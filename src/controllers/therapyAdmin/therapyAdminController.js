// Therapy Admin Controller (P22)
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const qualityService = require("../../services/qualityService");
const progressService = require("../../services/progressService");
const notificationStore = require("../../services/notificationStore");
const notifications = require("../../services/notifications");
const rules = require("../../config/businessRules");

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
    const [[reassignRow]] = await sequelize.query(
      `SELECT COUNT(DISTINCT a.id)::int as count
       FROM appointments a
       JOIN therapist_profiles tp ON tp.user_id = a.therapist_id
       JOIN therapist_leaves tl ON (tl.therapist_id = tp.id OR tl.therapist_id = tp.user_id OR tl.therapist_id = a.therapist_id)
       WHERE a.status IN ('confirmed', 'accepted_unpaid', 'paid', 'searching_therapist')
         AND a.date IN (CURRENT_DATE, (CURRENT_DATE + INTERVAL '1 day')::date)
         AND a.date >= tl.start_date AND a.date <= tl.end_date`
    );

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
    // Find active appointments for today or tomorrow where therapist is on leave
    const impactedBookings = await sequelize.query(
      `SELECT DISTINCT a.id, a.patient_id, a.patient_name, a.patient_phone, a.therapist_id, a.therapist_name,
              a.service_type_id, a.therapy_type, a.date, a.time, a.mode, a.total_amount, a.status,
              oa.full_address, oa.city, oa.state, oa.pincode,
              COALESCE(u.latitude, oa_u.latitude) as patient_lat,
              COALESCE(u.longitude, oa_u.longitude) as patient_lng,
              tl.reason as leave_reason, tl.start_date as leave_start, tl.end_date as leave_end
       FROM appointments a
       JOIN therapist_profiles tp ON tp.user_id = a.therapist_id
       JOIN therapist_leaves tl ON (tl.therapist_id = tp.id OR tl.therapist_id = tp.user_id OR tl.therapist_id = a.therapist_id)
       LEFT JOIN users u ON u.id = a.patient_id
       LEFT JOIN order_addresses oa ON oa.id = a.service_address_id
       LEFT JOIN users oa_u ON oa_u.id = oa.user_id
       WHERE a.status IN ('confirmed', 'accepted_unpaid', 'paid', 'searching_therapist')
         AND a.date IN (CURRENT_DATE, (CURRENT_DATE + INTERVAL '1 day')::date)
         AND a.date >= tl.start_date AND a.date <= tl.end_date
       ORDER BY a.date ASC, a.time ASC`,
      { type: QueryTypes.SELECT }
    );

    const enriched = [];
    for (const appt of impactedBookings) {
      const apptDateStr = new Date(appt.date).toISOString().slice(0, 10);
      const patientLat = appt.patient_lat ? Number(appt.patient_lat) : null;
      const patientLng = appt.patient_lng ? Number(appt.patient_lng) : null;

      // Find candidates:
      // - approved therapist
      // - not the current therapist
      // - quality ok
      // - registration not expired
      // - same service type
      // - not on leave on appt date
      // - no clash at appt date and time
      const candidatesRaw = await sequelize.query(
        `SELECT u.id as user_id, u.name, u.phone, u.city, u.latitude, u.longitude,
                tp.id as profile_id, tp.hourly_rate, tp.quality_status, tp.registration_valid_until,
                COALESCE(AVG(tr.rating), 0)::numeric(3,1) as avg_rating,
                COUNT(tr.id)::int as rating_count
         FROM users u
         JOIN therapist_profiles tp ON tp.user_id = u.id
         LEFT JOIN therapist_reviews tr ON (tr.therapist_id = tp.id OR tr.therapist_id = u.id)
         WHERE u.role = 'therapist'
           AND tp.profile_status = 'approved'
           AND u.id != :currentTherapistId
           AND (tp.quality_status IS NULL OR tp.quality_status = 'ok')
           AND (tp.registration_valid_until IS NULL OR tp.registration_valid_until >= CURRENT_DATE)
           AND (:serviceTypeId::int = ANY(tp.specialty) OR tp.specialty IS NULL OR array_length(tp.specialty, 1) IS NULL)
           AND NOT EXISTS (
             SELECT 1 FROM therapist_leaves tl
             WHERE tl.therapist_id = tp.id AND :apptDate >= tl.start_date AND :apptDate <= tl.end_date
           )
           AND NOT EXISTS (
             SELECT 1 FROM appointments a2
             WHERE a2.therapist_id = u.id AND a2.date = :apptDate AND a2.time = :apptTime
               AND a2.status IN ('confirmed', 'in_progress', 'therapist_on_the_way', 'arrived', 'paid', 'accepted_unpaid')
           )
         GROUP BY u.id, u.name, u.phone, u.city, u.latitude, u.longitude, tp.id, tp.hourly_rate, tp.quality_status, tp.registration_valid_until`,
        {
          replacements: {
            currentTherapistId: appt.therapist_id,
            serviceTypeId: appt.service_type_id || 1,
            apptDate: apptDateStr,
            apptTime: appt.time,
          },
          type: QueryTypes.SELECT
        }
      );

      const candidates = candidatesRaw.map(c => {
        const cLat = c.latitude ? Number(c.latitude) : null;
        const cLng = c.longitude ? Number(c.longitude) : null;
        const dist = haversineDistance(patientLat, patientLng, cLat, cLng);
        return {
          therapistId: c.user_id,
          profileId: c.profile_id,
          name: c.name,
          phone: c.phone,
          city: c.city,
          distanceKm: dist,
          avgRating: parseFloat(c.avg_rating || 0),
          ratingCount: c.rating_count,
        };
      })
      // within 8 km if coordinates exist, or same city fallback
      .filter(c => {
        if (c.distanceKm !== null) return c.distanceKm <= 8;
        return !appt.city || !c.city || c.city.toLowerCase() === appt.city.toLowerCase();
      })
      // sorted by distance ASC, then rating DESC
      .sort((a, b) => {
        if (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm) {
          return a.distanceKm - b.distanceKm;
        }
        return b.avgRating - a.avgRating;
      });

      enriched.push({
        booking: {
          id: appt.id,
          patientId: appt.patient_id,
          patientName: appt.patient_name,
          patientPhone: appt.patient_phone,
          currentTherapistId: appt.therapist_id,
          currentTherapistName: appt.therapist_name,
          serviceType: appt.therapy_type,
          date: apptDateStr,
          time: appt.time,
          address: appt.full_address || `${appt.city || ''}, ${appt.state || ''}`,
          leaveReason: appt.leave_reason,
        },
        candidates
      });
    }

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error("getEmergencyReassignQueue error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 3. Reassign booking
exports.reassignBooking = async (req, res) => {
  const { bookingId, newTherapistId, reason } = req.body;
  if (!bookingId || !newTherapistId) {
    return res.status(400).json({ success: false, error: "bookingId and newTherapistId are required" });
  }

  const t = await sequelize.transaction();
  try {
    const [appt] = await sequelize.query(
      `SELECT * FROM appointments WHERE id = :id FOR UPDATE`,
      { replacements: { id: bookingId }, type: QueryTypes.SELECT, transaction: t }
    );
    if (!appt) {
      await t.rollback();
      return res.status(404).json({ success: false, error: "Booking not found" });
    }

    const [newTherapist] = await sequelize.query(
      `SELECT u.id, u.name, u.phone, tp.id as profile_id, tp.quality_status, tp.registration_valid_until
       FROM users u
       JOIN therapist_profiles tp ON tp.user_id = u.id
       WHERE u.id = :id AND tp.profile_status = 'approved'`,
      { replacements: { id: newTherapistId }, type: QueryTypes.SELECT, transaction: t }
    );
    if (!newTherapist) {
      await t.rollback();
      return res.status(400).json({ success: false, error: "Target therapist is not approved" });
    }
    if (newTherapist.quality_status === 'frozen') {
      await t.rollback();
      return res.status(400).json({ success: false, error: "Target therapist is frozen" });
    }

    const oldTherapistId = appt.therapist_id;
    const oldTherapistName = appt.therapist_name;

    // Update appointment
    await sequelize.query(
      `UPDATE appointments
       SET therapist_id = :newId, therapist_name = :newName, therapist_phone = :newPhone
       WHERE id = :id`,
      {
        replacements: { newId: newTherapist.id, newName: newTherapist.name, newPhone: newTherapist.phone, id: bookingId },
        type: QueryTypes.UPDATE,
        transaction: t,
      }
    );

    // Audit log / quality action
    await sequelize.query(
      `INSERT INTO therapist_quality_actions (therapist_id, action, note, actor_id, created_at)
       VALUES (:pid, 'reassignment', :note, :actorId, NOW())`,
      {
        replacements: {
          pid: newTherapist.profile_id,
          note: `Reassigned booking #${bookingId} from Dr. ${oldTherapistName}. Reason: ${reason || 'Emergency leave'}`,
          actorId: req.user.id
        },
        type: QueryTypes.INSERT,
        transaction: t,
      }
    );

    await t.commit();

    // Notifications
    const dateText = appt.date instanceof Date ? appt.date.toISOString().slice(0, 10) : appt.date;
    // Patient
    if (appt.patient_id) {
      await notificationStore.notify(appt.patient_id, {
        type: "booking_reassigned",
        title: "Therapist Reassigned",
        message: `Your appointment on ${dateText} at ${appt.time} has been reassigned to Dr. ${newTherapist.name}.`,
        link: "/dashboard/patient/my-dashboard",
        data: { appointmentId: bookingId, newTherapistId: newTherapist.id },
      }).catch(() => {});
    }
    // New therapist
    await notificationStore.notify(newTherapist.id, {
      type: "booking_assigned",
      title: "New Appointment Assigned",
      message: `You have been assigned booking #${bookingId} for ${appt.patient_name} on ${dateText} at ${appt.time}.`,
      link: "/dashboard/therapist/my-dashboard",
      data: { appointmentId: bookingId },
    }).catch(() => {});
    // Old therapist
    if (oldTherapistId) {
      await notificationStore.notify(oldTherapistId, {
        type: "booking_reassigned_away",
        title: "Booking Reassigned",
        message: `Your booking #${bookingId} on ${dateText} at ${appt.time} was reassigned to Dr. ${newTherapist.name} due to your leave.`,
        link: "/dashboard/therapist/my-dashboard",
        data: { appointmentId: bookingId },
      }).catch(() => {});
    }

    // P24: Dispatch booking_reassigned (WhatsApp to patient + Push to new therapist + InApp to Admin)
    await notifications.notify("booking_reassigned", {
      patientId: appt.patient_id,
      therapistId: newTherapist.id,
      oldTherapistId,
      newTherapistName: newTherapist.name,
      date: dateText,
      time: appt.time,
      link: "https://curevan.com/dashboard/bookings",
    }).catch(() => {});

    res.json({
      success: true,
      message: `Booking #${bookingId} reassigned to Dr. ${newTherapist.name}`,
      data: { bookingId, therapistId: newTherapist.id, therapistName: newTherapist.name }
    });
  } catch (err) {
    await t.rollback();
    console.error("reassignBooking error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 4. Quality queue list & actions
exports.getQualityQueue = async (req, res) => {
  try {
    const windowSize = rules.quality?.windowRatings || 20;
    const minRatings = rules.quality?.minRatings || 10;
    const coachingBelow = rules.quality?.coachingBelow || 4.5;
    const reviewBelow = rules.quality?.reviewBelow || 4.0;

    const therapists = await sequelize.query(
      `SELECT u.id as user_id, u.name, u.email, u.phone, u.city,
              tp.id as profile_id, tp.quality_status, tp.quality_note, tp.registration_valid_until,
              tp.specialty, tp.qualification,
              COALESCE(AVG(tr.rating), 0)::numeric(3,1) as avg_rating,
              COUNT(tr.id)::int as total_ratings
       FROM users u
       JOIN therapist_profiles tp ON tp.user_id = u.id
       LEFT JOIN therapist_reviews tr ON (tr.therapist_id = tp.id OR tr.therapist_id = u.id)
       WHERE u.role = 'therapist' AND tp.profile_status = 'approved'
       GROUP BY u.id, u.name, u.email, u.phone, u.city, tp.id, tp.quality_status, tp.quality_note, tp.registration_valid_until, tp.specialty, tp.qualification
       ORDER BY tp.quality_status = 'frozen' DESC, tp.quality_status = 'under_review' DESC, tp.quality_status = 'coaching' DESC, avg_rating ASC`,
      { type: QueryTypes.SELECT }
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
      const measureChanges = await sequelize.query(
        `SELECT COALESCE(tp.condition, 'General Rehab') as condition,
                m.code as measure_code, m.name as measure_name, m.unit, m.higher_is_better,
                COUNT(DISTINCT tp.id)::int as plan_count,
                AVG(
                  CASE WHEN m.higher_is_better THEN (r_last.value::numeric - r_base.value::numeric)
                       ELSE (r_base.value::numeric - r_last.value::numeric) END
                )::numeric(5,2) as avg_change
         FROM treatment_plans tp
         JOIN plan_measures pm ON pm.plan_id = tp.id
         JOIN outcome_measures m ON m.id = pm.measure_id
         JOIN outcome_results r_base ON r_base.plan_id = tp.id AND r_base.measure_id = m.id AND r_base.assessment_point = 'baseline' AND r_base.value IS NOT NULL
         JOIN outcome_results r_last ON r_last.plan_id = tp.id AND r_last.measure_id = m.id AND r_last.assessment_point IN ('review', 'discharge') AND r_last.value IS NOT NULL
         WHERE tp.id IN (:planIds)
         GROUP BY condition, m.code, m.name, m.unit, m.higher_is_better
         HAVING COUNT(DISTINCT tp.id) >= 5
         ORDER BY plan_count DESC, condition ASC`,
        { replacements: { planIds }, type: QueryTypes.SELECT }
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
