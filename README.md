# curevan-node

Node.js / Express 5 / PostgreSQL API for Curevan.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (never commit it).
3. Database:
   - **Fresh database:** `npm run migrate`
   - **Existing database (already has the schema):** `node scripts/migrate.js --baseline`, then `npm run migrate`
   - See `migrations/README.md` for the migration rules.
4. `npm run dev` (or `npm start`).

Old one-off scripts are kept for reference in `scripts/archive/`.
