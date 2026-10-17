/**
 * Transactional Email channel adapter (P24).
 * MAIL_PROVIDER: sendgrid (HTTP API, production), smtp (the old Gmail/SMTP transporter, dev fallback only) or console (default).
 * Strictly adheres to rule: NEVER SEND OTP VIA EMAIL.
 */
const axios = require("axios");
const transporter = require("../../../config/mailer");

// "Name <a@b.c>" or "a@b.c" -> { email, name }
const parseFrom = (v) => { const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(v); return m ? { email: m[2].trim(), name: m[1].trim() || undefined } : { email: String(v).trim() }; };

async function sendEmail({ to, subject, text, html, attachments = [] }) {
  if (!to || !to.includes("@")) {
    throw new Error("Invalid recipient email address");
  }

  // Strict boundary rule: Never send OTP via email
  const combined = `${subject || ""} ${text || ""} ${html || ""}`;
  const otpLeakRegex = /(?:otp|start\s*code)(?:(?:\s+is)?[\s:=]+|\s+)(\d{4,6})\b/i;
  if (otpLeakRegex.test(combined)) {
    throw new Error("Security Violation: OTP must never be transmitted via email (P24 boundary)");
  }

  const from = process.env.MAIL_FROM || '"Curevan Care" <notifications@curevan.com>';
  const provider = (process.env.MAIL_PROVIDER || "console").toLowerCase();

  // MAIL_PROVIDER=sendgrid: transactional e-mail through the SendGrid HTTP API (sender domain curevan.com via MAIL_FROM); one retry
  if (provider === "sendgrid" && process.env.SENDGRID_API_KEY) {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const resp = await axios.post(
          "https://api.sendgrid.com/v3/mail/send",
          {
            personalizations: [{ to: [{ email: to }] }],
            from: parseFrom(from),
            subject,
            content: [{ type: "text/plain", value: text || " " }, ...(html ? [{ type: "text/html", value: html }] : [])],
          },
          { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, "content-type": "application/json" }, timeout: 8000 }
        );
        return { success: true, messageId: resp.headers?.["x-message-id"] || "mail_sendgrid_ok", provider: "sendgrid" };
      } catch (err) {
        lastErr = err;
        if (attempt === 1) await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error(`SendGrid failed: ${lastErr?.response?.data?.errors?.[0]?.message || lastErr.message}`);
  }

  // If real SMTP or nodemailer configured and provider not explicitly console
  if (provider === "smtp" && transporter) {
    try {
      const info = await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html,
        attachments,
      });
      return { success: true, messageId: info?.messageId || "mail_smtp_ok", provider: "smtp" };
    } catch (err) {
      console.error("SMTP email send failed:", err.message);
      throw err;
    }
  }

  // Console / Dev Provider
  console.log(`[Email:console] To: ${to} | From: ${from} | Subject: ${subject}`);
  return {
    success: true,
    messageId: `mail_console_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider: "console",
  };
}

module.exports = { sendEmail };
