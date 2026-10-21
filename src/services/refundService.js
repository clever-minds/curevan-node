/**
 * Refunds through Razorpay (P08). The final status (processed / failed) is set by the
 * webhook (refund.processed / refund.failed), not here.
 *
 *   refund({ orderId | appointmentId, amountInr, reason, actorId, returnId })
 *
 * Booking cancellation rules (P14) call this service with the amount they decide.
 */
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const razorpay = require("./razorpayService");

class RefundError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function writeAudit({ actorId, action, entityType, entityId, details, transaction }) {
  await sequelize.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details)
     VALUES (:actorId, :action, :entityType, :entityId, :details)`,
    {
      replacements: {
        actorId: String(actorId ?? "system"),
        action,
        entityType,
        entityId: String(entityId),
        details: details ? JSON.stringify(details) : null,
      },
      type: QueryTypes.INSERT,
      transaction,
    }
  );
}

async function refund({ orderId = null, appointmentId = null, amountInr = null, reason = null, actorId = null, returnId = null }) {
  if (!orderId && !appointmentId) throw new RefundError("orderId or appointmentId is required");

  const transaction = await sequelize.transaction();
  let refundId;
  try {
    // 1) what was paid, and with which Razorpay payment
    let paid;
    let userId;
    if (orderId) {
      const [o] = await sequelize.query(
        `SELECT id, user_id, total, payment_status, razorpay_payment_id FROM orders WHERE id = :id FOR UPDATE`,
        { replacements: { id: orderId }, type: QueryTypes.SELECT, transaction }
      );
      if (!o) throw new RefundError("Order not found", 404);
      if (!["Paid", "Partially Refunded"].includes(o.payment_status)) throw new RefundError("Order has no confirmed payment to refund");
      if (!o.razorpay_payment_id) throw new RefundError("No online payment is linked to this order - refund it manually");
      paid = { amount: Number(o.total), paymentId: o.razorpay_payment_id };
      userId = o.user_id;
    } else {
      const [a] = await sequelize.query(
        `SELECT id, patient_id, total_amount, payment_status, razorpay_payment_id FROM appointments WHERE id = :id FOR UPDATE`,
        { replacements: { id: appointmentId }, type: QueryTypes.SELECT, transaction }
      );
      if (!a) throw new RefundError("Appointment not found", 404);
      if (!["Paid", "Partially Refunded"].includes(a.payment_status)) throw new RefundError("Appointment has no confirmed payment to refund");
      if (!a.razorpay_payment_id) throw new RefundError("No online payment is linked to this appointment - refund it manually");
      paid = { amount: Number(a.total_amount), paymentId: a.razorpay_payment_id };
      userId = a.patient_id;
    }

    // 2) never refund more than paid minus what is already refunded (or on its way)
    const [sum] = await sequelize.query(
      `SELECT COALESCE(SUM(amount), 0) AS refunded FROM order_refunds
       WHERE ${orderId ? "order_id" : "appointment_id"} = :id AND LOWER(status) IN ('pending', 'processed')`,
      { replacements: { id: orderId || appointmentId }, type: QueryTypes.SELECT, transaction }
    );
    const remaining = r2(paid.amount - Number(sum.refunded));
    const amount = amountInr === null || amountInr === undefined || amountInr === "" ? remaining : r2(amountInr);
    if (!(amount > 0)) throw new RefundError("Refund amount must be greater than zero");
    if (amount > remaining) throw new RefundError(`Refund amount exceeds the refundable balance (${remaining})`);

    // 3) record first (pending), then call Razorpay
    const [row] = await sequelize.query(
      `INSERT INTO order_refunds (order_id, appointment_id, return_id, user_id, amount, reason, transaction_id, status, created_at)
       VALUES (:orderId, :appointmentId, :returnId, :userId, :amount, :reason, :paymentId, 'pending', NOW())
       RETURNING id`,
      {
        replacements: { orderId, appointmentId, returnId, userId, amount, reason, paymentId: paid.paymentId },
        type: QueryTypes.INSERT,
        transaction,
      }
    );
    refundId = row[0].id;

    let rzp;
    try {
      rzp = await razorpay.refund(paid.paymentId, Math.round(amount * 100), {
        reason: reason || "Refund",
        orderId: orderId ? String(orderId) : "",
        appointmentId: appointmentId ? String(appointmentId) : "",
      });
    } catch (err) {
      await transaction.rollback();
      throw new RefundError(`Razorpay refused the refund: ${(err && (err.error && err.error.description || err.message)) || "unknown error"}`, 502);
    }

    await sequelize.query(
      `UPDATE order_refunds SET razorpay_refund_id = :rzpId WHERE id = :id`,
      { replacements: { rzpId: rzp.id, id: refundId }, type: QueryTypes.UPDATE, transaction }
    );

    await writeAudit({
      actorId,
      action: "refund_initiated",
      entityType: orderId ? "order" : "appointment",
      entityId: orderId || appointmentId,
      details: { refundId, razorpayRefundId: rzp.id, amount, reason },
      transaction,
    });

    await transaction.commit();
    return { refundId, razorpayRefundId: rzp.id, amount, status: "pending" };
  } catch (err) {
    if (!(err instanceof RefundError) || err.status !== 502) {
      try { await transaction.rollback(); } catch (e) { /* already rolled back */ }
    }
    throw err;
  }
}

module.exports = { refund, RefundError };
