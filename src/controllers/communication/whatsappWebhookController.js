/**
 * WhatsApp Cloud API Webhook Controller (P30).
 * Handles:
 *  - Verification handshake (GET)
 *  - Payload delivery status & read receipts (POST)
 *  - Inbound opt-out (STOP/UNSUBSCRIBE) & opt-in (START) and support replies (POST)
 *  - Automatic SMS fallback on delivery failure
 */
const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const rules = require("../../config/businessRules");
const { cleanPhone, sendWhatsApp } = require("../../services/notifications/channels/whatsapp");
const { sendSms } = require("../../services/notifications/channels/sms");

/**
 * GET /api/hooks/whatsapp
 * Meta verification handshake.
 */
exports.verify = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token && expectedToken && token === expectedToken) {
    console.log("[WhatsAppWebhook] Verification challenge succeeded");
    return res.status(200).send(challenge);
  }

  console.warn("[WhatsAppWebhook] Verification failed: token mismatch or invalid mode");
  return res.sendStatus(403);
};

/**
 * Verify HMAC-SHA256 signature against WHATSAPP_APP_SECRET.
 */
function verifySignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    // If not set in non-production, log warning; in production reject
    if (process.env.NODE_ENV === "production") return false;
    return true;
  }

  const signature = req.headers["x-hub-signature-256"];
  if (!signature || !signature.startsWith("sha256=")) {
    return false;
  }

  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}));

  const expectedSig = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;

  const sigBuffer = Buffer.from(signature, "utf8");
  const expBuffer = Buffer.from(expectedSig, "utf8");

  if (sigBuffer.length !== expBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expBuffer);
}

/**
 * Handle delivery status update from Meta.
 */
async function handleStatusUpdate(statusObj) {
  const wamid = statusObj?.id;
  const status = statusObj?.status; // sent, delivered, read, failed
  if (!wamid || !status) return;

  const [existing] = await sequelize.query(
    `SELECT id, user_id, event, channel, template, status, dedupe_key, error
     FROM notification_log WHERE provider_message_id = :wamid`,
    { replacements: { wamid }, type: QueryTypes.SELECT }
  );

  if (!existing) return;

  if (status === "delivered") {
    await sequelize.query(
      `UPDATE notification_log
       SET status = 'delivered', delivered_at = COALESCE(delivered_at, NOW())
       WHERE id = :id`,
      { replacements: { id: existing.id }, type: QueryTypes.UPDATE }
    );
  } else if (status === "read") {
    await sequelize.query(
      `UPDATE notification_log
       SET status = 'read',
           delivered_at = COALESCE(delivered_at, NOW()),
           read_at = COALESCE(read_at, NOW())
       WHERE id = :id`,
      { replacements: { id: existing.id }, type: QueryTypes.UPDATE }
    );
  } else if (status === "failed") {
    const errItem = statusObj?.errors?.[0];
    const errCode = errItem?.code ? String(errItem.code) : null;
    const errMsg = errItem?.title || errItem?.message || "Delivery failed";
    const sanitizedError = errMsg.replace(/\b\d{4,6}\b/g, "[REDACTED]").slice(0, 500);

    await sequelize.query(
      `UPDATE notification_log
       SET status = 'failed', failed_at = NOW(), error_code = :errCode, error = :sanitizedError
       WHERE id = :id`,
      {
        replacements: { id: existing.id, errCode, sanitizedError },
        type: QueryTypes.UPDATE,
      }
    );

    // High availability: Send SMS fallback once if this was a patient critical event
    if (existing.user_id && ["booking_confirmed", "reminder_24h", "reminder_2h"].includes(existing.event)) {
      const [alreadySms] = await sequelize.query(
        `SELECT id FROM notification_log
         WHERE event = :event AND user_id = :uid AND channel = 'sms' LIMIT 1`,
        { replacements: { event: existing.event, uid: existing.user_id }, type: QueryTypes.SELECT }
      );

      if (!alreadySms) {
        try {
          const [user] = await sequelize.query(
            `SELECT id, phone, name FROM users WHERE id = :uid`,
            { replacements: { uid: existing.user_id }, type: QueryTypes.SELECT }
          );
          if (user?.phone) {
            const smsText = `Curevan update: Your session notification could not be delivered on WhatsApp. Please check your dashboard: https://www.curevan.com/dashboard/bookings - Curevan`;
            const smsRes = await sendSms({ to: user.phone, text: smsText });
            await sequelize.query(
              `INSERT INTO notification_log (user_id, event, channel, template, status, provider_message_id, created_at)
               VALUES (:uid, :event, 'sms', 'sms_fallback', 'sent', :msgId, NOW())`,
              {
                replacements: { uid: user.id, event: existing.event, msgId: smsRes?.messageId || "sms_fb_ok" },
                type: QueryTypes.INSERT,
              }
            );
          }
        } catch (smsErr) {
          console.error("[WhatsAppWebhook] SMS fallback failed:", smsErr.message);
        }
      }
    }
  }
}

/**
 * Handle inbound message from customer.
 */
