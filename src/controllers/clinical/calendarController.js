// .ics downloads and the personal read-only calendar feed (handoff pack P17).
const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const access = require("../../utils/access");
const { buildCalendar } = require("../../services/icsService");

const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const ROWS = `a.id, a.patient_id, a.therapist_id, a.patient_name, a.therapist_name, a.date, a.time, a.status, oa.city`;
const FROM = `FROM appointments a LEFT JOIN order_addresses oa ON oa.id = a.service_address_id`;
const send = (res, body, name) => { res.set({ "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, max-age=300" }); return res.send(body); };

// GET /api/calendar/appointments/:id.ics - the patient or the therapist of that booking
exports.appointmentIcs = async (req, res) => {
  const id = Number(String(req.params.file).replace(/\.ics$/, ""));
  if (!id) return res.status(404).json({ success: false, error: "Not found" });
  const [a] = await q(`SELECT ${ROWS} ${FROM} WHERE a.id = :id`, { id });
  if (!a) return res.status(404).json({ success: false, error: "Not found" });
  const isTherapist = access.same(a.therapist_id, req.user.id);
  if (!isTherapist && !access.same(a.patient_id, req.user.id)) return res.status(403).json({ success: false, error: "Forbidden" });
  return send(res, buildCalendar([a], isTherapist ? "therapist" : "patient"), `curevan-session-${id}.ics`);
};

// GET /api/calendar/feed/:token.ics - no login: the secret token IS the credential (regenerate it to cut access)
exports.feed = async (req, res) => {
  const token = String(req.params.file).replace(/\.ics$/, "");
  if (!/^[a-f0-9]{48}$/.test(token)) return res.status(404).send("Not found");
  const [u] = await q(`SELECT id FROM users WHERE calendar_token = :token`, { token });
  if (!u) return res.status(404).send("Not found");
  const rows = await q(
    `SELECT ${ROWS} ${FROM} WHERE (a.patient_id = :me OR a.therapist_id = :me) AND a.status IN ('confirmed', 'proposed')
       AND a.date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date AND a.date <= (NOW() AT TIME ZONE 'Asia/Kolkata')::date + 60 ORDER BY a.date, a.time`,
    { me: u.id }
  );
  return send(res, buildCalendar(rows, (b) => (access.same(b.therapist_id, u.id) ? "therapist" : "patient")), "curevan-sessions.ics");
};

const urlFor = (req, token) => `${req.protocol}://${req.get("host")}/api/calendar/feed/${token}.ics`;

// GET /api/calendar/token - the personal feed address (made on first use)
exports.getToken = async (req, res) => {
  let [u] = await q(`SELECT calendar_token FROM users WHERE id = :id`, { id: req.user.id });
  if (!u.calendar_token) {
    const token = crypto.randomBytes(24).toString("hex");
    await q(`UPDATE users SET calendar_token = :token WHERE id = :id`, { token, id: req.user.id });
    u = { calendar_token: token };
  }
  return res.json({ success: true, data: { url: urlFor(req, u.calendar_token) } });
};

exports.regenerateToken = async (req, res) => {
  const token = crypto.randomBytes(24).toString("hex");
  await q(`UPDATE users SET calendar_token = :token WHERE id = :id`, { token, id: req.user.id });
  return res.json({ success: true, data: { url: urlFor(req, token) } });
};
