// Treatment plans, goals, progress, reports and family (caregiver) access - handoff pack P16.
const fs = require("fs");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const access = require("../../utils/access");
const storage = require("../../utils/privateStorage");
const pcrService = require("../../services/pcrService");
const stateMachine = require("../../services/appointmentStateMachine");
const { planProgress } = require("../../services/progressService");

const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const fail = (res, status, error) => res.status(status).json({ success: false, error });
const isTherapist = (user) => user.role === "therapist" || (user.roles || []).includes("therapist");

/** 'admin' | 'patient' | 'caregiver' | 'therapist' (owner) | 'therapist-window' | null */
async function planAccess(user, plan) {
  if (access.isClinicalAdmin(user)) return "admin";
  if (access.same(plan.patient_id, user.id)) return "patient";
  const [link] = await q(`SELECT 1 FROM patient_caregivers WHERE patient_user_id = :p AND caregiver_user_id = :c AND revoked_at IS NULL AND activated_at IS NOT NULL AND can_view_progress`, { p: plan.patient_id, c: user.id });
  if (link) return "caregiver";
  if (isTherapist(user)) {
    if (access.same(plan.primary_therapist_id, user.id)) return "therapist";
    const appts = await q(`SELECT date, time, start_time FROM appointments WHERE patient_id = :p AND therapist_id = :t AND status IN (:active)`, { p: plan.patient_id, t: user.id, active: [...stateMachine.ACTIVE, stateMachine.STATUS.PCR_PENDING] });
    if (appts.some((a) => pcrService.historyOpen(a))) return "therapist-window";   // same T-4 h rule as the PCR history
  }
  return null;
}
const canWrite = (who) => who === "admin" || who === "therapist";

async function loadPlan(req, res) {
  const [plan] = await q(`SELECT * FROM treatment_plans WHERE id = :id`, { id: req.params.id });
  if (!plan) { fail(res, 404, "Plan not found"); return null; }
  const who = await planAccess(req.user, plan);
  if (!who) { fail(res, 403, "Forbidden"); return null; }
  return { plan, who };
}

// POST /api/clinical/plans
exports.createPlan = async (req, res) => {
  const b = req.body || {};
  const t = await sequelize.transaction();
  try {
    const patientId = Number(b.patientId);
    if (!patientId) { await t.rollback(); return fail(res, 400, "patientId is required"); }
    if (!access.isClinicalAdmin(req.user)) {
      const [rel] = await q(`SELECT 1 FROM appointments WHERE patient_id = :p AND therapist_id = :t AND status NOT LIKE 'cancelled%' LIMIT 1`, { p: patientId, t: req.user.id }, t);
      if (!isTherapist(req.user) || !rel) { await t.rollback(); return fail(res, 403, "Forbidden"); }
    }
    const goals = Array.isArray(b.goals) ? b.goals : [];
    if (goals.length < 1 || goals.length > 5) { await t.rollback(); return fail(res, 400, "A plan needs 1 to 5 goals"); }
    if (!String(b.condition || "").trim()) { await t.rollback(); return fail(res, 400, "condition is required"); }
    if (b.affectedSide && !["left", "right", "bilateral", "na"].includes(b.affectedSide)) { await t.rollback(); return fail(res, 400, "affectedSide must be left, right, bilateral or na"); }

    const codes = [...new Set([...(b.measures || []).map((m) => m.code), ...goals.map((g) => g.measureCode).filter(Boolean)])];
    const measures = codes.length ? await q(`SELECT id, code, per_side FROM outcome_measures WHERE code IN (:codes) AND active`, { codes }, t) : [];
    const byCode = new Map(measures.map((m) => [m.code, m]));
    const unknown = codes.filter((c) => !byCode.has(c));
    if (unknown.length) { await t.rollback(); return fail(res, 400, `Unknown or inactive measure: ${unknown.join(", ")}`); }

    const [plan] = await q(
      `INSERT INTO treatment_plans (patient_id, primary_therapist_id, service_type_id, condition, affected_side, body_region, onset_date, plan_start, planned_sessions,
         frequency_per_week, preferred_days, preferred_time, review_every_sessions, expected_end, created_by)
       VALUES (:patientId, :therapistId, :serviceTypeId, :condition, :side, :region, :onset, COALESCE(:planStart::date, CURRENT_DATE), :planned,
         :freq, :days::text[], :time, COALESCE(:review, 5), :expectedEnd, :createdBy) RETURNING *`,
      {
        patientId, therapistId: isTherapist(req.user) ? req.user.id : (b.primaryTherapistId || null), serviceTypeId: b.serviceTypeId || null,
        condition: String(b.condition).trim(), side: b.affectedSide || null, region: b.bodyRegion || null, onset: b.onsetDate || null, planStart: b.planStart || null,
        planned: b.plannedSessions || null, freq: b.frequencyPerWeek || null, days: b.preferredDays && b.preferredDays.length ? `{${b.preferredDays.join(",")}}` : null,
        time: b.preferredTime || null, review: b.reviewEverySessions || null, expectedEnd: b.expectedEnd || null, createdBy: req.user.id,
      }, t
    );
    for (const g of goals) {
      if (!String(g.description || "").trim()) { await t.rollback(); return fail(res, 400, "Every goal needs a description"); }
      await q(`INSERT INTO treatment_goals (plan_id, description, measure_id, baseline_value, target_value, target_date) VALUES (:planId, :description, :measureId, :baseline, :target, :targetDate)`,
        { planId: plan.id, description: String(g.description).trim(), measureId: g.measureCode ? byCode.get(g.measureCode).id : null, baseline: g.baselineValue ?? null, target: g.targetValue ?? null, targetDate: g.targetDate || null }, t);
    }
    for (const m of b.measures || []) {
      await q(`INSERT INTO plan_measures (plan_id, measure_id, side, item) VALUES (:planId, :measureId, :side, :item)`,
        { planId: plan.id, measureId: byCode.get(m.code).id, side: m.side || (byCode.get(m.code).per_side && ["left", "right"].includes(b.affectedSide) ? b.affectedSide : null), item: m.item || null }, t);
    }
    if (b.appointmentId) await q(`UPDATE appointments SET treatment_plan_id = :planId WHERE id = :id AND patient_id = :patientId`, { planId: plan.id, id: b.appointmentId, patientId }, t);
    await t.commit();
    return res.status(201).json({ success: true, data: { id: plan.id } });
  } catch (err) {
    await t.rollback();
    console.error("create plan error:", err.message);
    return fail(res, 500, "Could not create the plan");
  }
};

