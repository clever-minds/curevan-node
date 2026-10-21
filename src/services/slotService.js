// Which times a therapist can really be booked (handoff pack P13).
// The server is the only judge: the booking form only shows what getAvailableSlots returns,
// and assertSlotBookable runs again inside the booking transaction.
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const rules = require("../config/businessRules");
const { ACTIVE } = require("./appointmentStateMachine");

const IST_MS = 5.5 * 3600 * 1000;
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const pad = (n) => String(n).padStart(2, "0");

class SlotError extends Error {
  constructor(httpStatus, message) { super(message); this.httpStatus = httpStatus; }
}

// ---- time helpers (everything is Indian time) -----------------------------------------------
const istNow = (now = Date.now()) => new Date(now + IST_MS);
const todayIst = (now) => { const d = istNow(now); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayName = (ymd) => DAY_NAMES[new Date(`${ymd}T00:00:00Z`).getUTCDay()];

/** "09:00", "9", "9:30 PM" -> minutes after midnight, or null */
function toMinutes(v) {
  if (v === null || v === undefined || v === "") return null;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(String(v).trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3]) { h = h % 12; if (m[3].toUpperCase() === "PM") h += 12; }
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}
const label = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const slotStartMs = (ymd, minutes) => new Date(`${ymd}T${label(minutes)}:00+05:30`).getTime();

const truthy = (v) => !(v === false || v === "false" || v === 0 || v === "0" || v === null);

/** Weekday names ("mon", "Monday") and numbers (0 = Sunday) are both accepted. */
function sameDay(stored, ymd) {
  if (stored === null || stored === undefined) return false;
  const idx = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  const s = String(stored).trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s) === idx;
  return s.slice(0, 3) === DAY_NAMES[idx];
}

// ---- data loading -----------------------------------------------------------------------------
async function loadFacts(therapistUserId, ymd, transaction) {
  const opts = { type: QueryTypes.SELECT, transaction };
  const [profile] = await sequelize.query(
    `SELECT id, quality_status, registration_valid_until FROM therapist_profiles WHERE user_id = :uid`,
    { ...opts, replacements: { uid: therapistUserId } }
  );
  if (!profile) return null;

  const availability = await sequelize.query(
    `SELECT * FROM therapist_availability WHERE therapist_id = :pid`,
    { ...opts, replacements: { pid: profile.id } }
  );
  const leaves = await sequelize.query(
    `SELECT start_date, end_date, start_time, end_time, status FROM therapist_leaves
     WHERE therapist_id = :pid AND :ymd::date >= start_date AND :ymd::date <= end_date`,
    { ...opts, replacements: { pid: profile.id, ymd } }
  );
  const booked = await sequelize.query(
    `SELECT id, time FROM appointments
     WHERE therapist_id = :uid AND date = :ymd::date AND status IN (:active)`,
    { ...opts, replacements: { uid: therapistUserId, ymd, active: ACTIVE.filter((s) => s !== "searching_therapist") } }
  );
  return { profile, availability, leaves, booked };
}

/** Working windows (minutes) for one date from the weekly availability rows. */
function windowsFor(availability, ymd) {
  const out = [];
  for (const row of availability) {
    if (!sameDay(row.day_of_week, ymd)) continue;
    if (row.is_enabled !== undefined && row.is_enabled !== null && !truthy(row.is_enabled)) continue;
    const pairs = [[row.morning_start, row.morning_end], [row.evening_start, row.evening_end], [row.start_time, row.end_time]];
    for (const [a, b] of pairs) {
      const s = toMinutes(a), e = toMinutes(b);
      if (s !== null && e !== null && e > s) out.push([s, e]);
    }
  }
  return out;
}

/** Leave windows (minutes) on that date; a leave without times blocks the whole day. */
function leaveWindows(leaves) {
  return leaves
    .filter((l) => l.status === null || l.status === undefined || ["approved", "active"].includes(String(l.status).toLowerCase()))
    .map((l) => {
      const s = toMinutes(l.start_time), e = toMinutes(l.end_time);
      return [s === null ? 0 : s, e === null ? 24 * 60 : e];
    });
}

const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

/** Rules that do not depend on the therapist: not in the past, not too soon, not too far ahead. */
function checkWindowRules(ymd, minutes, now = Date.now(), { skipLead = false } = {}) {
  if (!isYmd(ymd)) return "Please choose a valid date.";
  const start = slotStartMs(ymd, minutes);
  if (Number.isNaN(start)) return "Please choose a valid time.";
  if (start < now) return "That time has already passed.";
  if (!skipLead && start < now + rules.session.minLeadHours * 3600000) return `Bookings must be made at least ${rules.session.minLeadHours} hours ahead.`;
  if (ymd > addDays(todayIst(now), rules.session.maxAdvanceDays)) return `Bookings can be made up to ${rules.session.maxAdvanceDays} days ahead.`;
  return null;
}

