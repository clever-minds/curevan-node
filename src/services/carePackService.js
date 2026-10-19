// Care pack rules shared by the purchase, the webhook, the booking and the cancellation paths (handoff pack P28).
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

/**
 * Activate the pack that was priced when the Razorpay order was made. What is activated comes from the stored row, never from the
 * request: the customer cannot pay for a small plan and get a bigger one. Safe to call twice (browser verify and webhook both do).
 * @returns {{ pack, already: boolean } | null}  null = no pack belongs to this order
 */
async function activateByOrder({ razorpayOrderId, paymentId, userId = null, amountPaise = null, transaction }) {
  const [pack] = await q(`SELECT cp.*, cpp.validity_days, cpp.name AS plan_name FROM care_packs cp JOIN care_pack_plans cpp ON cpp.id = cp.plan_id WHERE cp.razorpay_order_id = :id FOR UPDATE OF cp`, { id: razorpayOrderId }, transaction);
  if (!pack) return null;
  if (userId !== null && Number(pack.patient_id) !== Number(userId)) return null;
  if (amountPaise !== null && Math.round(Number(pack.price_paid) * 100) !== Number(amountPaise)) {
    throw new Error(`Amount mismatch for care pack ${pack.id}: expected ${Math.round(Number(pack.price_paid) * 100)}, Razorpay captured ${amountPaise}`);
  }
  if (pack.status !== "pending_payment") return { pack, already: true };

  const [active] = await q(
    `UPDATE care_packs SET status = 'active', razorpay_payment_id = :paymentId, purchased_at = NOW(), expires_at = NOW() + make_interval(days => :days), updated_at = NOW()
     WHERE id = :id RETURNING *`,
    { paymentId, days: pack.validity_days, id: pack.id }, transaction
  );
  await q(
    `INSERT INTO invoices (invoice_number, invoice_type, status, user_id, issued_at, total_amount_paise, tax_category, gst_amount)
     VALUES (:number, 'care_pack', 'issued', :userId, NOW(), :paise, 'exempt_clinical', 0) ON CONFLICT DO NOTHING RETURNING id`,
    { number: `INV-CP-${pack.id}`, userId: pack.patient_id, paise: Math.round(Number(pack.price_paid) * 100) }, transaction
  );
  return { pack: { ...active, plan_name: pack.plan_name }, already: false };
}

/** A session comes back to the pack (free-window cancellation, therapist or admin cancelled). A refunded pack stays refunded. */
async function returnSession(packId, transaction) {
  if (!packId) return;
  await q(
    `UPDATE care_packs SET sessions_used = GREATEST(0, sessions_used - 1), status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END, updated_at = NOW()
     WHERE id = :id AND status IN ('active', 'exhausted', 'expired') RETURNING id`,
    { id: packId }, transaction
  );
}

module.exports = { activateByOrder, returnSession };
