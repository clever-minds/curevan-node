// Cancellation policy (handoff pack P14, owner decision D2). All numbers come from businessRules.cancellation.
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const rules = require("../config/businessRules");
const access = require("../utils/access");

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * What would this cancellation cost?
 *   appointment : row with total_amount (or service_amount), payment_status, status, created_at, date/time
 *   role        : 'patient' | 'therapist' | 'admin'
 *   opts.noShow : the patient did not turn up
 * Returns { band, chargePct, chargeInr, refundInr, amountInr, paid, hoursBefore }
 */
function quote(appointment, role, now = Date.now(), opts = {}) {
  const c = rules.cancellation;
  const amountInr = r2(appointment.total_amount ?? appointment.service_amount ?? 0);
  const paid = appointment.payment_status === "Paid" || appointment.payment_status === "Partially Refunded";
  const start = access.slotStart(appointment);
  const hoursBefore = start ? (start.getTime() - now) / 3600000 : null;

  const build = (band, chargePct) => {
    const chargeInr = paid ? r2((amountInr * chargePct) / 100) : 0;
    return { band, chargePct: paid ? chargePct : 0, chargeInr, refundInr: paid ? r2(amountInr - chargeInr) : 0, amountInr, paid, hoursBefore };
  };

  if (role === "therapist" || role === "admin") return build(role, 0);     // the patient always gets everything back
  if (opts.noShow) return build("no_show", c.lateChargePct);

  const createdMs = appointment.created_at ? new Date(appointment.created_at).getTime() : null;
  if (createdMs && now - createdMs <= c.graceMinutesAfterBooking * 60000) return build("grace", 0);

  const waitingForTherapist = ["confirmed", "therapist_on_the_way"].includes(appointment.status);
  if (start && waitingForTherapist && now > start.getTime() + c.therapistLateMinutes * 60000) return build("therapist_late", 0);

  if (hoursBefore === null || hoursBefore >= c.freeHoursBefore) return build("free", 0);
  if (hoursBefore >= c.partialHoursBefore) return build("partial", c.partialChargePct);
  return build("late", c.lateChargePct);
}

/** Which share of the charge goes to the therapist: everything except the platform fee of their tier (D4/D5). */
async function therapistShare(therapistId, chargeInr, transaction) {
  if (!therapistId || !(chargeInr > 0)) return 0;
  const [tp] = await sequelize.query(
    `SELECT membership_plan FROM therapist_profiles WHERE user_id = :id`,
    { replacements: { id: therapistId }, type: QueryTypes.SELECT, transaction }
  );
  const feePct = tp && tp.membership_plan === "premium" ? rules.payout.premiumFeePct : rules.payout.standardFeePct;
  return r2(chargeInr * (1 - feePct / 100));
}

/** Store the outcome on the booking (the status itself is changed by the state machine). */
async function recordOutcome(appointment, q, { actorId, reason, transaction } = {}) {
  const share = await therapistShare(appointment.therapist_id, q.chargeInr, transaction);
  await sequelize.query(
    `UPDATE appointments
     SET cancelled_at = COALESCE(cancelled_at, NOW()), cancelled_by = :actorId, cancel_reason = :reason,
         cancellation_reason = COALESCE(:reason, cancellation_reason),
         cancellation_charge = :charge, refund_amount = :refund, cancellation_therapist_share = :share
     WHERE id = :id`,
    { replacements: { id: appointment.id, actorId: actorId ?? null, reason: reason || null, charge: q.chargeInr, refund: q.refundInr, share }, type: QueryTypes.UPDATE, transaction }
  );
  return share;
}

async function reliabilityEvent(therapistId, appointmentId, type, transaction) {
  if (!therapistId) return;
  await sequelize.query(
    `INSERT INTO therapist_reliability_events (therapist_id, appointment_id, type) VALUES (:therapistId, :appointmentId, :type)`,
    { replacements: { therapistId, appointmentId, type }, type: QueryTypes.INSERT, transaction }
  );
}

module.exports = { quote, recordOutcome, reliabilityEvent, therapistShare };
