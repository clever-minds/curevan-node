/**
 * Ownership / visibility helpers (P04).
 * Role helpers live in middlewares/requireRole.js; this file adds record-level checks.
 */
const jwt = require("jsonwebtoken");
const rules = require("../config/businessRules");
const { hasRole, isAdmin } = require("../middlewares/requireRole");

const same = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && Number(a) === Number(b);

// Admin who may see clinical records (PCR): super + therapy admin
const isClinicalAdmin = (user) => hasRole(user, "admin.super") || hasRole(user, "admin.therapy");
// Admin who may see shop records: super + e-com admin
const isShopAdmin = (user) => hasRole(user, "admin.super") || hasRole(user, "admin.ecom");

const apptPatientId = (a) => a && (a.patient_id ?? a.patientId);
const apptTherapistId = (a) => a && (a.therapist_id ?? a.therapistId);

function canAccessAppointment(user, appt) {
  if (!user || !appt) return false;
  if (isAdmin(user)) return true;
  return same(apptPatientId(appt), user.id) || same(apptTherapistId(appt), user.id);
}

function canAccessOrder(user, order) {
  if (!user || !order) return false;
  if (isShopAdmin(user)) return true;
  return same(order.user_id ?? order.userId, user.id);
}

// "10:00", "10:00:00", "10:00 AM", "2:30 pm" -> {h, m} or null
function parseClock(value) {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) {
    const pm = m[3].toLowerCase() === "pm";
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return h > 23 || min > 59 ? null : { h, m: min };
}

// Slot start as a Date (IST), or null when date/time cannot be read.
function slotStart(appt) {
  if (!appt) return null;
  const rawDate = appt.date;
  let ymd = null;
  if (rawDate instanceof Date) {
    // pg returns DATE columns as local midnight; use the local calendar parts
    ymd = `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, "0")}-${String(rawDate.getDate()).padStart(2, "0")}`;
  } else if (rawDate) {
    const m = String(rawDate).match(/^(\d{4}-\d{2}-\d{2})/);
    ymd = m ? m[1] : null;
  }
  const clock = parseClock(appt.start_time ?? appt.startTime ?? appt.time);
  if (!ymd || !clock) return null;
  const d = new Date(`${ymd}T${String(clock.h).padStart(2, "0")}:${String(clock.m).padStart(2, "0")}:00+05:30`);
  return isNaN(d.getTime()) ? null : d;
}

// True from windowHoursBefore before the slot until slot end + windowHoursAfter.
function withinAddressWindow(appt, now = new Date()) {
  const start = slotStart(appt);
  if (!start) return false;
  const from = start.getTime() - rules.maskedCall.windowHoursBefore * 3600 * 1000;
  const to = start.getTime() + rules.session.slotMinutes * 60 * 1000 + rules.maskedCall.windowHoursAfter * 3600 * 1000;
  return now.getTime() >= from && now.getTime() <= to;
}

/**
 * Remove personal data from an appointment object for the viewing user.
 * Admins see everything. Patients and therapists never get a phone number;
 * a therapist gets the service-address reference only inside the visit window.
 */
function sanitizeAppointmentForViewer(user, appt) {
  if (!appt) return appt;
  const out = { ...appt };
  for (const k of ["start_otp_hash", "startOtpHash", "otp_attempts", "otpAttempts"]) delete out[k];   // the start-code hash never leaves the server
  if (isAdmin(user)) return out;
  delete out.patientPhone;
  delete out.therapistPhone;
  delete out.patient_phone;
  delete out.therapist_phone;
  const isPatient = same(apptPatientId(appt), user.id);
  if (!isPatient && same(apptTherapistId(appt), user.id) && !withinAddressWindow(appt)) {
    if ("serviceAddress" in out) out.serviceAddress = null;
    if ("serviceAddressDetail" in out) out.serviceAddressDetail = null;
    if ("service_address_id" in out) out.service_address_id = null;
  }
  return out;
}

// Decode the JWT if one is sent, without rejecting anonymous callers (for public routes
// whose response depends on who is asking). Returns the payload or null.
function optionalUser(req) {
  try {
    let token = null;
    const h = req.headers && req.headers.authorization;
    if (h && h.startsWith("Bearer ")) token = h.split(" ")[1];
    if (!token && req.cookies && req.cookies.token) token = req.cookies.token;
    if (!token || token === "null" || token === "undefined") return null;
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// :userId in therapist routes can be the numeric id or the uid string.
const isSelfParam = (user, param) =>
  !!user && param !== undefined && param !== null && (String(param) === String(user.id) || (user.uid && String(param) === String(user.uid)));

// Personal / financial fields of a therapist that must not reach other users.
const PRIVATE_KEY_RE = /(^|_)(pan|bank|ifsc|kyc|aadhaar|account)|document|^(email|phone|mobile|pin|fullAddress|full_address|address_line1|address_line2|line1|line2)$/i;
function stripTherapistPrivate(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (PRIVATE_KEY_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

const deny = (res, status = 403, message = "Forbidden") => res.status(status).json({ success: false, message });

module.exports = {
  isAdmin,
  isClinicalAdmin,
  isShopAdmin,
  same,
  canAccessAppointment,
  canAccessOrder,
  slotStart,
  withinAddressWindow,
  sanitizeAppointmentForViewer,
  optionalUser,
  isSelfParam,
  stripTherapistPrivate,
  deny,
};
