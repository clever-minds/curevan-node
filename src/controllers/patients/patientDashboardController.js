// Patient home screen summary (handoff pack P21). One call, own data only; the numbers come from the same services the other screens use.
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const access = require("../../utils/access");
const rules = require("../../config/businessRules");
const { planProgress } = require("../../services/progressService");

const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const SHOWN_BOOKING = ["pending_payment", "searching_therapist", "accepted_unpaid", "confirmed", "therapist_on_the_way", "arrived", "in_progress", "pcr_pending"];
const MAX_CHARTS = 3;

// GET /api/patients/me/dashboard
exports.getDashboard = async (req, res) => {
  try {
    if (req.user.role !== "patient") return res.status(403).json({ success: false, error: "Forbidden" });
    const me = req.user.id;

    // next live booking (a proposal is shown as a proposal, not as a booking)
    const [b] = await q(
      `SELECT a.id, to_char(a.date, 'YYYY-MM-DD') AS date, a.time, a.start_time, a.status, a.payment_status AS "paymentStatus", a.mode, a.therapy_type AS "therapyType",
              a.therapist_id AS "therapistId", COALESCE(u.name, a.therapist_name) AS "therapistName", tp.qualification, m.file_path AS "therapistPhoto"
       FROM appointments a LEFT JOIN users u ON u.id = a.therapist_id LEFT JOIN therapist_profiles tp ON tp.user_id = a.therapist_id LEFT JOIN media m ON m.id = tp.profile_image
       WHERE a.patient_id = :me AND a.status IN (:shown) AND a.date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 1
       ORDER BY (a.status IN ('in_progress', 'arrived', 'therapist_on_the_way', 'pcr_pending')) DESC, a.date, a.time LIMIT 1`,
      { me, shown: SHOWN_BOOKING }
    );
    let activeBooking = null;
    if (b) {
      const start = access.slotStart(b);
      const now = Date.now();
      const inWindow = !start || (now >= start.getTime() - rules.otp.validFromHoursBefore * 3600000 && now <= start.getTime() + rules.session.slotMinutes * 60000);
      const { start_time, ...rest } = b;
      activeBooking = { ...rest, otpAvailable: ["confirmed", "therapist_on_the_way", "arrived"].includes(b.status) && inWindow };
    }

    const proposals = await q(
      `SELECT fp.id, fp.status, fp.hold_expires_at AS "holdExpiresAt", to_char(a.date, 'YYYY-MM-DD') AS date, a.time, a.therapist_name AS "therapistName"
       FROM followup_proposals fp JOIN appointments a ON a.id = fp.appointment_id
       WHERE fp.patient_id = :me AND fp.status IN ('proposed', 'changed') AND a.status = 'proposed' ORDER BY a.date, a.time`, { me }
    );

    // recovery: the active plan (else the latest one)
    const [planRow] = await q(`SELECT id, follow_up_overdue FROM treatment_plans WHERE patient_id = :me ORDER BY (status = 'active') DESC, id DESC LIMIT 1`, { me });
    let recovery = null;
    if (planRow) {
      const p = await planProgress(planRow.id);
      const review = Number(p.plan.review_every_sessions) || null;
      const withData = p.measures.map((m, i) => ({ m, i, goal: p.goals.some((g) => g.measureCode === m.code) })).filter((x) => x.m.series.length > 0);
      withData.sort((a, c) => Number(c.goal) - Number(a.goal) || c.m.series.length - a.m.series.length || a.i - c.i);
      recovery = {
        planId: p.plan.id, condition: p.plan.condition, status: p.plan.status, sessionsDone: p.sessionsDone, plannedSessions: p.plannedSessions, adherence: p.adherence,
        sessionsToNextReview: review ? review - (p.sessionsDone % review) : null,
        followUpOverdue: p.plan.status === "active" && !!planRow.follow_up_overdue,
        goals: p.goals, measures: withData.slice(0, MAX_CHARTS).map((x) => x.m),
      };
    }
    const quickScores = await q(
      `SELECT to_char(a.date, 'YYYY-MM-DD') AS date, p.functional_score AS "functionalScore", p.pain_vas AS "painVas"
       FROM pcr p JOIN appointments a ON a.id = p.appointment_id WHERE a.patient_id = :me AND LOWER(p.status) IN ('submitted', 'locked') ORDER BY a.date, a.id`, { me }
    );

    // last 3 health records and reports
    const pcrs = await q(
      `SELECT a.id AS "appointmentId", to_char(a.date, 'YYYY-MM-DD') AS date, COALESCE(a.therapist_name, p.therapist_name) AS "therapistName", a.therapy_type AS "therapyType"
       FROM pcr p JOIN appointments a ON a.id = p.appointment_id WHERE a.patient_id = :me AND LOWER(p.status) = 'locked' ORDER BY a.date DESC, a.id DESC LIMIT 3`, { me }
    );
    const reports = await q(
      `SELECT r.id, r.report_type AS "reportType", r.created_at AS "createdAt" FROM progress_reports r JOIN treatment_plans t ON t.id = r.plan_id
       WHERE t.patient_id = :me AND r.shared_with_patient_at IS NOT NULL ORDER BY r.id DESC LIMIT 3`, { me }
    );

    const orders = await q(
      `SELECT o.id, o.order_number AS number, o.total, o.status, o.created_at AS "createdAt", o.delivered_at AS "deliveredAt",
              (SELECT s.awb FROM shipments s WHERE s.order_id = o.id ORDER BY s.id DESC LIMIT 1) AS awb
       FROM orders o WHERE o.user_id = :me AND LOWER(COALESCE(o.status, '')) <> 'pending_payment' ORDER BY o.id DESC LIMIT 3`, { me }
    );

    const [last] = await q(
      `SELECT a.therapist_id AS "therapistId", COALESCE(u.name, a.therapist_name) AS name FROM appointments a LEFT JOIN users u ON u.id = a.therapist_id
       WHERE a.patient_id = :me AND a.status IN ('completed', 'pcr_pending') AND a.therapist_id IS NOT NULL ORDER BY a.date DESC, a.id DESC LIMIT 1`, { me }
    );
    const [{ n: bookingsEver }] = await q(`SELECT COUNT(*)::int AS n FROM appointments WHERE patient_id = :me AND status NOT IN ('cancelled_unpaid', 'proposal_expired', 'proposal_declined')`, { me });

    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: { activeBooking, proposals, recovery, quickScores, records: { pcrs, reports }, orders, lastTherapist: last || null, isNew: bookingsEver === 0 } });
  } catch (err) {
    console.error("patient dashboard error:", err.message);
    return res.status(500).json({ success: false, error: "Could not load your dashboard" });
  }
};
