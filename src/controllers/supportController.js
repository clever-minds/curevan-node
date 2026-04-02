const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const transporter = require("../config/mailer");


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

    try {
      const userEmail = req.user?.email;
      const userName = req.user?.name || "Customer";
      
      if (userEmail) {
        await transporter.sendMail({
          from: `"Curevan Support" <${process.env.MAIL_USER}>`,
          to: userEmail,
          subject: `Support Ticket Created: ${subject || type}`,
          html: `
            <p>Hi ${userName},</p>
            <p>We have received your support ticket regarding <strong>${type}</strong>.</p>
            <p>Our team will look into this and get back to you soon.</p>
            <p><strong>Message:</strong><br/>${message}</p>
          `
        });
      }

      await transporter.sendMail({
        from: `"Curevan Support" <${process.env.MAIL_USER}>`,
        to: process.env.MAIL_USER,
        subject: `New Support Ticket from ${userName}`,
        html: `
          <p>A new support ticket has been created by ${userName} (${userEmail || 'N/A'}).</p>
          <p><strong>Type:</strong> ${type}</p>
          <p><strong>Subject:</strong> ${subject || 'N/A'}</p>
          <p><strong>Message:</strong><br/>${message}</p>
        `
      });
    } catch (mailErr) {
      console.error("Failed to send ticket creation emails:", mailErr);
    }

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
    const isAdmin = roles.includes("admin.super");

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

    try {
      const [ticketInfo] = await sequelize.query(
        `SELECT t.user_id, u.email as user_email, u.name as user_name 
         FROM tickets t 
         JOIN users u ON u.id = t.user_id 
         WHERE t.id = :ticket_id`,
        { 
          replacements: { ticket_id }, 
          type: QueryTypes.SELECT 
        }
      );

      if (ticketInfo) {
        const isUserReplying = (ticketInfo.user_id === userId);
        
        if (isUserReplying) {
          await transporter.sendMail({
            from: `"Curevan Support" <${process.env.MAIL_USER}>`,
            to: process.env.MAIL_USER,
            subject: `New Reply on Ticket #${ticket_id} from ${ticketInfo.user_name}`,
            html: `
              <p>User ${ticketInfo.user_name} has replied to Ticket #${ticket_id}.</p>
              <p><strong>Message:</strong><br/>${message}</p>
            `
          });
        } else {
          if (ticketInfo.user_email) {
            await transporter.sendMail({
              from: `"Curevan Support" <${process.env.MAIL_USER}>`,
              to: ticketInfo.user_email,
              subject: `Update on your Support Ticket #${ticket_id}`,
              html: `
                <p>Hi ${ticketInfo.user_name},</p>
                <p>An admin has replied to your support ticket:</p>
                <p><strong>Message:</strong><br/>${message}</p>
              `
            });
          }
        }
      }
    } catch (mailErr) {
      console.error("Failed to send ticket reply emails:", mailErr);
    }

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

    try {
      const [ticketInfo] = await sequelize.query(
        `SELECT u.email as user_email, u.name as user_name 
         FROM tickets t 
         JOIN users u ON u.id = t.user_id 
         WHERE t.id = :id`,
        { 
          replacements: { id }, 
          type: QueryTypes.SELECT 
        }
      );

      if (ticketInfo && ticketInfo.user_email) {
        await transporter.sendMail({
          from: `"Curevan Support" <${process.env.MAIL_USER}>`,
          to: ticketInfo.user_email,
          subject: `Your Support Ticket #${id} has been closed`,
          html: `
            <p>Hi ${ticketInfo.user_name},</p>
            <p>Your support ticket #${id} has been marked as closed.</p>
            <p>If you need further assistance, please open a new ticket or reply to this email.</p>
          `
        });
      }
    } catch (mailErr) {
      console.error("Failed to send ticket close email:", mailErr);
    }

    return res.success(null, "Ticket closed");

  } catch (error) {
    console.error(error);
    return res.error("Failed to close ticket");
  }
};

exports.contactUs = async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.error("Name, email and message are required", 400);
    }

    await transporter.sendMail({
      from: `"Curevan Contact" <${email}>`,
      to: process.env.MAIL_USER, // Send to site admin
      replyTo: email,
      subject: `New Contact Request: ${subject || "No Subject"}`,
      html: `
        <h3>New Contact Us Message</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || "N/A"}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      `
    });

    return res.success(null, "Message sent successfully");
  } catch (error) {
    console.error("Contact Us error:", error);
    return res.error("Failed to send message", 500);
  }
};