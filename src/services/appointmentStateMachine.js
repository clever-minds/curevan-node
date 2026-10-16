// The ONE place that decides how an appointment may change status (handoff pack P12).
// Nothing else should write appointments.status directly.
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const access = require("../utils/access");
const rules = require("../config/businessRules");
const otpService = require("./otpService");

const STATUS = Object.freeze({
  PENDING_PAYMENT: "pending_payment",
  SEARCHING: "searching_therapist",
  ACCEPTED_UNPAID: "accepted_unpaid",
  CONFIRMED: "confirmed",
  ON_THE_WAY: "therapist_on_the_way",
  ARRIVED: "arrived",
  IN_PROGRESS: "in_progress",
  PCR_PENDING: "pcr_pending",
  COMPLETED: "completed",
  CANCELLED_PATIENT: "cancelled_by_patient",
  CANCELLED_THERAPIST: "cancelled_by_therapist",
  CANCELLED_ADMIN: "cancelled_by_admin",
  CANCELLED_UNPAID: "cancelled_unpaid",
  NO_SHOW: "no_show",
});

// states in which a booking is still alive (cancel / no-show are allowed from these)
const ACTIVE = [STATUS.PENDING_PAYMENT, STATUS.SEARCHING, STATUS.ACCEPTED_UNPAID, STATUS.CONFIRMED, STATUS.ON_THE_WAY, STATUS.ARRIVED, STATUS.IN_PROGRESS];
const TERMINAL = [STATUS.COMPLETED, STATUS.CANCELLED_PATIENT, STATUS.CANCELLED_THERAPIST, STATUS.CANCELLED_ADMIN, STATUS.CANCELLED_UNPAID, STATUS.NO_SHOW];

// who: system | therapist (the assigned one) | patient (the owner) | admin
const TRANSITIONS = [
  { from: [STATUS.PENDING_PAYMENT], to: STATUS.CONFIRMED, who: ["system"] },
  { from: [STATUS.SEARCHING], to: STATUS.ACCEPTED_UNPAID, who: ["therapist", "system"] },
  { from: [STATUS.ACCEPTED_UNPAID], to: STATUS.CONFIRMED, who: ["system"] },
  { from: [STATUS.CONFIRMED], to: STATUS.ON_THE_WAY, who: ["therapist"] },
  { from: [STATUS.ON_THE_WAY], to: STATUS.ARRIVED, who: ["therapist"] },
  { from: [STATUS.ARRIVED], to: STATUS.IN_PROGRESS, who: ["system"] },          // only after the OTP check
  { from: [STATUS.IN_PROGRESS], to: STATUS.PCR_PENDING, who: ["therapist"] },
  { from: [STATUS.PCR_PENDING], to: STATUS.COMPLETED, who: ["system"] },          // when the PCR is submitted
  { from: ACTIVE, to: STATUS.CANCELLED_PATIENT, who: ["patient"] },
  { from: ACTIVE, to: STATUS.CANCELLED_THERAPIST, who: ["therapist"] },
  { from: ACTIVE, to: STATUS.CANCELLED_ADMIN, who: ["admin"] },
  { from: ACTIVE, to: STATUS.NO_SHOW, who: ["therapist", "admin"] },
  { from: [STATUS.PENDING_PAYMENT, STATUS.ACCEPTED_UNPAID], to: STATUS.CANCELLED_UNPAID, who: ["system"] },
];

// timestamp column that is stamped when a booking enters a status
const STAMP = {
  [STATUS.ON_THE_WAY]: "travel_started_at",
  [STATUS.ARRIVED]: "arrived_at",
  [STATUS.IN_PROGRESS]: "session_started_at",
  [STATUS.PCR_PENDING]: "session_ended_at",
  [STATUS.COMPLETED]: "completed_at",
};

