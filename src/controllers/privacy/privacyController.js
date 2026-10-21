// DPDP Act 2023 rights of a user: a copy of their data, correction, erasure, withdrawing marketing consent (handoff pack P25).
// Nothing is deleted automatically: an erasure request goes to the Super Admin, clinical records follow docs/DATA_RETENTION.md.
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const rules = require("../../config/businessRules");

const TYPES = ["export", "correction", "erasure", "withdraw_consent"];
const STATUSES = ["open", "in_progress", "done", "rejected"];
const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const fail = (res, status, message) => res.status(status).json({ success: false, error: message, message });

// POST /api/privacy/requests { type, note }
exports.createRequest = async (req, res) => {
  try {
    const { type, note } = req.body || {};
    if (!TYPES.includes(type)) return fail(res, 400, `type must be one of ${TYPES.join(", ")}`);
    const [open] = await q(`SELECT id FROM privacy_requests WHERE user_id = :me AND type = :type AND status IN ('open', 'in_progress') LIMIT 1`, { me: req.user.id, type });
    if (open) return fail(res, 409, "You already have an open request of this kind. We will get back to you.");

    const t = await sequelize.transaction();
    try {
      const [row] = await q(`INSERT INTO privacy_requests (user_id, type, note) VALUES (:me, :type, :note) RETURNING id, type, status, created_at AS "createdAt"`,
        { me: req.user.id, type, note: String(note || "").slice(0, 1000) || null }, t);
      if (type === "withdraw_consent") {
        // marketing consent is withdrawn at once: it needs nobody's approval
        await q(`INSERT INTO consent_logs (user_id, consent_type, policy_version, granted, ip, user_agent) VALUES (:me, 'marketing', :version, false, :ip, :ua) RETURNING id`,
          { me: req.user.id, version: rules.consent.policyVersion, ip: req.ip || null, ua: String(req.headers["user-agent"] || "").slice(0, 300) || null }, t);
        await q(`UPDATE users SET marketing_opt_in = false WHERE id = :me RETURNING id`, { me: req.user.id }, t);
        await q(`UPDATE privacy_requests SET status = 'done', closed_at = NOW() WHERE id = :id RETURNING id`, { id: row.id }, t);
        row.status = "done";
      }
      await t.commit();
      return res.status(201).json({ success: true, data: row });
    } catch (err) { await t.rollback(); throw err; }
  } catch (err) {
    console.error("privacy createRequest error:", err.message);
    return fail(res, 500, "Could not save your request");
  }
};

// GET /api/privacy/requests - the caller's own requests
exports.myRequests = async (req, res) => {
  try {
    const rows = await q(`SELECT id, type, status, note, created_at AS "createdAt", closed_at AS "closedAt" FROM privacy_requests WHERE user_id = :me ORDER BY id DESC`, { me: req.user.id });
    return res.json({ success: true, data: rows });
  } catch (err) { return fail(res, 500, "Could not load your requests"); }
};

// GET /api/privacy/export - a copy of the caller's own data as JSON (profile, bookings, orders, session record summaries, consents)
exports.exportMyData = async (req, res) => {
  try {
    const me = req.user.id;
    const [profile] = await q(`SELECT id, name, email, phone, role, city, state, pin, address_line1, address_line2, date_of_birth, created_at FROM users WHERE id = :me`, { me });
    const bookings = await q(
      `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, time, status, therapy_type AS "service", therapist_name AS "therapist", payment_status AS "paymentStatus", total_amount AS amount, created_at AS "createdAt"
       FROM appointments WHERE patient_id = :me ORDER BY date DESC, id DESC`, { me });
    const orders = await q(
      `SELECT o.id, o.order_number AS "orderNumber", o.total, o.status, o.payment_status AS "paymentStatus", o.created_at AS "createdAt",
              COALESCE((SELECT json_agg(json_build_object('name', oi.name, 'qty', oi.qty, 'price', oi.price)) FROM order_items oi WHERE oi.order_id = o.id), '[]'::json) AS items
       FROM orders o WHERE o.user_id = :me ORDER BY o.id DESC`, { me });
    const sessionRecords = await q(
      `SELECT p.id, to_char(a.date, 'YYYY-MM-DD') AS date, a.therapist_name AS "therapist", p.status, p.chief_complaint AS "chiefComplaint", p.diagnosis, p.treatment_provided AS "treatmentProvided", p.plan_of_care AS "planOfCare"
       FROM pcr p JOIN appointments a ON a.id = p.appointment_id WHERE a.patient_id = :me AND LOWER(p.status) IN ('submitted', 'locked') ORDER BY a.date DESC`, { me });
    const consents = await q(`SELECT consent_type AS type, policy_version AS version, granted, created_at AS "createdAt" FROM consent_logs WHERE user_id = :me ORDER BY id`, { me });
    const guardians = await q(`SELECT guardian_name AS name, relation, created_at AS "createdAt" FROM patient_guardians WHERE patient_user_id = :me ORDER BY id`, { me });

    // the file is a record of this request too
    await q(`INSERT INTO privacy_requests (user_id, type, status, closed_at, note) VALUES (:me, 'export', 'done', NOW(), 'Downloaded by the user') RETURNING id`, { me });
    res.set({ "Content-Type": "application/json", "Content-Disposition": `attachment; filename="curevan-my-data.json"`, "Cache-Control": "private, no-store" });
    return res.send(JSON.stringify({ generatedAt: new Date().toISOString(), profile, bookings, orders, sessionRecords, consents, guardians }, null, 2));
  } catch (err) {
    console.error("privacy export error:", err.message);
    return fail(res, 500, "Could not prepare your data");
  }
};

// GET /api/privacy/admin/requests?status= (Super Admin)
exports.adminList = async (req, res) => {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const rows = await q(
      `SELECT r.id, r.user_id AS "userId", u.name AS "userName", u.email AS "userEmail", r.type, r.status, r.note, r.created_at AS "createdAt", r.closed_at AS "closedAt", r.handled_by AS "handledBy"
       FROM privacy_requests r LEFT JOIN users u ON u.id = r.user_id
       WHERE (:status::text IS NULL OR r.status = :status) ORDER BY (r.status IN ('open', 'in_progress')) DESC, r.id DESC LIMIT 500`, { status });
    return res.json({ success: true, data: rows });
  } catch (err) { return fail(res, 500, "Could not load the requests"); }
};

// PATCH /api/privacy/admin/requests/:id { status, note } (Super Admin)
exports.adminUpdate = async (req, res) => {
  try {
    const { status, note } = req.body || {};
    if (!STATUSES.includes(status)) return fail(res, 400, `status must be one of ${STATUSES.join(", ")}`);
    const closed = ["done", "rejected"].includes(status);
    const rows = await q(
      `UPDATE privacy_requests SET status = :status, note = COALESCE(:note, note), handled_by = :admin, closed_at = CASE WHEN :closed THEN NOW() ELSE NULL END WHERE id = :id RETURNING id, status`,
      { status, note: note ? String(note).slice(0, 1000) : null, admin: req.user.id, closed, id: req.params.id });
    if (!rows.length) return fail(res, 404, "Request not found");
    return res.json({ success: true, data: rows[0] });
  } catch (err) { return fail(res, 500, "Could not update the request"); }
};
