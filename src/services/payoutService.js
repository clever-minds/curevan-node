// Therapist payout engine (handoff pack P18): lines per session, tier fee, GST on the fee, TDS over the yearly threshold,
// weekly batches, approval and payment (Phase 1: bank transfer + UTR).
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const rules = require("../config/businessRules");
const notificationStore = require("./notificationStore");
const notifications = require("./notifications");

const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");
const ymdOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const IST_MS = 5.5 * 3600 * 1000;

class PayoutError extends Error {
  constructor(httpStatus, message) { super(message); this.httpStatus = httpStatus; }
}

/** Monday of the week that holds `ymd` (YYYY-MM-DD), as YYYY-MM-DD. */
function mondayOf(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return ymdOf(d);
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymdOf(d); };

/** Financial year (April to March) of a date: { start, end } as YYYY-MM-DD. */
function financialYear(ymd) {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7));
  const startYear = m >= 4 ? y : y - 1;
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

/**
 * The money of one line.
 *   fee      = gross x tier fee %       (standard 0, premium 10 - businessRules.payout)
 *   gst      = fee x gst %
 *   tds      = tds % of the part of this gross that takes the year-to-date gross above the yearly threshold
 *   pgCharge = gross x pg % (only if the owner sets one)
 *   net      = gross - fee - gst - tds - pgCharge
 */
function computeLine({ gross, plan, ytdGrossBefore }) {
  const p = rules.payout;
  const feePct = plan === "premium" ? p.premiumFeePct : p.standardFeePct;
  const fee = r2((gross * feePct) / 100);
  const gst = r2((fee * p.gstOnFeePct) / 100);
  const above = Math.max(0, ytdGrossBefore + gross - Math.max(ytdGrossBefore, p.tdsAnnualThresholdInr));
  const tds = r2((above * p.tdsPct) / 100);
  const pgCharge = p.pgChargePct > 0 ? r2((gross * p.pgChargePct) / 100) : 0;
  return { feePct, fee, gst, tds, pgCharge, net: r2(gross - fee - gst - tds - pgCharge) };
}

async function ytdGross(therapistId, ymd, transaction) {
  const fy = financialYear(ymd);
  const [row] = await q(`SELECT COALESCE(SUM(gross_amount), 0) AS g FROM payout_items WHERE therapist_id = :t AND week_start >= :a::date AND week_start <= :b::date`, { t: therapistId, a: fy.start, b: fy.end }, transaction);
  return Number(row.g);
}

async function insertItem({ type, sourceId, therapistId, patientId, serviceTypeId, gross, weekStart, cancellationShare = 0, planOverride, transaction }) {
  const [existing] = await q(`SELECT id FROM payout_items WHERE type = :type AND source_id = :sourceId`, { type, sourceId }, transaction);
  if (existing) return null;
  const [tp] = await q(`SELECT membership_plan FROM therapist_profiles WHERE user_id = :id`, { id: therapistId }, transaction);
  const plan = planOverride || (tp && tp.membership_plan === "premium" ? "premium" : "standard");
  const line = computeLine({ gross, plan, ytdGrossBefore: await ytdGross(therapistId, weekStart, transaction) });
  const rows = await q(
    `INSERT INTO payout_items (type, source_id, therapist_id, patient_id, service_type_id, gross_amount, platform_fee_pct, platform_fee_amount, gst_on_platform_fee,
        pre_tds_payable, tds_deducted, pg_charge, net_amount, currency, state, week_start, membership_plan_snapshot, cancellation_share, created_at)
     VALUES (:type, :sourceId, :therapistId, :patientId, :serviceTypeId, :gross, :feePct, :fee, :gst, :preTds, :tds, :pg, :net, 'INR', 'Pending', :weekStart, :plan, :share, NOW())
     ON CONFLICT DO NOTHING RETURNING id`,
    { type, sourceId, therapistId, patientId: patientId ?? null, serviceTypeId: serviceTypeId != null ? String(serviceTypeId) : null, gross, feePct: line.feePct, fee: line.fee, gst: line.gst,
      preTds: r2(gross - line.fee - line.gst - line.pgCharge), tds: line.tds, pg: line.pgCharge, net: line.net, weekStart, plan, share: cancellationShare },
    transaction
  );
  return rows.length ? { id: rows[0].id, ...line, plan, gross } : null;      // null = the line already existed
}