/** Old display labels -> codes (used for incoming filters / old clients). */
const LEGACY = {
  Pending: STATUS.PENDING_PAYMENT, "Pending Approval": STATUS.SEARCHING, "Payment Pending": STATUS.ACCEPTED_UNPAID,
  Accepted: STATUS.ACCEPTED_UNPAID, Confirmed: STATUS.CONFIRMED, Assigned: STATUS.CONFIRMED,
  Navigating: STATUS.ON_THE_WAY, "On The Way": STATUS.ON_THE_WAY, Arrived: STATUS.ARRIVED,
  "In Progress": STATUS.IN_PROGRESS, "Session Started": STATUS.IN_PROGRESS,
  Searching: STATUS.SEARCHING, "Searching Therapist": STATUS.SEARCHING,
  Completed: STATUS.COMPLETED, Cancelled: STATUS.CANCELLED_ADMIN, Rejected: STATUS.CANCELLED_THERAPIST, "No-Show": STATUS.NO_SHOW,
};
const normalize = (s) => (Object.values(STATUS).includes(s) ? s : LEGACY[s] || s);

function rolesOf(actor, appt) {
  if (!actor) return [];
  if (actor.system) return ["system"];
  const out = [];
  if (access.isAdmin(actor)) out.push("admin");
  if (appt.therapist_id && access.same(appt.therapist_id, actor.id)) out.push("therapist");
  if (access.same(appt.patient_id, actor.id)) out.push("patient");
  return out;
}

class TransitionError extends Error {
  constructor(httpStatus, message) { super(message); this.httpStatus = httpStatus; }
}

/**
 * Move an appointment to `to`. Throws TransitionError (404 / 403 / 409) when it is not allowed.
 * actor = req.user, or { system: true } for payment verification, cron and the OTP check.
 * Pass opts.transaction to join a caller's transaction.
 */
async function transition(appointmentId, to, actor, opts = {}) {
  to = normalize(to);
  const own = !opts.transaction;
  const t = opts.transaction || (await sequelize.transaction());
  try {
    const [appt] = await sequelize.query(
      `SELECT * FROM appointments WHERE id = :id FOR UPDATE`,
      { replacements: { id: appointmentId }, type: QueryTypes.SELECT, transaction: t }
    );
    if (!appt) throw new TransitionError(404, "Appointment not found");

    const from = appt.status;
    const rule = TRANSITIONS.find((r) => r.to === to && r.from.includes(from));
    if (!rule) throw new TransitionError(409, `Cannot change an appointment from "${from}" to "${to}"`);

    const actorRoles = rolesOf(actor, appt);
    if (!rule.who.some((w) => actorRoles.includes(w))) {
      throw new TransitionError(403, "You are not allowed to make this change");
    }

    if (to === STATUS.ON_THE_WAY) {
      const start = access.slotStart(appt);
      if (start && Date.now() < start.getTime() - rules.visit.travelFromMinutesBefore * 60000) {
        throw new TransitionError(409, `You can start travelling ${rules.visit.travelFromMinutesBefore} minutes before the slot`);
      }
    }

    const sets = ["status = :to"];
    const rep = { id: appointmentId, to };
    if (STAMP[to]) sets.push(`${STAMP[to]} = NOW()`);
    if (to === STATUS.CONFIRMED) {            // a code is prepared now; the patient sees a fresh one when asking for it
      sets.push("start_otp_hash = :otpHash", "otp_attempts = 0");
      rep.otpHash = otpService.issue(appointmentId).hash;
    }
    for (const [col, val] of Object.entries(opts.extra || {})) {   // column names come from our own code only
      sets.push(`${col} = :x_${col}`);
      rep[`x_${col}`] = val;
    }
    await sequelize.query(`UPDATE appointments SET ${sets.join(", ")} WHERE id = :id`, { replacements: rep, type: QueryTypes.UPDATE, transaction: t });

    await sequelize.query(
      `INSERT INTO appointment_status_history (appointment_id, from_status, to_status, actor_id, note)
       VALUES (:id, :from, :to, :actorId, :note)`,
      { replacements: { id: appointmentId, from, to, actorId: actor && !actor.system ? actor.id : null, note: opts.note || (actor && actor.system ? "system" : null) }, type: QueryTypes.INSERT, transaction: t }
    );

    if (own) await t.commit();
    return { from, to, appointment: { ...appt, status: to } };
  } catch (err) {
    if (own) await t.rollback();
    throw err;
  }
}

module.exports = { STATUS, ACTIVE, TERMINAL, TRANSITIONS, TransitionError, transition, normalize };
