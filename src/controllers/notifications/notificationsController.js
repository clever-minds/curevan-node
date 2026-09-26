const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

exports.listNotifications = async (req, res) => {
  try {
    const { id } = req.params; 
    const uid = String(id);

    console.log("\n======================================");
    console.log("[BACKEND_API] /api/notifications/list/:id HIT!");
    console.log(`[BACKEND_API] req.params.id aayi hai: ---> ${id} <---`);
    console.log("======================================\n");

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

    console.log(`[BACKEND_NOTIFICATION_LIST] Data returned:`, notifications);

    res.json({
      status: true,
      data: notifications
    });
  } catch (error) {
    console.error("listNotifications error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.unreadCount = async (req, res) => {
  try {
    const { id } = req.params; 
    const uid = String(id);

    const [result] = await sequelize.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_uid = :uid AND is_read = false`,
      {
        replacements: { uid },
        type: QueryTypes.SELECT
      }
    );

    res.json({
      status: true,
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
    
    await sequelize.query(
      `UPDATE notifications SET is_read = true WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.UPDATE
      }
    );

    res.json({
      success: true,
      status: true,
      message: "Notification marked as read"
    });
  } catch (error) {
    console.error("markAsRead error:", error);
    res.status(500).json({ success: false, status: false, message: "Server error" });
  }
};
