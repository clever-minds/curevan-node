/**
 * Push notification channel adapter (P24).
 * Integrates with Firebase Cloud Messaging (FCM) via firebaseNotifier.
 */
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");
const firebaseNotifier = require("../../../utils/firebaseNotifier");

async function sendPush({ userId = null, token = null, title, body, data = {} }) {
  let fcmToken = token;
  if (!fcmToken && userId) {
    const [u] = await sequelize.query(`SELECT fcm_token FROM users WHERE id = :id`, {
      replacements: { id: userId },
      type: QueryTypes.SELECT,
    });
    fcmToken = u?.fcm_token;
  }

  if (!fcmToken) {
    return { success: false, skipped: true, error: "No FCM token available for user" };
  }

  try {
    const sanitizedData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])
    );

    await firebaseNotifier.sendToTherapist(fcmToken, title, body, sanitizedData);
    return { success: true, messageId: `fcm_${Date.now()}`, provider: "firebase" };
  } catch (err) {
    console.warn("FCM push send failed:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendPush };
