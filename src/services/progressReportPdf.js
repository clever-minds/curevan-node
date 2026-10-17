// "Curevan Progress Report" and "Curevan Discharge Summary" PDFs (handoff pack P16). No prices anywhere.
const fs = require("fs");
const PDFDocument = require("pdfkit");
const storage = require("../utils/privateStorage");

const show = (v) => (v === null || v === undefined ? "-" : String(v));
const dateText = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "-");
const label = (m) => `${m.name}${m.side ? ` (${m.side})` : ""}${m.item ? ` - ${m.item}` : ""}`;

/** progress = planProgress() result. Returns the relative path of the written file. */
async function generateProgressPdf({ reportId, reportType, progress, summary, patientFirstName, therapist }) {
  const rel = `reports/${reportType}-${reportId}.pdf`;
  const file = storage.prepare(rel);
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const done = new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    out.on("finish", resolve);
    out.on("error", reject);
    doc.pipe(out);
  });

  const title = reportType === "discharge" ? "Curevan Discharge Summary" : "Curevan Progress Report";
  const { plan } = progress;
  doc.fontSize(20).fillColor("#4c1d95").text("Curevan");
  doc.moveDown(0.3).fontSize(16).fillColor("#111").text(title);
  doc.fontSize(10).fillColor("#555")
    .text(`Patient: ${patientFirstName}      Report date: ${dateText(new Date())}`)
    .text(`Therapist: ${therapist?.name || "-"}${therapist?.registration_no ? `   Registration no.: ${therapist.registration_no}` : ""}`)
    .text(`Plan: ${show(plan.condition)}${plan.affected_side && plan.affected_side !== "na" ? `, ${plan.affected_side} side` : ""}      Sessions: ${progress.sessionsDone} of ${show(plan.planned_sessions)}`);

  doc.moveDown(0.8).fontSize(12).fillColor("#4c1d95").text("Measures: baseline, now and target");
  doc.fontSize(9).fillColor("#111");
  for (const m of progress.measures) {
    doc.text(`${label(m)}: baseline ${show(m.baseline)}  ->  now ${show(m.latest)}  (target ${show(m.target)})  ${m.percentTowardTarget !== null ? `${m.percentTowardTarget}% of the way` : ""}  [${m.status}]`, { lineGap: 2 });
  }
  if (!progress.measures.length) doc.text("No measures recorded yet.");

  doc.moveDown(0.8).fontSize(12).fillColor("#4c1d95").text("Goals");
  doc.fontSize(9).fillColor("#111");
  for (const g of progress.goals) doc.text(`${g.description} - ${String(g.status).replace(/_/g, " ")}`, { lineGap: 2 });
  if (!progress.goals.length) doc.text("No goals set.");

  doc.moveDown(0.8).fontSize(12).fillColor("#4c1d95").text(reportType === "discharge" ? "Discharge summary and advice" : "Progress summary and next plan");
  doc.fontSize(10).fillColor("#111").text(String(summary || "-").replace(/<[^>]*>/g, ""), { lineGap: 2 });
  if (reportType === "discharge" && plan.discharge_reason) doc.moveDown(0.5).fontSize(10).text(`Reason for discharge: ${plan.discharge_reason}`);

  doc.moveDown(2).fontSize(8).fillColor("#777").text("For clinical communication; not a medical certificate.", { align: "center" });
  doc.end();
  await done;
  return rel;
}

module.exports = { generateProgressPdf };
