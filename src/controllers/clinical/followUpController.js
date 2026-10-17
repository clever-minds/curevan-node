// Follow-up proposals, overdue list and reminder preferences (handoff pack P17).
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const access = require("../../utils/access");
const followUp = require("../../services/followUpService");

const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const handle = (res, err, what) => {
  if (err instanceof followUp.FollowUpError) return res.status(err.httpStatus).json({ success: false, error: err.message });
  const stateMachine = require("../../services/appointmentStateMachine");
  if (err instanceof stateMachine.TransitionError) return res.status(err.httpStatus).json({ success: false, error: err.message });
  console.error(`${what} error:`, err.message);
  return res.status(500).json({ success: false, error: `Could not ${what}` });
};

// GET /api/clinical/followups/mine - the patient's proposals, or the therapist's (what they recommended)
exports.listMine = async (req, res) => {
  try {
    const asTherapist = req.user.role === "therapist";
    const rows = await q(
      `SELECT fp.id, fp.therapist_id AS "therapistId", fp.appointment_id AS "appointmentId", fp.series_id AS "seriesId", fp.status, a.status AS "apptStatus", a.payment_status AS "paymentStatus",
              to_char(a.date, 'YYYY-MM-DD') AS date, a.time, a.therapist_name AS "therapistName", a.patient_name AS "patientName",
              fp.hold_expires_at AS "holdExpiresAt", a.service_amount AS amount
       FROM followup_proposals fp LEFT JOIN appointments a ON a.id = fp.appointment_id
       WHERE ${asTherapist ? "fp.therapist_id" : "fp.patient_id"} = :me AND fp.status <> 'no_slot'
       ORDER BY a.date, a.time`,
      { me: req.user.id }
    );
    return res.json({ success: true, data: rows });
  } catch (err) { return handle(res, err, "load follow-ups"); }
};

// POST /api/clinical/followups/:id/confirm  { all?: boolean } - all: commit to the whole series (each session is paid as it comes)
exports.confirm = async (req, res) => {
  try {
    if ((req.body || {}).all) return res.json({ success: true, data: await followUp.confirmSeries(Number(req.params.id), req.user) });
    const [p] = await q(`SELECT fp.appointment_id AS "appointmentId", a.service_amount AS amount, fp.patient_id, fp.status, a.status AS "apptStatus" FROM followup_proposals fp JOIN appointments a ON a.id = fp.appointment_id WHERE fp.id = :id`, { id: req.params.id });
    if (!p) return res.status(404).json({ success: false, error: "Proposal not found" });
    if (!access.same(p.patient_id, req.user.id)) return res.status(403).json({ success: false, error: "Forbidden" });
    if (p.apptStatus !== "proposed") return res.status(409).json({ success: false, error: "This proposal can no longer be confirmed" });
    // single session: the patient now pays with the normal booking payment (create-appointment with this appointmentId)
    return res.json({ success: true, data: { appointmentId: p.appointmentId, amount: Number(p.amount), next: "pay" } });
  } catch (err) { return handle(res, err, "confirm the session"); }
};

exports.change = async (req, res) => {
  try {
    const { date, time } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^\d{1,2}:\d{2}$/.test(time || "")) return res.status(400).json({ success: false, error: "date and time are required" });
    return res.json({ success: true, data: await followUp.changeTime(Number(req.params.id), req.user, { date, time }) });
  } catch (err) { return handle(res, err, "change the time"); }
};

exports.decline = async (req, res) => {
  try { return res.json({ success: true, data: await followUp.decline(Number(req.params.id), req.user) }); }
  catch (err) { return handle(res, err, "decline the session"); }
};

// GET /api/clinical/followups/overdue - plans whose patient has no next session booked for too long
exports.overdue = async (req, res) => {
  try {
    const admin = access.isClinicalAdmin(req.user);
    if (!admin && req.user.role !== "therapist") return res.status(403).json({ success: false, error: "Forbidden" });
    const rows = await q(
      `SELECT tp.id AS "planId", tp.patient_id AS "patientId", u.name AS "patientName", tp.primary_therapist_id AS "therapistId", tp.frequency_per_week AS "frequencyPerWeek"
       FROM treatment_plans tp JOIN users u ON u.id = tp.patient_id
       WHERE tp.status = 'active' AND tp.follow_up_overdue ${admin ? "" : "AND tp.primary_therapist_id = :me"} ORDER BY tp.id`,
      { me: req.user.id }
    );
    return res.json({ success: true, data: rows });
  } catch (err) { return handle(res, err, "load the overdue list"); }
};

// GET/PUT /api/clinical/reminder-prefs
exports.getPrefs = async (req, res) => {
  const [u] = await q(`SELECT reminder_prefs FROM users WHERE id = :id`, { id: req.user.id });
  return res.json({ success: true, data: { r24h: true, r2h: true, hep_daily: false, ...(u && u.reminder_prefs ? u.reminder_prefs : {}) } });
};

exports.putPrefs = async (req, res) => {
  const b = req.body || {};
  const prefs = { r24h: b.r24h !== false, r2h: b.r2h !== false, hep_daily: b.hep_daily === true };
  await q(`UPDATE users SET reminder_prefs = :prefs::jsonb WHERE id = :id`, { prefs: JSON.stringify(prefs), id: req.user.id });
  return res.json({ success: true, data: prefs });
};
