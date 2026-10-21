// Consent and guardian rules at booking time, GST treatment of a service invoice (handoff pack P25).
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");
const rules = require("../config/businessRules");

class ComplianceError extends Error {
  constructor(httpStatus, message) { super(message); this.httpStatus = httpStatus; }
}

const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Age in whole years on `now` from YYYY-MM-DD / DD-MM-YYYY / DD/MM/YYYY / an ISO or Date value; null when it cannot be read. */
function ageFrom(dob, now = new Date()) {
  if (!dob) return null;
  let d;
  if (dob instanceof Date) d = dob;
  else {
    const s = String(dob).trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
    if (iso) d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    else if (dmy) d = new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));
    else d = new Date(s);
  }
  if (Number.isNaN(d.getTime())) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

const logConsent = (userId, type, granted, ip, userAgent, transaction) => q(
  `INSERT INTO consent_logs (user_id, consent_type, policy_version, granted, ip, user_agent) VALUES (:userId, :type, :version, :granted, :ip, :ua) RETURNING id`,
  { userId, type, version: rules.consent.policyVersion, granted, ip: ip || null, ua: String(userAgent || "").slice(0, 300) || null }, transaction
);

/**
 * Called before a new booking is saved.
 *  - first booking: the medical consent and the privacy notice must be accepted; they are stored with the policy version
 *  - patient younger than 18 (from the date of birth in the booking form): guardian name, relation, phone and the guardian's consent are required
 * Throws ComplianceError(400) when something is missing.
 */
async function enforceBookingConsents({ userId, dob, consents = {}, guardian = null, ip, userAgent, transaction }) {
  const given = await q(
    `SELECT consent_type FROM consent_logs WHERE user_id = :userId AND consent_type IN ('medical', 'privacy') AND granted = true GROUP BY consent_type`,
    { userId }, transaction
  );
  const have = new Set(given.map((x) => x.consent_type));
  for (const [key, label] of [["medical", "the medical consent"], ["privacy", "the privacy notice"]]) {
    if (have.has(key)) continue;
    if (consents[key] !== true) throw new ComplianceError(400, `Please accept ${label} to continue with your first booking.`);
    await logConsent(userId, key, true, ip, userAgent, transaction);
  }

  const age = ageFrom(dob);
  if (age !== null && age < rules.consent.adultAge) {
    const g = guardian || {};
    const phone = String(g.phone || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!String(g.name || "").trim() || !String(g.relation || "").trim() || phone.length !== 10) {
      throw new ComplianceError(400, "The patient is under 18: please give the name, relation and 10-digit mobile number of a parent or guardian.");
    }
    if (g.consent !== true) throw new ComplianceError(400, "The patient is under 18: a parent or guardian must consent to the booking.");
    const [log] = await logConsent(userId, "medical", true, ip, userAgent, transaction);
    await q(
      `INSERT INTO patient_guardians (patient_user_id, guardian_name, relation, phone, consent_log_id) VALUES (:userId, :name, :relation, :phone, :log)`,
      { userId, name: String(g.name).trim().slice(0, 120), relation: String(g.relation).trim().slice(0, 40), phone, log: log ? log.id : null }, transaction
    );
  }
  return { age };
}

/**
 * GST treatment of a paid service. exempt_clinical: no GST. taxable_18: the price paid includes 18% GST, split CGST + SGST when the place of
 * supply is the supplier's state, otherwise IGST (same rule as the shop order helper).
 */
function serviceTax({ taxCategory, totalInr, placeOfSupplyState, supplierState = rules.legalEntity.state }) {
  const total = r2(totalInr);
  if (taxCategory !== "taxable_18") return { taxCategory: "exempt_clinical", gst: 0, cgst: 0, sgst: 0, igst: 0, taxable: total, total };
  const taxable = r2(total / 1.18);
  const gst = r2(total - taxable);
  const sameState = !placeOfSupplyState || String(placeOfSupplyState).trim().toLowerCase() === String(supplierState).trim().toLowerCase();
  if (sameState) { const half = r2(gst / 2); return { taxCategory, gst, cgst: half, sgst: r2(gst - half), igst: 0, taxable, total }; }
  return { taxCategory, gst, cgst: 0, sgst: 0, igst: gst, taxable, total };
}

module.exports = { ComplianceError, ageFrom, enforceBookingConsents, serviceTax };
