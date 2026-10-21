// Payout batches API (handoff pack P18).
const { QueryTypes } = require("sequelize");
const PDFDocument = require("pdfkit");
const { sequelize } = require("../../config/db");
const access = require("../../utils/access");
const payoutService = require("../../services/payoutService");

const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const isAdmin = (user) => access.isClinicalAdmin(user);
const fail = (res, err, what) => {
  if (err instanceof payoutService.PayoutError) return res.status(err.httpStatus).json({ success: false, error: err.message });
  console.error(`${what} error:`, err.message);
  return res.status(500).json({ success: false, error: `Could not ${what}` });
};

// CSV cells that start with = + - @ would run as formulas in a spreadsheet
const cell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// GET /api/payout-batches/list?week=YYYY-MM-DD&status=&therapistId=   admins: all, therapist: own
exports.list = async (req, res) => {
  try {
    const admin = isAdmin(req.user);
    const rows = await q(
      `SELECT b.id, b.therapist_id AS "therapistId", u.name AS "therapistName", to_char(b.week_start, 'YYYY-MM-DD') AS "weekStart", to_char(b.week_end, 'YYYY-MM-DD') AS "weekEnd",
              b.gross, b.platform_fee AS "platformFee", b.gst_on_fee AS "gstOnFee", b.tds, b.adjustments, b.net, b.status, b.approved_by AS "approvedBy", b.approved_at AS "approvedAt",
              b.utr, b.paid_at AS "paidAt", b.hold_reason AS "holdReason", (SELECT COUNT(*)::int FROM payout_items i WHERE i.batch_id = b.id) AS "itemCount"
       FROM payout_batches b JOIN users u ON u.id = b.therapist_id
       WHERE (:me::int IS NULL OR b.therapist_id = :me::int) AND (:week::date IS NULL OR b.week_start = :week::date) AND (:status::text IS NULL OR b.status = :status::text)
         AND (:therapistId::int IS NULL OR b.therapist_id = :therapistId::int)
       ORDER BY b.week_start DESC, b.id DESC`,
      { me: admin ? null : req.user.id, week: req.query.week || null, status: req.query.status || null, therapistId: admin ? req.query.therapistId || null : null }
    );
    return res.json({ success: true, data: rows.map((b) => ({ ...b, gross: Number(b.gross), platformFee: Number(b.platformFee), gstOnFee: Number(b.gstOnFee), tds: Number(b.tds), adjustments: Number(b.adjustments), net: Number(b.net) })) });
  } catch (err) { return fail(res, err, "load payouts"); }
};

async function batchFor(req, res) {
  const [b] = await q(`SELECT b.*, u.name AS therapist_name, tp.pan_number, tp.bank_account_number, tp.bank_ifsc_code, tp.registration_no FROM payout_batches b JOIN users u ON u.id = b.therapist_id LEFT JOIN therapist_profiles tp ON tp.user_id = b.therapist_id WHERE b.id = :id`, { id: req.params.id });
  if (!b) { res.status(404).json({ success: false, error: "Batch not found" }); return null; }
  if (!isAdmin(req.user) && !access.same(b.therapist_id, req.user.id)) { res.status(403).json({ success: false, error: "Forbidden" }); return null; }
  return b;
}

// GET /api/payout-batches/:id - the batch with its lines
exports.get = async (req, res) => {
  const b = await batchFor(req, res);
  if (!b) return;
  const items = await q(`SELECT id, type, source_id AS "sourceId", gross_amount AS gross, platform_fee_pct AS "feePct", platform_fee_amount AS fee, gst_on_platform_fee AS gst, tds_deducted AS tds, pg_charge AS "pgCharge", net_amount AS net, state, to_char(week_start, 'YYYY-MM-DD') AS "weekStart" FROM payout_items WHERE batch_id = :id ORDER BY id`, { id: b.id });
  const { bank_account_number, bank_ifsc_code, pan_number, ...safe } = b;      // bank details only leave through the CSV export
  return res.json({ success: true, data: { ...safe, items } });
};

