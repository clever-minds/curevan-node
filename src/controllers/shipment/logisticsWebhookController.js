// Courier updates (handoff pack P19). The URL deliberately avoids "shiprocket", "sr" and "kr" because Shiprocket rejects such URLs.
const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const notificationStore = require("../../services/notificationStore");

const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// forward pipeline of an order; rto and cancelled can happen at any point
const RANK = { placed: 0, paid: 0, packed: 1, awb_generated: 1, picked_up: 2, shipped: 2, in_transit: 3, out_for_delivery: 4, delivered: 5 };
const TERMINAL = ["rto", "cancelled", "refunded", "returned", "return_approved"];

/** Shiprocket status text (or id) -> our order status, or null when it changes nothing for the order. */
function mapStatus(text, id) {
  const s = String(text || "").trim().toUpperCase().replace(/[_-]+/g, " ");
  if (!s) return null;
  if (s.startsWith("RTO")) return "rto";
  if (s.includes("CANCEL")) return "cancelled";
  if (s.includes("OUT FOR DELIVERY")) return "out_for_delivery";
  if (s === "DELIVERED" || s.includes("DELIVERED") && !s.includes("UNDELIVERED") && !s.startsWith("RTO")) return "delivered";
  if (s.includes("IN TRANSIT") || s.includes("REACHED AT") || s.includes("SHIPPED")) return "in_transit";
  if (s.includes("PICKED UP") || s.includes("PICKUP DONE") || s.includes("PICKED")) return "picked_up";
  if (s.includes("AWB") && s.includes("ASSIGN")) return "awb_generated";
  return null;
}

// reverse (return) shipments move the return request instead of the order
const RETURN_MAP = { awb_generated: "Pickup Scheduled", picked_up: "In Transit", in_transit: "In Transit", out_for_delivery: "In Transit", delivered: "Received" };
const RETURN_RANK = { Approved: 0, "Pickup Scheduled": 1, "In Transit": 2, Received: 3 };

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function applyEvent(ev) {
  const t = await sequelize.transaction();
  try {
    const awb = ev.awb ? String(ev.awb) : null;
    const srOrder = String(ev.order_id || ev.sr_order_id || "");
    const returnMatch = /^RET-.+-(\d+)$/.exec(srOrder);          // our reverse orders are named RET-<order number>-<return id>
    const isReturn = !!returnMatch || Number(ev.is_return) === 1;
    const eventTime = ev.current_timestamp || ev.scan_time || ev.timestamp ? new Date(ev.current_timestamp || ev.scan_time || ev.timestamp) : null;
    const when = eventTime && !Number.isNaN(eventTime.getTime()) ? eventTime : null;
    const statusText = ev.current_status || ev.shipment_status || ev.status || "";
    const statusId = Number(ev.current_status_id ?? ev.shipment_status_id) || null;

    let shipment = null;
    let ret = null;
    if (isReturn) {
      [ret] = await q(`SELECT * FROM order_returns WHERE ${returnMatch ? "id = :id" : "reverse_awb = :awb"} FOR UPDATE`, returnMatch ? { id: Number(returnMatch[1]) } : { awb }, t);
      if (ret && awb && !ret.reverse_awb) await q(`UPDATE order_returns SET reverse_awb = :awb WHERE id = :id`, { awb, id: ret.id }, t);
    } else if (awb) {
      [shipment] = await q(`SELECT * FROM shipments WHERE awb = :awb FOR UPDATE`, { awb }, t);
    }

    // always keep the event (a duplicate is ignored by the unique index)
    const inserted = await q(
      `INSERT INTO shipment_events (shipment_id, awb, status_id, status, payload, event_time) VALUES (:sid, :awb, :statusId, :status, :payload::jsonb, :when)
       ON CONFLICT DO NOTHING RETURNING id`,
      { sid: shipment ? shipment.id : null, awb, statusId, status: String(statusText).slice(0, 120), payload: JSON.stringify(ev), when: when ? when.toISOString() : null }, t
    );
    if (!inserted.length) { await t.commit(); return { duplicate: true }; }

    const mapped = mapStatus(statusText, statusId);
    if (!mapped) { await t.commit(); return { stored: true }; }

    if (isReturn) {
      if (ret && RETURN_MAP[mapped] && (RETURN_RANK[RETURN_MAP[mapped]] ?? -1) > (RETURN_RANK[ret.status] ?? -1)) {
        await q(`UPDATE order_returns SET status = :s, updated_at = NOW() WHERE id = :id`, { s: RETURN_MAP[mapped], id: ret.id }, t);
        if (RETURN_MAP[mapped] === "Received") await notificationStore.notifyRoles(["admin.ecom"], { type: "return_received", title: "A return arrived", message: `Return #${ret.id} reached the warehouse. Inspect it to refund.`, link: "/dashboard/ecom-admin/returns" }).catch(() => {});
      }
      await t.commit();
      return { stored: true, returnId: ret ? ret.id : null, status: mapped };
    }

    if (!shipment) { await t.commit(); return { stored: true, unknownAwb: true }; }

    await q(`UPDATE shipments SET status = :label, status_id = COALESCE(:statusId, status_id), delivered_at = CASE WHEN :delivered THEN COALESCE(:when::timestamptz, NOW()) ELSE delivered_at END WHERE id = :id`,
      { label: String(statusText).slice(0, 60) || mapped, statusId, delivered: mapped === "delivered", when: when ? when.toISOString() : null, id: shipment.id }, t);

    const [order] = await q(`SELECT id, user_id, status FROM orders WHERE id = :id FOR UPDATE`, { id: shipment.order_id }, t);
    if (order) {
      const current = String(order.status || "").toLowerCase().replace(/\s+/g, "_");
      const isTerminal = TERMINAL.includes(current);
      const forward = (RANK[mapped] ?? -1) > (RANK[current] ?? -1);
      const apply = !isTerminal && (mapped === "rto" || mapped === "cancelled" || forward);
      if (apply) {
        const stored = mapped === "cancelled" ? "Cancelled" : mapped;
        await q(`UPDATE orders SET status = :s, delivered_at = CASE WHEN :delivered THEN COALESCE(:when::timestamptz, NOW()) ELSE delivered_at END WHERE id = :id`,
          { s: stored, delivered: mapped === "delivered", when: when ? when.toISOString() : null, id: order.id }, t);
      }
      await t.commit();
      if (apply && mapped === "delivered") {
        await notificationStore.notify(order.user_id, { type: "order", title: "Your order was delivered", message: "Your order has been delivered. You can request a return within the return window if something is wrong.", link: "/dashboard/patient/orders" }).catch(() => {});
      }
      return { stored: true, orderStatus: apply ? mapped : current };
    }
    await t.commit();
    return { stored: true };
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

// POST /api/hooks/logistics
exports.receive = async (req, res) => {
  const token = process.env.SHIPROCKET_WEBHOOK_TOKEN;
  if (!token || !safeEqual(req.get("x-api-key"), token)) return res.status(401).json({ ok: false });   // never process an unsigned call
  res.status(200).json({ ok: true });          // answer first: the courier retries slow or failing hooks
  try {
    const body = req.body || {};
    const events = Array.isArray(body) ? body : [body];
    for (const ev of events) await applyEvent(ev);
  } catch (err) {
    console.error("logistics webhook error:", err.message);
  }
};

exports._applyEvent = applyEvent;       // for the tests
exports.mapStatus = mapStatus;
