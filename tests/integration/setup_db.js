/**
 * Prepares a REAL PostgreSQL for the integration tests:
 *   1. wipes the public schema
 *   2. loads tests/integration/test_schema.sql (test-only stand-in for the 0000 baseline)
 *   3. runs the real migration runner: --baseline, then every migration after it
 *
 * Connection comes from DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD.
 */
const __db = process.env.DB_NAME || "curevan_test";
if (!/test/i.test(__db)) { console.error(`Refusing to run: DB_NAME "${__db}" does not look like a test database.`); process.exit(2); }
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../..");
const env = { ...process.env };

async function main() {
  const client = new Client({
    host: env.DB_HOST || "127.0.0.1",
    port: Number(env.DB_PORT) || 5432,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.query(fs.readFileSync(path.join(__dirname, "test_schema.sql"), "utf8"));
  await client.end();

  for (const args of [["--baseline"], []]) {
    const r = spawnSync(process.execPath, [path.join(root, "scripts/migrate.js"), ...args], { env, encoding: "utf8", cwd: root });
    process.stdout.write((r.stdout || "").replace(/\[dotenv[^\n]*\n/g, ""));
    if (r.status !== 0) {
      process.stderr.write(r.stderr || "");
      throw new Error(`migrate ${args.join(" ")} failed`);
    }
  }
  console.log("test database ready");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
