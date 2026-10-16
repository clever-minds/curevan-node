const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

// Every handler works on the LOGGED-IN user's own notifications. An id in the URL is accepted
// (the website sends one) but never used to read someone else's rows.
// notifications.user_uid holds the numeric user id as text.

exports.listNotifications = async (req, res) => {
  try {
    const uid = String(req.user.id);

    const notifications = await sequelize.query(
      `SELECT
        id,
        type,
        title,
        message,
        is_read as read,
        link,
        created_at as "createdAt"
       FROM notifications
       WHERE user_uid = :uid
       ORDER BY created_at DESC
       LIMIT 50`,
      {
        replacements: { uid },
        type: QueryTypes.SELECT
      }
    );

    res.json({
      status: true,
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error("listNotifications error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.unreadCount = async (req, res) => {
  try {
    const uid = String(req.user.id);

    const [result] = await sequelize.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_uid = :uid AND is_read = false`,
      {
        replacements: { uid },
        type: QueryTypes.SELECT
      }
    );

    res.json({
      status: true,
      success: true,
      data: {
        count: parseInt(result.count || 0, 10)
      }
    });
  } catch (error) {
    console.error("unreadCount error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    // only the owner can mark a notification as read
    const updated = await sequelize.query(
      `UPDATE notifications SET is_read = true WHERE id = :id AND user_uid = :uid RETURNING id`,
      {
        replacements: { id, uid: String(req.user.id) },
        type: QueryTypes.SELECT
      }
    );

    if (!updated.length) {
      return res.status(404).json({ success: false, status: false, message: "Notification not found" });
    }

    res.json({
      success: true,
      status: true,
      message: "Notification marked as read"
    });
  } catch (error) {
    // a malformed id (not a uuid) is simply "not found"
    if (error && error.original && error.original.code === "22P02") {
      return res.status(404).json({ success: false, status: false, message: "Notification not found" });
    }
    console.error("markAsRead error:", error);
    res.status(500).json({ success: false, status: false, message: "Server error" });
  }
};
