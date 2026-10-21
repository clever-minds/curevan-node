// Masked calls between the patient and the therapist of a booking (handoff pack P27). Neither real number ever leaves the server.
const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const rules = require("../../config/businessRules");
const access = require("../../utils/access");
const telephony = require("../../services/telephony");

const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const fail = (res, status, message) => res.status(status).json({ success: false, error: message, message });
const CALLABLE = ["confirmed", "therapist_on_the_way", "arrived", "in_progress"];

const windowMessage = () => `Calling opens ${rules.maskedCall.windowHoursBefore} hours before your appointment`;

/** The phone number in the form the provider needs: digits with the country code 91 for a 10-digit Indian number. */
const dialable = (raw) => {
  const d = String(raw || "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  return d.length >= 11 ? `+${d}` : null;
};

// POST /api/communication/mask-call { appointmentId }
exports.maskCall = async (req, res) => {
  try {
    const appointmentId = Number((req.body || {}).appointmentId);
    if (!Number.isInteger(appointmentId) || appointmentId <= 0) return fail(res, 400, "appointmentId is required");
    if (!telephony.isLive()) return fail(res, 503, "Calling is not available right now");

    const [appt] = await q(
      `SELECT id, patient_id, therapist_id, status, date, time, start_time FROM appointments WHERE id = :id`, { id: appointmentId }
    );
    if (!appt) return fail(res, 404, "Appointment not found");

    // only the two people of this booking, and only the booking's own other party
    let role = null;
    if (access.same(appt.patient_id, req.user.id)) role = "patient";
    else if (access.same(appt.therapist_id, req.user.id)) role = "therapist";
    if (!role) return fail(res, 403, "Forbidden");
    if (!CALLABLE.includes(appt.status)) return fail(res, 403, "Calling is available only for a confirmed booking");
    if (!access.withinAddressWindow(appt)) return fail(res, 403, windowMessage());

    const [numbers] = await q(
      `SELECT (SELECT phone FROM users WHERE id = :patient) AS patient_phone, (SELECT phone FROM users WHERE id = :therapist) AS therapist_phone`,
      { patient: appt.patient_id, therapist: appt.therapist_id }
    );
    const from = dialable(role === "patient" ? numbers.patient_phone : numbers.therapist_phone);
    const to = dialable(role === "patient" ? numbers.therapist_phone : numbers.patient_phone);
    if (!from) return fail(res, 409, "Please add your mobile number to your profile to use calling");
    if (!to) return fail(res, 409, "The other person has no number on file. Please contact support");

    const [call] = await q(
      `INSERT INTO masked_calls (appointment_id, caller_role, caller_user_id, status) VALUES (:appt, :role, :me, 'initiated') RETURNING id`,
      { appt: appt.id, role, me: req.user.id }
    );
    try {
      const out = await telephony.connect({ from, to, callId: call.id });
      await q(`UPDATE masked_calls SET provider_call_sid = :sid, status = :status WHERE id = :id RETURNING id`, { sid: out.sid, status: telephony.normalizeStatus(out.status), id: call.id });
    } catch (err) {
      await q(`UPDATE masked_calls SET status = 'failed', ended_at = NOW() WHERE id = :id RETURNING id`, { id: call.id });
      console.error(`masked call #${call.id} failed:`, err.message);       // the message never holds a number
      return fail(res, 502, "We could not connect the call. Please try again in a moment.");
    }
    return res.status(201).json({ success: true, data: { callId: call.id, status: "initiated", message: "Your phone will ring in a moment. Answer it and we will connect you." } });
  } catch (err) {
    console.error("maskCall error:", err.message);
    return fail(res, 500, "Could not start the call");
  }
};

const safeEqual = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// POST /api/hooks/telephony?token=...  (the provider's status callback; form-encoded or JSON)
exports.statusWebhook = async (req, res) => {
  const token = process.env.TELEPHONY_WEBHOOK_TOKEN;
  if (!token || !safeEqual(req.query.token || req.get("x-webhook-token"), token)) return res.status(401).json({ ok: false });
  try {
    const b = req.body || {};
    const sid = b.CallSid || b.call_sid || b.sid;
    if (!sid) return res.status(200).json({ ok: true });                  // nothing to match; answer quickly so the provider does not retry
    const status = telephony.normalizeStatus(b.Status || b.CallStatus || b.status);
    const seconds = Number(b.Duration ?? b.ConversationDuration ?? b.duration);
    const final = ["completed", "busy", "no-answer", "failed", "canceled"].includes(status);
    await q(
      `UPDATE masked_calls SET status = :status,
              duration_seconds = COALESCE(:duration, duration_seconds),
              ended_at = CASE WHEN :final THEN COALESCE(ended_at, NOW()) ELSE ended_at END
       WHERE provider_call_sid = :sid RETURNING id`,
      { status, duration: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null, final, sid: String(sid) }
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("telephony webhook error:", err.message);
    return res.status(200).json({ ok: true });
  }
};
