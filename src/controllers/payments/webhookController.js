const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const razorpay = require("../../services/razorpayService");
const payments = require("./paymentsController");
const orderController = require("../orders/orderController");
const carePackService = require("../../services/carePackService");

/* ---------------------------------------------------------------
   Event handlers. Each one is safe to run twice.
--------------------------------------------------------------- */

const toPaise = (inr) => Math.round(Number(inr) * 100);

async function onPaymentCaptured(payment) {
  const rzpOrderId = payment.order_id;
  if (!rzpOrderId) return "no order id on payment";

  const [order] = await sequelize.query(
    `SELECT id, total FROM orders WHERE razorpay_order_id = :id`,
    { replacements: { id: rzpOrderId }, type: QueryTypes.SELECT }
  );
  if (order) {
    if (toPaise(order.total) !== Number(payment.amount)) {
      throw new Error(`Amount mismatch for order ${order.id}: expected ${toPaise(order.total)}, Razorpay captured ${payment.amount}`);
    }
    const r = await payments.confirmOrderPayment({ razorpayOrderId: rzpOrderId, paymentId: payment.id, signature: null });
    if (!r.ok) throw new Error(r.message || "could not confirm order");
    return "order confirmed";
  }

  const [appt] = await sequelize.query(
    `SELECT id, total_amount FROM appointments WHERE razorpay_order_id = :id`,
    { replacements: { id: rzpOrderId }, type: QueryTypes.SELECT }
  );
  if (appt) {
    if (toPaise(appt.total_amount) !== Number(payment.amount)) {
      throw new Error(`Amount mismatch for appointment ${appt.id}: expected ${toPaise(appt.total_amount)}, Razorpay captured ${payment.amount}`);
    }
    const r = await payments.confirmBookingPayment({ razorpayOrderId: rzpOrderId, paymentId: payment.id, signature: null });
    if (!r.ok) throw new Error(r.message || "could not confirm booking");
    return "booking confirmed";
  }
  // a care pack bought and paid, then the browser was closed: the stored purchase is activated here
  const pack = await carePackService.activateByOrder({ razorpayOrderId: rzpOrderId, paymentId: payment.id, amountPaise: payment.amount });
  if (pack) return pack.already ? "care pack already active" : "care pack activated";
  return "no matching order, booking or care pack";
}

