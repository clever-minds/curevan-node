# Feedback on the P01–P29 update (local re-check, 22 Oct 2026)

All numbers below come from a fresh local run on the code that is now on `main` (plus one test fix, see "Found during this check").

## 1. Result of the local check
| Check | Result |
|---|---|
| API unit tests | 15/15 |
| API acceptance, pay-first flow (the handoff pack) | 709/709 |
| API acceptance, approval-first flow | 702/702 |
| Go-live checklist (21 items) | 19 covered by API tests, all pass; items 7 (build) and 19 (mobile 375 px) are covered by the website checks |
| Website typecheck | 0 errors |
| Website lint | 0 errors |
| Website unit tests | 104/104 |
| Link check | 143 pages, 0 missing link targets |
| Production build (plain `npm ci`, fresh clone) | passes |
| Playwright, 5 roles, desktop + 375 px | 18/18 |
| Every key dashboard page, all 5 roles (47 pages), no 5xx / NaN / undefined / page errors | 47/47 |
| API starts from a fresh clone with no Firebase file | starts, cron jobs initialised |

## 2. What was delivered, per prompt
| P | What it does now |
|---|---|
| 01 | Business rules in one settings file; secrets and tokens removed from logs; CORS and body limit hardened |
| 02 | Migration runner (`npm run migrate`, `--baseline`, `--status`); loose scripts archived |
| 03 | `requireRole` on every admin/therapist route; route permission table in `docs/ROUTE_PERMISSIONS.md` |
| 04 | Ownership checks: a patient cannot read another patient's appointment, PCR, order, address or invoice |
| 05 | No role injection at sign-up; phone login needs a verified Firebase token; role changes locked down |
| 06 | Shop checkout: server price, server coupon and GST, signature-verified Razorpay payment, stock hold |
| 07 | Bookings priced on the server and paid through verified Razorpay; "Request a therapist" saved correctly |
| 08 | Signed, idempotent Razorpay webhook; refunds go through Razorpay |
| 09 | Website calls match the real API paths |
| 10 | SOS alerts, own-only notifications, consent log, basic cancel with refund |
| 11 | TypeScript errors 0; broken menu links fixed |
| 12 | Appointment state machine, doorstep start code (OTP), visit flow, status codes |
| 13 | Slot availability, leave, lead time; two people cannot book the same slot |
| 14 | Cancellation bands and refunds (free ≥ 12 h, 50 % to 2 h, 100 % after) with a quote before cancelling |
| 15 | PCR outcome scores, home exercises, baseline carry-forward, lock with SHA-256 hash, PDF |
| 16 | Treatment plans, goals, outcome measure library (free-to-use only), progress charts |
| 17 | Next-session proposals, holds, reminders (24 h, 2 h, 60 min), overdue follow-ups |
| 18 | Payout engine: tier fee, GST on the fee, TDS above the yearly threshold, weekly batches, UTR |
| 19 | Courier webhook pipeline, shipping fee rule (₹50 under ₹499), return rules and inspection refund |
| 20 | Therapist affiliate (DR code), commission engine tied to delivery and returns |
| 21 | Dedicated patient dashboard |
| 22 | Therapist dashboard on real data; Therapy Admin reassignment, quality, credentials |
| 23 | Super Admin and E-com Admin dashboard upgrades |
| 24 | Notifications: WhatsApp, SMS (DLT), e-mail; all 24 events wired; SMS fallback for WhatsApp failures |
| 25 | Invoices from the company settings, GST by service category, consent and guardian rules, privacy requests (DPDP), breach and retention notes |
| 26 | AI assistant: model from `AI_MODEL_ID`, six safe tools on the user's own login, emergency and "talk to a person" handled in code, support tickets with priority |
| 27 | Masked calling between patient and therapist inside the allowed time window |
| 28 | 5- and 10-session care packs: purchase, use at booking, session returned on a free cancellation, refund of unused sessions |
| 29 | `npm test` pipeline, go-live checklist mapping, CI for both repos, Playwright tests |

## 3. Found during this check (and fixed)
- **Flaky test, not a product bug:** `P22 more than 2 hours before the slot nothing is cancelled` failed depending on the time of day the suite ran, because another fixture booking of the same therapist could legitimately fall inside the 2-hour window of that test's fake clock. The test now checks only the booking it is about. The product behaviour is unchanged. The fix is committed locally (`e61f8ff` in curevan-node) and is **not yet on GitHub**.
- **Test database was down** on this machine (it is a throw-away local Postgres, not a service); restarted, nothing to do with the code.

Fixed earlier in the work and already merged: the `npm ci` lock-file error on the Amplify build (PR #2), money values added as text on the Therapy Admin dashboard charts, bank details moved from the invoice code to the company settings, and `.env.example` now lists every variable.

## 4. Not verified (needs live accounts, do on staging)
Real Razorpay checkout popup and live webhook, Shiprocket, WhatsApp/MSG91/SendGrid delivery, an Exotel call, a Gemini answer, and a GitHub Actions run. Payments, refunds and payouts were tested against stubs only.

## 5. Before and at go-live
1. Back up the production database.
2. `node scripts/migrate.js --baseline` once (the `0000` baseline is a placeholder), then `npm run migrate` (0001–0020 only add tables and columns).
3. Add the missing names from `.env.example` to the server env. An empty value switches that feature off.
4. Set `NEXT_PUBLIC_API_URL` before the website build, and have the API reachable at build time.
5. Set `PRIVATE_STORAGE_DIR` to a persistent folder.
6. Deploy API first, website second, then one Razorpay test-key booking and one shop order.

## 6. Open items for the owner
- Company details: GSTIN, CIN, PAN, address, phone and bank details are empty until entered (invoices show a warning, nothing is invented).
- GST treatment and SAC code need the CA's confirmation (D1).
- Care packs: price list and the 10 % cancellation fee are from D14 and need confirming; refund is pro-rata of the price paid per unused session.
- Vendors (D12) and DLT template ids are placeholders until registered.
- The AI summary blocks on the admin dashboards are still static text.
- No admin screen to mark a product non-returnable (as the pack says).
- The `0000` baseline needs the real production schema dump.
