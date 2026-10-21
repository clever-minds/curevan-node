// Therapy Admin Controller (P22)
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const qualityService = require("../../services/qualityService");
const progressService = require("../../services/progressService");
const notificationStore = require("../../services/notificationStore");
const notifications = require("../../services/notifications");
const rules = require("../../config/businessRules");
const slotService = require("../../services/slotService");
const emergencyService = require("../../services/emergencyService");

// Helper: Haversine distance in km
function haversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

// 1. Dashboard summary counts
exports.getDashboardOverview = async (req, res) => {
  try {
    // Overdue followups count
    const [[overdueRow]] = await sequelize.query(
      `SELECT COUNT(*)::int as count FROM treatment_plans WHERE status = 'active' AND follow_up_overdue = true`
    );

    // Quality queue count (coaching, under_review, frozen)
    const [[qualityRow]] = await sequelize.query(
      `SELECT COUNT(*)::int as count FROM therapist_profiles WHERE profile_status = 'approved' AND quality_status IN ('coaching', 'under_review', 'frozen')`
    );

    // Credential counts
    const [[credExpiringRow]] = await sequelize.query(
      `SELECT COUNT(*)::int as count FROM therapist_profiles
       WHERE profile_status = 'approved' AND registration_valid_until > CURRENT_DATE AND registration_valid_until <= CURRENT_DATE + INTERVAL '30 days'`
    );
    const [[credExpiredRow]] = await sequelize.query(
      `SELECT COUNT(*)::int as count FROM therapist_profiles
       WHERE profile_status = 'approved' AND registration_valid_until < CURRENT_DATE`
    );

    // Emergency leaves overlapping active bookings for today or tomorrow
    const reassignRow = { count: (await emergencyService.listImpacted()).length };

    res.json({
      success: true,
      data: {
        overdueFollowUpsCount: overdueRow?.count || 0,
        qualityQueueCount: qualityRow?.count || 0,
        credentialExpiringCount: credExpiringRow?.count || 0,
        credentialExpiredCount: credExpiredRow?.count || 0,
        emergencyReassignCount: reassignRow?.count || 0,
        qualityQueue: qualityRow?.count || 0,
        credentialQueue: (credExpiringRow?.count || 0) + (credExpiredRow?.count || 0),
        emergencyReassignment: reassignRow?.count || 0,
        overdueFollowups: overdueRow?.count || 0,
      }
    });
  } catch (err) {
    console.error("getDashboardOverview error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 2. Emergency reassignment queue & candidate matching
exports.getEmergencyReassignQueue = async (req, res) => {
  try {
    const out = [];
    for (const appt of await emergencyService.listImpacted()) {
      out.push({
        booking: {
          id: appt.id, patientId: appt.patient_id, patientName: appt.patient_name, patientPhone: appt.patient_phone,
          currentTherapistId: appt.therapist_id, currentTherapistName: appt.therapist_name, serviceType: appt.therapy_type,
          date: appt.date, time: appt.time, address: appt.full_address || `${appt.city || ""}, ${appt.state || ""}`, leaveReason: appt.leave_reason,
        },
        candidates: await emergencyService.candidatesFor(appt),
      });
    }
    res.json({ success: true, data: out });
  } catch (err) {
    console.error("getEmergencyReassignQueue error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 3. Reassign booking (one click): same checks as the candidate list, status history + audit log, patient and both therapists told
exports.reassignBooking = async (req, res) => {
  const { bookingId, newTherapistId, reason } = req.body;
  if (!bookingId || !newTherapistId) {
    return res.status(400).json({ success: false, error: "bookingId and newTherapistId are required" });
  }

  const t = await sequelize.transaction();
  try {
    const [appt] = await sequelize.query(`SELECT * FROM appointments WHERE id = :id FOR UPDATE`, { replacements: { id: bookingId }, type: QueryTypes.SELECT, transaction: t });
    if (!appt) { await t.rollback(); return res.status(404).json({ success: false, error: "Booking not found" }); }
    if (!emergencyService.ACTIVE_FOR_REASSIGN.includes(appt.status)) { await t.rollback(); return res.status(409).json({ success: false, error: `A booking that is ${appt.status} cannot be reassigned` }); }
    if (Number(appt.therapist_id) === Number(newTherapistId)) { await t.rollback(); return res.status(400).json({ success: false, error: "The booking already belongs to this therapist" }); }

    const [newTherapist] = await sequelize.query(
      `SELECT u.id, u.name, u.phone, tp.id AS profile_id, tp.specialty
       FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id
       WHERE u.id = :id AND tp.profile_status = 'approved'`,
      { replacements: { id: newTherapistId }, type: QueryTypes.SELECT, transaction: t }
    );
    if (!newTherapist) { await t.rollback(); return res.status(400).json({ success: false, error: "Target therapist is not approved" }); }
    if (appt.service_type_id && !(newTherapist.specialty || []).map(Number).includes(Number(appt.service_type_id))) {
      await t.rollback();
      return res.status(400).json({ success: false, error: "Target therapist does not offer this service" });
    }
    const dateText = emergencyService.ymdText(appt.date);
    try {
      // frozen, expired registration, working hours, leave and clashes: the same rules as a new booking
      await slotService.assertSlotBookable(newTherapist.id, dateText, appt.time, { transaction: t, skipLead: true, ignoreAppointmentId: appt.id });
    } catch (err) {
      await t.rollback();
      if (err instanceof slotService.SlotError) return res.status(err.httpStatus || 400).json({ success: false, error: err.message });
      throw err;
    }

    const oldTherapistId = appt.therapist_id;
    const oldTherapistName = appt.therapist_name;
    await sequelize.query(
      `UPDATE appointments SET therapist_id = :newId, therapist_name = :newName, therapist_phone = :newPhone WHERE id = :id`,
      { replacements: { newId: newTherapist.id, newName: newTherapist.name, newPhone: newTherapist.phone, id: bookingId }, type: QueryTypes.UPDATE, transaction: t }
    );
    const note = `Reassigned from ${oldTherapistName || "therapist #" + oldTherapistId} to ${newTherapist.name}. ${reason || "Therapist on leave"}`.slice(0, 500);
    await sequelize.query(
      `INSERT INTO appointment_status_history (appointment_id, from_status, to_status, actor_id, note) VALUES (:id, :status, :status, :actor, :note)`,
      { replacements: { id: bookingId, status: appt.status, actor: req.user.id, note }, type: QueryTypes.INSERT, transaction: t }
    );
    await sequelize.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (:actor, 'reassign_booking', 'appointment', :id, :details)`,
      { replacements: { actor: String(req.user.id), id: String(bookingId), details: JSON.stringify({ from: oldTherapistId, to: newTherapist.id, reason: reason || "Therapist on leave" }) }, type: QueryTypes.INSERT, transaction: t }
    );
    await t.commit();

    // patient (WhatsApp + in-app), new and old therapist (push + in-app), therapy admin (in-app)
    await notifications.notify("booking_reassigned", {
      patientId: appt.patient_id, therapistId: newTherapist.id, oldTherapistId, newTherapistName: newTherapist.name,
      date: dateText, time: appt.time, link: "https://curevan.com/dashboard/bookings",
    }).catch((e) => console.error("booking_reassigned notify failed:", e.message));

    res.json({ success: true, message: `Booking #${bookingId} reassigned to ${newTherapist.name}`, data: { bookingId, therapistId: newTherapist.id, therapistName: newTherapist.name } });
  } catch (err) {
    await t.rollback().catch(() => {});
    if (slotService.isSlotConflict(err)) return res.status(409).json({ success: false, error: "Slot no longer available" });
    console.error("reassignBooking error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 4. Quality queue list & actions
exports.getQualityQueue = async (req, res) => {
  try {
    const minRatings = rules.quality.minRatings;
    const coachingBelow = rules.quality.coachingBelow;
    const reviewBelow = rules.quality.reviewBelow;

    const therapists = await sequelize.query(
      `SELECT u.id as user_id, u.name, u.email, u.phone, u.city,
              tp.id as profile_id, tp.quality_status, tp.quality_note, tp.registration_valid_until, tp.specialty, tp.qualification,
              (SELECT COALESCE(AVG(r.rating), 0)::numeric(3,2) FROM (SELECT rating FROM therapist_reviews WHERE therapist_id = u.id AND rating IS NOT NULL ORDER BY created_at DESC LIMIT :win) r) AS avg_rating,
              (SELECT COUNT(*)::int FROM (SELECT rating FROM therapist_reviews WHERE therapist_id = u.id AND rating IS NOT NULL ORDER BY created_at DESC LIMIT :win) r) AS total_ratings
       FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id
       WHERE u.role = 'therapist' AND tp.profile_status = 'approved' AND COALESCE(tp.quality_status, 'ok') <> 'ok'
       ORDER BY tp.quality_status = 'frozen' DESC, tp.quality_status = 'under_review' DESC, tp.quality_status = 'coaching' DESC, avg_rating ASC`,
      { replacements: { win: rules.quality.windowRatings }, type: QueryTypes.SELECT }
    );

    const enriched = [];
    for (const t of therapists) {
      // Recent quality actions
      const actions = await sequelize.query(
        `SELECT id, action, note, created_at, actor_id FROM therapist_quality_actions
         WHERE therapist_id = :pid ORDER BY created_at DESC LIMIT 5`,
        { replacements: { pid: t.profile_id }, type: QueryTypes.SELECT }
      );

      enriched.push({
        id: t.user_id,
        user_id: t.user_id,
        therapistId: t.user_id,
        profileId: t.profile_id,
        name: t.name,
        email: t.email,
        phone: t.phone,
        city: t.city,
        qualityStatus: t.quality_status || 'ok',
        qualityNote: t.quality_note,
        avgRating: parseFloat(t.avg_rating || 0),
        totalRatings: t.total_ratings,
        minRatings,
        coachingBelow,
        reviewBelow,
        recentActions: actions,
      });
    }

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error("getQualityQueue error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.recordQualityAction = async (req, res) => {
  try {
    const { therapistId, action, note } = req.body;
    if (!therapistId || !action) {
      return res.status(400).json({ success: false, error: "therapistId and action are required" });
    }
    const result = await qualityService.recordQualityAction({
      therapistId,
      action,
      note,
      actorId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("recordQualityAction error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 5. Credential queue list
exports.getCredentialQueue = async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT * FROM (
         SELECT u.id as user_id, u.name, u.email, u.phone, u.city,
                tp.id as profile_id, tp.council, tp.registration_no, tp.registration_valid_until,
                tp.registration_doc_id, tp.qualification,
                CASE
                  WHEN tp.registration_valid_until IS NULL THEN 'missing'
                  WHEN tp.registration_valid_until < CURRENT_DATE THEN 'expired'
                  WHEN tp.registration_valid_until <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
                  ELSE 'valid'
                END as credential_status,
                CASE
                  WHEN tp.registration_valid_until IS NOT NULL
                  THEN (tp.registration_valid_until - CURRENT_DATE)::int
                  ELSE NULL
                END as days_remaining
         FROM users u
         JOIN therapist_profiles tp ON tp.user_id = u.id
         WHERE u.role = 'therapist' AND tp.profile_status = 'approved'
       ) sub
       ORDER BY credential_status = 'expired' DESC, credential_status = 'expiring_soon' DESC, days_remaining ASC`,
      { type: QueryTypes.SELECT }
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("getCredentialQueue error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 6. Overdue followups list & actions
exports.getOverdueFollowUps = async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT tp.id as "planId", tp.patient_id as "patientId", u.name as "patientName", u.phone as "patientPhone",
              tp.primary_therapist_id as "therapistId", tu.name as "therapistName",
              tp.condition as "condition", tp.frequency_per_week as "frequencyPerWeek",
              MAX(a.date) as "lastSessionDate",
              (CURRENT_DATE - MAX(a.date))::int as "daysOverdue"
       FROM treatment_plans tp
       JOIN users u ON u.id = tp.patient_id
       LEFT JOIN users tu ON tu.id = tp.primary_therapist_id
       LEFT JOIN appointments a ON a.treatment_plan_id = tp.id AND a.status = 'completed'
       WHERE tp.status = 'active' AND tp.follow_up_overdue = true
       GROUP BY tp.id, tp.patient_id, u.name, u.phone, tp.primary_therapist_id, tu.name, tp.condition, tp.frequency_per_week
       ORDER BY "daysOverdue" DESC NULLS LAST`,
      { type: QueryTypes.SELECT }
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("getOverdueFollowUps error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.closeTreatmentPlan = async (req, res) => {
  try {
    const { planId, reason } = req.body;
    if (!planId) return res.status(400).json({ success: false, error: "planId is required" });

    await sequelize.query(
      `UPDATE treatment_plans SET status = 'discharged', discharge_notes = :reason, updated_at = NOW() WHERE id = :planId`,
      { replacements: { planId, reason: reason || 'Closed by Therapy Admin' }, type: QueryTypes.UPDATE }
    );

    res.json({ success: true, message: `Plan #${planId} discharged` });
  } catch (err) {
    console.error("closeTreatmentPlan error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 7. Stalled progress list & actions
exports.getStalledProgressQueue = async (req, res) => {
  try {
    const plans = await sequelize.query(
      `SELECT tp.*, u.name as patient_name, u.phone as patient_phone,
              tu.name as therapist_name, tu.phone as therapist_phone
       FROM treatment_plans tp
       JOIN users u ON u.id = tp.patient_id
       LEFT JOIN users tu ON tu.id = tp.primary_therapist_id
       WHERE tp.status = 'active'
       ORDER BY tp.updated_at DESC`,
      { type: QueryTypes.SELECT }
    );

    const stalled = [];
    for (const plan of plans) {
      const prog = await progressService.planProgress(plan.id).catch(() => null);
      if (prog && prog.stalled) {
        const primaryGoal = prog.goals && prog.goals[0];
        stalled.push({
          planId: plan.id,
          patientId: plan.patient_id,
          patientName: plan.patient_name,
          patientPhone: plan.patient_phone,
          therapistId: plan.primary_therapist_id,
          therapistName: plan.therapist_name,
          condition: plan.condition_name || plan.diagnosis || "General Rehab",
          sessionsDone: prog.sessionsDone,
          plannedSessions: plan.planned_sessions,
          lastReviewDate: plan.last_review_date,
          primaryGoalDescription: primaryGoal?.description || null,
          measureName: primaryGoal?.measureName || primaryGoal?.measureCode || null,
          baseline: primaryGoal?.baseline ?? null,
          latest: primaryGoal?.latest ?? null,
          target: primaryGoal?.target ?? null,
        });
      }
    }

    res.json({ success: true, data: stalled });
  } catch (err) {
    console.error("getStalledProgressQueue error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 8. Outcome Summary (last 90 days real data)
exports.getOutcomeSummary = async (req, res) => {
  try {
    // Discharged plans in last 90 days
    const dischargedPlans = await sequelize.query(
      `SELECT tp.id, tp.patient_id, tp.condition, tp.updated_at
       FROM treatment_plans tp
       WHERE tp.status = 'discharged' AND tp.updated_at >= CURRENT_DATE - INTERVAL '90 days'`,
      { type: QueryTypes.SELECT }
    );
    const dischargedCount = dischargedPlans.length;

    // Goals achieved / partially achieved on discharged plans
    const planIds = dischargedPlans.map(p => p.id);
    let goalsTotal = 0;
    let goalsAchieved = 0;
    let goalsPartiallyAchieved = 0;
    if (planIds.length > 0) {
      const goals = await sequelize.query(
        `SELECT status, COUNT(*)::int as count FROM treatment_goals
         WHERE plan_id IN (:planIds) GROUP BY status`,
        { replacements: { planIds }, type: QueryTypes.SELECT }
      );
      for (const g of goals) {
        const cnt = parseInt(g.count || 0, 10);
        goalsTotal += cnt;
        if (g.status === 'achieved') goalsAchieved += cnt;
        if (g.status === 'partially_achieved') goalsPartiallyAchieved += cnt;
      }
    }
    const percentAchieved = goalsTotal > 0 ? Math.round((goalsAchieved / goalsTotal) * 100) : 0;
    const percentPartiallyAchieved = goalsTotal > 0 ? Math.round((goalsPartiallyAchieved / goalsTotal) * 100) : 0;

    // Median sessions to discharge
    let medianSessions = 0;
    if (planIds.length > 0) {
      const sessionCounts = await sequelize.query(
        `SELECT COUNT(*)::int as sessions FROM appointments
         WHERE treatment_plan_id IN (:planIds) AND status = 'completed'
         GROUP BY treatment_plan_id ORDER BY sessions ASC`,
        { replacements: { planIds }, type: QueryTypes.SELECT }
      );
      if (sessionCounts.length > 0) {
        const mid = Math.floor(sessionCounts.length / 2);
        medianSessions = sessionCounts.length % 2 !== 0
          ? sessionCounts[mid].sessions
          : Math.round((sessionCounts[mid - 1].sessions + sessionCounts[mid].sessions) / 2);
      }
    }

    // Average change per measure grouped by condition (min 5 plans per group, hide if < 5)
    let conditionGroups = [];
    if (planIds.length > 0) {
      // one baseline and one latest (review or discharge) value per plan, measure, side and item: a plan counts once however many reviews it had
      const measureChanges = await sequelize.query(
        `WITH base AS (
           SELECT DISTINCT ON (plan_id, measure_id, side, item) plan_id, measure_id, side, item, value
           FROM outcome_results WHERE assessment_point = 'baseline' AND value IS NOT NULL AND plan_id IN (:planIds)
           ORDER BY plan_id, measure_id, side, item, recorded_at, id
         ), latest AS (
           SELECT DISTINCT ON (plan_id, measure_id, side, item) plan_id, measure_id, side, item, value
           FROM outcome_results WHERE assessment_point IN ('review', 'discharge') AND value IS NOT NULL AND plan_id IN (:planIds)
           ORDER BY plan_id, measure_id, side, item, recorded_at DESC, id DESC
         )
         SELECT COALESCE(tp.condition, 'General Rehab') AS condition,
                m.code AS measure_code, m.name AS measure_name, m.unit, m.higher_is_better,
                COUNT(DISTINCT tp.id)::int AS plan_count,
                AVG(CASE WHEN m.higher_is_better THEN l.value - b.value ELSE b.value - l.value END)::numeric(8,2) AS avg_change
         FROM treatment_plans tp
         JOIN base b ON b.plan_id = tp.id
         JOIN latest l ON l.plan_id = b.plan_id AND l.measure_id = b.measure_id AND l.side IS NOT DISTINCT FROM b.side AND l.item IS NOT DISTINCT FROM b.item
         JOIN outcome_measures m ON m.id = b.measure_id
         GROUP BY condition, m.code, m.name, m.unit, m.higher_is_better
         HAVING COUNT(DISTINCT tp.id) >= :minPlans
         ORDER BY plan_count DESC, condition ASC`,
        { replacements: { planIds, minPlans: rules.outcomeSummary.minPlansPerGroup }, type: QueryTypes.SELECT }
      );
      conditionGroups = measureChanges.map(row => ({
        condition: row.condition,
        measureCode: row.measure_code,
        measureName: row.measure_name,
        unit: row.unit,
        planCount: row.plan_count,
        avgChange: parseFloat(row.avg_change || 0)
      }));
    }

    res.json({
      success: true,
      data: {
        dischargedPlansCount: dischargedCount,
        totalDischarged: dischargedCount,
        goalsTotal,
        goalsAchieved,
        goalsPartiallyAchieved,
        percentGoalsAchieved: percentAchieved,
        percentGoalsPartiallyAchieved: percentPartiallyAchieved,
        medianSessionsToDischarge: medianSessions,
        conditionMeasures: conditionGroups,
        byCondition: conditionGroups,
      }
    });
  } catch (err) {
    console.error("getOutcomeSummary error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