/**
 * A booking becomes payable when: the payment was verified (or recorded by an admin), the start code was verified, and the PCR is locked.
 * Called when an admin locks the PCR. Idempotent.
 */
async function createItemForAppointment(appointmentId, { transaction } = {}) {
  const [a] = await q(
    `SELECT a.*, to_char(a.date, 'YYYY-MM-DD') AS ymd, p.status AS pcr_status FROM appointments a LEFT JOIN pcr p ON p.appointment_id = a.id WHERE a.id = :id`,
    { id: appointmentId }, transaction
  );
  if (!a) throw new PayoutError(404, "Booking not found");
  if (!a.therapist_id) throw new PayoutError(409, "This booking has no therapist");
  const verifiedPayment = a.payment_status === "Paid" && (a.razorpay_payment_id || /^manual_/.test(String(a.payment_method || "")));
  if (!verifiedPayment) throw new PayoutError(409, "The payment for this booking is not confirmed");
  if (!a.otp_verified_at) throw new PayoutError(409, "The session start code was never verified for this booking");
  if (String(a.pcr_status || "").toLowerCase() !== "locked") throw new PayoutError(409, "The PCR is not locked yet");
  const gross = Number(a.service_amount ?? a.total_amount ?? 0);
  if (!(gross > 0)) throw new PayoutError(409, "This booking has no amount to pay out");
  const item = await insertItem({ type: "service", sourceId: a.id, therapistId: a.therapist_id, patientId: a.patient_id, serviceTypeId: a.service_type_id, gross, weekStart: mondayOf(a.ymd), transaction });
  return item ? { created: true, item } : { created: false };
}

/** The therapist's part of a cancellation charge (P14) becomes a payout line of its own. */
async function createItemForCancellation(appointmentId, { transaction } = {}) {
  const [a] = await q(`SELECT a.id, a.therapist_id, a.patient_id, a.service_type_id, a.cancellation_charge, a.cancellation_therapist_share, to_char(COALESCE(a.cancelled_at, NOW()) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS ymd FROM appointments a WHERE a.id = :id`, { id: appointmentId }, transaction);
  if (!a || !a.therapist_id || !(Number(a.cancellation_charge) > 0)) return { created: false };
  const item = await insertItem({ type: "cancellation", sourceId: a.id, therapistId: a.therapist_id, patientId: a.patient_id, serviceTypeId: a.service_type_id, gross: Number(a.cancellation_charge), weekStart: mondayOf(a.ymd), cancellationShare: Number(a.cancellation_therapist_share || 0), transaction });
  return item ? { created: true, item } : { created: false };
}

/** An eligible product commission (P20) becomes a payout line: no platform fee (the fee tier is for sessions), TDS rules as for any other line. */
async function createItemForCommission(commission, { transaction } = {}) {
  const todayIst = ymdOf(new Date(Date.now() + IST_MS));
  const item = await insertItem({ type: "affiliate", sourceId: commission.id, therapistId: commission.therapist_id, gross: Number(commission.commission_amount), weekStart: mondayOf(todayIst), planOverride: "standard", transaction });
  return item ? { created: true, item } : { created: false };
}

const hasBankDetails = (tp) => !!(tp && tp.bank_account_number && String(tp.bank_account_number).trim() && tp.bank_ifsc_code && String(tp.bank_ifsc_code).trim());

