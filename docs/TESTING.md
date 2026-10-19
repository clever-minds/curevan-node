# Testing the API

## Run everything locally

You need a PostgreSQL 16 whose database name contains `test` (the scripts refuse any other name and wipe it on every run).

```bash
# once: a throw-away database (Docker example)
docker run -d --name curevan-test-db -e POSTGRES_USER=curevan -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=curevan_test -p 54329:5432 postgres:16

# every time (DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD default to 127.0.0.1 / 54329 / curevan_test / curevan / testpw)
npm test
```

`npm test` runs, in order: unit tests, test-database setup, the acceptance suite in the pay-first flow (the handoff pack),
the go-live checklist mapping, the database again, then the acceptance suite in the approval-first flow (`--approval`).
Razorpay, Firebase, mail, WhatsApp, SMS, telephony and Shiprocket are stubbed inside the tests: no real key or account is used.

| Script | What it does |
|---|---|
| `npm test` | everything above |
| `npm run test:db` | only (re)creates the test database |
| `npm run test:users` | seeds the five test users (`patient@`, `therapist@`, `super@`, `ecom@`, `therapy@curevan.test`, password `Test@1234`) and demo data |
| `node tests/integration/dev_server.js` | the real API on :5000 with stubs, for the website's browser tests |

CI (`.github/workflows/ci.yml`) runs `npm test` against a `postgres:16` service on every pull request and push to `main`.

## Go-live checklist (IT Action Plan v3) -> automated tests

`tests/checklist.json` maps every item to named checks of `tests/integration/acceptance.test.js`.
`tests/check_checklist.js` fails the run when one of them is missing or failing.

| # | Item | Automated by |
|---|---|---|
| 1 | Phone login bypass | acceptance `#1` (no token / forged token -> 401) |
| 2 | Role escalation | acceptance `#2` (update-roles 403, sign-up creates a patient only) |
| 3 | Data privacy | acceptance `#3` (appointment, PCR, order, address of another patient; therapist address window) |
| 4 | Payment | acceptance `#4` (forged signature, tampered amounts, 20 payments reconcile) |
| 5 | Request a therapist | acceptance `#5` |
| 6 | Broken links | acceptance `#6` (every website API call exists) + website `npm run check:links` |
| 7 | Build | website CI: `typecheck` and `build` |
| 8 | OTP | acceptance `P12`, `P21` |
| 9 | PCR gate | acceptance `P12`, `P18` |
| 10 | Slots | acceptance `P13` (409, two simultaneous bookings) |
| 11 | Cancellation bands | acceptance `P14` + `tests/unit/cancellation_quote.test.js` |
| 12 | Payout | acceptance `P18` |
| 13 | Shipping | acceptance `P19` |
| 14 | Returns | acceptance `P19` |
| 15 | Affiliate | acceptance `P20` |
| 16 | Notifications | acceptance `P24` |
| 17 | SOS | acceptance `P10` |
| 18 | Compliance | acceptance `P10`, `P14`, `P25` |
| 19 | Mobile 375 px | website Playwright project "Mobile 375" (`e2e/mobile.spec.ts`) |
| 20 | Progress tracking | acceptance `P15`, `P16` |
| 21 | Follow-ups and reminders | acceptance `P17` |

## Not covered by automation

A real Razorpay checkout popup, real WhatsApp/SMS/e-mail delivery, a real Exotel call and a real Gemini answer need live accounts;
do them by hand once with the test/sandbox keys before go-live.
