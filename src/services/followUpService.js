// Next-session proposals, holds, expiry and overdue flags (handoff pack P17).
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const rules = require("../config/businessRules");
const access = require("../utils/access");
const stateMachine = require("./appointmentStateMachine");
const slotService = require("./slotService");
const notificationStore = require("./notificationStore");

const { STATUS } = stateMachine;
const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const pad = (n) => String(n).padStart(2, "0");
const IST_MS = 5.5 * 3600 * 1000;
const istYmd = (ms) => { const d = new Date(ms + IST_MS); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const startIso = (date, time) => new Date(`${date}T${time.length === 5 ? time : time.slice(0, 5)}:00+05:30`).toISOString();
const dayLabel = (date, time) => `${new Date(`${date}T${time}:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} at ${time}`;

class FollowUpError extends Error {
  constructor(httpStatus, message) { super(message); this.httpStatus = httpStatus; }
}

/** The slots a "next session plan" asks for: one date/time, or weekdays x time x occurrences (max 12). */
function slotsFromPlan(plan, now = Date.now()) {
  if (plan.mode === "single") return [{ date: plan.date, time: plan.time }];
  if (plan.mode !== "series") return [];
  const wanted = Math.min(Number(plan.occurrences) || 0, rules.followUp.maxSeriesSessions);
  const weekdays = (plan.weekdays || []).map(Number);
  const out = [];
  let day = plan.startDate || istYmd(now + 86400000);
  for (let i = 0; i < 120 && out.length < wanted; i++) {
    const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekdays.includes(wd)) out.push({ date: day, time: plan.time });
    day = new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  }
  return out;
}

/** Checks the plan sent with a PCR. Throws FollowUpError (400) when it is not acceptable for this session type. */
function validatePlan(plan, { sessionType, planDischarged }) {
  if (!plan || !plan.mode) throw new FollowUpError(400, "Please choose what happens next: a next session, a series, 'patient will book later' or 'no further sessions'");
  if (!["single", "series", "later", "none"].includes(plan.mode)) throw new FollowUpError(400, "Unknown next-session option");
  if (plan.mode === "none" && sessionType !== "discharge" && !planDischarged) throw new FollowUpError(400, "'No further sessions' is only for a discharge visit");
  if (plan.mode === "later" && String(plan.reason || "").trim().length < 3) throw new FollowUpError(400, "Please say why the patient will book later");
  if (plan.mode === "single" && !(/^\d{4}-\d{2}-\d{2}$/.test(plan.date || "") && /^\d{1,2}:\d{2}$/.test(plan.time || ""))) throw new FollowUpError(400, "Please choose the date and time of the next session");
  if (plan.mode === "series") {
    if (!Array.isArray(plan.weekdays) || !plan.weekdays.length || !/^\d{1,2}:\d{2}$/.test(plan.time || "")) throw new FollowUpError(400, "Please choose weekdays and a time for the series");
    const n = Number(plan.occurrences);
    if (!(n >= 1 && n <= rules.followUp.maxSeriesSessions)) throw new FollowUpError(400, `A series can have 1 to ${rules.followUp.maxSeriesSessions} sessions`);
  }
}

const holdUntil = (startMs, now) => new Date(Math.min(now + rules.followUp.holdHours * 3600000, startMs - rules.followUp.mustConfirmHoursBefore * 3600000));

/** After the PCR is submitted: hold the recommended slots as 'proposed' bookings and tell the patient. */
async function createProposals({ pcrId, appointmentId, plan, now = Date.now() }) {
  if (!plan || !["single", "series"].includes(plan.mode)) return { created: [], noSlot: 0 };
  const [src] = await q(`SELECT a.*, tp.hourly_rate, u.name AS patient_name_u FROM appointments a LEFT JOIN therapist_profiles tp ON tp.user_id = a.therapist_id LEFT JOIN users u ON u.id = a.patient_id WHERE a.id = :id`, { id: appointmentId });
  if (!src) throw new FollowUpError(404, "Booking not found");
  const slots = slotsFromPlan(plan, now);
  let seriesId = null;
  if (plan.mode === "series") {
    const [s] = await q(`INSERT INTO followup_series (treatment_plan_id, patient_id, therapist_id, weekdays, time, start_date, occurrences) VALUES (:planId, :patientId, :therapistId, :weekdays::smallint[], :time, :startDate, :n) RETURNING id`,
      { planId: src.treatment_plan_id || null, patientId: src.patient_id, therapistId: src.therapist_id, weekdays: `{${(plan.weekdays || []).join(",")}}`, time: plan.time, startDate: slots[0] ? slots[0].date : null, n: slots.length });
    seriesId = s.id;
  }
  const created = [];
  let noSlot = 0;
  for (const slot of slots) {
    const t = await sequelize.transaction();
    try {
      await slotService.assertSlotBookable(src.therapist_id, slot.date, slot.time, { transaction: t, now });
      const amount = Number(src.hourly_rate) || Number(src.service_amount) || 0;
      const [appt] = await q(
        `INSERT INTO appointments (patient_id, patient_name, therapist_id, therapist_name, service_type_id, therapy_type, service_amount, total_amount, date, time, mode, service_address_id,
           status, verification_status, payment_status, pcr_status, price_source, treatment_plan_id, created_at)
         VALUES (:patientId, :patientName, :therapistId, :therapistName, :serviceTypeId, :therapyType, :amount, :amount, :date, :time, 'home', :addressId,
           'proposed', 'Not Verified', 'Pending', 'not_started', 'therapist_rate', :planId, NOW()) RETURNING id`,
        { patientId: src.patient_id, patientName: src.patient_name || src.patient_name_u, therapistId: src.therapist_id, therapistName: src.therapist_name, serviceTypeId: src.service_type_id, therapyType: src.therapy_type, amount, date: slot.date, time: slot.time.padStart(5, "0"), addressId: src.service_address_id, planId: src.treatment_plan_id || null }, t);
      const startMs = new Date(startIso(slot.date, slot.time.padStart(5, "0"))).getTime();
      await q(`INSERT INTO followup_proposals (source_pcr_id, treatment_plan_id, patient_id, therapist_id, proposed_start, series_id, appointment_id, status, hold_expires_at) VALUES (:pcrId, :planId, :patientId, :therapistId, :start, :seriesId, :apptId, 'proposed', :hold)`,
        { pcrId, planId: src.treatment_plan_id || null, patientId: src.patient_id, therapistId: src.therapist_id, start: new Date(startMs).toISOString(), seriesId, apptId: appt.id, hold: holdUntil(startMs, now).toISOString() }, t);
      await q(`INSERT INTO appointment_status_history (appointment_id, from_status, to_status, actor_id, note) VALUES (:id, NULL, 'proposed', :actor, 'recommended in the PCR')`, { id: appt.id, actor: src.therapist_id }, t);
      await t.commit();
      created.push(appt.id);
    } catch (err) {
      await t.rollback();
      if (!(err instanceof slotService.SlotError) && !slotService.isSlotConflict(err)) throw err;
      noSlot += 1;
      await q(`INSERT INTO followup_proposals (source_pcr_id, treatment_plan_id, patient_id, therapist_id, proposed_start, series_id, status) VALUES (:pcrId, :planId, :patientId, :therapistId, :start, :seriesId, 'no_slot')`,
        { pcrId, planId: src.treatment_plan_id || null, patientId: src.patient_id, therapistId: src.therapist_id, start: startIso(slot.date, slot.time.padStart(5, "0")), seriesId });
    }
  }
  if (created.length) {
    const first = slots.find((s, i) => i >= 0);
    await notificationStore.notify(src.patient_id, {
      type: "followup_proposed", title: "Your next session",
      message: created.length > 1 ? `Your therapist recommends ${created.length} sessions starting ${dayLabel(first.date, first.time.padStart(5, "0"))}. Confirm to keep these slots.` : `Your therapist recommends your next session on ${dayLabel(first.date, first.time.padStart(5, "0"))}. Confirm to keep this slot.`,
      link: "/dashboard/bookings",
    });
  }
  if (noSlot) {
    await notificationStore.notify(src.therapist_id, {
      type: "followup_no_slot", title: "A recommended time is no longer free",
      message: `${noSlot} of the recommended times could not be held. Please pick another time for the patient.`, link: "/dashboard/therapist/schedule",
    });
  }
  return { created, noSlot };
}

// ---- patient responses ---------------------------------------------------------------------------------
async function loadForPatient(proposalId, userId) {
  const [p] = await q(`SELECT fp.*, a.status AS appt_status, a.date, a.time FROM followup_proposals fp JOIN appointments a ON a.id = fp.appointment_id WHERE fp.id = :id`, { id: proposalId });
  if (!p) throw new FollowUpError(404, "Proposal not found");
  if (!access.same(p.patient_id, userId)) throw new FollowUpError(403, "Forbidden");
  return p;
}

/** "Confirm all": the patient commits to the series; each session is then paid as it comes (via Pay now). */
async function confirmSeries(proposalId, user, now = Date.now()) {
  const p = await loadForPatient(proposalId, user.id);
  if (!["proposed", "changed"].includes(p.status) || p.appt_status !== STATUS.PROPOSED) throw new FollowUpError(409, "This proposal can no longer be confirmed");
  const siblings = p.series_id
    ? await q(`SELECT fp.id, fp.appointment_id FROM followup_proposals fp JOIN appointments a ON a.id = fp.appointment_id WHERE fp.series_id = :s AND fp.patient_id = :patient AND fp.status IN ('proposed', 'changed') AND a.status = 'proposed'`, { s: p.series_id, patient: user.id })
    : [{ id: p.id, appointment_id: p.appointment_id }];
  for (const s of siblings) {
    await stateMachine.transition(s.appointment_id, STATUS.ACCEPTED_UNPAID, user, { note: "patient confirmed the recommended session" });
    const [a] = await q(`SELECT date, time FROM appointments WHERE id = :id`, { id: s.appointment_id });
    const start = access.slotStart(a).getTime();
    await q(`UPDATE followup_proposals SET status = 'confirmed', patient_response_at = NOW(), hold_expires_at = :hold WHERE id = :id`, { id: s.id, hold: new Date(start - rules.followUp.mustConfirmHoursBefore * 3600000).toISOString() });
  }
  return { confirmed: siblings.map((s) => s.appointment_id) };
}

/** The patient picks another time from the therapist's free slots; the booking keeps proposing until they confirm. */
async function changeTime(proposalId, user, { date, time }, now = Date.now()) {
  const p = await loadForPatient(proposalId, user.id);
  if (!["proposed", "changed"].includes(p.status) || p.appt_status !== STATUS.PROPOSED) throw new FollowUpError(409, "This proposal can no longer be changed");
  const t = await sequelize.transaction();
  try {
    await slotService.assertSlotBookable(p.therapist_id, date, time, { transaction: t, now, ignoreAppointmentId: p.appointment_id });
    await q(`UPDATE appointments SET date = :date, time = :time WHERE id = :id`, { date, time: time.padStart(5, "0"), id: p.appointment_id }, t);
    const startMs = new Date(startIso(date, time.padStart(5, "0"))).getTime();
    await q(`UPDATE followup_proposals SET status = 'changed', proposed_start = :start, patient_response_at = NOW(), hold_expires_at = :hold WHERE id = :id`, { id: p.id, start: new Date(startMs).toISOString(), hold: holdUntil(startMs, now).toISOString() }, t);
    await t.commit();
  } catch (err) {
    await t.rollback();
    if (err instanceof slotService.SlotError) throw new FollowUpError(err.httpStatus, err.message);
    if (slotService.isSlotConflict(err)) throw new FollowUpError(409, "Slot no longer available");
    throw err;
  }
  return { ok: true };
}

async function decline(proposalId, user) {
  const p = await loadForPatient(proposalId, user.id);
  if (!["proposed", "changed"].includes(p.status) || p.appt_status !== STATUS.PROPOSED) throw new FollowUpError(409, "This proposal can no longer be declined");
  await stateMachine.transition(p.appointment_id, STATUS.PROPOSAL_DECLINED, user, { note: "declined by the patient" });
  await q(`UPDATE followup_proposals SET status = 'declined', patient_response_at = NOW() WHERE id = :id`, { id: p.id });
  await notificationStore.notify(p.therapist_id, { type: "followup_declined", title: "A recommended session was declined", message: "Your patient declined a recommended session.", link: "/dashboard/therapist/schedule" });
  return { ok: true };
}

// ---- jobs ------------------------------------------------------------------------------------------------------
/** Every 10 minutes: one nudge, then release proposals nobody confirmed (and series sessions nobody paid) at hold expiry. */
async function expireHolds(now = Date.now()) {
  let expired = 0, nudged = 0;
  const nudgeBefore = new Date(now - rules.followUp.nudgeAfterHours * 3600000).toISOString();
  const waiting = await q(
    `SELECT fp.id, fp.appointment_id, fp.patient_id FROM followup_proposals fp
     WHERE fp.status IN ('proposed', 'changed') AND fp.created_at <= :nudgeBefore AND fp.hold_expires_at > :now`,
    { nudgeBefore, now: new Date(now).toISOString() }
  );
  for (const w of waiting) {
    const claimed = await q(`INSERT INTO reminder_log (appointment_id, user_id, type) VALUES (:a, :u, 'followup_nudge') ON CONFLICT DO NOTHING RETURNING id`, { a: w.appointment_id, u: w.patient_id });
    if (claimed.length) {
      await notificationStore.notify(w.patient_id, { type: "followup_nudge", title: "Keep your next session", message: "Your recommended session is still waiting for you. Confirm soon to keep the slot.", link: "/dashboard/bookings" });
      nudged += 1;
    }
  }
  const due = await q(
    `SELECT fp.id, fp.appointment_id, fp.patient_id, fp.therapist_id, a.status AS appt_status FROM followup_proposals fp JOIN appointments a ON a.id = fp.appointment_id
     WHERE fp.status IN ('proposed', 'changed', 'confirmed') AND fp.hold_expires_at <= :now AND a.status IN ('proposed', 'accepted_unpaid') AND a.payment_status <> 'Paid'`,
    { now: new Date(now).toISOString() }
  );
  for (const d of due) {
    try {
      await stateMachine.transition(d.appointment_id, STATUS.PROPOSAL_EXPIRED, { system: true }, { note: "hold expired" });
    } catch (err) { if (err instanceof stateMachine.TransitionError) continue; throw err; }
    await q(`UPDATE followup_proposals SET status = 'expired' WHERE id = :id`, { id: d.id });
    await notificationStore.notify(d.patient_id, { type: "followup_expired", title: "A recommended session was released", message: "The slot we held for your next session was released because it was not confirmed in time. You can book again anytime.", link: "/dashboard/bookings" });
    await notificationStore.notify(d.therapist_id, { type: "followup_expired", title: "A recommended session was released", message: "A recommended session was not confirmed in time and the slot is free again.", link: "/dashboard/therapist/schedule" });
    expired += 1;
  }
  return { expired, nudged };
}

/** Daily: a patient with an active plan and no future session for too long is flagged and told (once). */
async function markOverdue(now = Date.now()) {
  const today = istYmd(now);
  const plans = await q(`SELECT * FROM treatment_plans WHERE status = 'active'`, {});
  let flagged = 0;
  for (const plan of plans) {
    const [future] = await q(
      `SELECT 1 FROM appointments WHERE patient_id = :p AND date >= :today::date AND status IN ('proposed', 'accepted_unpaid', 'pending_payment', 'confirmed', 'therapist_on_the_way', 'arrived', 'in_progress') LIMIT 1`,
      { p: plan.patient_id, today }
    );
    const [last] = await q(`SELECT to_char(MAX(date), 'YYYY-MM-DD') AS d FROM appointments WHERE patient_id = :p AND status IN ('completed', 'pcr_pending')`, { p: plan.patient_id });
    const gapDays = 7 / (Number(plan.frequency_per_week) || 1) + rules.followUp.overdueGraceDays;
    const lastMs = last && last.d ? new Date(`${last.d}T00:00:00Z`).getTime() : null;
    const overdue = !future && lastMs !== null && (new Date(`${today}T00:00:00Z`).getTime() - lastMs) / 86400000 > gapDays;
    if (overdue && !plan.follow_up_overdue) {
      await q(`UPDATE treatment_plans SET follow_up_overdue = true WHERE id = :id`, { id: plan.id });
      await notificationStore.notify(plan.patient_id, { type: "followup_overdue", title: "Time to book your next session", message: "It has been a while since your last session. Book your next one to keep your recovery on track.", link: "/dashboard/bookings" });
      if (plan.primary_therapist_id) await notificationStore.notify(plan.primary_therapist_id, { type: "followup_overdue", title: "A patient has no next session booked", message: "One of your patients has no upcoming session booked.", link: "/dashboard/therapist/my-dashboard" });
      flagged += 1;
    } else if (!overdue && plan.follow_up_overdue) {
      await q(`UPDATE treatment_plans SET follow_up_overdue = false WHERE id = :id`, { id: plan.id });
    }
  }
  return { flagged };
}

module.exports = { FollowUpError, slotsFromPlan, validatePlan, createProposals, confirmSeries, changeTime, decline, expireHolds, markOverdue };
