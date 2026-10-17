// Quality & Credential checks for Therapists (P22)
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const rules = require("../config/businessRules");
const notificationStore = require("./notificationStore");

/**
 * Evaluates the quality status of a therapist based on recent reviews.
 * Rule:
 *   - takes last windowRatings (default 20, min 10)
 *   - if count >= minRatings:
 *       avg < reviewBelow (4.0) -> under_review
 *       avg < coachingBelow (4.5) -> coaching
 *       else -> ok
 * Note: If already frozen by admin, does not auto-unfreeze.
 */
async function evaluateTherapistQuality(therapistId, transaction) {
  const qRules = rules.quality || { windowRatings: 20, minRatings: 10, coachingBelow: 4.5, reviewBelow: 4.0 };
  const windowRatings = qRules.windowRatings || 20;
  const minRatings = qRules.minRatings || 10;
  const coachingBelow = qRules.coachingBelow || 4.5;
  const reviewBelow = qRules.reviewBelow || 4.0;

  const [profile] = await sequelize.query(
    `SELECT id, user_id, quality_status, quality_note FROM therapist_profiles WHERE user_id = :id`,
    { replacements: { id: therapistId }, type: QueryTypes.SELECT, transaction }
  );
  if (!profile) return null;

  const reviews = await sequelize.query(
    `SELECT rating FROM therapist_reviews 
     WHERE therapist_id = :uid AND rating IS NOT NULL
     ORDER BY created_at DESC LIMIT :limit`,
    { replacements: { uid: profile.user_id, limit: windowRatings }, type: QueryTypes.SELECT, transaction }
  );

  if (reviews.length < minRatings) {
    return {
      therapistId: profile.user_id,
      profileId: profile.id,
      qualityStatus: profile.quality_status || 'ok',
      ratingsCount: reviews.length,
      averageRating: null,
      evaluated: false,
    };
  }

  const sum = reviews.reduce((acc, r) => acc + Number(r.rating), 0);
  const avg = Math.round((sum / reviews.length) * 100) / 100;

  let newStatus = profile.quality_status || 'ok';
  if (profile.quality_status !== 'frozen') {
    if (avg < reviewBelow) {
      newStatus = 'under_review';
    } else if (avg < coachingBelow) {
      newStatus = 'coaching';
    } else {
      newStatus = 'ok';
    }
  }

  if (newStatus !== profile.quality_status) {
    await sequelize.query(
      `UPDATE therapist_profiles SET quality_status = :newStatus, updated_at = NOW() WHERE id = :id`,
      { replacements: { newStatus, id: profile.id }, type: QueryTypes.UPDATE, transaction }
    );
  }

  return {
    therapistId: profile.user_id,
    profileId: profile.id,
    qualityStatus: newStatus,
    ratingsCount: reviews.length,
    averageRating: avg,
    evaluated: true,
    flagged: newStatus !== 'ok',
  };
}

/**
 * Runs quality evaluation across all approved therapists.
 */
async function evaluateAllTherapistsQuality() {
  const profiles = await sequelize.query(
    `SELECT id, user_id FROM therapist_profiles WHERE profile_status = 'approved'`,
    { type: QueryTypes.SELECT }
  );
  const results = [];
  for (const p of profiles) {
    const res = await evaluateTherapistQuality(p.user_id);
    if (res) results.push(res);
  }
  return results;
}

/**
 * Checks credential expiry:
 * - Flags registrations expiring within 30 days and notifies therapist & admin.
 * - Flags expired registrations.
 */
async function checkCredentialExpiryAll() {
  const expiringSoon = await sequelize.query(
    `SELECT tp.id, tp.user_id, tp.registration_valid_until, tp.council, u.name, u.email
     FROM therapist_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE tp.profile_status = 'approved'
       AND tp.registration_valid_until > CURRENT_DATE
       AND tp.registration_valid_until <= CURRENT_DATE + INTERVAL '30 days'`,
    { type: QueryTypes.SELECT }
  );

  for (const t of expiringSoon) {
    const validUntilStr = new Date(t.registration_valid_until).toISOString().slice(0, 10);
    const [recent] = await sequelize.query(`SELECT 1 FROM notifications WHERE user_uid = :uid AND type = 'credential_expiry' AND created_at > NOW() - INTERVAL '7 days' LIMIT 1`, { replacements: { uid: String(t.user_id) }, type: QueryTypes.SELECT });
    if (recent) continue;       // reminded this week already
    // Notify therapist
    await notificationStore.notify(t.user_id, {
      type: "credential_expiry",
      title: "Registration Renewal Required",
      message: `Your professional council registration (${t.council || 'Council'}) expires on ${validUntilStr}. Please update your credentials.`,
      link: "/dashboard/therapist/edit",
      data: { validUntil: validUntilStr },
    }).catch(() => {});

    // Notify Therapy Admin
    await notificationStore.notifyRoles(["admin.therapy", "admin.super"], {
      type: "therapist_credential_expiring",
      title: "Therapist Credential Expiring Soon",
      message: `Dr. ${t.name}'s registration expires on ${validUntilStr}.`,
      link: "/dashboard/therapy-admin/my-dashboard",
      data: { therapistId: t.user_id, validUntil: validUntilStr },
    }).catch(() => {});
  }

  const expired = await sequelize.query(
    `SELECT tp.id, tp.user_id, tp.registration_valid_until, tp.council, u.name
     FROM therapist_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE tp.profile_status = 'approved'
       AND tp.registration_valid_until < CURRENT_DATE`,
    { type: QueryTypes.SELECT }
  );

  return { expiringSoonCount: expiringSoon.length, expiredCount: expired.length };
}

/**
 * Records a quality action taken by an admin (add note, schedule interview, unfreeze, suspend, freeze).
 */
async function recordQualityAction({ therapistId, action, note, actorId }) {
  const [profile] = await sequelize.query(
    `SELECT id, user_id, quality_status FROM therapist_profiles WHERE user_id = :id`,
    { replacements: { id: therapistId }, type: QueryTypes.SELECT }
  );
  if (!profile) throw new Error("Therapist profile not found");

  const t = await sequelize.transaction();
  try {
    let nextStatus = profile.quality_status;
    if (action === "freeze" || action === "suspend") {
      nextStatus = "frozen";
    } else if (action === "unfreeze") {
      nextStatus = "ok";
    } else if (action === "coaching") {
      nextStatus = "coaching";
    } else if (action === "under_review") {
      nextStatus = "under_review";
    }

    await sequelize.query(
      `INSERT INTO therapist_quality_actions (therapist_id, action, note, actor_id, created_at)
       VALUES (:pid, :action, :note, :actorId, NOW())`,
      {
        replacements: { pid: profile.id, action, note: note || null, actorId: actorId || null },
        type: QueryTypes.INSERT,
        transaction: t,
      }
    );

    if (nextStatus !== profile.quality_status || note) {
      await sequelize.query(
        `UPDATE therapist_profiles
         SET quality_status = :nextStatus, quality_note = COALESCE(:note, quality_note), updated_at = NOW()
         WHERE id = :pid`,
        {
          replacements: { nextStatus, note: note || null, pid: profile.id },
          type: QueryTypes.UPDATE,
          transaction: t,
        }
      );
    }

    await t.commit();
    return { success: true, qualityStatus: nextStatus };
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

module.exports = {
  evaluateTherapistQuality,
  evaluateAllTherapistsQuality,
  checkCredentialExpiryAll,
  recordQualityAction,
};
