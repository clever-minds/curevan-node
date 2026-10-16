const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const transporter = require("../../config/mailer");
const razorpay = require("../../services/razorpayService");

/**
 * Mark a shop order as paid. Shared by the browser verify call (P06) and the webhook (P08).
 * Idempotent: calling it again for an already paid order returns the same result.
 *
 * @param {object} args
 * @param {string} args.razorpayOrderId
 * @param {string} args.paymentId
 * @param {string|null} args.signature   stored for audit (null when confirmed by webhook)
 * @param {number|null} args.userId      when set, the order must belong to this user
 * @returns {Promise<{ ok:boolean, status?:number, message?:string, data?:object }>}
 */
async function confirmOrderPayment({ razorpayOrderId, paymentId, signature = null, userId = null }) {
  const transaction = await sequelize.transaction();
  try {
    const [order] = await sequelize.query(
      `SELECT * FROM orders WHERE razorpay_order_id = :rzpId FOR UPDATE`,
      { replacements: { rzpId: razorpayOrderId }, type: QueryTypes.SELECT, transaction }
    );

    if (!order || (userId !== null && Number(order.user_id) !== Number(userId))) {
      await transaction.rollback();
      return { ok: false, status: 404, message: "Order not found" };
    }

    const [existingInvoice] = await sequelize.query(
      `SELECT id, invoice_number FROM invoices WHERE order_id = :orderId LIMIT 1`,
      { replacements: { orderId: order.id }, type: QueryTypes.SELECT, transaction }
    );

    if (order.payment_status === "Paid") {
      await transaction.rollback();
      return {
        ok: true,
        data: {
          orderId: order.id,
          orderNumber: order.order_number,
          invoiceId: existingInvoice ? existingInvoice.id : null,
          invoiceNumber: existingInvoice ? existingInvoice.invoice_number : null,
          total: Number(order.total),
          paymentStatus: "Paid",
          alreadyProcessed: true,
        },
      };
    }

    // Payment arrived after the 30-minute hold expired: take the stock again.
    if (order.status === "payment_failed") {
      const released = await sequelize.query(
        `SELECT inventory_id, qty FROM order_stock_reservations WHERE order_id = :orderId AND released_at IS NOT NULL`,
        { replacements: { orderId: order.id }, type: QueryTypes.SELECT, transaction }
      );
      for (const r of released) {
        await sequelize.query(
          `UPDATE inventory SET on_hand = on_hand - :qty, reserved = reserved + :qty, updated_at = CURRENT_TIMESTAMP WHERE id = :inventoryId`,
          { replacements: { qty: r.qty, inventoryId: r.inventory_id }, type: QueryTypes.UPDATE, transaction }
        );
      }
      await sequelize.query(
        `UPDATE order_stock_reservations SET released_at = NULL WHERE order_id = :orderId`,
        { replacements: { orderId: order.id }, type: QueryTypes.UPDATE, transaction }
      );
    }

    await sequelize.query(
      `UPDATE orders
       SET payment_status = 'Paid', status = 'Placed',
           razorpay_payment_id = :paymentId, paid_at = NOW()
       WHERE id = :orderId`,
      { replacements: { paymentId, orderId: order.id }, type: QueryTypes.UPDATE, transaction }
    );

    await sequelize.query(
      `UPDATE payment_transactions
       SET status = 'paid', razorpay_payment_id = :paymentId, razorpay_signature = :signature
       WHERE order_id = :orderId AND razorpay_order_id = :rzpId`,
      { replacements: { paymentId, signature, orderId: order.id, rzpId: razorpayOrderId }, type: QueryTypes.UPDATE, transaction }
    );

    if (order.coupon_id) {
      await sequelize.query(
        `INSERT INTO coupon_usages (coupon_id, user_id, order_id, discount)
         VALUES (:couponId, :userId, :orderId, :discount)
         ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING`,
        {
          replacements: {
            couponId: order.coupon_id,
            userId: order.user_id,
            orderId: order.id,
            discount: order.coupon_only_discount || 0,
          },
          type: QueryTypes.INSERT,
          transaction,
        }
      );
    }

    // Invoice is issued only once the money is confirmed.
    let invoiceId = existingInvoice ? existingInvoice.id : null;
    let invoiceNumber = existingInvoice ? existingInvoice.invoice_number : null;
    if (!existingInvoice) {
      invoiceNumber = `INV-${order.id}`;
      const [inv] = await sequelize.query(
        `INSERT INTO invoices (
           invoice_number, invoice_type, status, user_id, order_id,
           total_amount_paise, cgst_amount, sgst_amount, igst_amount, issued_at
         ) VALUES (
           :invoiceNumber, 'order', 'issued', :userId, :orderId,
           :totalAmountPaise, :cgst, :sgst, :igst, CURRENT_TIMESTAMP
         ) RETURNING id`,
        {
          replacements: {
            invoiceNumber,
            userId: order.user_id,
            orderId: order.id,
            totalAmountPaise: Math.round(Number(order.total) * 100),
            cgst: order.cgst,
            sgst: order.sgst,
            igst: order.igst,
          },
          type: QueryTypes.INSERT,
          transaction,
        }
      );
      invoiceId = inv[0].id;
    }

    await sequelize.query(`DELETE FROM cart WHERE user_id = :userId`, {
      replacements: { userId: order.user_id },
      type: QueryTypes.DELETE,
      transaction,
    });

    await transaction.commit();

    try {
      const [user] = await sequelize.query(`SELECT email, name FROM users WHERE id = :id`, {
        replacements: { id: order.user_id },
        type: QueryTypes.SELECT,
      });
      if (user && user.email) {
        await transporter.sendMail({
          from: `"Curevan Orders" <${process.env.MAIL_FROM || process.env.MAIL_USER}>`,
          to: user.email,
          subject: `Order Confirmation - ${order.order_number}`,
          html: `
            <h3>Order Received!</h3>
            <p>Hi ${user.name || "Customer"},</p>
            <p>Your payment was received and order <strong>${order.order_number}</strong> has been placed successfully.</p>
            <p><strong>Total Amount:</strong> ₹${order.total}</p>
            <p>We will notify you once your order is shipped.</p>
          `,
        });
      }
    } catch (mailErr) {
      console.error("Failed to send order confirmation email:", mailErr.message);
    }

    return {
      ok: true,
      data: {
        orderId: order.id,
        orderNumber: order.order_number,
        invoiceId,
        invoiceNumber,
        total: Number(order.total),
        paymentStatus: "Paid",
      },
    };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

/* POST /api/payments/verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature } */
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "razorpay_order_id, razorpay_payment_id and razorpay_signature are required" });
    }

    if (!razorpay.verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }

    const result = await confirmOrderPayment({
      razorpayOrderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      userId: req.user.id,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }

    return res.json({ success: true, message: "Payment verified", data: result.data });
  } catch (error) {
    console.error("verifyPayment error:", error);
    return res.status(500).json({ success: false, message: "Failed to verify payment" });
  }
};

exports.confirmOrderPayment = confirmOrderPayment;
