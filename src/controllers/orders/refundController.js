const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');
const refundService = require('../../services/refundService');

/* =========================
   INITIATE REFUND (Admin)
========================= */
exports.initiateRefund = async (req, res) => {
  try {
    const body = req.body || {};
    const orderId = body.orderId ?? body.order_id;
    const returnId = body.returnId ?? body.return_id;
    const { amount, reason } = body; // amount is in rupees
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }

    // Goes to Razorpay; the status turns 'processed' (or 'failed') when the webhook arrives.
    const result = await refundService.refund({
      orderId,
      returnId: returnId || null,
      amountInr: amount,
      reason,
      actorId: req.user.id,
    });

    res.status(201).json({
      success: true,
      message: 'Refund sent to Razorpay. It will show as processed once Razorpay confirms.',
      refundId: result.refundId,
      status: result.status,
      amount: result.amount,
    });
  } catch (error) {
    if (error instanceof refundService.RefundError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('INITIATE REFUND ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to initiate refund' });
  }
};

/* =========================
   LIST REFUNDS (Admin)
========================= */
exports.listRefunds = async (req, res) => {
  try {
    const refunds = await sequelize.query(
      `SELECT r.*, o.order_number, u.name as user_name
       FROM order_refunds r
       LEFT JOIN orders o ON o.id = r.order_id
       JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC`,
      { type: QueryTypes.SELECT }
    );
    res.json({ success: true, data: refunds });
  } catch (error) {
    console.error('LIST REFUNDS ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch refunds' });
  }
};

/* =========================
   GET MY REFUNDS (User)
========================= */
exports.getMyRefunds = async (req, res) => {
  try {
    const userId = req.user.id;
    const refunds = await sequelize.query(
      `SELECT r.*, o.order_number
       FROM order_refunds r
       LEFT JOIN orders o ON o.id = r.order_id
       WHERE r.user_id = :userId
       ORDER BY r.created_at DESC`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT
      }
    );
    res.json({ success: true, data: refunds });
  } catch (error) {
    console.error('MY REFUNDS ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch your refunds' });
  }
};