async function recompute(batchId, transaction) {
  const [t] = await q(
    `SELECT COALESCE(SUM(gross_amount),0) AS gross, COALESCE(SUM(platform_fee_amount),0) AS fee, COALESCE(SUM(gst_on_platform_fee),0) AS gst,
            COALESCE(SUM(tds_deducted),0) AS tds, COALESCE(SUM(net_amount),0) AS net FROM payout_items WHERE batch_id = :id`, { id: batchId }, transaction);
  await q(`UPDATE payout_batches SET gross = :gross, platform_fee = :fee, gst_on_fee = :gst, tds = :tds, net = :net + adjustments WHERE id = :id`,
    { id: batchId, gross: r2(t.gross), fee: r2(t.fee), gst: r2(t.gst), tds: r2(t.tds), net: r2(t.net) }, transaction);
}

/**
 * Sunday 23:59 IST: group each therapist's unbatched lines into a batch for the week they belong to.
 * Missing bank details put the batch 'on_hold'. A week whose batch is already approved/paid pushes late lines to the next week.
 */
async function runWeeklyBatches(now = Date.now()) {
  const todayIst = ymdOf(new Date(now + IST_MS));
  const thisMonday = mondayOf(todayIst);
  const groups = await q(
    `SELECT therapist_id, week_start::text AS week_start FROM payout_items WHERE batch_id IS NULL AND state = 'Pending' AND week_start <= :sunday::date GROUP BY therapist_id, week_start ORDER BY week_start`,
    { sunday: addDays(thisMonday, 6) }
  );
  const result = { created: 0, attached: 0, onHold: 0, moved: 0 };
  for (const g of groups) {
    const t = await sequelize.transaction();
    try {
      let [batch] = await q(`SELECT * FROM payout_batches WHERE therapist_id = :t AND week_start = :w::date FOR UPDATE`, { t: g.therapist_id, w: g.week_start }, t);
      if (batch && !["scheduled", "on_hold"].includes(batch.status)) {
        await q(`UPDATE payout_items SET week_start = :next::date WHERE therapist_id = :t AND week_start = :w::date AND batch_id IS NULL AND state = 'Pending'`, { next: addDays(g.week_start, 7), t: g.therapist_id, w: g.week_start }, t);
        await t.commit();
        result.moved += 1;
        continue;
      }
      const [tp] = await q(`SELECT bank_account_number, bank_ifsc_code FROM therapist_profiles WHERE user_id = :id`, { id: g.therapist_id }, t);
      const ok = hasBankDetails(tp);
      if (!batch) {
        [batch] = await q(`INSERT INTO payout_batches (therapist_id, week_start, week_end, status, hold_reason) VALUES (:t, :w::date, :e::date, :status, :reason) RETURNING *`,
          { t: g.therapist_id, w: g.week_start, e: addDays(g.week_start, 6), status: ok ? "scheduled" : "on_hold", reason: ok ? null : "Bank details are missing" }, t);
        result.created += 1;
        if (!ok) result.onHold += 1;
      } else result.attached += 1;
      await q(`UPDATE payout_items SET batch_id = :b, state = :state WHERE therapist_id = :t AND week_start = :w::date AND batch_id IS NULL AND state = 'Pending'`, { b: batch.id, state: batch.status === "on_hold" || !ok ? "onHold" : "Scheduled", t: g.therapist_id, w: g.week_start }, t);
      await q(`UPDATE affiliate_commissions SET payout_batch_id = :b, updated_at = NOW() WHERE id IN (SELECT source_id FROM payout_items WHERE batch_id = :b AND type = 'affiliate')`, { b: batch.id }, t);
      await recompute(batch.id, t);
      await t.commit();
    } catch (err) { await t.rollback(); throw err; }
  }
  return result;
}

// ---- admin actions on a batch -------------------------------------------------------------------------
async function loadBatch(id, transaction) {
  const [b] = await q(`SELECT * FROM payout_batches WHERE id = :id FOR UPDATE`, { id }, transaction);
  if (!b) throw new PayoutError(404, "Batch not found");
  return b;
}

async function approve(id, adminId) {
  const t = await sequelize.transaction();
  try {
    const b = await loadBatch(id, t);
    if (b.status !== "scheduled") throw new PayoutError(409, b.status === "on_hold" ? "This batch is on hold. Release it first." : `A ${b.status} batch cannot be approved`);
    await q(`UPDATE payout_batches SET status = 'approved', approved_by = :admin, approved_at = NOW() WHERE id = :id`, { id, admin: adminId }, t);
    await t.commit();
    return { id, status: "approved" };
  } catch (err) { await t.rollback(); throw err; }
}