// GET /api/clinical/plans?patientId=&stalled=1
exports.listPlans = async (req, res) => {
  try {
    const admin = access.isClinicalAdmin(req.user);
    let plans;
    if (admin) plans = await q(`SELECT * FROM treatment_plans WHERE (:patientId::int IS NULL OR patient_id = :patientId::int) ORDER BY id DESC`, { patientId: req.query.patientId || null });
    else if (isTherapist(req.user)) plans = await q(`SELECT * FROM treatment_plans WHERE primary_therapist_id = :me AND (:patientId::int IS NULL OR patient_id = :patientId::int) ORDER BY id DESC`, { me: req.user.id, patientId: req.query.patientId || null });
    else {
      // a patient sees their own plans, a caregiver the plans of the patients who shared with them
      plans = await q(
        `SELECT p.* FROM treatment_plans p WHERE p.patient_id = :me
            OR p.patient_id IN (SELECT patient_user_id FROM patient_caregivers WHERE caregiver_user_id = :me AND revoked_at IS NULL AND activated_at IS NOT NULL AND can_view_progress)
         ORDER BY p.id DESC`, { me: req.user.id });
    }
    const out = [];
    for (const p of plans) {
      const prog = await planProgress(p.id);
      if (req.query.stalled === "1" && !(admin && prog.stalled)) continue;
      out.push({ ...p, stalled: admin || isTherapist(req.user) ? prog.stalled : undefined, sessionsDone: prog.sessionsDone, adherence: prog.adherence });
    }
    return res.json({ success: true, data: out });
  } catch (err) {
    console.error("list plans error:", err.message);
    return fail(res, 500, "Could not load plans");
  }
};

exports.getPlan = async (req, res) => {
  const ctx = await loadPlan(req, res);
  if (!ctx) return;
  const goals = await q(`SELECT g.*, m.code AS measure_code FROM treatment_goals g LEFT JOIN outcome_measures m ON m.id = g.measure_id WHERE g.plan_id = :id ORDER BY g.id`, { id: ctx.plan.id });
  const measures = await q(`SELECT pm.*, m.code, m.name FROM plan_measures pm JOIN outcome_measures m ON m.id = pm.measure_id WHERE pm.plan_id = :id ORDER BY pm.id`, { id: ctx.plan.id });
  return res.json({ success: true, data: { ...ctx.plan, goals, measures, readOnly: !canWrite(ctx.who) } });
};

