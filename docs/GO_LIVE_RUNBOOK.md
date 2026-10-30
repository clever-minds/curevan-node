# Go-live runbook (GL-20)

Do the steps in order. Tick each one and write the time next to it. Stop and ask if a step fails: nothing below needs a workaround.

## 0. Before the day
- [ ] The owner has decided / delivered: company legal details (GL-12), CA sign-off on GST/SAC (GL-13), vendor accounts (GL-14), care-pack prices (GL-16), service base prices and tax categories (GL-17), offline-payment and admin-access rules (GL-18).
- [ ] All pull requests are merged into `main` and CI is green on `main` (API `api-tests`, website `checks`).
- [ ] The staging live-test day (GL-19) is done and recorded in `Curevan_IT_Master_Tracker.xlsx`.

## 1. Back up (API server)
- [ ] `pg_dump -Fc -d <production database> -f curevan_$(date +%F).dump` and copy it off the server.
- [ ] Note the current API commit (`git rev-parse HEAD`) and the website build id (for a rollback).

## 2. Check the database before migrating
- [ ] `psql -d <production database> -f docs/find_duplicate_slots.sql`: step 1 must return **no rows**. If it returns rows, the owner resolves each pair first (otherwise migration 0006 skips its unique index).
- [ ] If this is a brand-new empty database: `migrations/0000_baseline.sql` must be the real schema dump (GL-01), then `node scripts/migrate.js --baseline` is **not** used; run `npm run migrate` instead.
- [ ] Existing production database: `node scripts/migrate.js --baseline` once (records 0000 as applied), then step 3.

## 3. Migrate and configure (API server)
- [ ] `git pull` (or deploy the release) and `npm ci`.
- [ ] `npm run migrate:status`, then `npm run migrate`. It applies, in order, everything not yet applied (the recent ones: `0021` follow-up link, `0022` slugs, `0023` refund/care-pack/non-returnable, `0024` therapist links). Each file runs in its own transaction.
- [ ] `.env` has every variable of `.env.example` that applies: `NODE_ENV=production`, `FRONTEND_URL`, `CORS_ORIGINS`, `JWT_SECRET`, the database settings (`DB_SSL=true` for a managed database), `RAZORPAY_*` (live keys), `SHIPROCKET_*`, `MAIL_PROVIDER=sendgrid` + `SENDGRID_API_KEY`, WhatsApp / SMS / DLT / Exotel values, `OTP_SECRET`, `PRIVATE_STORAGE_DIR` (a folder outside the web root that exists and is writable), the Firebase service-account file or `FIREBASE_SERVICE_ACCOUNT`.
- [ ] `pm2 restart <api>` and `pm2 logs --lines 50`: no error lines.
- [ ] `bash scripts/live_probe.sh` (read-only): every probe passes.

## 4. Deploy the website
- [ ] Amplify variables: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, the `NEXT_PUBLIC_FIREBASE_*` set, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
- [ ] The build from `main` is green (`npm ci` must be plain, with no extra flags).

## 5. Smoke test on the live site (one real booking and one real order)
- [ ] A test patient books a session and pays; the therapist sees it; the payment shows in Razorpay and in the reconciliation page.
- [ ] A test order is placed and paid; the invoice opens; the shipment is created.
- [ ] Cancel the test booking: the refund appears in Razorpay and the booking is cancelled.
- [ ] Sign in once with each role (patient, therapist, super admin, e-commerce admin, therapy admin) and open the dashboard.

## 6. After go-live
- [ ] Submit `https://www.curevan.com/sitemap.xml` in Google Search Console and test the old links: `/shop`, `/book`, `%20` category links, numeric product links and old therapist links all return a permanent redirect (GL-21).
- [ ] Unpublish test content (for example the journal article `test-1`).
- [ ] Watch `pm2 logs` and the reconciliation page for the first Friday payout.

## Rollback
1. Website: redeploy the previous Amplify build.
2. API: check out the previous commit, `pm2 restart`.
3. Database: migrations only add columns, tables and indexes, so the previous code keeps working with the new schema. Restore the dump only if data was damaged.
