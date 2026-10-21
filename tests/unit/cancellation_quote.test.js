// Unit tests for cancellationService.quote() at every band, using the configured values (businessRules.cancellation).
// Run: node tests/unit/cancellation_quote.test.js   (no database needed)
Object.assign(process.env, { DB_HOST: "127.0.0.1", DB_PORT: "1", DB_NAME: "x", DB_USER: "x", DB_PASSWORD: "x", JWT_SECRET: "x" });
const assert = require("assert");
const rules = require("../../src/config/businessRules");
const { quote } = require("../../src/services/cancellationService");

const c = rules.cancellation;
const NOW = Date.UTC(2030, 5, 10, 6, 30);                    // 12:00 in India
const pad = (n) => String(n).padStart(2, "0");
// a paid 1,500 INR booking whose slot starts `hours` hours after NOW
function booking(hours, extra = {}) {
  const d = new Date(NOW + hours * 3600000 + 5.5 * 3600000);
  return { total_amount: 1500, payment_status: "Paid", status: "confirmed", created_at: new Date(NOW - 24 * 3600000),
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, ...extra };
}
const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const pct = (p) => (1500 * p) / 100;

t("13 h before -> free, full refund", () => { const q = quote(booking(13), "patient", NOW); assert.deepStrictEqual([q.band, q.chargeInr, q.refundInr], ["free", 0, 1500]); });
t(`exactly ${c.freeHoursBefore} h before -> still free`, () => assert.strictEqual(quote(booking(c.freeHoursBefore), "patient", NOW).band, "free"));
t("11 h before -> partial charge", () => { const q = quote(booking(11), "patient", NOW); assert.deepStrictEqual([q.band, q.chargePct, q.chargeInr, q.refundInr], ["partial", c.partialChargePct, pct(c.partialChargePct), 1500 - pct(c.partialChargePct)]); });
t(`exactly ${c.partialHoursBefore} h before -> partial charge`, () => assert.strictEqual(quote(booking(c.partialHoursBefore), "patient", NOW).band, "partial"));
t("1 h before -> late charge", () => { const q = quote(booking(1), "patient", NOW); assert.deepStrictEqual([q.band, q.chargePct, q.chargeInr, q.refundInr], ["late", c.lateChargePct, pct(c.lateChargePct), 1500 - pct(c.lateChargePct)]); });
t("no-show -> late charge", () => { const q = quote(booking(-1), "patient", NOW, { noShow: true }); assert.deepStrictEqual([q.band, q.chargePct], ["no_show", c.lateChargePct]); });
t("therapist cancels 1 h before -> everything refunded", () => { const q = quote(booking(1), "therapist", NOW); assert.deepStrictEqual([q.band, q.chargeInr, q.refundInr], ["therapist", 0, 1500]); });
t("admin cancels 1 h before -> everything refunded", () => { const q = quote(booking(1), "admin", NOW); assert.deepStrictEqual([q.band, q.chargeInr, q.refundInr], ["admin", 0, 1500]); });
t("booked 5 minutes ago, slot in 1 h -> free (grace)", () => { const q = quote(booking(1, { created_at: new Date(NOW - 5 * 60000) }), "patient", NOW); assert.deepStrictEqual([q.band, q.refundInr], ["grace", 1500]); });
t("booked 11 minutes ago, slot in 1 h -> not grace", () => assert.strictEqual(quote(booking(1, { created_at: new Date(NOW - 11 * 60000) }), "patient", NOW).band, "late"));
t("therapist 31 minutes late, not arrived -> free", () => assert.strictEqual(quote(booking(-0.52), "patient", NOW).band, "therapist_late"));
t("therapist 29 minutes late -> normal late charge", () => assert.strictEqual(quote(booking(-0.48), "patient", NOW).band, "late"));
t("therapist late but already arrived -> normal late charge", () => assert.strictEqual(quote(booking(-0.7, { status: "arrived" }), "patient", NOW).band, "late"));
t("unpaid booking -> nothing to charge or refund", () => { const q = quote(booking(1, { payment_status: "Pending" }), "patient", NOW); assert.deepStrictEqual([q.chargeInr, q.refundInr, q.paid], [0, 0, false]); });
t("amounts are rounded to paise (999.99 at 50%)", () => { const q = quote(booking(11, { total_amount: 999.99 }), "patient", NOW); assert.strictEqual(q.chargeInr + q.refundInr, 999.99); });

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "  <-- " + e.message); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed (configured: free >= ${c.freeHoursBefore} h, ${c.partialChargePct}% to ${c.partialHoursBefore} h, ${c.lateChargePct}% after, ${c.graceMinutesAfterBooking} min grace)`);
process.exit(failed ? 1 : 0);
