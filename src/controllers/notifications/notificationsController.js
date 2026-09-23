const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

exports.listNotifications = async (req, res) => {
  try {
    const { uid } = req.params;

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
      data: notifications
    });
  } catch (error) {
    console.error("listNotifications error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};