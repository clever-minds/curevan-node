const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const razorpayService = require("../../services/razorpayService");

const r2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

function getYesterdayIST() {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  istNow.setUTCDate(istNow.getUTCDate() - 1);
  return istNow.toISOString().slice(0, 10);
}

// GET /api/admin/reconciliation?date=YYYY-MM-DD
exports.getReconciliation = async (req, res) => {
  try {
    const targetDate = req.query.date || getYesterdayIST();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ success: false, message: "Invalid date format. Use YYYY-MM-DD" });
    }

    // Unix timestamps in seconds for start and end of target day in IST (UTC+5:30)
    const fromSec = Math.floor(new Date(`${targetDate}T00:00:00+05:30`).getTime() / 1000);
    const toSec = Math.floor(new Date(`${targetDate}T23:59:59+05:30`).getTime() / 1000);

    // 1. Fetch payments from Razorpay
    // every page of the day (100 per call); if Razorpay cannot be reached we say so instead of calling every payment a mismatch
    const rzpPayments = [];
    try {
      const PAGE = 100;
      for (let skip = 0, page = 0; page < 100; page += 1, skip += PAGE) {
        const rzpRes = await razorpayService.fetchPayments({ from: fromSec, to: toSec, count: PAGE, skip });
        const items = (rzpRes && rzpRes.items) || [];
        rzpPayments.push(...items);
        if (items.length < PAGE) break;
      }
    } catch (err) {
      console.error("Reconciliation: Razorpay fetch failed:", err.message);
      return res.status(502).json({ success: false, message: "Could not fetch the payments from Razorpay. Please try again." });
    }
    const capturedPayments = rzpPayments.filter((p) => p.status === "captured");

    // 2. Fetch Curevan paid records (orders & bookings)
    const orders = await sequelize.query(
      `
      SELECT
        o.id,
        'order' AS type,
        COALESCE(o.order_number, 'ORD-' || o.id) AS reference,
        o.total AS amount,
        o.payment_status AS "paymentStatus",
        'razorpay' AS "paymentMethod",
        o.razorpay_payment_id AS "razorpayPaymentId",
        o.razorpay_order_id AS "razorpayOrderId",
        o.paid_at AS "paidAt",
        o.created_at AS "createdAt"
      FROM orders o
      WHERE o.payment_status IN ('Paid', 'Partially Refunded')
        AND (
          (o.paid_at IS NOT NULL AND (o.paid_at AT TIME ZONE 'Asia/Kolkata')::date = :targetDate::date)
          OR (o.paid_at IS NULL AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date = :targetDate::date)
        )
      ORDER BY o.id ASC
      `,
      { replacements: { targetDate }, type: QueryTypes.SELECT }
    );

    const appointments = await sequelize.query(
      `
      SELECT
        a.id,
        'booking' AS type,
        ('BK-' || a.id) AS reference,
        a.total_amount AS amount,
        a.payment_status AS "paymentStatus",
        a.payment_method AS "paymentMethod",
        a.razorpay_payment_id AS "razorpayPaymentId",
        a.razorpay_order_id AS "razorpayOrderId",
        a.paid_at AS "paidAt",
        a.created_at AS "createdAt"
      FROM appointments a
      WHERE a.payment_status IN ('Paid', 'Partially Refunded')
        AND COALESCE(a.payment_method, 'razorpay') NOT LIKE 'manual_%' AND COALESCE(a.payment_method, 'razorpay') <> 'care_pack'
        AND (
          (a.paid_at IS NOT NULL AND (a.paid_at AT TIME ZONE 'Asia/Kolkata')::date = :targetDate::date)
          OR (a.paid_at IS NULL AND (a.created_at AT TIME ZONE 'Asia/Kolkata')::date = :targetDate::date)
        )
      ORDER BY a.id ASC
      `,
      { replacements: { targetDate }, type: QueryTypes.SELECT }
    );

    const packs = await sequelize.query(
      `SELECT cp.id, ('PACK-' || cp.id) AS reference, cp.price_paid AS amount, cp.razorpay_payment_id AS "razorpayPaymentId", cp.razorpay_order_id AS "razorpayOrderId", cp.purchased_at AS "paidAt"
       FROM care_packs cp
       WHERE cp.razorpay_payment_id IS NOT NULL AND cp.status IN ('active', 'exhausted', 'expired', 'refunded') AND (cp.purchased_at AT TIME ZONE 'Asia/Kolkata')::date = :targetDate::date
       ORDER BY cp.id ASC`,
      { replacements: { targetDate }, type: QueryTypes.SELECT }
    );

    const curevanItems = [
      ...packs.map((c) => ({ id: c.id, type: "care_pack", reference: c.reference, amount: Number(c.amount || 0), paymentId: c.razorpayPaymentId, orderId: c.razorpayOrderId, paidAt: c.paidAt, link: "/dashboard/admin/care-packs" })),
      ...orders.map((o) => ({
        id: o.id,
        type: "order",
        reference: o.reference,
        amount: Number(o.amount || 0),
        paymentId: o.razorpayPaymentId,
        orderId: o.razorpayOrderId,
        paidAt: o.paidAt || o.createdAt,
        link: `/dashboard/admin/orders`
      })),
      ...appointments.map((a) => ({
        id: a.id,
        type: "booking",
        reference: a.reference,
        amount: Number(a.amount || 0),
        paymentId: a.razorpayPaymentId,
        orderId: a.razorpayOrderId,
        paidAt: a.paidAt || a.createdAt,
        link: `/dashboard/admin/appointments`
      }))
    ];

    // 3. Reconcile
    const matchedCurevanKeys = new Set();
    const matched = [];
    const mismatches = [];

    for (const rzp of capturedPayments) {
      const rzpAmountINR = r2(Number(rzp.amount || 0) / 100);
      // Try to find matching Curevan item by payment ID first, then by Razorpay order ID
      const found = curevanItems.find((item) => {
        const key = `${item.type}-${item.id}`;
        if (matchedCurevanKeys.has(key)) return false;
        if (item.paymentId && item.paymentId === rzp.id) return true;
        if (item.orderId && rzp.order_id && item.orderId === rzp.order_id) return true;
        return false;
      });

      if (found) {
        matchedCurevanKeys.add(`${found.type}-${found.id}`);
        const foundAmountPaise = Math.round(found.amount * 100);
        if (foundAmountPaise === Number(rzp.amount)) {
          matched.push({
            paymentId: rzp.id,
            orderId: rzp.order_id || found.orderId,
            curevanId: found.id,
            type: found.type,
            reference: found.reference,
            amount: found.amount,
            paidAt: found.paidAt
          });
        } else {
          mismatches.push({
            type: "amount_mismatch",
            paymentId: rzp.id,
            orderId: rzp.order_id || found.orderId,
            curevanId: found.id,
            curevanType: found.type,
            reference: found.reference,
            curevanAmount: found.amount,
            razorpayAmount: rzpAmountINR,
            description: `Amount mismatch on ${found.reference}: Curevan has ₹${found.amount} but Razorpay captured ₹${rzpAmountINR}`,
            link: found.link
          });
        }
      } else {
        mismatches.push({
          type: "missing_in_curevan",
          paymentId: rzp.id,
          orderId: rzp.order_id || null,
          curevanId: null,
          curevanType: null,
          reference: rzp.id,
          curevanAmount: 0,
          razorpayAmount: rzpAmountINR,
          description: `Razorpay payment ${rzp.id} (₹${rzpAmountINR}) captured but not found in Curevan paid records`,
          link: null
        });
      }
    }

    // Check Curevan records that had no Razorpay match
    for (const item of curevanItems) {
      if (!matchedCurevanKeys.has(`${item.type}-${item.id}`)) {
        mismatches.push({
          type: "missing_in_razorpay",
          paymentId: item.paymentId || null,
          orderId: item.orderId || null,
          curevanId: item.id,
          curevanType: item.type,
          reference: item.reference,
          curevanAmount: item.amount,
          razorpayAmount: 0,
          description: `${item.type === "order" ? "Order" : "Booking"} ${item.reference} (₹${item.amount}) is marked Paid in Curevan but has no matching captured payment in Razorpay`,
          link: item.link
        });
      }
    }

    // refunds that need a person: Razorpay refused them, they have been "pending" for 2+ days, or the booking is refunded but still active
    const refundRows = await sequelize.query(
      `SELECT r.id, r.amount, r.status, r.reason, r.created_at AS "createdAt", r.order_id AS "orderId", r.appointment_id AS "appointmentId", r.care_pack_id AS "carePackId",
              a.status AS "appointmentStatus"
       FROM order_refunds r LEFT JOIN appointments a ON a.id = r.appointment_id
       WHERE (r.created_at AT TIME ZONE 'Asia/Kolkata')::date = :targetDate::date
         AND (LOWER(r.status) = 'failed'
              OR (LOWER(r.status) = 'pending' AND r.created_at < NOW() - INTERVAL '2 days')
              OR (r.appointment_id IS NOT NULL AND LOWER(r.status) IN ('pending', 'processed') AND a.status IN ('confirmed', 'accepted', 'on_the_way', 'arrived', 'in_progress')))
       ORDER BY r.id ASC`,
      { replacements: { targetDate }, type: QueryTypes.SELECT }
    );
    for (const f of refundRows) {
      const what = f.orderId ? `order ${f.orderId}` : f.carePackId ? `care pack ${f.carePackId}` : `booking ${f.appointmentId}`;
      const type = String(f.status).toLowerCase() === "failed" ? "refund_failed" : "refund_pending_long";
      const activeBooking = f.appointmentId && ["confirmed", "accepted", "on_the_way", "arrived", "in_progress"].includes(f.appointmentStatus);
      mismatches.push({
        type: activeBooking ? "refunded_but_active" : type,
        paymentId: null, orderId: null, curevanId: f.orderId || f.carePackId || f.appointmentId, curevanType: f.orderId ? "order" : f.carePackId ? "care_pack" : "booking",
        reference: `REFUND-${f.id}`, curevanAmount: r2(f.amount), razorpayAmount: 0,
        description: activeBooking
          ? `Refund of ₹${r2(f.amount)} for ${what} was sent, but the booking is still "${f.appointmentStatus}". Cancel it by hand.`
          : String(f.status).toLowerCase() === "failed"
            ? `Refund of ₹${r2(f.amount)} for ${what} failed at Razorpay. The customer has not been paid back yet.`
            : `Refund of ₹${r2(f.amount)} for ${what} has been pending for more than 2 days.`,
        link: f.orderId ? "/dashboard/admin/orders" : "/dashboard/admin/appointments",
      });
    }

    const curevanTotal = r2(curevanItems.reduce((acc, x) => acc + x.amount, 0));
    const razorpayTotal = r2(capturedPayments.reduce((acc, x) => acc + Number(x.amount || 0) / 100, 0));
    const matchedTotal = r2(matched.reduce((acc, x) => acc + x.amount, 0));

    return res.json({
      success: true,
      data: {
        date: targetDate,
        summary: {
          curevanTotal,
          curevanCount: curevanItems.length,
          razorpayTotal,
          razorpayCount: capturedPayments.length,
          matchedCount: matched.length,
          matchedTotal,
          mismatchCount: mismatches.length,
          difference: r2(curevanTotal - razorpayTotal)
        },
        mismatches,
        matched
      }
    });
  } catch (error) {
    console.error("Reconciliation error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate reconciliation report" });
  }
};

