// npm test: prepare the TEST database, run the unit tests, both flows of the acceptance suite and the go-live checklist check.
// Needs a PostgreSQL whose database name contains "test" (see tests/integration/README.md); it is wiped on every run.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dbName = process.env.DB_NAME || "curevan_test";
if (!/test/i.test(dbName)) { console.error(`Refusing to run: DB_NAME "${dbName}" does not look like a test database.`); process.exit(2); }

const log = path.join(os.tmpdir(), "curevan-acceptance.log");
const steps = [
  ["unit tests", ["tests/unit/cancellation_quote.test.js"]],
  ["test database", ["tests/integration/setup_db.js"]],
  ["acceptance, pay-first flow (the handoff pack)", ["tests/integration/acceptance.test.js"], log],
  ["go-live checklist mapping", ["tests/check_checklist.js", log]],
  ["test database", ["tests/integration/setup_db.js"]],
  ["acceptance, approval-first flow", ["tests/integration/acceptance.test.js", "--approval"]],
];

for (const [name, args, tee] of steps) {
  console.log(`\n=== ${name}`);
  const r = spawnSync(process.execPath, args, { cwd: path.resolve(__dirname, ".."), env: process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || "") + (r.stderr || "");
  if (tee) fs.writeFileSync(tee, out);
  const lines = out.split(/\r?\n/);
  const summary = lines.filter((l) => /passed|checklist|^FAIL |^PASS #|CRASH|Done|ready/i.test(l) && !l.startsWith("PASS ")).slice(-30);
  console.log((r.status === 0 ? summary.slice(-3) : lines.filter((l) => l.startsWith("FAIL ") || /CRASH|Error/.test(l)).concat(summary).slice(-40)).join("\n"));
  if (r.status !== 0) { console.error(`\nFAILED: ${name}`); process.exit(r.status || 1); }
}
console.log("\nAll test steps passed.");