async function handleInboundMessage(msgObj) {
  const wamid = msgObj?.id;
  const fromRaw = msgObj?.from;
  const fromClean = cleanPhone(fromRaw);
  if (!wamid || !fromClean) return;

  // Deduplicate by wamid
  const [existing] = await sequelize.query(
    `SELECT id FROM whatsapp_inbound WHERE wamid = :wamid`,
    { replacements: { wamid }, type: QueryTypes.SELECT }
  );
  if (existing) return;

  const phoneHash = crypto.createHash("sha256").update(fromClean).digest("hex");
  const rawText = msgObj?.text?.body || "";
  const sanitizedSnippet = String(rawText || "")
    .slice(0, 200)
    .replace(/\b\d{4,6}\b/g, "[REDACTED]");

  await sequelize.query(
    `INSERT INTO whatsapp_inbound (from_phone_hash, wamid, type, text_snippet, received_at)
     VALUES (:hash, :wamid, :type, :snippet, NOW())`,
    {
      replacements: {
        hash: phoneHash,
        wamid,
        type: msgObj?.type || "text",
        snippet: sanitizedSnippet,
      },
      type: QueryTypes.INSERT,
    }
  );

  const command = rawText.trim().toUpperCase();
  const policyVer = rules.consent?.policyVersion || "2026-10";

  // Find user matching phone
  const tenDigits = fromClean.slice(-10);
  const [user] = await sequelize.query(
    `SELECT id, name FROM users WHERE phone LIKE :phoneLike OR phone = :fullPhone LIMIT 1`,
    { replacements: { phoneLike: `%${tenDigits}`, fullPhone: fromClean }, type: QueryTypes.SELECT }
  );

  if (command === "STOP" || command === "UNSUBSCRIBE") {
    if (user) {
      await sequelize.query(
        `UPDATE users
         SET whatsapp_opt_in = false,
             whatsapp_opt_in_at = NOW(),
             whatsapp_opt_in_source = 'whatsapp_reply'
         WHERE id = :uid`,
        { replacements: { uid: user.id }, type: QueryTypes.UPDATE }
      );

      await sequelize.query(
        `INSERT INTO consent_logs (user_id, consent_type, policy_version, granted, created_at)
         VALUES (:uid, 'whatsapp', :policyVer, false, NOW())`,
        { replacements: { uid: user.id, policyVer }, type: QueryTypes.INSERT }
      );
    }

    try {
      await sendWhatsApp({
        to: fromClean,
        text: "You will no longer get Curevan updates on WhatsApp. Reply START to turn them on again.",
      });
    } catch (e) {
      console.error("[WhatsAppWebhook] STOP reply error:", e.message);
    }
    return;
  }

  if (command === "START") {
    if (user) {
      await sequelize.query(
        `UPDATE users
         SET whatsapp_opt_in = true,
             whatsapp_opt_in_at = NOW(),
             whatsapp_opt_in_source = 'whatsapp_reply'
         WHERE id = :uid`,
        { replacements: { uid: user.id }, type: QueryTypes.UPDATE }
      );

      await sequelize.query(
        `INSERT INTO consent_logs (user_id, consent_type, policy_version, granted, created_at)
         VALUES (:uid, 'whatsapp', :policyVer, true, NOW())`,
        { replacements: { uid: user.id, policyVer }, type: QueryTypes.INSERT }
      );
    }

    try {
      await sendWhatsApp({
        to: fromClean,
        text: "Thank you! You will now receive Curevan booking and order updates on WhatsApp. Reply STOP anytime to turn them off.",
      });
    } catch (e) {
      console.error("[WhatsAppWebhook] START reply error:", e.message);
    }
    return;
  }

  if (command === "HELP") {
    try {
      await sendWhatsApp({
        to: fromClean,
        text: "Need help? Call +91 95144 46292 or write to care@curevan.com.",
      });
    } catch (e) {
      console.error("[WhatsAppWebhook] HELP reply error:", e.message);
    }
    return;
  }

  // Any other message: reply once per 24 hours
  const [priorInbound] = await sequelize.query(
    `SELECT id FROM whatsapp_inbound
     WHERE from_phone_hash = :hash
       AND received_at >= NOW() - INTERVAL '24 hours'
       AND wamid != :wamid
     LIMIT 1`,
    { replacements: { hash: phoneHash, wamid }, type: QueryTypes.SELECT }
  );

  if (!priorInbound) {
    try {
      await sendWhatsApp({
        to: fromClean,
        text: "This number sends booking and order updates. For help call +91 95144 46292 or write to care@curevan.com.",
      });
    } catch (e) {
      console.error("[WhatsAppWebhook] Default 24h auto-reply error:", e.message);
    }
  }
}

/**
 * POST /api/hooks/whatsapp
 * Meta delivery receipt and inbound webhook handler.
 */
exports.receive = async (req, res) => {
  if (!verifySignature(req)) {
    console.warn("[WhatsAppWebhook] Invalid X-Hub-Signature-256");
    return res.status(401).json({ success: false, error: "Invalid signature" });
  }

  // Fast HTTP 200 acknowledge
  res.status(200).json({ success: true });

  // Process asynchronously without holding the HTTP response
  setImmediate(async () => {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);
      const data = typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(raw);

      const entries = data?.entry || [];
      for (const entry of entries) {
        const changes = entry?.changes || [];
        for (const change of changes) {
          const value = change?.value;
          if (!value) continue;

          // Delivery / Read / Fail statuses
          if (Array.isArray(value.statuses)) {
            for (const st of value.statuses) {
              await handleStatusUpdate(st);
            }
          }

          // Inbound messages
          if (Array.isArray(value.messages)) {
            for (const msg of value.messages) {
              await handleInboundMessage(msg);
            }
          }
        }
      }
    } catch (err) {
      console.error("[WhatsAppWebhook] Processing error:", err.message);
    }
  });
};
