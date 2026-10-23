// A patient asks for a follow-up visit after a completed one: the new booking is linked to the old one, and the new PCR
// opens with the last visit's report next to it (read-only for the treating therapist, from 4 hours before the session).
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");

class FollowUpLinkError extends Error {
  constructor(httpStatus, message) { super(message); this.httpStatus = httpStatus; }
}

const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

async function loadOwned(patientId, id, transaction) {
  const [prev] = await q(`SELECT id, patient_id, status FROM appointments WHERE id = :id`, { id }, transaction);
  // same answer for "not yours" and "does not exist": nobody learns which visit ids exist
  if (!prev || String(prev.patient_id) !== String(patientId)) throw new FollowUpLinkError(404, "Earlier visit not found");
  if (prev.status !== "completed") throw new FollowUpLinkError(400, "A follow-up can be booked only after a completed visit");
  return prev;
}

/**
 * What the patient may do for a follow-up of this completed visit:
 *   { mode: "dates", dates: [...] }  only on the dates the doctor recommended in the report
 *   { mode: "any" }                  the doctor left it to the patient ("book later") or recommended nothing; or the recommended dates have passed
 *   { mode: "none" }                 the doctor recorded "no further sessions"
 *   { mode: "proposed" }             the doctor's slot is already held for the patient: confirm it from the dashboard
 *   { mode: "booked" }               a follow-up is already booked
 */
async function options(patientId, followUpOf, { transaction } = {}) {
  const id = Number(followUpOf);
  if (!Number.isInteger(id) || id <= 0) throw new FollowUpLinkError(400, "followUpOf must be the id of an earlier visit");
  await loadOwned(patientId, id, transaction);
  const [live] = await q(
    `SELECT id, status FROM appointments WHERE follow_up_of = :id AND status NOT LIKE 'cancelled%' AND status NOT IN ('proposal_expired', 'no_slot', 'declined') ORDER BY (status = 'proposed') DESC LIMIT 1`,
    { id }, transaction
  );
  if (live && live.status === "proposed") return { mode: "proposed", message: "Your therapist has already reserved a follow-up for you. Confirm it from your dashboard." };
  if (live) return { mode: "booked", message: "A follow-up for this visit is already booked" };

  const [report] = await q(`SELECT id, next_session_plan AS plan FROM pcr WHERE appointment_id = :id AND status = 'locked' ORDER BY id DESC LIMIT 1`, { id }, transaction);
  const plan = report && report.plan;
  if (!plan || !plan.mode || plan.mode === "later") return { mode: "any" };
  if (plan.mode === "none") return { mode: "none", message: "Your therapist has recorded that no further sessions are needed. Please ask for a new assessment if you need more care." };
  // the dates the doctor asked for: every proposal made from this report (any status), else the single date in the plan
  const rows = await q(`SELECT DISTINCT to_char(proposed_start AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS d FROM followup_proposals WHERE source_pcr_id = :pcrId ORDER BY 1`, { pcrId: report.id }, transaction);
  let dates = rows.map((r) => r.d);
  if (!dates.length && plan.mode === "single" && plan.date) dates = [plan.date];
  const today = istToday();
  const future = dates.filter((d) => d >= today);
  if (!future.length) return { mode: "any", note: "The date your therapist suggested has passed. Please choose a new date." };
  return { mode: "dates", dates: future };
}

/**
 * Check that `followUpOf` is a completed visit of this patient and that the booking `date` is one the doctor allowed.
 * Returns the id to store in appointments.follow_up_of, or null when the booking is not a follow-up.
 */
async function resolve(patientId, followUpOf, { transaction, date } = {}) {
  if (followUpOf === undefined || followUpOf === null || followUpOf === "") return null;
  const o = await options(patientId, followUpOf, { transaction });
  if (o.mode === "booked") throw new FollowUpLinkError(409, o.message);
  if (o.mode === "proposed") throw new FollowUpLinkError(409, o.message);
  if (o.mode === "none") throw new FollowUpLinkError(400, o.message);
  if (o.mode === "dates" && !o.dates.includes(String(date || "").slice(0, 10))) {
    throw new FollowUpLinkError(400, `Your therapist asked for this follow-up on ${o.dates.join(", ")}. Please choose ${o.dates.length > 1 ? "one of those dates" : "that date"}.`);
  }
  return Number(followUpOf);
}

/** The report of the patient's latest locked visit before this one. `linked` says it is the visit this follow-up was booked from. */
async function lastVisitFor(patientId, appointmentId, followUpOf, transaction) {
  const [latest] = await q(
    `SELECT a.id AS "appointmentId", a.date, a.time, a.therapist_name AS "therapistName", a.therapy_type AS "therapyType",
      p.chief_complaint AS "chiefComplaint", p.assessment, p.diagnosis, p.treatment_provided AS "treatmentProvided", p.plan_of_care AS "planOfCare",
      p.bp, p.hr, p.rr, p.temp, p.functional_score AS "functionalScore", p.functional_measure AS "functionalMeasure", p.pain_vas AS "painVas",
      p.hep, p.next_treatment_date AS "nextTreatmentDate", p.session_type AS "sessionType", p.locked_at AS "lockedAt"
     FROM pcr p JOIN appointments a ON a.id = p.appointment_id
     WHERE a.patient_id = :patientId AND a.id <> :appointmentId AND p.status = 'locked'
     ORDER BY p.locked_at DESC NULLS LAST, p.id DESC LIMIT 1`,
    { patientId, appointmentId }, transaction
  );
  return latest ? { ...latest, linked: Boolean(followUpOf) && String(latest.appointmentId) === String(followUpOf) } : null;
}

module.exports = { FollowUpLinkError, options, resolve, lastVisitFor };
