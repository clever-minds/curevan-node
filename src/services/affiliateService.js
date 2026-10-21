// Therapist affiliate (DR code) commissions (handoff pack P20). Products only, never therapy sessions.
// coupons.therapist_id = therapist PROFILE id; affiliate_commissions.therapist_id = therapist USER id (what payouts use).
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const rules = require("../config/businessRules");
const payoutService = require("./payoutService");

const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** DR + surname (last word of the name) in capitals, letters only; the first name when there is no usable surname. */
function baseCode(name) {
  const letters = (w) => String(w || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z]/g, "").toUpperCase();
  const words = String(name || "").replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").trim().split(/\s+/);
  const surname = letters(words.length > 1 ? words[words.length - 1] : "");
  return `DR${surname || letters(words[0]) || "CUREVAN"}`;
}

/** Creates the DR code of one approved therapist (by profile id) if they have none. Returns the coupon row. */
async function ensureCodeForTherapist(profileId, { transaction } = {}) {
  const [existing] = await q(`SELECT * FROM coupons WHERE owner_type = 'Therapist' AND therapist_id = :id ORDER BY id LIMIT 1`, { id: profileId }, transaction);
  if (existing) return existing;
  const [tp] = await q(`SELECT u.name FROM therapist_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.id = :id`, { id: profileId }, transaction);
  if (!tp) return null;
  const base = baseCode(tp.name);
  for (let n = 1; n < 200; n += 1) {
    const code = n === 1 ? base : `${base}${n}`;
    const rows = await q(
      `INSERT INTO coupons (code, type, value, status, scope, owner_type, therapist_id, is_stackable)
       SELECT :code, 'percent', :pct, 'Active', 'Global', 'Therapist', :id, false
       WHERE NOT EXISTS (SELECT 1 FROM coupons WHERE UPPER(code) = :code)
       RETURNING *`,
      { code, pct: rules.affiliate.patientDiscountPct, id: profileId }, transaction
    );
    if (rows.length) return rows[0];
  }
  return null;
}

/** Codes for every approved therapist that has none (admin button). */
async function generateMissing() {
  const missing = await q(
    `SELECT tp.id FROM therapist_profiles tp
     WHERE tp.profile_status = 'approved' AND NOT EXISTS (SELECT 1 FROM coupons c WHERE c.owner_type = 'Therapist' AND c.therapist_id = tp.id) ORDER BY tp.id`
  );
  const made = [];
  for (const m of missing) {
    const c = await ensureCodeForTherapist(m.id);
    if (c) made.push(c);
  }
  return made;
}

/**
 * At payment verification: when the order used a therapist coupon, one pending commission row per order line.
 * sale = the line's taxable value after the discount (no GST, no shipping). The therapist never earns on their own order.
 */
async function recordForOrder(orderId, { transaction } = {}) {
  const [order] = await q(`SELECT id, user_id, coupon_id FROM orders WHERE id = :id`, { id: orderId }, transaction);
  if (!order || !order.coupon_id) return 0;
  const [c] = await q(`SELECT c.id, tp.user_id AS therapist_user_id FROM coupons c JOIN therapist_profiles tp ON tp.id = c.therapist_id WHERE c.id = :id AND c.owner_type = 'Therapist'`, { id: order.coupon_id }, transaction);
  if (!c || Number(c.therapist_user_id) === Number(order.user_id)) return 0;
  const pct = rules.affiliate.therapistCommissionPct;
  const rows = await q(
    `INSERT INTO affiliate_commissions (order_id, order_item_id, therapist_id, coupon_id, sale_amount, commission_pct, commission_amount, status)
     SELECT oi.order_id, oi.id, :therapist, :coupon, oi.taxable_value, :pct, ROUND(oi.taxable_value * :pct / 100, 2), 'pending'
     FROM order_items oi WHERE oi.order_id = :orderId AND COALESCE(oi.taxable_value, 0) > 0
     ON CONFLICT (order_item_id) DO NOTHING RETURNING id`,
    { therapist: c.therapist_user_id, coupon: c.id, pct, orderId }, transaction
  );
  return rows.length;
}

