const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");


exports.createTicket = async (req, res) => {
  try {
    const userId = req.user?.id;

    const { type, subject, message, priority, rating, item_id, topic } = req.body;

    const file = req.file?.path || null; // multer file path

    if (!userId) return res.error("Unauthorized");
    if (!type || !message) return res.error("Type and message required");

    const [ticket] = await sequelize.query(
      `INSERT INTO tickets
      (user_id, item_id, type, topic, subject, message, file, priority, rating)
      VALUES (:userId, :item_id, :type, :topic, :subject, :message, :file, :priority, :rating)
      RETURNING *`,
      {
        replacements: {
          userId,
          item_id: item_id || null,
          type,
          topic: topic || null,
          subject: subject || null,
          message,
          file,
          priority: priority || "medium",
          rating: rating || null
        },
        type: QueryTypes.INSERT
      }
    );

    return res.success(ticket[0], "Ticket created successfully");

  } catch (error) {
    console.error(error);
    return res.error("Failed to create ticket");
  }
};

exports.getTickets = async (req, res) => {
  try {
    const userId = req.user?.id;
    const roles = req.user.roles || [];

    console.log("Get tickets for user roles:", roles);

    // Check if user is super admin or admin.super
    const isAdmin =roles.includes("admin.super");

    // Fetch tickets: all if admin, else only user's tickets
    const tickets = await sequelize.query(
      `SELECT *
       FROM tickets
       WHERE (:isAdmin = true OR user_id = :userId)
       ORDER BY created_at DESC`,
      {
        replacements: {
          userId,
          isAdmin
        },
        type: QueryTypes.SELECT
      }
    );

    return res.success(tickets);

  } catch (error) {
    console.error(" getTickets error:", error);
    return res.error("Failed to fetch tickets");
  }
};
exports.getTicket = async (req, res) => {
  try {
    const { id } = req.params;

    const [ticket] = await sequelize.query(
      `SELECT * FROM tickets WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.SELECT
      }
    );

    if (!ticket) return res.error("Ticket not found");

    const messages = await sequelize.query(
      `SELECT tm.*, u.name
       FROM ticket_messages tm
       LEFT JOIN users u ON u.id = tm.sender_id
       WHERE tm.ticket_id = :id
       ORDER BY tm.created_at ASC`,
      {
        replacements: { id },
        type: QueryTypes.SELECT
      }
    );

    return res.success({ ticket, messages });

  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch ticket");
  }
};

exports.replyTicket = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { ticket_id, message } = req.body;

    if (!ticket_id || !message) {
      return res.error("Ticket id and message required");
    }

    await sequelize.query(
      `INSERT INTO ticket_messages
       (ticket_id, sender_id, message)
       VALUES (:ticket_id, :userId, :message)`,
      {
        replacements: { ticket_id, userId, message },
        type: QueryTypes.INSERT
      }
    );

    return res.success(null, "Reply added");

  } catch (error) {
    console.error(error);
    return res.error("Failed to reply");
  }
};

exports.closeTicket = async (req, res) => {
  try {
    const { id } = req.params;

    await sequelize.query(
      `UPDATE tickets
       SET status = 'closed',
       updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.UPDATE
      }
    );

    return res.success(null, "Ticket closed");

  } catch (error) {
    console.error(error);
    return res.error("Failed to close ticket");
  }
};