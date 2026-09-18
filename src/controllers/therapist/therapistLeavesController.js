const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

exports.addLeave = async (req, res) => {
  try {
    const therapistId = req.user.id;
    const { start_date, end_date, start_time, end_time, reason } = req.body;

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

    return res.success(null, "Leave added successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to add leave");
  }
};

exports.listLeaves = async (req, res) => {
  try {
    const therapistId = req.user.id;
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
    const therapistId = req.user.id;
    const { id } = req.params;

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
