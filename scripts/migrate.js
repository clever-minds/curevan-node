#!/usr/bin/env node
/**
 * Minimal SQL migration runner.
 *   node scripts/migrate.js              apply all pending migrations/*.sql in filename order
 *   node scripts/migrate.js --status     list applied / pending migrations
 *   node scripts/migrate.js --baseline   record 0000_baseline.sql as applied WITHOUT running it
 *                                         (use once on a database that already has the schema)
 * Connection uses the same env variables as src/config/db.js (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD).
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Client } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const BASELINE = '0000_baseline.sql';
const PLACEHOLDER_MARKER = 'CUREVAN-BASELINE-PLACEHOLDER';

function listFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
}

async function main() {
  const flag = process.argv[2];
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id SERIAL PRIMARY KEY,
         filename TEXT UNIQUE NOT NULL,
         applied_at TIMESTAMPTZ DEFAULT now()
       )`
    );
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    const files = listFiles();

    if (flag === '--status') {
      files.forEach((f) => console.log(`${applied.has(f) ? 'applied' : 'pending'}  ${f}`));
      if (files.length === 0) console.log('no migration files found');
      return;
    }

    if (flag === '--baseline') {
      if (!files.includes(BASELINE)) throw new Error(`${BASELINE} not found in migrations/`);
      await client.query('INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING', [BASELINE]);
      console.log(`${BASELINE} recorded as applied (not executed).`);
      return;
    }

    if (flag) throw new Error(`Unknown option ${flag}`);

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log('Nothing to apply.');
      return;
    }
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      if (file === BASELINE && sql.includes(PLACEHOLDER_MARKER)) {
        throw new Error(
          `${BASELINE} is still the placeholder. Replace it with: pg_dump --schema-only --no-owner --no-privileges -d <db> > migrations/${BASELINE}`
        );
      }
      console.log(`Applying ${file} ...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${file} failed and was rolled back: ${err.message}`);
      }
    }
    console.log('Done.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err.code || (err.errors && err.errors[0] && err.errors[0].code) || String(err));
  process.exit(1);
});
