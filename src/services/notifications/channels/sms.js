/**
 * SMS channel adapter with DLT compliance (P24).
 * Supports 'msg91', 'fail' (testing), and 'console' (dev/testing).
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

async function sendSms({ to, text, dltTemplateId, dltEntityId, dltSenderId }) {
  const phone = cleanPhone(to);
  if (!phone) {
    throw new Error("Invalid recipient phone number for SMS");
  }

  const provider = (process.env.SMS_PROVIDER || "console").toLowerCase();

  if (provider === "fail") {
    throw new Error("Simulated SMS gateway failure");
  }

  const authKey = process.env.MSG91_AUTH_KEY || process.env.SMS_AUTH_KEY;
  const sender = dltSenderId || process.env.DLT_SENDER_ID || "CURVAN";

  // MSG91 / Licensed SMS Provider
  if (provider === "msg91" && authKey) {
    if (!dltTemplateId) throw new Error("No DLT template id configured for this message (set its DLT_TID_* variable)");
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const resp = await axios.post(
          "https://control.msg91.com/api/v5/flow/",
          {
            template_id: dltTemplateId,
            sender: sender,
            short_url: "0",
            mobiles: phone,
          },
          {
            headers: {
              authkey: authKey,
              "content-type": "application/json",
            },
            timeout: 5000,
          }
        );
        return { success: true, messageId: resp.data?.message || "sms_msg91_ok", provider: "msg91" };
      } catch (err) {
        lastErr = err;
        if (attempt === 1) await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error(`SMS gateway failed: ${lastErr?.response?.data?.message || lastErr.message}`);
  }

  // Console / Dev Provider (Sanitize any potential OTP before logging to stdout)
  const safeText = String(text || "").replace(/\b\d{4,6}\b/g, "[REDACTED]");
  console.log(`[SMS:console] To: ${phone} | DLT TID: ${dltTemplateId || "N/A"} | Header: ${sender} | Text: ${safeText}`);
  return {
    success: true,
    messageId: `sms_console_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider: "console",
  };
}

module.exports = { sendSms, cleanPhone };
