/**
 * WhatsApp channel adapter (P24).
 * Supports 'meta' (Meta WhatsApp Cloud API), 'fail' (for testing fallback), and 'console' (dev/testing).
 * Automatically retries once on network failure.
 */
const axios = require("axios");

function cleanPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

async function sendWhatsApp({ to, text, templateName, templateParams = [], components = null }) {
  const phone = cleanPhone(to);
  if (!phone) {
    throw new Error("Invalid recipient phone number for WhatsApp");
  }

  const provider = (process.env.WHATSAPP_PROVIDER || "console").toLowerCase();

  // Test simulation for fallback verification
  if (provider === "fail") {
    throw new Error("Simulated WhatsApp delivery failure for fallback test");
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

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
          language: { code: "en_US" },
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

    // Attempt with 1 retry
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const resp = await axios.post(
          `https://graph.facebook.com/v21.0/${phoneId}/messages`,
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
        if (attempt === 1) await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error(`Meta WhatsApp API failed: ${lastErr?.response?.data?.error?.message || lastErr.message}`);
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
