const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const access = require("../../utils/access");
const notificationStore = require("../../services/notificationStore");
const notifications = require("../../services/notifications");

const ADMIN_ROLES = ["admin.super", "admin.therapy"];

// row -> the shape the frontend's SOSAlert type and pages use
const toAlert = (r) => ({
  id: String(r.id),
  therapistId: String(r.raised_by),
  therapistName: r.raised_by_name || null,
  bookingId: r.appointment_id !== null && r.appointment_id !== undefined ? String(r.appointment_id) : "",
  type: r.alert_type || "sos",
  message: r.message || null,
  raisedByRole: r.role || null,
  location: { lat: r.lat !== null ? Number(r.lat) : null, lng: r.lng !== null ? Number(r.lng) : null },
  status: r.status,
  timestamp: r.created_at,
  triggeredAt: r.created_at,
  resolvedAt: r.resolved_at || null,
  resolutionNote: r.resolution_note || null,
});

/* POST /api/sos/create   { bookingId?, location?: {lat,lng}, type?: 'sos'|'missed-checkin', message? } */
exports.createAlert = async (req, res) => {
  try {
    const { bookingId, location, message } = req.body || {};
    const alertType = req.body && req.body.type === "missed-checkin" ? "missed-checkin" : "sos";

    // an alert can only reference a booking the caller is part of
    let appointmentId = null;
    if (bookingId) {
      const [appt] = await sequelize.query(
        `SELECT id, patient_id, therapist_id FROM appointments WHERE id = :id`,
        { replacements: { id: Number(bookingId) }, type: QueryTypes.SELECT }
      );
      if (!appt || !access.canAccessAppointment(req.user, appt)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      appointmentId = appt.id;
    }

    const lat = location && Number.isFinite(Number(location.lat)) ? Number(location.lat) : null;
    const lng = location && Number.isFinite(Number(location.lng)) ? Number(location.lng) : null;
    const role = Array.isArray(req.user.roles) && req.user.roles.length ? req.user.roles[0] : req.user.role;

    const [rows] = await sequelize.query(
      `INSERT INTO sos_alerts (appointment_id, raised_by, role, alert_type, lat, lng, message)
       VALUES (:appointmentId, :userId, :role, :alertType, :lat, :lng, :message)
       RETURNING id`,
      { replacements: { appointmentId, userId: req.user.id, role, alertType, lat, lng, message: message ? String(message).slice(0, 500) : null }, type: QueryTypes.INSERT }
    );
    const alertId = rows[0].id;

    // tell every Super Admin and Therapy Admin (bell + push)
    const [who] = await sequelize.query(`SELECT name, phone FROM users WHERE id = :id`, { replacements: { id: req.user.id }, type: QueryTypes.SELECT });
    const notified = await notificationStore.notifyRoles(ADMIN_ROLES, {
      type: "sos",
      title: alertType === "sos" ? "SOS alert" : "Missed check-in",
      message: `${(who && who.name) || "A user"} raised an alert${appointmentId ? ` for booking #${appointmentId}` : ""}.`,
      link: "/dashboard/admin/sos-alerts",
      data: { alertId },
    });

    // P24: Dispatch sos_raised via notifications (Admin: push + SMS to on-call)
    await notifications.notify("sos_raised", {
      therapistName: who?.name,
      phone: who?.phone,
      bookingId: appointmentId,
      time: new Date().toLocaleTimeString("en-IN"),
      lat,
      lng,
    }).catch((err) => console.error("Failed to notify sos_raised:", err.message));

    return res.json({ success: true, message: "Alert sent", data: { id: String(alertId), notifiedAdmins: notified } });
  } catch (error) {
    console.error("createAlert error:", error);
    return res.status(500).json({ success: false, message: "Could not send the alert" });
  }
};

/* GET /api/sos/list?status=active|resolved   (Super Admin, Therapy Admin) */
exports.listAlerts = async (req, res) => {
  try {
    const status = req.query.status === "resolved" || req.query.status === "active" ? req.query.status : null;
    const rows = await sequelize.query(
      `SELECT s.*, u.name AS raised_by_name
       FROM sos_alerts s
       LEFT JOIN users u ON u.id = s.raised_by
       ${status ? "WHERE s.status = :status" : ""}
       ORDER BY (s.status = 'active') DESC, s.created_at DESC
       LIMIT 500`,
      { replacements: { status }, type: QueryTypes.SELECT }
    );
    return res.json({ success: true, data: rows.map(toAlert) });
  } catch (error) {
    console.error("listAlerts error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch alerts" });
  }
};

/* POST /api/sos/resolve   { alertId, note? }   (Super Admin, Therapy Admin) */
exports.resolveAlert = async (req, res) => {
  try {
    const { alertId, note } = req.body || {};
    if (!alertId) return res.status(400).json({ success: false, error: "alertId is required", message: "alertId is required" });

    // the resolver is the logged-in admin; an actorId in the body is ignored
    const rows = await sequelize.query(
      `UPDATE sos_alerts
       SET status = 'resolved', resolved_by = :adminId, resolved_at = NOW(), resolution_note = :note
       WHERE id = :id AND status = 'active'
       RETURNING id`,
      { replacements: { id: Number(alertId), adminId: req.user.id, note: note ? String(note).slice(0, 500) : null }, type: QueryTypes.SELECT }
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Alert not found or already resolved", message: "Alert not found or already resolved" });
    }
    return res.json({ success: true, message: "Alert resolved" });
  } catch (error) {
    console.error("resolveAlert error:", error);
    return res.status(500).json({ success: false, error: "Failed to resolve alert", message: "Failed to resolve alert" });
  }
};