async function onPaymentFailed(payment) {
  const rzpOrderId = payment.order_id;
  if (!rzpOrderId) return "no order id on payment";

  const [order] = await sequelize.query(
    `SELECT id, status, payment_status FROM orders WHERE razorpay_order_id = :id`,
    { replacements: { id: rzpOrderId }, type: QueryTypes.SELECT }
  );
  if (!order) return "not a shop order (booking stays pending; the unpaid clean-up job handles it)";
  if (order.payment_status === "Paid") return "already paid - failure event ignored";

  // mark failed and give the reserved stock back (a later successful retry re-reserves it)
  const t = await sequelize.transaction();
  try {
    const released = await orderController.releasePendingOrdersForOrder(order.id, t);
    await t.commit();
    return released ? "order marked payment_failed, stock released" : "nothing to release";
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

async function onRefundEvent(refundEntity, finalStatus) {
  const [row] = await sequelize.query(
    `SELECT id, order_id, appointment_id, return_id FROM order_refunds WHERE razorpay_refund_id = :id`,
    { replacements: { id: refundEntity.id }, type: QueryTypes.SELECT }
  );
  if (!row) throw new Error(`Unknown refund ${refundEntity.id}`);

  await sequelize.query(
    `UPDATE order_refunds SET status = :status, updated_at = NOW() WHERE id = :id`,
    { replacements: { status: finalStatus, id: row.id }, type: QueryTypes.UPDATE }
  );

  if (finalStatus !== "processed") return "refund marked failed";

  // paid status follows the total refunded so far
  const owner = row.order_id
    ? { table: "orders", idCol: "id", id: row.order_id, totalCol: "total", fk: "order_id" }
    : { table: "appointments", idCol: "id", id: row.appointment_id, totalCol: "total_amount", fk: "appointment_id" };
  const [totals] = await sequelize.query(
    `SELECT t.${owner.totalCol} AS total,
            COALESCE((SELECT SUM(amount) FROM order_refunds WHERE ${owner.fk} = :id AND LOWER(status) = 'processed'), 0) AS refunded
     FROM ${owner.table} t WHERE t.${owner.idCol} = :id`,
    { replacements: { id: owner.id }, type: QueryTypes.SELECT }
  );
  const full = Number(totals.refunded) + 0.001 >= Number(totals.total);
  await sequelize.query(
    `UPDATE ${owner.table} SET payment_status = :ps ${owner.table === "orders" && full ? ", status = 'Refunded'" : ""} WHERE ${owner.idCol} = :id`,
    { replacements: { ps: full ? "Refunded" : "Partially Refunded", id: owner.id }, type: QueryTypes.UPDATE }
  );
  if (row.return_id) {            // the refund for a return went through: close the return
    await sequelize.query(
      `UPDATE order_returns SET status = 'Refunded', updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
      { replacements: { id: row.return_id }, type: QueryTypes.UPDATE }
    );
  }
  return full ? "fully refunded" : "partially refunded";
}

async function dispatch(event, payload) {
  switch (event) {
    case "payment.captured":
    case "order.paid": {
      const payment = payload.payload && payload.payload.payment && payload.payload.payment.entity;
      return payment ? onPaymentCaptured(payment) : "no payment entity";
    }
    case "payment.failed": {
      const payment = payload.payload && payload.payload.payment && payload.payload.payment.entity;
      return payment ? onPaymentFailed(payment) : "no payment entity";
    }
    case "refund.processed":
      return onRefundEvent(payload.payload.refund.entity, "processed");
    case "refund.failed":
      return onRefundEvent(payload.payload.refund.entity, "failed");
    default:
      return `event ${event} ignored`;
  }
}

/* ---------------------------------------------------------------
   POST /api/payments/webhook   (raw body, no login)
--------------------------------------------------------------- */
exports.handleWebhook = async (req, res) => {
  const raw = req.body; // Buffer (express.raw)
  const signature = req.headers["x-razorpay-signature"];

  if (!Buffer.isBuffer(raw) || !razorpay.verifyWebhookSignature(raw, signature)) {
    return res.status(400).json({ success: false, message: "Invalid signature" });
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    return res.status(400).json({ success: false, message: "Invalid JSON" });
  }

  const eventId = String(req.headers["x-razorpay-event-id"] || crypto.createHash("sha256").update(raw).digest("hex"));
  const event = payload.event;

  let rowId;
  try {
    const [inserted] = await sequelize.query(
      `INSERT INTO payment_webhook_events (event_id, event, payload)
       VALUES (:eventId, :event, :payload::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      { replacements: { eventId, event, payload: JSON.stringify(payload) }, type: QueryTypes.INSERT }
    );
    if (inserted && inserted.length) {
      rowId = inserted[0].id;
    } else {
      // seen before: ignore it if it was handled, retry it if the earlier attempt failed
      const [prev] = await sequelize.query(
        `SELECT id, processed_at FROM payment_webhook_events WHERE event_id = :eventId`,
        { replacements: { eventId }, type: QueryTypes.SELECT }
      );
      if (!prev || prev.processed_at) return res.status(200).json({ success: true, duplicate: true });
      rowId = prev.id;
    }
  } catch (err) {
    console.error("webhook store error:", err.message);
    return res.status(500).json({ success: false, message: "Could not record event" }); // Razorpay will retry
  }

  // answer fast, then do the work
  res.status(200).json({ success: true });

  try {
    const outcome = await dispatch(event, payload);
    await sequelize.query(
      `UPDATE payment_webhook_events SET processed_at = NOW(), error = NULL WHERE id = :id`,
      { replacements: { id: rowId }, type: QueryTypes.UPDATE }
    );
    return outcome;
  } catch (err) {
    console.error(`webhook ${event} processing error:`, err.message);
    await sequelize.query(
      `UPDATE payment_webhook_events SET error = :error WHERE id = :id`,
      { replacements: { error: String(err.message).slice(0, 500), id: rowId }, type: QueryTypes.UPDATE }
    ).catch(() => {});
  }
};
