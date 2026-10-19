// Emergency reassignment (handoff pack P22): bookings hit by a therapist's leave today or tomorrow, who can take them over, and the
// automatic 100% refund cancellation when nobody was found 2 hours before the slot.
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const rules = require("../config/businessRules");
const access = require("../utils/access");
const stateMachine = require("./appointmentStateMachine");
const slotService = require("./slotService");
const cancellationService = require("./cancellationService");
const refundService = require("./refundService");
const payoutService = require("./payoutService");
const notifications = require("./notifications");

const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const pad = (n) => String(n).padStart(2, "0");
const IST_MS = 5.5 * 3600 * 1000;
const ymdOf = (ms) => { const d = new Date(ms + IST_MS); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const minutes = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const ymdText = (d) => (d instanceof Date ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : String(d).slice(0, 10));
const ACTIVE_FOR_REASSIGN = ["confirmed", "accepted_unpaid", "searching_therapist"];

function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) return null;
  const rad = (x) => (Number(x) * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

/** Active bookings of the next `lookAheadDays` (IST) whose therapist has an approved leave that covers the slot (whole day, or the leave's hours). */
async function listImpacted(now = Date.now()) {
  const today = ymdOf(now), last = ymdOf(now + rules.emergency.lookAheadDays * 86400000);
  const rows = await q(
    `SELECT a.id, a.patient_id, a.patient_name, a.patient_phone, a.therapist_id, a.therapist_name, a.service_type_id, a.therapy_type, to_char(a.date, 'YYYY-MM-DD') AS date, a.time, a.start_time,
            a.status, a.payment_status, a.total_amount, a.service_amount, a.created_at, a.service_address_id, a.care_pack_id,
            oa.full_address, oa.city, oa.state,
            tl.reason AS leave_reason, tl.start_time AS leave_start_time, tl.end_time AS leave_end_time
     FROM appointments a
     JOIN therapist_profiles tp ON tp.user_id = a.therapist_id
     JOIN therapist_leaves tl ON tl.therapist_id = tp.id AND a.date >= tl.start_date AND a.date <= tl.end_date AND COALESCE(tl.status, 'approved') = 'approved'
     LEFT JOIN order_addresses oa ON oa.id = a.service_address_id
     WHERE a.status IN (:active) AND a.date >= :today::date AND a.date <= :last::date
     ORDER BY a.date, a.time, a.id`,
    { active: ACTIVE_FOR_REASSIGN, today, last }
  );
  const length = rules.session.slotMinutes;
  const seen = new Set();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    const from = minutes(r.leave_start_time), to = minutes(r.leave_end_time), at = minutes(r.time);
    const covered = from === null || to === null || at === null || (at < to && at + length > from);   // a leave with hours only blocks those hours
    if (covered) seen.add(r.id);
    return covered;
  });
}

/** Who could take this booking: approved, quality ok, registration valid, same service type, free at that slot (slotService), within the radius, best first. */
async function candidatesFor(appt, { now = Date.now() } = {}) {
  const [patient] = await q(
    `SELECT COALESCE(u.latitude, oa_u.latitude) AS lat, COALESCE(u.longitude, oa_u.longitude) AS lng
     FROM users u LEFT JOIN order_addresses oa ON oa.id = :addr LEFT JOIN users oa_u ON oa_u.id = oa.user_id WHERE u.id = :pid`,
    { addr: appt.service_address_id || null, pid: appt.patient_id }
  );
  const rows = await q(
    `SELECT u.id AS user_id, tp.id AS profile_id, u.name, u.phone, u.city, u.latitude, u.longitude,
            (SELECT COALESCE(AVG(r.rating), 0)::numeric(3,2) FROM (SELECT rating FROM therapist_reviews WHERE therapist_id = u.id AND rating IS NOT NULL ORDER BY created_at DESC LIMIT :win) r) AS avg_rating,
            (SELECT COUNT(*)::int FROM therapist_reviews WHERE therapist_id = u.id AND rating IS NOT NULL) AS rating_count
     FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id
     WHERE u.role = 'therapist' AND tp.profile_status = 'approved' AND u.id <> :current
       AND COALESCE(tp.quality_status, 'ok') = 'ok'
       AND (:svc::int IS NULL OR :svc::int = ANY(tp.specialty))`,
    { current: appt.therapist_id, svc: appt.service_type_id || null, win: rules.quality.windowRatings }
  );
  const out = [];
  for (const c of rows) {
    try { await slotService.assertSlotBookable(c.user_id, ymdText(appt.date), appt.time, { skipLead: true, ignoreAppointmentId: appt.id, now }); }
    catch (err) { if (err instanceof slotService.SlotError) continue; throw err; }       // frozen / expired registration / off hours / on leave / clash
    const distanceKm = patient ? haversineKm(patient.lat, patient.lng, c.latitude, c.longitude) : null;
    if (distanceKm !== null ? distanceKm > rules.emergency.radiusKm : (appt.city && c.city && String(c.city).toLowerCase() !== String(appt.city).toLowerCase())) continue;
    out.push({ therapistId: c.user_id, profileId: c.profile_id, name: c.name, phone: c.phone, city: c.city, distanceKm, avgRating: Number(c.avg_rating), ratingCount: c.rating_count });
  }
  return out.sort((a, b) => (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm ? a.distanceKm - b.distanceKm : b.avgRating - a.avgRating));
}

/** Bookings still on a therapist who is on leave, with the slot starting within `autoCancelHoursBefore`: cancelled by admin, the patient gets 100% back. */
async function autoCancelUnassigned(now = Date.now()) {
  const result = { cancelled: 0, failed: 0 };
  const admin = { id: null, role: "admin", roles: ["admin.therapy"] };
  for (const appt of await listImpacted(now)) {
    const start = access.slotStart(appt);
    if (!start || start.getTime() - now > rules.emergency.autoCancelHoursBefore * 3600000 || start.getTime() < now - 3600000) continue;
    const quote = cancellationService.quote(appt, "admin", now);
    try {
      if (quote.refundInr > 0 && !appt.care_pack_id) await refundService.refund({ appointmentId: appt.id, amountInr: quote.refundInr, reason: "No replacement therapist found after the therapist's leave", actorId: null });
    } catch (err) {
      if (err instanceof refundService.RefundError) { result.failed += 1; console.error(`auto-cancel #${appt.id}: refund failed: ${err.message}`); continue; }     // left for support
      throw err;
    }
    const t = await sequelize.transaction();
    try {
      await stateMachine.transition(appt.id, stateMachine.STATUS.CANCELLED_ADMIN, admin, { transaction: t, note: "Therapist on leave and no replacement found 2 hours before the slot" });
      await cancellationService.recordOutcome(appt, quote, { actorId: null, reason: "Therapist on leave, no replacement", transaction: t });
      if (appt.care_pack_id) await require("./carePackService").returnSession(appt.care_pack_id, t);
      await t.commit();
    } catch (err) {
      await t.rollback();
      if (err instanceof stateMachine.TransitionError) { result.failed += 1; continue; }
      throw err;
    }
    await notifications.notify("booking_cancelled", {
      appointmentId: appt.id, patientId: appt.patient_id, therapistId: appt.therapist_id, date: appt.date, time: appt.time,
      reason: "your therapist is unavailable and no replacement was found", cancelledBy: "admin", refundInr: quote.refundInr, link: "https://curevan.com/dashboard/bookings",
    }).catch((e) => console.error("auto-cancel notify failed:", e.message));
    result.cancelled += 1;
  }
  return result;
}

module.exports = { listImpacted, candidatesFor, autoCancelUnassigned, ymdText, ACTIVE_FOR_REASSIGN };