exports.approve = async (req, res) => { try { return res.json({ success: true, data: await payoutService.approve(Number(req.params.id), req.user.id) }); } catch (e) { return fail(res, e, "approve the batch"); } };
exports.hold = async (req, res) => { try { return res.json({ success: true, data: await payoutService.hold(Number(req.params.id), (req.body || {}).reason) }); } catch (e) { return fail(res, e, "hold the batch"); } };
exports.release = async (req, res) => { try { return res.json({ success: true, data: await payoutService.release(Number(req.params.id)) }); } catch (e) { return fail(res, e, "release the batch"); } };
exports.markPaid = async (req, res) => { try { return res.json({ success: true, data: await payoutService.markPaid(Number(req.params.id), req.body || {}) }); } catch (e) { return fail(res, e, "mark the batch paid"); } };

// GET /api/payout-batches/export.csv?week=YYYY-MM-DD - what the bank upload needs, for approved batches
exports.exportCsv = async (req, res) => {
  try {
    const week = req.query.week;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week || "")) return res.status(400).json({ success: false, error: "week=YYYY-MM-DD (the Monday of the week) is required" });
    const rows = await q(
      `SELECT b.id, u.name, tp.bank_account_number, tp.bank_ifsc_code, b.net FROM payout_batches b JOIN users u ON u.id = b.therapist_id LEFT JOIN therapist_profiles tp ON tp.user_id = b.therapist_id
       WHERE b.week_start = :week::date AND b.status = 'approved' ORDER BY b.id`, { week });
    const lines = [["Beneficiary name", "Account number", "IFSC", "Amount (INR)", "Batch id"].join(",")];
    for (const r of rows) lines.push([r.name, r.bank_account_number, r.bank_ifsc_code, Number(r.net).toFixed(2), r.id].map(cell).join(","));
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="curevan-payouts-${week}.csv"`, "Cache-Control": "private, no-store" });
    return res.send(lines.join("\r\n") + "\r\n");
  } catch (err) { return fail(res, err, "export the payouts"); }
};

// GET /api/payout-batches/:id/statement.pdf - the therapist (own) or an admin
exports.statementPdf = async (req, res) => {
  try {
    const b = await batchFor(req, res);
    if (!b) return;
    const items = await q(`SELECT i.type, i.source_id, i.gross_amount, i.platform_fee_amount, i.gst_on_platform_fee, i.tds_deducted, i.pg_charge, i.net_amount, to_char(a.date, 'DD Mon YYYY') AS day FROM payout_items i LEFT JOIN appointments a ON a.id = i.source_id AND i.type IN ('service', 'cancellation') WHERE i.batch_id = :id ORDER BY i.id`, { id: b.id });
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="curevan-payout-statement-${b.id}.pdf"`, "Cache-Control": "private, no-store" });
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    const money = (n) => `INR ${Number(n || 0).toFixed(2)}`;
    doc.fontSize(20).fillColor("#4c1d95").text("Curevan");
    doc.moveDown(0.3).fontSize(15).fillColor("#111").text("Payout statement");
    doc.fontSize(10).fillColor("#555").text(`Therapist: ${b.therapist_name}${b.registration_no ? `   Registration no.: ${b.registration_no}` : ""}`)
      .text(`Week: ${String(b.week_start).slice(0, 10)} to ${String(b.week_end).slice(0, 10)}      Status: ${b.status}${b.utr ? `      Bank reference (UTR): ${b.utr}` : ""}`);
    doc.moveDown().fontSize(9).fillColor("#111");
    for (const i of items) {
      const label = i.type === "cancellation" ? "Cancellation charge" : i.type === "affiliate" ? "Product commission" : "Home session";
      doc.text(`${i.day || ""}  ${label} #${i.source_id}:  gross ${money(i.gross_amount)}  fee ${money(i.platform_fee_amount)}  GST on fee ${money(i.gst_on_platform_fee)}  TDS ${money(i.tds_deducted)}  net ${money(i.net_amount)}`, { lineGap: 3 });
    }
    if (!items.length) doc.text("No lines in this batch.");
    doc.moveDown().fontSize(11).text(`Gross ${money(b.gross)}   Platform fee ${money(b.platform_fee)}   GST on fee ${money(b.gst_on_fee)}   TDS ${money(b.tds)}   Adjustments ${money(b.adjustments)}`);
    doc.fontSize(13).fillColor("#4c1d95").text(`Net payable: ${money(b.net)}`);
    doc.moveDown(2).fontSize(8).fillColor("#777").text("This statement lists what Curevan pays you for the week. It is not a tax invoice.", { align: "center" });
    doc.end();
  } catch (err) { if (!res.headersSent) return fail(res, err, "prepare the statement"); res.end(); }
};