exports.updatePlan = async (req, res) => {
  const ctx = await loadPlan(req, res);
  if (!ctx) return;
  if (!canWrite(ctx.who)) return fail(res, 403, "Forbidden");
  const b = req.body || {};
  if (b.status && !["active", "on_hold", "cancelled"].includes(b.status)) return fail(res, 400, "Use a discharge PCR to discharge a plan; status can be active, on_hold or cancelled");
  await q(
    `UPDATE treatment_plans SET status = COALESCE(:status, status), planned_sessions = COALESCE(:planned, planned_sessions), frequency_per_week = COALESCE(:freq, frequency_per_week),
       review_every_sessions = COALESCE(:review, review_every_sessions), expected_end = COALESCE(:expectedEnd::date, expected_end), updated_at = NOW() WHERE id = :id`,
    { id: ctx.plan.id, status: b.status || null, planned: b.plannedSessions || null, freq: b.frequencyPerWeek || null, review: b.reviewEverySessions || null, expectedEnd: b.expectedEnd || null }
  );
  return res.json({ success: true });
};

exports.addGoal = async (req, res) => {
  const ctx = await loadPlan(req, res);
  if (!ctx) return;
  if (!canWrite(ctx.who)) return fail(res, 403, "Forbidden");
  const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM treatment_goals WHERE plan_id = :id AND status <> 'revised'`, { id: ctx.plan.id });
  if (n >= 5) return fail(res, 400, "A plan can have at most 5 goals");
  const b = req.body || {};
  if (!String(b.description || "").trim()) return fail(res, 400, "description is required");
  const [m] = b.measureCode ? await q(`SELECT id FROM outcome_measures WHERE code = :code AND active`, { code: b.measureCode }) : [null];
  if (b.measureCode && !m) return fail(res, 400, "Unknown measure");
  const [goal] = await q(`INSERT INTO treatment_goals (plan_id, description, measure_id, baseline_value, target_value, target_date) VALUES (:planId, :description, :measureId, :baseline, :target, :targetDate) RETURNING id`,
    { planId: ctx.plan.id, description: String(b.description).trim(), measureId: m ? m.id : null, baseline: b.baselineValue ?? null, target: b.targetValue ?? null, targetDate: b.targetDate || null });
  return res.status(201).json({ success: true, data: { id: goal.id } });
};

exports.updateGoal = async (req, res) => {
  const [goal] = await q(`SELECT * FROM treatment_goals WHERE id = :id`, { id: req.params.id });
  if (!goal) return fail(res, 404, "Goal not found");
  const [plan] = await q(`SELECT * FROM treatment_plans WHERE id = :id`, { id: goal.plan_id });
  if (!canWrite(await planAccess(req.user, plan))) return fail(res, 403, "Forbidden");
  const b = req.body || {};
  if (b.status && !["in_progress", "achieved", "partially_achieved", "not_achieved", "revised"].includes(b.status)) return fail(res, 400, "Invalid status");
  await q(`UPDATE treatment_goals SET status = COALESCE(:status, status), target_value = COALESCE(:target, target_value), target_date = COALESCE(:targetDate::date, target_date), description = COALESCE(:description, description), updated_at = NOW() WHERE id = :id`,
    { id: goal.id, status: b.status || null, target: b.targetValue ?? null, targetDate: b.targetDate || null, description: b.description || null });
  return res.json({ success: true });
};

exports.getProgress = async (req, res) => {
  const ctx = await loadPlan(req, res);
  if (!ctx) return;
  const data = await planProgress(ctx.plan.id);
  if (ctx.who === "patient" || ctx.who === "caregiver") delete data.stalled;      // the stalled flag is for the clinical team
  return res.json({ success: true, data });
};

exports.listReports = async (req, res) => {
  const ctx = await loadPlan(req, res);
  if (!ctx) return;
  const onlyShared = ctx.who === "patient" || ctx.who === "caregiver";
  const rows = await q(`SELECT id, report_type AS "reportType", session_number AS "sessionNumber", created_at AS "createdAt", shared_with_patient_at AS "sharedAt" FROM progress_reports WHERE plan_id = :id ${onlyShared ? "AND shared_with_patient_at IS NOT NULL" : ""} ORDER BY id`, { id: ctx.plan.id });
  return res.json({ success: true, data: rows });
};

exports.reportPdf = async (req, res) => {
  const [report] = await q(`SELECT * FROM progress_reports WHERE id = :id`, { id: req.params.id });
  if (!report) return fail(res, 404, "Report not found");
  const [plan] = await q(`SELECT * FROM treatment_plans WHERE id = :id`, { id: report.plan_id });
  const who = await planAccess(req.user, plan);
  if (!who) return fail(res, 403, "Forbidden");
  if ((who === "patient" || who === "caregiver") && !report.shared_with_patient_at) return fail(res, 403, "Forbidden");
  if (!report.pdf_path || !fs.existsSync(storage.resolve(report.pdf_path))) return fail(res, 404, "The PDF is not available");
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="curevan-${report.report_type}-report-${report.id}.pdf"`, "Cache-Control": "private, no-store" });
  return fs.createReadStream(storage.resolve(report.pdf_path)).pipe(res);
};

