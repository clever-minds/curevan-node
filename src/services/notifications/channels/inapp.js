/**
 * In-app notification channel adapter (P24).
 * Writes directly to the notifications table (the notification bell in UI).
 */
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

async function sendInApp({ userId, type = "system", title, message = "", link = "" }) {
  if (!userId) {
    return { success: false, error: "userId required for in-app notification" };
  }

  try {
    const [row] = await sequelize.query(
      `INSERT INTO notifications (user_uid, type, title, message, link)
       VALUES (:uid, :type, :title, :message, :link)
       RETURNING id`,
      {
        replacements: {
          uid: String(userId),
          type,
          title: String(title || "").slice(0, 255),
          message: String(message || ""),
          link: String(link || "").slice(0, 255),
        },
        type: QueryTypes.INSERT,
      }
    );

    return {
      success: true,
      notificationId: Array.isArray(row) && row[0]?.id ? row[0].id : null,
      provider: "database",
    };
  } catch (err) {
    console.error("Failed to insert in-app notification:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendInApp };
