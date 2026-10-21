// "Curevan Patient Care Summary" PDF for a locked PCR (handoff pack P15).
const fs = require("fs");
const PDFDocument = require("pdfkit");
const storage = require("../utils/privateStorage");

const plain = (html) => String(html ?? "").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
const dateText = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "-");

/** Writes storage/private/pcr/<id>.pdf and returns the relative path. */
async function generatePcrPdf({ pcr, appointment, therapist }) {
  const rel = `pcr/${pcr.id}.pdf`;
  const file = storage.prepare(rel);
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const done = new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    out.on("finish", resolve);
    out.on("error", reject);
    doc.pipe(out);
  });

  const firstName = String(appointment.patient_name || "Patient").trim().split(/\s+/)[0];
  const section = (title, body) => {
    doc.moveDown(0.8).fontSize(12).fillColor("#4c1d95").text(title);
    doc.fontSize(10).fillColor("#111").text(plain(body) || "-", { lineGap: 2 });
  };

  doc.fontSize(20).fillColor("#4c1d95").text("Curevan", { continued: true }).fontSize(11).fillColor("#555").text("   home therapy, anywhere");
  doc.moveDown(0.5).fontSize(16).fillColor("#111").text("Patient Care Summary");
  doc.fontSize(10).fillColor("#555")
    .text(`Patient: ${firstName}      Session date: ${dateText(appointment.date)}`)
    .text(`Therapist: ${therapist?.name || appointment.therapist_name || "-"}${therapist?.registration_no ? `   Registration no.: ${therapist.registration_no}` : ""}`);

  section("Assessment", pcr.assessment);
  section("Treatment provided", pcr.treatment_provided);
  section("Home exercise programme", pcr.hep);
  section("Scores", `Functional score: ${pcr.functional_score ?? "-"} / 10${pcr.functional_measure ? ` (${pcr.functional_measure})` : ""}\nPain (VAS): ${pcr.pain_vas ?? "-"} / 10`);
  section("Next steps", pcr.plan_of_care);

  doc.moveDown(2).fontSize(8).fillColor("#777").text("This summary is not a prescription for medicines.", { align: "center" });
  doc.end();
  await done;
  return rel;
}

module.exports = { generatePcrPdf };
