// Clinical-record rules from handoff pack P15: who may see what and when, validation, hash, access log.
const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const access = require("../utils/access");

const HISTORY_OPENS_HOURS_BEFORE = 4;   // the assigned therapist may read the patient's earlier PCRs from T-4 h

const logAccess = (pcrId, userId, action, note = null, transaction) =>
  sequelize.query(
    `INSERT INTO pcr_access_log (pcr_id, user_id, action, note) VALUES (:pcrId, :userId, :action, :note)`,
    { replacements: { pcrId, userId: userId ?? null, action, note }, type: QueryTypes.INSERT, transaction }
  ).catch((e) => console.error("pcr access log failed:", e.message));

/** True from 4 hours before the slot start. */
function historyOpen(appt, now = Date.now()) {
  const start = access.slotStart(appt);
  return !!start && now >= start.getTime() - HISTORY_OPENS_HOURS_BEFORE * 3600000;
}

/** The therapist may edit once the start code was verified (booking in progress, or waiting for the PCR). */
const therapistCanEdit = (appt) => ["in_progress", "pcr_pending"].includes(appt.status);

/** Baseline for a patient's next PCR: taken from their latest locked PCR (any therapist). Vitals, notes, HEP and scores start empty. */
async function carryForwardBaseline(patientId, exceptAppointmentId, transaction) {
  const [prev] = await sequelize.query(
    `SELECT p.baseline, p.chief_complaint, p.diagnosis FROM pcr p JOIN appointments a ON a.id = p.appointment_id
     WHERE a.patient_id = :patientId AND a.id <> :exceptId AND p.status = 'locked'
     ORDER BY p.locked_at DESC NULLS LAST, p.id DESC LIMIT 1`,
    { replacements: { patientId, exceptId: exceptAppointmentId }, type: QueryTypes.SELECT, transaction }
  );
  if (!prev) return null;
  const b = prev.baseline || {};
  return {
    chiefComplaint: b.chiefComplaint ?? prev.chief_complaint ?? "",
    diagnosis: b.diagnosis ?? prev.diagnosis ?? "",
    medicalHistory: b.medicalHistory ?? "",
    allergies: b.allergies ?? "",
    longTermGoal: b.longTermGoal ?? "",
  };
}

const present = (v) => v !== null && v !== undefined && String(v).replace(/<[^>]*>/g, "").trim() !== "";

/** What must be filled before a PCR can be submitted. Returns the list of missing field names. */
function missingForSubmit(m) {
  const missing = [];
  for (const [key, label] of [["bp", "BP"], ["hr", "heart rate"], ["rr", "respiratory rate"], ["temp", "temperature"]]) if (!present(m[key])) missing.push(label);
  if (!present(m.assessment)) missing.push("assessment");
  if (!present(m.treatment_provided)) missing.push("treatment provided");
  if (!present(m.hep)) missing.push("home exercise programme");
  const fs = Number(m.functional_score), pv = Number(m.pain_vas);
  if (m.functional_score === null || m.functional_score === undefined || m.functional_score === "" || !(fs >= 1 && fs <= 10)) missing.push("functional score (1-10)");
  if (m.pain_vas === null || m.pain_vas === undefined || m.pain_vas === "" || !(pv >= 0 && pv <= 10)) missing.push("pain score (0-10)");
  return missing;
}

/** SHA-256 over the clinical content of the PCR (not its bookkeeping), so later edits are detectable. */
function contentHash(row) {
  const content = {
    id: row.id, appointment_id: row.appointment_id, patient_id: row.patient_id, therapist_id: row.therapist_id,
    chief_complaint: row.chief_complaint, assessment: row.assessment, diagnosis: row.diagnosis,
    treatment_provided: row.treatment_provided, plan_of_care: row.plan_of_care, bp: row.bp, hr: row.hr, rr: row.rr, temp: row.temp,
    functional_score: row.functional_score, pain_vas: row.pain_vas, functional_measure: row.functional_measure,
    hep: row.hep, baseline: row.baseline, next_treatment_date: row.next_treatment_date,
  };
  return crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

module.exports = { logAccess, historyOpen, therapistCanEdit, carryForwardBaseline, missingForSubmit, contentHash, HISTORY_OPENS_HOURS_BEFORE };
