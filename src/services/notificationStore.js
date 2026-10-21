/**
 * In-app notifications (the bell) plus a best-effort push to the user's phone.
 *   create(userId, { type, title, message, link })      only the in-app row
 *   notify(userId, payload)                              row + push
 *   notifyRoles(["admin.super", ...], payload)           row + push for everyone holding one of the roles
 * `notifications.user_uid` stores the numeric user id as text.
 */
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");

async function create(userId, { type = "system", title, message = "", link = "" }, transaction) {
  await sequelize.query(
    `INSERT INTO notifications (user_uid, type, title, message, link)
     VALUES (:uid, :type, :title, :message, :link)`,
    {
      replacements: { uid: String(userId), type, title: String(title).slice(0, 255), message, link: String(link).slice(0, 255) },
      type: QueryTypes.INSERT,
      transaction,
    }
  );
}

async function push(token, { title, message = "", link = "", type = "system", data = {} }) {
  if (!token) return;
  try {
    const { getMessaging } = require("../config/firebaseAdmin");
    await getMessaging().send({
      notification: { title, body: message },
      data: { type, link: link || "", ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) },
      token,
    });
  } catch (err) {
    console.error("push failed (the in-app notification was still saved):", err.message);
  }
}

async function notify(userId, payload) {
  try {
    await create(userId, payload);
    const [u] = await sequelize.query(`SELECT fcm_token FROM users WHERE id = :id`, { replacements: { id: userId }, type: QueryTypes.SELECT });
    if (u && u.fcm_token) await push(u.fcm_token, payload);
  } catch (err) {
    console.error("notify failed:", err.message);
  }
}

async function notifyRoles(roleNames, payload) {
  const users = await sequelize.query(
    `SELECT DISTINCT u.id, u.fcm_token
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.name IN (:roles)`,
    { replacements: { roles: roleNames }, type: QueryTypes.SELECT }
  );
  for (const u of users) {
    try {
      await create(u.id, payload);
      await push(u.fcm_token, payload);
    } catch (err) {
      console.error("notifyRoles failed for user", u.id, err.message);
    }
  }
  return users.length;
}

module.exports = { create, notify, notifyRoles };
