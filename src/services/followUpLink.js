// A patient asks for a follow-up visit after a completed one: the new booking is linked to the old one, and the new PCR
// opens with the last visit's report next to it (read-only for the treating therapist, from 4 hours before the session).
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");

class FollowUpLinkError extends Error {
  constructor(httpStatus, message) { super(message); this.httpStatus = httpStatus; }
}

const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

/**
 * Check that `followUpOf` is a completed visit of this patient with no live follow-up booked yet.
 * Returns the id to store in appointments.follow_up_of, or null when the booking is not a follow-up.
 */
async function resolve(patientId, followUpOf, { transaction } = {}) {
  if (followUpOf === undefined || followUpOf === null || followUpOf === "") return null;
  const id = Number(followUpOf);
  if (!Number.isInteger(id) || id <= 0) throw new FollowUpLinkError(400, "followUpOf must be the id of an earlier visit");
  const [prev] = await q(`SELECT id, patient_id, status FROM appointments WHERE id = :id`, { id }, transaction);
  // same answer for "not yours" and "does not exist": nobody learns which visit ids exist
  if (!prev || String(prev.patient_id) !== String(patientId)) throw new FollowUpLinkError(404, "Earlier visit not found");
  if (prev.status !== "completed") throw new FollowUpLinkError(400, "A follow-up can be booked only after a completed visit");
  const [open] = await q(
    `SELECT id FROM appointments WHERE follow_up_of = :id AND status NOT LIKE 'cancelled%' AND status NOT IN ('proposal_expired', 'no_slot', 'declined') LIMIT 1`,
    { id }, transaction
  );
  if (open) throw new FollowUpLinkError(409, "A follow-up for this visit is already booked");
  return id;
}

/** The report of the visit this one follows: the linked visit, else the patient's latest locked report. */
async function lastVisitFor(patientId, appointmentId, followUpOf, transaction) {
  const base = `SELECT a.id AS "appointmentId", a.date, a.time, a.therapist_name AS "therapistName", a.therapy_type AS "therapyType",
      p.chief_complaint AS "chiefComplaint", p.assessment, p.diagnosis, p.treatment_provided AS "treatmentProvided", p.plan_of_care AS "planOfCare",
      p.bp, p.hr, p.rr, p.temp, p.functional_score AS "functionalScore", p.functional_measure AS "functionalMeasure", p.pain_vas AS "painVas",
      p.hep, p.next_treatment_date AS "nextTreatmentDate", p.session_type AS "sessionType", p.locked_at AS "lockedAt"
    FROM pcr p JOIN appointments a ON a.id = p.appointment_id`;
  if (followUpOf) {
    const [linked] = await q(`${base} WHERE a.id = :followUpOf AND a.patient_id = :patientId AND p.status = 'locked' LIMIT 1`, { followUpOf, patientId }, transaction);
    if (linked) return { ...linked, linked: true };
  }
  const [latest] = await q(
    `${base} WHERE a.patient_id = :patientId AND a.id <> :appointmentId AND p.status = 'locked' ORDER BY p.locked_at DESC NULLS LAST, p.id DESC LIMIT 1`,
    { patientId, appointmentId }, transaction
  );
  return latest ? { ...latest, linked: false } : null;
}

module.exports = { FollowUpLinkError, resolve, lastVisitFor };
