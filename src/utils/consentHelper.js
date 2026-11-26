/**
 * Consent helper utility (P25, P30).
 * Handles persistent communication consent logging and user preference updates.
 */
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const rules = require("../config/businessRules");

async function saveWhatsAppConsent(userId, granted, source = "account", req = null) {
  if (!userId) return;
  const isGranted = Boolean(granted);
  const policyVersion = rules.consent?.policyVersion || "2026-10";

  await sequelize.query(
    `UPDATE users
     SET whatsapp_opt_in = :isGranted,
         whatsapp_opt_in_at = NOW(),
         whatsapp_opt_in_source = :source
     WHERE id = :userId`,
    {
      replacements: { userId, isGranted, source },
      type: QueryTypes.UPDATE,
    }
  );

  await sequelize.query(
    `INSERT INTO consent_logs (user_id, consent_type, policy_version, granted, ip, user_agent, created_at)
     VALUES (:userId, 'whatsapp', :policyVersion, :isGranted, :ip, :ua, NOW())`,
    {
      replacements: {
        userId,
        policyVersion,
        isGranted,
        ip: req?.ip || null,
        ua: String(req?.headers?.["user-agent"] || "").slice(0, 300) || null,
      },
      type: QueryTypes.INSERT,
    }
  );
}

module.exports = { saveWhatsAppConsent };