// ---- public API ---------------------------------------------------------------------------------
/** Hourly slots a patient can book on that date: [{ time: "10:00" }, ...] */
async function getAvailableSlots(therapistUserId, ymd, now = Date.now()) {
  if (!isYmd(ymd)) throw new SlotError(400, "date must be YYYY-MM-DD");
  const base = { date: ymd, slotMinutes: rules.session.slotMinutes, minLeadHours: rules.session.minLeadHours, maxAdvanceDays: rules.session.maxAdvanceDays };
  if (ymd > addDays(todayIst(now), rules.session.maxAdvanceDays) || ymd < todayIst(now)) return { ...base, slots: [] };

  const facts = await loadFacts(therapistUserId, ymd);
  if (!facts) throw new SlotError(404, "Therapist not found");
  if (facts.profile.quality_status === "frozen" || (facts.profile.registration_valid_until && String(facts.profile.registration_valid_until).slice(0, 10) < todayIst(now))) {
    return { ...base, slots: [] };
  }

  const length = rules.session.slotMinutes;
  const blocked = leaveWindows(facts.leaves);
  const takenStarts = facts.booked.map((b) => toMinutes(b.time)).filter((m) => m !== null);
  const slots = new Set();

  for (const [from, to] of windowsFor(facts.availability, ymd)) {
    for (let t = from; t + length <= to; t += length) {
      if (blocked.some(([b0, b1]) => overlaps(t, t + length, b0, b1))) continue;
      if (takenStarts.some((s) => overlaps(t, t + length, s, s + length))) continue;
      if (checkWindowRules(ymd, t, now)) continue;
      slots.add(t);
    }
  }
  return { ...base, slots: [...slots].sort((a, b) => a - b).map((m) => ({ time: label(m) })) };
}

/**
 * Throws SlotError when this therapist cannot take a booking at date/time.
 * Call it INSIDE the booking transaction; it takes a per-therapist lock so two simultaneous
 * bookings for the same slot cannot both pass.
 *   400 = the request itself breaks a rule (past, <4 h, >30 days, outside hours, leave)
 *   409 = the slot was taken by someone else
 */
async function assertSlotBookable(therapistUserId, ymd, time, { transaction, now = Date.now(), skipLead = false, ignoreAppointmentId = null } = {}) {
  const minutes = toMinutes(time);
  if (!isYmd(ymd) || minutes === null) throw new SlotError(400, "Please choose a valid date and time.");
  const ruleMessage = checkWindowRules(ymd, minutes, now, { skipLead });
  if (ruleMessage) throw new SlotError(400, ruleMessage);

  await sequelize.query(`SELECT pg_advisory_xact_lock(7001, :uid)`, { replacements: { uid: Number(therapistUserId) }, type: QueryTypes.SELECT, transaction });

  const facts = await loadFacts(therapistUserId, ymd, transaction);
  if (!facts) throw new SlotError(404, "Therapist not found");
  if (facts.profile.quality_status === "frozen") {
    throw new SlotError(400, "The therapist is not currently accepting bookings.");
  }
  if (facts.profile.registration_valid_until && String(facts.profile.registration_valid_until).slice(0, 10) < todayIst(now)) {
    throw new SlotError(400, "The therapist's professional registration has expired.");
  }

  const length = rules.session.slotMinutes;
  if (!windowsFor(facts.availability, ymd).some(([from, to]) => minutes >= from && minutes + length <= to)) {
    throw new SlotError(400, "That time is outside the therapist's working hours.");
  }
  if (leaveWindows(facts.leaves).some(([b0, b1]) => overlaps(minutes, minutes + length, b0, b1))) {
    throw new SlotError(400, "The therapist is on leave at that time.");
  }
  const clash = facts.booked.some((b) => {
    if (ignoreAppointmentId && Number(b.id) === Number(ignoreAppointmentId)) return false;
    const s = toMinutes(b.time);
    return s !== null && overlaps(minutes, minutes + length, s, s + length);
  });
  if (clash) throw new SlotError(409, "Slot no longer available");
}

/** True for the unique-index violation that protects the same rule at the database level. */
const isSlotConflict = (err) => !!err && (err.name === "SequelizeUniqueConstraintError" || err.original?.code === "23505" || err.parent?.code === "23505") &&
  /uq_appointments_active_slot/.test(String(err.original?.constraint || err.parent?.constraint || err.message || ""));

module.exports = { getAvailableSlots, assertSlotBookable, checkWindowRules, isSlotConflict, SlotError, toMinutes };
