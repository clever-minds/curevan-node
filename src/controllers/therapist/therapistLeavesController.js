const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const notificationStore = require("../../services/notificationStore");
const emergencyService = require("../../services/emergencyService");

exports.addLeave = async (req, res) => {
  try {
    const userId = req.user.id;
    const { start_date, end_date, start_time, end_time, reason } = req.body;

    const [profile] = await sequelize.query(
      "SELECT id FROM therapist_profiles WHERE user_id = :userId",
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    if (!profile) return res.error("Therapist profile not found");
    const therapistId = profile.id;

    if (!start_date || !end_date) {
      return res.error("Start date and end date are required");
    }

    await sequelize.query(
      "INSERT INTO therapist_leaves (therapist_id, start_date, end_date, start_time, end_time, reason, status) " +
      "VALUES (:therapistId, :start_date, :end_date, :start_time, :end_time, :reason, 'approved')",
      {
        replacements: { therapistId, start_date, end_date, start_time: start_time || null, end_time: end_time || null, reason: reason || null },
        type: QueryTypes.INSERT,
      }
    );

    // a leave for today or tomorrow that covers active bookings: the therapy team is told right away (the dashboard banner shows the same list)
    let affectedBookings = 0;
    try {
      affectedBookings = (await emergencyService.listImpacted()).filter((b) => Number(b.therapist_id) === Number(userId)).length;
      if (affectedBookings > 0) {
        await notificationStore.notifyRoles(["admin.therapy", "admin.super"], {
          type: "therapist_leave_conflict",
          title: "Therapist leave needs a replacement",
          message: `${affectedBookings} booking${affectedBookings === 1 ? "" : "s"} of ${req.user.name || "a therapist"} fall on a new leave. Reassign them.`,
          link: "/dashboard/therapy-admin/my-dashboard",
          data: { therapistId: userId, affectedBookings },
        });
      }
    } catch (alertErr) {
      console.error("leave conflict alert failed:", alertErr.message);      // the leave itself is saved
    }

    return res.success({ affectedBookings }, "Leave added successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to add leave");
  }
};

exports.listLeaves = async (req, res) => {
  try {
    const userId = req.user.id;
    const [profile] = await sequelize.query(
      "SELECT id FROM therapist_profiles WHERE user_id = :userId",
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    if (!profile) return res.success([], "No leaves found");
    const therapistId = profile.id;
    
    const leaves = await sequelize.query(
      "SELECT * FROM therapist_leaves WHERE therapist_id = :therapistId ORDER BY start_date DESC",
      {
        replacements: { therapistId },
        type: QueryTypes.SELECT,
      }
    );

    return res.success(leaves, "Leaves fetched successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch leaves");
  }
};

exports.deleteLeave = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const [profile] = await sequelize.query(
      "SELECT id FROM therapist_profiles WHERE user_id = :userId",
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    if (!profile) return res.error("Therapist profile not found");
    const therapistId = profile.id;

    const result = await sequelize.query(
      "DELETE FROM therapist_leaves WHERE id = :id AND therapist_id = :therapistId RETURNING id",
      {
        replacements: { id, therapistId },
        type: QueryTypes.DELETE,
      }
    );

    if (!result.length) {
      return res.error("Leave not found or unauthorized");
    }

    return res.success(null, "Leave deleted successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to delete leave");
  }
};
