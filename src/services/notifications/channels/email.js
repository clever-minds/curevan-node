/**
 * Transactional Email channel adapter (P24).
 * Supports API providers (SendGrid/SES/SMTP) and Console/Nodemailer dev fallback.
 * Strictly adheres to rule: NEVER SEND OTP VIA EMAIL.
 */
const transporter = require("../../../config/mailer");

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

  // If real SMTP or nodemailer configured and provider not explicitly console
  if (provider !== "console" && transporter) {
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
