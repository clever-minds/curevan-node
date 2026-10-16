const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const access = require("../../utils/access");

/* GET /api/invoices/list?type=order|service&from=YYYY-MM-DD&to=YYYY-MM-DD&userId=
   Admins see every invoice (and may filter by user); anyone else sees only their own. */
exports.listInvoices = async (req, res) => {
  try {
    const admin = access.isAdmin(req.user);
    const where = [];
    const replacements = {};

    if (!admin) {
      where.push("i.user_id = :me");
      replacements.me = req.user.id;
    } else if (req.query.userId) {
      where.push("i.user_id = :userId");
      replacements.userId = Number(req.query.userId);
    }
    if (req.query.type === "order") where.push("i.order_id IS NOT NULL");
    if (req.query.type === "service") where.push("i.booking_id IS NOT NULL");
    if (req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)) { where.push("i.issued_at >= :from"); replacements.from = req.query.from; }
    if (req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) { where.push("i.issued_at < (:to::date + 1)"); replacements.to = req.query.to; }

    const rows = await sequelize.query(
      `SELECT i.id, i.invoice_number, i.status, i.user_id, i.order_id, i.booking_id, i.issued_at, i.total_amount_paise,
              u.name AS customer_name
       FROM invoices i
       LEFT JOIN users u ON u.id = i.user_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY i.issued_at DESC NULLS LAST, i.id DESC
       LIMIT 1000`,
      { replacements, type: QueryTypes.SELECT }
    );

    // shape used by the frontend's Invoice type
    const data = rows.map((r) => ({
      id: String(r.id),
      invoiceNumber: r.invoice_number,
      number: r.invoice_number,
      status: r.status,
      userId: r.user_id,
      customerName: r.customer_name || null,
      source: {
        orderId: r.order_id !== null && r.order_id !== undefined ? String(r.order_id) : undefined,
        bookingId: r.booking_id !== null && r.booking_id !== undefined ? String(r.booking_id) : undefined,
      },
      issuedAt: r.issued_at,
      totalAmountPaise: Number(r.total_amount_paise),
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error("listInvoices error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch invoices" });
  }
};