// GET /api/admin/payment-exceptions
exports.getPaymentExceptions = async (req, res) => {
  try {
    const pendingOrders = await sequelize.query(
      `
      SELECT
        o.id,
        COALESCE(o.order_number, 'ORD-' || o.id) AS "orderNumber",
        o.customer_name AS "customerName",
        o.customer_phone AS "customerPhone",
        o.total,
        o.status,
        o.payment_status AS "paymentStatus",
        o.created_at AS "createdAt"
      FROM orders o
      WHERE (o.status = 'pending_payment' OR o.payment_status IN ('Pending', 'pending_payment'))
        AND o.payment_status <> 'Paid'
        AND o.created_at < NOW() - INTERVAL '30 minutes'
      ORDER BY o.created_at DESC
      LIMIT 50
      `,
      { type: QueryTypes.SELECT }
    );

    const failedWebhooks = await sequelize.query(
      `
      SELECT
        id,
        event_id AS "eventId",
        event,
        payload,
        error,
        received_at AS "receivedAt",
        processed_at AS "processedAt"
      FROM payment_webhook_events
      WHERE error IS NOT NULL
      ORDER BY received_at DESC
      LIMIT 50
      `,
      { type: QueryTypes.SELECT }
    );

    return res.json({
      success: true,
      data: {
        pendingOrders: pendingOrders.map((o) => ({ ...o, total: Number(o.total || 0) })),
        failedWebhooks
      }
    });
  } catch (error) {
    console.error("Payment exceptions error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch payment exceptions" });
  }
};
