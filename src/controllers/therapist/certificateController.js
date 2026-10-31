// The therapist's registration certificate (P22): uploaded by the therapist, opened by the therapist and the therapy / super admins.
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const storage = require("../../utils/privateStorage");
const access = require("../../utils/access");

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png" };

// the file is checked in memory first and written to the private folder only when it is a PDF / JPEG / PNG under 5 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => (TYPES[file.mimetype] ? cb(null, true) : cb(new Error("Please upload a PDF, JPG or PNG file"))),
}).single("certificate");

const meta = (row) => ({ uploaded: Boolean(row && row.registration_certificate_path), name: (row && row.registration_certificate_name) || null, uploadedAt: (row && row.registration_certificate_uploaded_at) || null });

// POST /api/therapists/me/certificate   (multipart, field "certificate")
exports.uploadCertificate = (req, res) => {
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: err.code === "LIMIT_FILE_SIZE" ? "The file is larger than 5 MB" : err.message });
    if (!req.file) return res.status(400).json({ success: false, error: "Choose a file" });
    try {
      const [prof] = await sequelize.query(`SELECT id, registration_certificate_path FROM therapist_profiles WHERE user_id = :uid`, { replacements: { uid: req.user.id }, type: QueryTypes.SELECT });
      if (!prof) return res.status(404).json({ success: false, error: "Therapist profile not found" });
      const rel = path.join("certificates", `${req.user.id}-${Date.now()}${TYPES[req.file.mimetype]}`);
      fs.writeFileSync(storage.prepare(rel), req.file.buffer);
      const name = String(req.file.originalname || "certificate").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
      await sequelize.query(
        `UPDATE therapist_profiles SET registration_certificate_path = :rel, registration_certificate_name = :name, registration_certificate_uploaded_at = NOW() WHERE id = :id`,
        { replacements: { rel, name, id: prof.id }, type: QueryTypes.UPDATE }
      );
      await sequelize.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (:a, 'certificate_uploaded', 'therapist', :e, :d)`,
        { replacements: { a: String(req.user.id), e: String(req.user.id), d: JSON.stringify({ name }) }, type: QueryTypes.INSERT }
      );
      if (prof.registration_certificate_path) { try { fs.unlinkSync(storage.resolve(prof.registration_certificate_path)); } catch (e) { /* the old file is gone already */ } }
      return res.json({ success: true, data: meta({ registration_certificate_path: rel, registration_certificate_name: name, registration_certificate_uploaded_at: new Date() }) });
    } catch (e) {
      console.error("uploadCertificate error:", e.message);
      return res.status(500).json({ success: false, error: "Could not save the certificate" });
    }
  });
};

// GET /api/therapists/me/certificate   (does the therapist have one?)
exports.myCertificate = async (req, res) => {
  const [row] = await sequelize.query(`SELECT registration_certificate_path, registration_certificate_name, registration_certificate_uploaded_at FROM therapist_profiles WHERE user_id = :uid`, { replacements: { uid: req.user.id }, type: QueryTypes.SELECT });
  return res.json({ success: true, data: meta(row) });
};

// GET /api/therapists/certificate/:userId/file   (the therapist herself or himself, the therapy / super admins)
exports.certificateFile = async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) return res.status(404).json({ success: false, error: "Not found" });
  if (req.user.id !== userId && !access.isClinicalAdmin(req.user)) return res.status(403).json({ success: false, error: "Forbidden" });
  const [row] = await sequelize.query(`SELECT registration_certificate_path AS p, registration_certificate_name AS n FROM therapist_profiles WHERE user_id = :uid`, { replacements: { uid: userId }, type: QueryTypes.SELECT });
  if (!row || !row.p) return res.status(404).json({ success: false, error: "No certificate uploaded" });
  const full = storage.resolve(row.p);
  if (!fs.existsSync(full)) return res.status(404).json({ success: false, error: "No certificate uploaded" });
  res.set({ "Content-Type": { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png" }[path.extname(full)] || "application/octet-stream", "Content-Disposition": `inline; filename="${row.n || "certificate"}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  return fs.createReadStream(full).pipe(res);
};
