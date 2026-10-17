// Treatment plans, due outcome measures, PCR hooks and progress reports (handoff pack P16).
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const { planProgress } = require("./progressService");
const { generateProgressPdf } = require("./progressReportPdf");

class ClinicalError extends Error {
  constructor(httpStatus, message, extra = {}) { super(message); this.httpStatus = httpStatus; this.extra = extra; }
}

const SESSION_TYPES = ["initial_assessment", "follow_up", "review", "discharge"];

/** The patient's active plan for a service type (or any active plan when the booking has no service type). */
async function activePlan(patientId, serviceTypeId, transaction) {
  const [plan] = await sequelize.query(
    `SELECT * FROM treatment_plans WHERE patient_id = :patientId AND status = 'active'
       AND (:serviceTypeId::int IS NULL OR service_type_id IS NULL OR service_type_id = :serviceTypeId::int)
     ORDER BY id DESC LIMIT 1`,
    { replacements: { patientId, serviceTypeId: serviceTypeId ?? null }, type: QueryTypes.SELECT, transaction }
  );
  return plan || null;
}

/** Later bookings of the same patient + service type join the active plan automatically. */
async function linkAppointment(appointmentId, transaction) {
  const [appt] = await sequelize.query(`SELECT id, patient_id, service_type_id, treatment_plan_id FROM appointments WHERE id = :id`, { replacements: { id: appointmentId }, type: QueryTypes.SELECT, transaction });
  if (!appt) return null;
  if (appt.treatment_plan_id) return appt.treatment_plan_id;
  const plan = await activePlan(appt.patient_id, appt.service_type_id, transaction);
  if (!plan) return null;
  await sequelize.query(`UPDATE appointments SET treatment_plan_id = :planId WHERE id = :id`, { replacements: { planId: plan.id, id: appointmentId }, type: QueryTypes.UPDATE, transaction });
  return plan.id;
}

/** 1-based number of this visit in the plan: finished PCRs of the plan before it, plus one. */
async function sessionNumberFor(planId, pcrId, transaction) {
  const [row] = await sequelize.query(
    `SELECT COUNT(*)::int AS n FROM pcr WHERE treatment_plan_id = :planId AND id <> :pcrId AND LOWER(status) IN ('submitted', 'locked')`,
    { replacements: { planId, pcrId }, type: QueryTypes.SELECT, transaction }
  );
  return row.n + 1;
}

/** Which measures must be recorded at this visit, with the last value seen (shown next to the input). */
async function dueMeasures(plan, sessionType, sessionNumber, transaction) {
  const rows = await sequelize.query(
    `SELECT pm.id AS plan_measure_id, pm.side, pm.item, m.id AS measure_id, m.code, m.name, m.scale_type, m.min_value, m.max_value, m.unit,
            m.higher_is_better, m.frequency, m.instructions, m.sub_items,
            (SELECT r.value FROM outcome_results r WHERE r.plan_id = pm.plan_id AND r.measure_id = pm.measure_id
               AND (pm.side IS NULL OR r.side = pm.side) AND (pm.item IS NULL OR r.item = pm.item) ORDER BY r.recorded_at DESC, r.id DESC LIMIT 1) AS last_value
     FROM plan_measures pm JOIN outcome_measures m ON m.id = pm.measure_id
     WHERE pm.plan_id = :planId AND m.active ORDER BY pm.id`,
    { replacements: { planId: plan.id }, type: QueryTypes.SELECT, transaction }
  );
  const every = Number(plan.review_every_sessions) || 5;
  const isReviewVisit = sessionType === "review" || sessionType === "discharge" || (sessionNumber > 0 && sessionNumber % every === 0);
  return rows.filter((m) => {
    if (sessionType === "initial_assessment") return true;                  // baseline: everything
    if (m.frequency === "every_session") return true;
    if (m.frequency === "review") return isReviewVisit;
    if (m.frequency === "baseline_discharge") return sessionType === "discharge" || isReviewVisit;
    return false;
  }).map((m) => ({ ...m, last_value: m.last_value === null ? null : Number(m.last_value) }));
}

const assessmentPoint = (sessionType, sessionNumber, plan) => {
  if (sessionType === "initial_assessment") return "baseline";
  if (sessionType === "discharge") return "discharge";
  if (sessionType === "review" || (sessionNumber % (Number(plan.review_every_sessions) || 5) === 0)) return "review";
  return "session";
};

/**
 * Called inside the PCR transaction when a PCR is saved.
 *  - always: session type, plan link, session number
 *  - on submit: due measures must be recorded (or "could not assess" + reason), results are stored,
 *    goal statuses updated; review/discharge need the therapist's summary
 * Returns { reportToMake } for the caller to build after the commit.
 */