async function hold(id, reason) {
  if (String(reason || "").trim().length < 3) throw new PayoutError(400, "Please give a reason for the hold");
  const t = await sequelize.transaction();
  try {
    const b = await loadBatch(id, t);
    if (b.status === "paid") throw new PayoutError(409, "A paid batch cannot be put on hold");
    await q(`UPDATE payout_batches SET status = 'on_hold', hold_reason = :reason, approved_by = NULL, approved_at = NULL WHERE id = :id`, { id, reason: String(reason).trim() }, t);
    await q(`UPDATE payout_items SET state = 'onHold' WHERE batch_id = :id`, { id }, t);
    await t.commit();
    return { id, status: "on_hold" };
  } catch (err) { await t.rollback(); throw err; }
}

async function release(id) {
  const t = await sequelize.transaction();
  try {
    const b = await loadBatch(id, t);
    if (b.status !== "on_hold") throw new PayoutError(409, "Only a batch on hold can be released");
    const [tp] = await q(`SELECT bank_account_number, bank_ifsc_code FROM therapist_profiles WHERE user_id = :id`, { id: b.therapist_id }, t);
    if (!hasBankDetails(tp)) throw new PayoutError(409, "The therapist's bank details are still missing");
    await q(`UPDATE payout_batches SET status = 'scheduled', hold_reason = NULL WHERE id = :id`, { id }, t);
    await q(`UPDATE payout_items SET state = 'Scheduled' WHERE batch_id = :id`, { id }, t);
    await t.commit();
    return { id, status: "scheduled" };
  } catch (err) { await t.rollback(); throw err; }
}

async function markPaid(id, { utr, paidAt }) {
  const ref = String(utr || "").trim();
  if (!/^[A-Za-z0-9]{6,30}$/.test(ref)) throw new PayoutError(400, "Enter the bank's UTR reference (6 to 30 letters or digits)");
  const when = paidAt ? new Date(paidAt) : new Date();
  if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 86400000) throw new PayoutError(400, "The payment date is not valid");
  const t = await sequelize.transaction();
  let batch;
  try {
    batch = await loadBatch(id, t);
    if (batch.status !== "approved") throw new PayoutError(409, "Only an approved batch can be marked paid");
    const [dup] = await q(`SELECT 1 FROM payout_batches WHERE utr = :utr AND id <> :id`, { utr: ref, id }, t);
    if (dup) throw new PayoutError(409, "That UTR was already used for another batch");
    await q(`UPDATE payout_batches SET status = 'paid', utr = :utr, paid_at = :at WHERE id = :id`, { id, utr: ref, at: when.toISOString() }, t);
    await q(`UPDATE payout_items SET state = 'Paid' WHERE batch_id = :id`, { id }, t);
    await q(`UPDATE affiliate_commissions SET status = 'paid', updated_at = NOW() WHERE id IN (SELECT source_id FROM payout_items WHERE batch_id = :id AND type = 'affiliate')`, { id }, t);
    await t.commit();
  } catch (err) { await t.rollback(); throw err; }
  await notificationStore.notify(batch.therapist_id, { type: "payout_paid", title: "Your payout was sent", message: `Your payout of INR ${batch.net} for the week of ${String(batch.week_start).slice(0, 10)} was sent. Bank reference: ${ref}.`, link: "/dashboard/earnings" }).catch(() => {});
  await notifications.notify("payout_paid", {
    therapistId: batch.therapist_id,
    amount: batch.net,
    week: String(batch.week_start).slice(0, 10),
    utr: ref,
    link: "https://curevan.com/dashboard/earnings",
  }).catch(() => {});
  return { id, status: "paid" };
}

module.exports = { PayoutError, computeLine, financialYear, mondayOf, createItemForAppointment, createItemForCancellation, createItemForCommission, runWeeklyBatches, approve, hold, release, markPaid, hasBankDetails };
