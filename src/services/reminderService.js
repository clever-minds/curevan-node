// Reminders for sessions and home exercises (handoff pack P17). Safe to run as often as you like:
// reminder_log has a unique key (appointment, user, type), so each reminder goes out exactly once.
// Texts never contain a diagnosis or condition - only time, names and locality.
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const rules = require("../config/businessRules");
const access = require("../utils/access");
const notificationStore = require("./notificationStore");

const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const IST_MS = 5.5 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, "0");
const istParts = (ms) => { const d = new Date(ms + IST_MS); return { ymd: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, hour: d.getUTCHours() }; };
const hhmm = (time) => String(time || "").slice(0, 5);
const firstName = (name) => String(name || "your patient").trim().split(/\s+/)[0];

/** true only for the first caller for this (appointment, user, type) - the claim that makes a reminder exactly-once */
async function claim(appointmentId, userId, type) {
  const rows = await q(`INSERT INTO reminder_log (appointment_id, user_id, type) VALUES (:a, :u, :t) ON CONFLICT DO NOTHING RETURNING id`, { a: appointmentId, u: userId, t: type });
  return rows.length > 0;
}

async function sendTo(userId, appointmentId, type, payload) {
  if (!(await claim(appointmentId, userId, type))) return false;
  await notificationStore.notify(userId, { type: "reminder", ...payload, data: { reminder: type, appointmentId } });
  return true;
}

async function run(now = Date.now()) {
  const sent = { patient24h: 0, patient2h: 0, therapist60: 0, agenda: 0, hep: 0 };
  const sessions = await q(
    `SELECT a.id, a.patient_id, a.therapist_id, a.patient_name, a.therapist_name, a.date, a.time, oa.city, u.reminder_prefs
     FROM appointments a LEFT JOIN order_addresses oa ON oa.id = a.service_address_id LEFT JOIN users u ON u.id = a.patient_id
     WHERE a.status = 'confirmed' AND a.date >= (:from)::date - 1 AND a.date <= (:to)::date + 1`,
    { from: istParts(now).ymd, to: istParts(now + 2 * 86400000).ymd }
  );

  for (const s of sessions) {
    const start = access.slotStart(s);
    if (!start) continue;
    const untilMin = (start.getTime() - now) / 60000;
    const prefs = s.reminder_prefs || { r24h: true, r2h: true };

    for (const h of rules.reminders.patientHoursBefore) {
      const inWindow = untilMin <= h * 60 && untilMin > (h - 1) * 60;          // a late job still sends within the hour, never days late
      if (!inWindow || prefs[`r${h}h`] === false) continue;
      const when = h >= 24 ? "tomorrow" : `in ${h} hours`;
      const sentNow = await sendTo(s.patient_id, s.id, `reminder_${h}h`, {
        title: "Session reminder",
        message: `Your Curevan home session with ${s.therapist_name || "your therapist"} is ${when} at ${hhmm(s.time)}.${h <= 2 ? " Your start code will be visible in the app." : ""}`,
        link: "/dashboard/bookings",
      });
      if (sentNow) sent[h >= 24 ? "patient24h" : "patient2h"] += 1;
    }

    if (untilMin <= rules.reminders.therapistMinutesBefore && untilMin > 0 && s.therapist_id) {
      const sentNow = await sendTo(s.therapist_id, s.id, "therapist_60min", {
        title: "Session starting soon",
        message: `Your Curevan home session with ${firstName(s.patient_name)} starts at ${hhmm(s.time)}${s.city ? ` in ${s.city}` : ""}.`,
        link: "/dashboard/therapist/schedule",
      });
      if (sentNow) sent.therapist60 += 1;
    }
  }

  // therapist's agenda for today, from 07:00 IST (one per therapist per day, anchored on appointment 0)
  const { ymd, hour } = istParts(now);
  if (hour >= rules.reminders.therapistAgendaHour) {
    const today = await q(`SELECT a.therapist_id, a.patient_name, a.time FROM appointments a WHERE a.status = 'confirmed' AND a.date = :ymd::date AND a.therapist_id IS NOT NULL ORDER BY a.therapist_id, a.time`, { ymd });
    const byTherapist = new Map();
    for (const row of today) byTherapist.set(row.therapist_id, [...(byTherapist.get(row.therapist_id) || []), row]);
    for (const [therapistId, rows] of byTherapist) {
      const ok = await sendTo(therapistId, 0, `therapist_daily_agenda_${ymd}`, {
        title: "Your sessions today",
        message: rows.map((r) => `${hhmm(r.time)} ${firstName(r.patient_name)}`).join(", "),
        link: "/dashboard/therapist/schedule",
      });
      if (ok) sent.agenda += 1;
    }
  }

  // daily home-exercise reminder (opt-in) for patients with an active plan, from 18:00 IST
  if (hour >= rules.reminders.hepReminderHour) {
    const patients = await q(
      `SELECT DISTINCT u.id, (SELECT a.id FROM pcr p JOIN appointments a ON a.id = p.appointment_id WHERE a.patient_id = u.id AND p.hep IS NOT NULL AND p.hep <> '' ORDER BY a.date DESC, a.id DESC LIMIT 1) AS last_appt
       FROM users u JOIN treatment_plans tp ON tp.patient_id = u.id AND tp.status = 'active' WHERE (u.reminder_prefs ->> 'hep_daily') = 'true'`, {}
    );
    for (const pt of patients) {
      if (!pt.last_appt) continue;
      const ok = await sendTo(pt.id, 0, `hep_daily_${ymd}`, { title: "Time for your home exercises", message: "A few minutes of your exercises today keeps your recovery on track.", link: `/pcr/${pt.last_appt}` });
      if (ok) sent.hep += 1;
    }
  }
  return sent;
}

module.exports = { run };
