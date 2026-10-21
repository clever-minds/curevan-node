// Start-of-session OTP (D8). The plain code exists only in the response to the patient;
// the database keeps a salted hash and the code is never logged.
const crypto = require("crypto");
const rules = require("../config/businessRules");

const secret = () => process.env.OTP_SECRET || process.env.JWT_SECRET || "curevan-otp";

function generate() {
  const max = 10 ** rules.otp.length;
  return String(crypto.randomInt(0, max)).padStart(rules.otp.length, "0");
}

function hash(appointmentId, otp) {
  return crypto.createHmac("sha256", secret()).update(`${appointmentId}:${otp}`).digest("hex");
}

function matches(appointmentId, otp, storedHash) {
  if (!storedHash || !/^\d+$/.test(String(otp ?? "")) || String(otp).length !== rules.otp.length) return false;
  const a = Buffer.from(hash(appointmentId, String(otp)), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Make a new OTP for a booking. Returns { otp, hash } - store only the hash. */
function issue(appointmentId) {
  const otp = generate();
  return { otp, hash: hash(appointmentId, otp) };
}

module.exports = { issue, matches, hash };
