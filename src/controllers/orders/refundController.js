const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

/* =========================
   INITIATE REFUND (Admin)
========================= */
exports.initiateRefund = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderId, returnId, amount, reason, transactionId } = req.body;
    const adminId = req.user.id;

    // 1. Get Order Details
    const [order] = await sequelize.query(
      `SELECT user_id, status, total FROM orders WHERE id = :orderId`,
      {
        replacements: { orderId },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    if (!order) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // 2. Create Refund Record
    const [refund] = await sequelize.query(
      `INSERT INTO order_refunds (order_id, return_id, user_id, amount, reason, transaction_id, status)
       VALUES (:orderId, :returnId, :userId, :amount, :reason, :transactionId, 'Processed')
       RETURNING id`,
      {
        replacements: {
          orderId,
          returnId: returnId || null,
          userId: order.user_id,
          amount,
          reason,
          transactionId: transactionId || null
        },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    const refundId = refund[0].id;

    // 3. Update Order Status
    await sequelize.query(
      `UPDATE orders SET payment_status = 'Refunded', status = 'Refunded' WHERE id = :orderId`,
      { replacements: { orderId }, type: QueryTypes.UPDATE, transaction: t }
    );

    // 4. Update Return Status if linked
    if (returnId) {
      await sequelize.query(
        `UPDATE order_returns SET status = 'Refunded', updated_at = CURRENT_TIMESTAMP WHERE id = :returnId`,
        { replacements: { returnId }, type: QueryTypes.UPDATE, transaction: t }
      );
    }

    await t.commit();
    res.status(201).json({
      success: true,
      message: 'Refund processed successfully',
      refundId
    });

  } catch (error) {
    await t.rollback();
    console.error('INITIATE REFUND ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to initiate refund', error: error.message });
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
       JOIN orders o ON o.id = r.order_id
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
       JOIN orders o ON o.id = r.order_id
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
