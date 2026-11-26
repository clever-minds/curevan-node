const { sequelize } = require("../../config/db");
const { QueryTypes } = require("sequelize");
const { notify } = require("../../services/notifications");

/**
 * Mask phone number for privacy: e.g. +91 95144 46292 -> +91 ••••• 46292
 */
function maskPhone(phone) {
  if (!phone) return null;
  const cleaned = String(phone).replace(/[^\d+]/g, "");
  if (cleaned.length <= 4) return "••••";
  const last4 = cleaned.slice(-4);
  const prefix = cleaned.startsWith("+") ? cleaned.slice(0, 3) + " " : "";
  return `${prefix}••••• ${last4}`.trim();
}

/**
 * GET /api/admin/notification-log
 * Query params: event, status, channel, limit, offset
 * Role: admin.super
 * Returns last 100 entries joined with users. Phone is masked. Strictly NO message bodies, NO OTPs.
 */
async function getNotificationLogs(req, res) {
  try {
    const { event, status, channel } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const conditions = [];
    const replacements = { limit, offset };

    if (event) {
      conditions.push("nl.event = :event");
      replacements.event = event;
    }
    if (status) {
      conditions.push("nl.status = :status");
      replacements.status = status;
    }
    if (channel) {
      conditions.push("nl.channel = :channel");
      replacements.channel = channel;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
      SELECT 
        nl.id,
        nl.user_id,
        nl.event,
        nl.channel,
        nl.template,
        nl.status,
        nl.provider_message_id,
        nl.error,
        nl.error_code,
        nl.created_at,
        nl.delivered_at,
        nl.read_at,
        nl.failed_at,
        u.role AS user_role,
        u.phone AS user_phone,
        u.name AS user_name
      FROM notification_log nl
      LEFT JOIN users u ON u.id = nl.user_id
      ${whereClause}
      ORDER BY nl.created_at DESC
      LIMIT :limit OFFSET :offset
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM notification_log nl
      ${whereClause}
    `;

    const [rows, countResult] = await Promise.all([
      sequelize.query(query, { replacements, type: QueryTypes.SELECT }),
      sequelize.query(countQuery, { replacements, type: QueryTypes.SELECT }),
    ]);

    const total = parseInt(countResult[0]?.total || 0, 10);

    const sanitizedLogs = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      event: row.event,
      channel: row.channel,
      template: row.template,
      status: row.status,
      providerMessageId: row.provider_message_id,
      error: row.error,
      errorCode: row.error_code,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at,
      readAt: row.read_at,
      failedAt: row.failed_at,
      userRole: row.user_role || "Unknown",
      userName: row.user_name || null,
      maskedPhone: maskPhone(row.user_phone),
    }));

    return res.status(200).json({
      success: true,
      data: {
        total,
        limit,
        offset,
        logs: sanitizedLogs,
      },
    });
  } catch (err) {
    console.error("[NotificationLogController] getNotificationLogs error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notification logs",
    });
  }
}

/**
 * POST /api/admin/notification-log/:id/resend
 * Looks up row by ID, re-dispatches notification, logs new row.
 * Role: admin.super
 */
async function resendNotification(req, res) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Missing log ID" });
    }

    const [log] = await sequelize.query(
      `SELECT nl.*, u.phone, u.email, u.name, u.role
       FROM notification_log nl
       LEFT JOIN users u ON u.id = nl.user_id
       WHERE nl.id = :id
       LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!log) {
      return res.status(404).json({ success: false, message: "Notification log entry not found" });
    }

    // Attempt re-dispatch using the notification dispatcher
    // To re-dispatch, we construct a synthetic payload containing the recipient user
    const resendPayload = {
      user: {
        id: log.user_id,
        phone: log.phone,
        email: log.email,
        name: log.name,
        role: log.role,
        whatsapp_opt_in: true, // Force re-dispatch if initiated manually by admin
      },
      channelOverride: log.channel,
      templateOverride: log.template,
      isResend: true,
      originalLogId: log.id,
    };

    // If there's an associated entity, notify will process
    await notify(log.event, resendPayload);

    return res.status(200).json({
      success: true,
      message: `Notification resend initiated for event ${log.event}`,
    });
  } catch (err) {
    console.error("[NotificationLogController] resendNotification error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to resend notification",
    });
  }
}

module.exports = {
  getNotificationLogs,
  resendNotification,
  maskPhone,
};
