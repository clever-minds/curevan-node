/**
 * Lists every API route with its guard, read from src/app.js (mount paths) and src/routes/*.js (route lines).
 *   node scripts/route_permissions.js            print the markdown rows
 *   node scripts/route_permissions.js --check    exit 1 if docs/ROUTE_PERMISSIONS.md misses a route or shows a different guard
 * A static scan (nothing is started): `router.use(authMiddleware)` / `router.use(requireRole(...))` apply to the routes below them.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");

const mounts = [...app.matchAll(/^\s*app\.use\(\s*['"]([^'"]+)['"]\s*,\s*require\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)\s*\)/gm)].map((m) => ({ base: m[1], file: m[2] }));

const rolesOf = (text) => {
  const m = /requireRole\(([^)]*)\)/.exec(text);
  return m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : null;
};

const rows = [];
for (const { base, file } of mounts) {
  const full = path.join(root, "src/routes", file.endsWith(".js") ? file : `${file}.js`);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, "utf8").replace(/\/\/[^\n]*/g, "");
  // the name the file gives the login middleware (authMiddleware, auth, ...)
  const authNames = [...new Set(["authMiddleware", ...[...src.matchAll(/const\s+(\w+)\s*=\s*require\([^)]*authMiddleware[^)]*\)/g)].map((x) => x[1])])];
  const authRe = new RegExp("\\b(" + authNames.join("|") + ")\\b|optionalAuth|requireRole");
  let globalAuth = false;
  let globalRoles = null;
  const re = /router\.(use|get|post|put|patch|delete)\(\s*([\s\S]*?)\)\s*;/g;
  let m;
  while ((m = re.exec(src))) {
    const [, method, args] = m;
    if (method === "use") {
      if (authRe.test(args) && !/^\s*requireRole/.test(args)) globalAuth = true;
      const r = rolesOf(args);
      if (r) globalRoles = r;
      continue;
    }
    const p = /^\s*["'`]([^"'`]*)["'`]/.exec(args);
    if (!p) continue;
    const roles = rolesOf(args) || globalRoles;
    const login = globalAuth || authRe.test(args);
    rows.push({ method: method.toUpperCase(), path: `${base}${p[1] === "/" ? "" : p[1]}`, login, roles, file: file.replace(/\.js$/, "") });
  }
}

const withSuper = (roles) => ["admin.super", ...roles.filter((r) => r !== "admin.super")];   // admin.super always passes requireRole
const allowed = (r) => (r.roles ? withSuper(r.roles).join(", ") : r.login ? "any logged-in user" : "public (no login)");
const line = (r) => `| ${r.method} | \`${r.path}\` | ${r.login ? "yes" : "no"} | ${allowed(r)} | ${r.file} |`;

if (process.argv.includes("--check")) {
  const doc = fs.readFileSync(path.join(root, "docs/ROUTE_PERMISSIONS.md"), "utf8");
  const bad = [];
  for (const r of rows) {
    const key = `| ${r.method} | \`${r.path}\` |`;
    const docLine = doc.split("\n").find((l) => l.startsWith(key));
    if (!docLine) bad.push(`missing in the doc: ${r.method} ${r.path}`);
    else if (!docLine.includes(`| ${r.login ? "yes" : "no"} |`)) bad.push(`login differs: ${r.method} ${r.path}`);
  }
  if (bad.length) { console.log(bad.join("\n")); process.exit(1); }
  console.log(`${rows.length} routes, all listed with the right login rule`);
} else {
  console.log(rows.map(line).join("\n"));
}
