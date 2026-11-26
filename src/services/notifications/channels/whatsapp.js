/**
 * WhatsApp channel adapter (P24, P30).
 * Supports 'meta' (Meta WhatsApp Cloud API), 'fail' (for testing fallback), and 'console' (dev/testing).
 * Automatically retries once on network failure or rate limit (429 / 130429).
 */
const axios = require("axios");
const rules = require("../../../config/businessRules");

function cleanPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

async function sendWhatsApp({ to, text, templateName, templateParams = [], components = null }) {
  // Master feature switch (P30: businessRules.features.whatsapp)
  if (rules.features && rules.features.whatsapp === false) {
    return {
      success: false,
      skipped: true,
      reason: "features.whatsapp_disabled",
    };
  }

  const phone = cleanPhone(to);
  if (!phone) {
    throw new Error("Invalid recipient phone number for WhatsApp");
  }

  const provider = (process.env.WHATSAPP_PROVIDER || "console").toLowerCase();

  // Test simulation for fallback verification
  if (provider === "fail") {
    const failErr = new Error("Simulated WhatsApp delivery failure for fallback test");
    failErr.isFallbackToSms = true;
    throw failErr;
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = rules.whatsapp?.graphVersion || process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
  const templateLang = rules.whatsapp?.templateLang || process.env.WHATSAPP_TEMPLATE_LANG || "en";

  // Real Meta Cloud API
  if (provider === "meta" && token && phoneId) {
    let bodyPayload;
    if (templateName) {
      bodyPayload = {
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLang },
          components: components || [
            {
              type: "body",
              parameters: templateParams.map((p) => ({ type: "text", text: String(p) })),
            },
          ],
        },
      };
    } else {
      bodyPayload = {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body: text },
      };
    }

    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const resp = await axios.post(
          `https://graph.facebook.com/${graphVersion}/${phoneId}/messages`,
          bodyPayload,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            timeout: 5000,
          }
        );
        const msgId = resp.data?.messages?.[0]?.id || "wa_meta_ok";
        return { success: true, messageId: msgId, provider: "meta" };
      } catch (err) {
        lastErr = err;
        const status = err.response?.status;
        const metaCode = err.response?.data?.error?.code;

        // Do not retry on 4xx errors except rate limits (429 or Meta code 130429)
        const isRateLimit = status === 429 || metaCode === 130429;
        const isClientError = status && status >= 400 && status < 500;
        if (isClientError && !isRateLimit) {
          break; // Stop immediately without second attempt
        }

        if (attempt === 1) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }

    const metaErr = lastErr?.response?.data?.error;
    const metaCode = metaErr?.code;
    const metaMsg = metaErr?.message || lastErr.message;

    const error = new Error(`Meta WhatsApp API failed (${metaCode || "ERR"}): ${metaMsg}`);
    error.code = metaCode;

    // Map Meta error 131026 (not a WhatsApp user) and 131047 (24-hour window) to fallback to SMS
    if (metaCode === 131026 || metaCode === 131047) {
      error.isFallbackToSms = true;
      error.fallbackReason = metaCode === 131026 ? "not_a_whatsapp_user" : "outside_24h_window";
    }

    throw error;
  }

  // Console / Dev Provider (Sanitize any potential OTP before logging to stdout)
  const safeBody = (text || JSON.stringify(templateParams)).replace(/\b\d{4,6}\b/g, "[REDACTED]");
  console.log(`[WhatsApp:console] To: ${phone} | Template: ${templateName || "raw_text"} | Body: ${safeBody}`);
  return {
    success: true,
    messageId: `wa_console_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider: "console",
  };
}

module.exports = { sendWhatsApp, cleanPhone };