// ---- family access -------------------------------------------------------------------------------
// POST /api/clinical/caregivers { mobile, relation, consentAccepted }   (the patient, for one family member)
exports.addCaregiver = async (req, res) => {
  try {
    const b = req.body || {};
    const mobile = String(b.mobile || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!/^[6-9]\d{9}$/.test(mobile)) return fail(res, 400, "Please enter a valid 10-digit mobile number");
    if (b.consentAccepted !== true) return fail(res, 400, "Your consent to share is required");
    const [active] = await q(`SELECT COUNT(*)::int AS n FROM patient_caregivers WHERE patient_user_id = :me AND revoked_at IS NULL`, { me: req.user.id });
    if (active.n >= 1) return fail(res, 409, "You can share with one family member at a time. Remove the current one first.");

    let [cg] = await q(`SELECT id FROM users WHERE phone = :mobile LIMIT 1`, { mobile });
    if (!cg) {
      await q(`INSERT INTO roles (name) VALUES ('caregiver') ON CONFLICT (name) DO NOTHING`, {});
      [cg] = await q(`INSERT INTO users (uid, email, name, phone, role, is_verified) VALUES (:uid, :email, 'Family member', :mobile, 'caregiver', false) RETURNING id`, { uid: `caregiver-${mobile}`, email: `caregiver-${mobile}@no-email.curevan`, mobile });
      await q(`INSERT INTO user_roles (user_id, role_id) SELECT :id, id FROM roles WHERE name = 'caregiver'`, { id: cg.id });
    }
    if (access.same(cg.id, req.user.id)) return fail(res, 400, "That is your own number");
    const [consent] = await q(`INSERT INTO consent_logs (user_id, consent_type, policy_version, granted, ip, user_agent) VALUES (:me, 'caregiver_share', '1', true, :ip, :ua) RETURNING id`, { me: req.user.id, ip: req.ip, ua: String(req.headers["user-agent"] || "").slice(0, 300) });
    const [link] = await q(`INSERT INTO patient_caregivers (patient_user_id, caregiver_user_id, relation, consent_log_id) VALUES (:me, :cg, :relation, :consentId) RETURNING id`, { me: req.user.id, cg: cg.id, relation: String(b.relation || "").slice(0, 40) || null, consentId: consent.id });
    return res.status(201).json({ success: true, data: { id: link.id, note: "They can open your progress after signing in with an OTP sent to that mobile number." } });
  } catch (err) {
    console.error("add caregiver error:", err.message);
    return fail(res, 500, "Could not add the family member");
  }
};

exports.listCaregivers = async (req, res) => {
  const rows = await q(`SELECT pc.id, pc.relation, pc.created_at AS "createdAt", pc.activated_at AS "activatedAt", pc.revoked_at AS "revokedAt", u.phone FROM patient_caregivers pc JOIN users u ON u.id = pc.caregiver_user_id WHERE pc.patient_user_id = :me ORDER BY pc.id DESC`, { me: req.user.id });
  return res.json({ success: true, data: rows.map((r) => ({ ...r, phone: r.phone ? `******${String(r.phone).slice(-4)}` : null })) });
};

exports.revokeCaregiver = async (req, res) => {
  const rows = await q(`UPDATE patient_caregivers SET revoked_at = NOW() WHERE id = :id AND patient_user_id = :me AND revoked_at IS NULL RETURNING id`, { id: req.params.id, me: req.user.id });
  if (!rows.length) return fail(res, 404, "Not found");
  return res.json({ success: true });
};
