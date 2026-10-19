// Go-live acceptance checklist (IT Action Plan v3) -> automated tests.
// Reads the output of `node tests/integration/acceptance.test.js` and fails unless every checklist item has all its mapped checks PASSING
// (and none of them FAILING). Items that live in the website are mapped to its checks in docs/TESTING.md.
//   node tests/check_checklist.js <acceptance-output.log>
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
if (!file) { console.error("usage: node tests/check_checklist.js <acceptance-output.log>"); process.exit(2); }
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
const pass = lines.filter((l) => l.startsWith("PASS "));
const fail = lines.filter((l) => l.startsWith("FAIL "));
const items = JSON.parse(fs.readFileSync(path.join(__dirname, "checklist.json"), "utf8"));

let bad = 0;
for (const it of items) {
  if (!it.all) { console.log(`--   #${String(it.id).padStart(2)} ${it.title}: ${it.frontend}`); continue; }
  const missing = it.all.filter((p) => !pass.some((l) => new RegExp(p).test(l)));
  const failing = it.all.filter((p) => fail.some((l) => new RegExp(p).test(l)));
  const ok = !missing.length && !failing.length;
  if (!ok) bad += 1;
  console.log(`${ok ? "PASS" : "FAIL"} #${String(it.id).padStart(2)} ${it.title} (${it.all.length} check${it.all.length === 1 ? "" : "s"})${missing.length ? "  missing: " + missing.join(" | ") : ""}${failing.length ? "  failing: " + failing.join(" | ") : ""}`);
}
console.log(bad ? `\n${bad} checklist item(s) not covered by a passing test` : `\nEvery checklist item that the API covers has passing tests (${items.filter((i) => i.all).length} of ${items.length}; the rest are in the website's checks)`);
process.exit(bad ? 1 : 0);
