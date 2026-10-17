// PCR PDF download and the patient progress series (handoff pack P15).
const fs = require("fs");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const access = require("../../utils/access");
const storage = require("../../utils/privateStorage");
const pcrService = require("../../services/pcrService");
const { generatePcrPdf } = require("../../services/pcrPdfService");
const stateMachine = require("../../services/appointmentStateMachine");

// GET /api/pcr/:id/pdf - the patient (own), the treating therapist, clinical admins
exports.downloadPdf = async (req, res) => {
  try {
    const [row] = await sequelize.query(
      `SELECT p.*, a.patient_id AS a_patient, a.therapist_id AS a_therapist, a.patient_name, a.therapist_name, a.date
       FROM pcr p JOIN appointments a ON a.id = p.appointment_id WHERE p.id = :id`,
      { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
    );
    if (!row) return res.status(404).json({ success: false, error: "PCR not found" });
    const allowed = access.isClinicalAdmin(req.user) || access.same(row.a_patient, req.user.id) || access.same(row.a_therapist, req.user.id);
    if (!allowed) return res.status(403).json({ success: false, error: "Forbidden" });
    if (String(row.status).toLowerCase() !== "locked") return res.status(409).json({ success: false, error: "The summary is available once the PCR is finalised" });

    let rel = row.pdf_path;
    if (!rel || !fs.existsSync(storage.resolve(rel))) {          // e.g. the file was lost: make it again from the stored content
      const [therapist] = await sequelize.query(`SELECT u.name, tp.registration_no FROM users u LEFT JOIN therapist_profiles tp ON tp.user_id = u.id WHERE u.id = :id`, { replacements: { id: row.a_therapist }, type: QueryTypes.SELECT });
      rel = await generatePcrPdf({ pcr: row, appointment: { patient_name: row.patient_name, therapist_name: row.therapist_name, date: row.date }, therapist });
      await sequelize.query(`UPDATE pcr SET pdf_path = :rel WHERE id = :id`, { replacements: { rel, id: row.id }, type: QueryTypes.UPDATE });
    }
    await pcrService.logAccess(row.id, req.user.id, "pdf");
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="curevan-care-summary-${row.id}.pdf"`, "Cache-Control": "private, no-store" });
    return fs.createReadStream(storage.resolve(rel)).pipe(res);
  } catch (err) {
    console.error("pcr pdf error:", err.message);
    return res.status(500).json({ success: false, error: "Could not prepare the PDF" });
  }
};

// GET /api/patients/:patientId/progress - [{ sessionDate, functionalScore, painVas, therapistName }]
exports.patientProgress = async (req, res) => {
  try {
    const patientId = Number(req.params.patientId);
    let allowed = access.isClinicalAdmin(req.user) || access.same(patientId, req.user.id);
    if (!allowed && req.user.role === "therapist") {
      // the current / next assigned therapist, from 4 hours before the session
      const live = await sequelize.query(
        `SELECT date, time, start_time FROM appointments WHERE patient_id = :patientId AND therapist_id = :therapistId AND status IN (:active)`,
        { replacements: { patientId, therapistId: req.user.id, active: [...stateMachine.ACTIVE, stateMachine.STATUS.PCR_PENDING] }, type: QueryTypes.SELECT }
      );
      allowed = live.some((a) => pcrService.historyOpen(a));
    }
    if (!allowed) return res.status(403).json({ success: false, error: "Forbidden" });

    const rows = await sequelize.query(
      `SELECT to_char(a.date, 'YYYY-MM-DD') AS "sessionDate", p.functional_score AS "functionalScore", p.pain_vas AS "painVas",
              COALESCE(a.therapist_name, p.therapist_name) AS "therapistName", p.id AS "pcrId"
       FROM pcr p JOIN appointments a ON a.id = p.appointment_id
       WHERE a.patient_id = :patientId AND LOWER(p.status) IN ('submitted', 'locked')
       ORDER BY a.date, a.id`,
      { replacements: { patientId }, type: QueryTypes.SELECT }
    );
    if (rows.length) await pcrService.logAccess(rows[rows.length - 1].pcrId, req.user.id, "progress");
    return res.json({ success: true, data: rows.map(({ pcrId, ...r }) => r) });
  } catch (err) {
    console.error("progress error:", err.message);
    return res.status(500).json({ success: false, error: "Could not load progress" });
  }
};
