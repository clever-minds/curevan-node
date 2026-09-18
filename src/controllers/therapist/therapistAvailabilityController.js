const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

exports.setAvailability = async (req, res) => {
  try {
    const therapistId = req.user.id;
    const { schedule } = req.body; // Array of { day_of_week: 0-6, start_time, end_time }

    if (!Array.isArray(schedule)) {
      return res.error("Schedule must be an array");
    }

    // Use a transaction to replace the old schedule
    const t = await sequelize.transaction();
    try {
      await sequelize.query(
        "DELETE FROM therapist_availability WHERE therapist_id = :therapistId",
        { replacements: { therapistId }, type: QueryTypes.DELETE, transaction: t }
      );

      for (const item of schedule) {
        if (item.day_of_week >= 0 && item.day_of_week <= 6 && item.start_time && item.end_time) {
          await sequelize.query(
            "INSERT INTO therapist_availability (therapist_id, day_of_week, start_time, end_time) VALUES (:therapistId, :day, :start, :end)",
            { 
              replacements: { therapistId, day: item.day_of_week, start: item.start_time, end: item.end_time }, 
              type: QueryTypes.INSERT, 
              transaction: t 
            }
          );
        }
      }
      
      await t.commit();
      return res.success(null, "Availability updated successfully");
    } catch (err) {
      await t.rollback();
      throw err;
    }
  } catch (error) {
    console.error(error);
    return res.error("Failed to set availability");
  }
};

exports.getAvailability = async (req, res) => {
  try {
    const therapistId = req.user.id;
    const availability = await sequelize.query(
      "SELECT day_of_week, start_time, end_time FROM therapist_availability WHERE therapist_id = :therapistId ORDER BY day_of_week ASC",
      {
        replacements: { therapistId },
        type: QueryTypes.SELECT,
      }
    );

    return res.success(availability, "Availability fetched successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch availability");
  }
};