/** Order cancelled or items returned: the commission is void. A line not yet in a payout batch also leaves the payout queue. */
async function cancelFor(orderId, status, { itemIds, transaction } = {}) {
  if (itemIds && !itemIds.length) return 0;
  const rows = await q(
    `UPDATE affiliate_commissions SET status = :status, updated_at = NOW()
     WHERE order_id = :orderId AND status IN ('pending', 'eligible') ${itemIds ? "AND order_item_id IN (:ids)" : ""} RETURNING id`,
    { status, orderId, ids: itemIds }, transaction
  );
  if (rows.length) await q(`DELETE FROM payout_items WHERE type = 'affiliate' AND source_id IN (:ids) AND batch_id IS NULL AND state = 'Pending'`, { ids: rows.map((r) => r.id) }, transaction);
  return rows.length;
}

/** Daily: pending commissions whose order was delivered at least `eligibleAfterDeliveryDays` ago (and has no open return) become eligible and join the payout queue. */
async function promoteEligible() {
  const days = rules.affiliate.eligibleAfterDeliveryDays;
  const due = await q(
    `SELECT c.*, o.delivered_at FROM affiliate_commissions c JOIN orders o ON o.id = c.order_id
     WHERE c.status = 'pending' AND o.delivered_at IS NOT NULL AND o.delivered_at + make_interval(days => :days) <= NOW()
       AND LOWER(o.status) NOT IN ('cancelled', 'refunded', 'returned', 'return approved', 'rto')
       AND NOT EXISTS (SELECT 1 FROM order_returns r WHERE r.order_id = c.order_id AND r.status IN ('Requested', 'Approved', 'Pickup Scheduled', 'In Transit', 'Received', 'Inspected'))`,
    { days }
  );
  let n = 0;
  for (const c of due) {
    const t = await sequelize.transaction();
    try {
      const upd = await q(`UPDATE affiliate_commissions SET status = 'eligible', eligible_at = :at, updated_at = NOW() WHERE id = :id AND status = 'pending' RETURNING *`,
        { id: c.id, at: new Date(new Date(c.delivered_at).getTime() + days * 86400000).toISOString() }, t);
      if (upd.length) { await payoutService.createItemForCommission(upd[0], { transaction: t }); n += 1; }
      await t.commit();
    } catch (err) { await t.rollback(); throw err; }
  }
  return n;
}

/** Numbers for the therapist's affiliate page. */
async function statsFor(userId) {
  const [tp] = await q(`SELECT id FROM therapist_profiles WHERE user_id = :id`, { id: userId });
  if (!tp) return null;
  const [code] = await q(`SELECT code, status, value FROM coupons WHERE owner_type = 'Therapist' AND therapist_id = :id ORDER BY id LIMIT 1`, { id: tp.id });
  const [t] = await q(
    `SELECT COUNT(DISTINCT order_id)::int AS redemptions,
            COALESCE(SUM(sale_amount) FILTER (WHERE status NOT IN ('cancelled', 'cancelled_returned')), 0) AS gross_sales,
            COALESCE(SUM(commission_amount) FILTER (WHERE status = 'pending'), 0) AS pending,
            COALESCE(SUM(commission_amount) FILTER (WHERE status = 'eligible'), 0) AS eligible,
            COALESCE(SUM(commission_amount) FILTER (WHERE status = 'paid'), 0) AS paid
     FROM affiliate_commissions WHERE therapist_id = :id`, { id: userId }
  );
  const top = await q(
    `SELECT oi.name, SUM(oi.qty)::int AS units, SUM(c.sale_amount) AS sales
     FROM affiliate_commissions c JOIN order_items oi ON oi.id = c.order_item_id
     WHERE c.therapist_id = :id AND c.status NOT IN ('cancelled', 'cancelled_returned') GROUP BY oi.name ORDER BY SUM(c.sale_amount) DESC LIMIT 5`, { id: userId }
  );
  return {
    code: code ? code.code : null,
    codeStatus: code ? code.status : null,
    patientDiscountPct: code ? Number(code.value) : rules.affiliate.patientDiscountPct,
    commissionPct: rules.affiliate.therapistCommissionPct,
    redemptions: t.redemptions,
    grossSales: r2(t.gross_sales),
    pending: r2(t.pending),
    eligible: r2(t.eligible),
    paid: r2(t.paid),
    topProducts: top.map((x) => ({ name: x.name, units: x.units, sales: r2(x.sales) })),
  };
}

module.exports = { baseCode, ensureCodeForTherapist, generateMissing, recordForOrder, cancelFor, promoteEligible, statsFor };
