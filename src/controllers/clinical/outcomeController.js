// The outcome-measure library (handoff pack P16). Reading is open to signed-in users; editing is for admin.therapy / admin.super.
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const access = require("../../utils/access");

const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const SCALES = ["numeric", "ordinal", "percent", "time_seconds", "speed_mps", "degrees"];
const FREQ = ["every_session", "review", "baseline_discharge"];

exports.listMeasures = async (req, res) => {
  const all = req.query.all === "1" && access.isClinicalAdmin(req.user);
  const rows = await q(`SELECT * FROM outcome_measures ${all ? "" : "WHERE active"} ORDER BY id`, {});
  return res.json({ success: true, data: rows });
};

exports.createMeasure = async (req, res) => {
  const b = req.body || {};
  if (!/^[A-Z0-9_]{2,20}$/.test(String(b.code || ""))) return res.status(400).json({ success: false, error: "code must be 2-20 capital letters, digits or _" });
  if (!String(b.name || "").trim()) return res.status(400).json({ success: false, error: "name is required" });
  if (!SCALES.includes(b.scaleType)) return res.status(400).json({ success: false, error: `scaleType must be one of ${SCALES.join(", ")}` });
  if (!FREQ.includes(b.frequency)) return res.status(400).json({ success: false, error: `frequency must be one of ${FREQ.join(", ")}` });
  if (!String(b.licenceNote || "").trim()) return res.status(400).json({ success: false, error: "licenceNote is required (who owns the scale and why it is free to use)" });
  try {
    const [row] = await q(
      `INSERT INTO outcome_measures (code, name, specialty, domain, scale_type, min_value, max_value, unit, higher_is_better, per_side, frequency, instructions, licence_note)
       VALUES (:code, :name, :specialty, :domain, :scaleType, :min, :max, :unit, COALESCE(:higher, true), COALESCE(:perSide, false), :frequency, :instructions, :licenceNote) RETURNING *`,
      { code: b.code, name: String(b.name).trim(), specialty: b.specialty || null, domain: b.domain || null, scaleType: b.scaleType, min: b.minValue ?? null, max: b.maxValue ?? null, unit: b.unit || null, higher: b.higherIsBetter ?? null, perSide: b.perSide ?? null, frequency: b.frequency, instructions: b.instructions || null, licenceNote: String(b.licenceNote).trim() }
    );
    return res.status(201).json({ success: true, data: row });
  } catch (err) {
    if (err.original?.code === "23505" || err.parent?.code === "23505" || /unique/i.test(err.name)) return res.status(409).json({ success: false, error: "That code already exists" });
    console.error("create measure error:", err.message);
    return res.status(500).json({ success: false, error: "Could not add the measure" });
  }
};

exports.updateMeasure = async (req, res) => {
  const b = req.body || {};
  if (b.frequency && !FREQ.includes(b.frequency)) return res.status(400).json({ success: false, error: "Invalid frequency" });
  const rows = await q(
    `UPDATE outcome_measures SET active = COALESCE(:active, active), name = COALESCE(:name, name), instructions = COALESCE(:instructions, instructions),
       licence_note = COALESCE(:licenceNote, licence_note), frequency = COALESCE(:frequency, frequency) WHERE id = :id RETURNING *`,
    { id: req.params.id, active: typeof b.active === "boolean" ? b.active : null, name: b.name || null, instructions: b.instructions || null, licenceNote: b.licenceNote || null, frequency: b.frequency || null }
  );
  if (!rows.length) return res.status(404).json({ success: false, error: "Measure not found" });
  return res.json({ success: true, data: rows[0] });
};