async function onPcrSave({ t, pcr, appointment, userId, data, submitting }) {
  const sessionType = SESSION_TYPES.includes(data.sessionType) ? data.sessionType : pcr.session_type || "follow_up";
  const planId = (await linkAppointment(appointment.id, t)) || null;
  let plan = null;
  if (planId) [plan] = await sequelize.query(`SELECT * FROM treatment_plans WHERE id = :id`, { replacements: { id: planId }, type: QueryTypes.SELECT, transaction: t });

  if (submitting && sessionType === "initial_assessment" && !plan) throw new ClinicalError(400, "Create the treatment plan first (condition, goals and measures)");
  const sessionNumber = plan ? await sessionNumberFor(plan.id, pcr.id, t) : null;
  await sequelize.query(
    `UPDATE pcr SET session_type = :sessionType, treatment_plan_id = :planId, session_number = :sessionNumber WHERE id = :id`,
    { replacements: { sessionType, planId: plan ? plan.id : null, sessionNumber, id: pcr.id }, type: QueryTypes.UPDATE, transaction: t }
  );
  if (!plan || !submitting) return { reportToMake: null };

  const due = await dueMeasures(plan, sessionType, sessionNumber, t);
  const given = Array.isArray(data.outcomeValues) ? data.outcomeValues : [];
  const keyOf = (x) => `${x.measureId}|${x.side || ""}|${x.item || ""}`;
  const byKey = new Map(given.map((g) => [keyOf(g), g]));
  const missing = [];
  for (const m of due) {
    const g = byKey.get(keyOf({ measureId: m.measure_id, side: m.side, item: m.item }));
    const hasValue = g && g.value !== undefined && g.value !== null && g.value !== "" && !g.couldNotAssess;
    const excused = g && g.couldNotAssess && String(g.reason || "").trim().length >= 3;
    if (!hasValue && !excused) missing.push(`${m.name}${m.side ? ` (${m.side})` : ""}`);
    else if (hasValue) {
      const v = Number(g.value);
      if (Number.isNaN(v) || (m.min_value !== null && v < Number(m.min_value)) || (m.max_value !== null && v > Number(m.max_value))) {
        throw new ClinicalError(400, `${m.name}: the value must be between ${m.min_value ?? "-"} and ${m.max_value ?? "-"}`);
      }
    }
  }
  if (missing.length) throw new ClinicalError(400, `Please record: ${missing.join(", ")} (or tick "Could not assess" with a reason)`, { missingMeasures: missing });

  if ((sessionType === "review" || sessionType === "discharge") && String(data.progressSummary || "").trim().length < 10) {
    throw new ClinicalError(400, "Please write the progress summary and next plan");
  }
  if (sessionType === "discharge" && String(data.dischargeReason || "").trim().length < 3) {
    throw new ClinicalError(400, "Please give the reason for discharge");
  }

  // store the results (re-submitting replaces this PCR's rows)
  const point = assessmentPoint(sessionType, sessionNumber, plan);
  await sequelize.query(`DELETE FROM outcome_results WHERE pcr_id = :pcrId`, { replacements: { pcrId: pcr.id }, type: QueryTypes.DELETE, transaction: t });
  for (const m of due) {
    const g = byKey.get(keyOf({ measureId: m.measure_id, side: m.side, item: m.item }));
    const couldNot = g && (g.couldNotAssess || g.value === undefined || g.value === null || g.value === "");
    await sequelize.query(
      `INSERT INTO outcome_results (plan_id, measure_id, appointment_id, pcr_id, side, item, value, assessment_point, recorded_by, note)
       VALUES (:planId, :measureId, :apptId, :pcrId, :side, :item, :value, :point, :userId, :note)`,
      { replacements: { planId: plan.id, measureId: m.measure_id, apptId: appointment.id, pcrId: pcr.id, side: m.side, item: m.item, value: couldNot ? null : Number(g.value), point, userId, note: couldNot ? `Could not assess: ${String(g.reason).trim()}` : null }, type: QueryTypes.INSERT, transaction: t }
    );
  }

  for (const gs of Array.isArray(data.goalStatuses) ? data.goalStatuses : []) {
    if (["in_progress", "achieved", "partially_achieved", "not_achieved", "revised"].includes(gs.status)) {
      await sequelize.query(`UPDATE treatment_goals SET status = :status, updated_at = NOW() WHERE id = :id AND plan_id = :planId`, { replacements: { status: gs.status, id: gs.goalId, planId: plan.id }, type: QueryTypes.UPDATE, transaction: t });
    }
  }

  if (sessionType === "discharge") {
    await sequelize.query(`UPDATE treatment_plans SET status = 'discharged', discharge_reason = :reason, updated_at = NOW() WHERE id = :id`, { replacements: { reason: String(data.dischargeReason).trim(), id: plan.id }, type: QueryTypes.UPDATE, transaction: t });
  }
  const makeReport = sessionType === "review" || sessionType === "discharge";
  return { reportToMake: makeReport ? { planId: plan.id, type: sessionType === "discharge" ? "discharge" : "review", sessionNumber, summary: String(data.progressSummary).trim(), therapistId: appointment.therapist_id } : null };
}

/** After the commit: store the report row and its PDF. */
async function createReport({ planId, type, sessionNumber, summary, therapistId }) {
  const [row] = await sequelize.query(
    `INSERT INTO progress_reports (plan_id, report_type, session_number, summary, therapist_id, shared_with_patient_at)
     VALUES (:planId, :type, :sessionNumber, :summary, :therapistId, NOW()) RETURNING id`,
    { replacements: { planId, type, sessionNumber, summary, therapistId }, type: QueryTypes.SELECT }
  );
  const progress = await planProgress(planId);
  const [who] = await sequelize.query(
    `SELECT u.name, tp.registration_no, (SELECT split_part(name, ' ', 1) FROM users WHERE id = :patientId) AS patient_first
     FROM users u LEFT JOIN therapist_profiles tp ON tp.user_id = u.id WHERE u.id = :therapistId`,
    { replacements: { therapistId, patientId: progress.plan.patient_id }, type: QueryTypes.SELECT }
  );
  const rel = await generateProgressPdf({ reportId: row.id, reportType: type, progress, summary, patientFirstName: who?.patient_first || "Patient", therapist: who });
  await sequelize.query(`UPDATE progress_reports SET pdf_path = :rel WHERE id = :id`, { replacements: { rel, id: row.id }, type: QueryTypes.UPDATE });
  return row.id;
}

module.exports = { ClinicalError, SESSION_TYPES, activePlan, linkAppointment, dueMeasures, sessionNumberFor, onPcrSave, createReport };
