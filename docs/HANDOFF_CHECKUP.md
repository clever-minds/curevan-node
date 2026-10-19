# Handoff Pack check-up, P01 to P29 (2026-10-19)

Branches are stacked: `task/P29-qa-ci` in both repos contains every earlier prompt. Nothing is pushed. Commit messages are `P##: title`.

## Evidence of this run
| Check | Result |
|---|---|
| API unit tests | 15/15 |
| API acceptance, pay-first flow (the pack) | 709/709, 0 failing |
| API acceptance, approval-first flow | 702/702 |
| Go-live checklist (21 items) mapped to tests | 19 covered by API tests, items 7 and 19 by the website checks; all pass |
| Website typecheck / lint / unit tests | 0 errors / 0 errors (31 warnings) / 104 passed |
| Website link check | 143 pages, 0 missing targets |
| Website production build | passes |
| Playwright against the test stack (5 roles, API login) | 18/18 (desktop + Mobile 375) |
| Real boot of the API + site smoke (P21-P24, earlier) | 29/29 |

## Per prompt
| P | Topic | Backend (migration) | Website | Acceptance checks |
|---|---|---|---|---|
| 01 | Business rules, secrets, logging | yes | yes | in #1-#6 groups |
| 02 | Migration runner and baseline | yes (runner; baseline file is a placeholder, see below) | - | all migrations apply on a clean DB every run |
| 03 | RBAC on routes | yes (`docs/ROUTE_PERMISSIONS.md`) | - | #2, #3 |
| 04 | Ownership checks | yes | - | #3 |
| 05 | Sign-up role injection, phone login | yes | yes | #1, #2 |
| 06 | Shop checkout signature | yes (0001) | yes | #4 |
| 07 | Booking payments, request a therapist | yes (0002) | yes | #4, #5 |
| 08 | Webhook and refunds | yes (0003) | yes | #4 |
| 09 | Address mismatches | yes | yes | P09 6, #6 |
| 10 | SOS, notifications, consent, basic cancel | yes (0004) | yes | P10 38 |
| 11 | TypeScript, links, cleanup | - | yes | typecheck, check:links |
| 12 | Status flow, start OTP | yes (0005) | yes | P12 31 |
| 13 | Slots, leave, lead time | yes (0006) | yes | P13 19 |
| 14 | Cancellation and refunds | yes (0007) | yes | P14 19 + unit 15 |
| 15 | PCR upgrade | yes (0008) | yes | P15 21 |
| 16 | Treatment plans, outcome measures | yes (0009) | yes | P16 53 |
| 17 | Follow-ups, reminders | yes (0010) | yes | P17 46 |
| 18 | Payout engine | yes (0011) | yes | P18 46 |
| 19 | Shiprocket pipeline, shipping, returns | yes (0012) | yes | P19 41 |
| 20 | Affiliate | yes (0013) | yes | P20 29 |
| 21 | Patient dashboard | yes | yes | P21 18 |
| 22 | Therapist + Therapy Admin dashboards | yes (0014) | yes | P22 64 |
| 23 | Super Admin + E-com dashboards | yes | yes | P23 12 |
| 24 | Notifications (WhatsApp, SMS, e-mail) | yes (0015) | yes | P24 36 |
| 25 | Invoices, GST, consent, DPDP | yes (0016) | yes | P25 37 |
| 26 | AI assistant, safe tools, escalation | yes (0017) | yes | P26 25 + 4 website test files |
| 27 | Masked calling | yes (0018) | yes | P27 38 |
| 28 | Care packs | yes (0019, 0020) | yes | P28 50 |
| 29 | QA automation and CI | yes | yes | checklist + 18 e2e |

## Found and fixed during the check-up
Client-chosen pack plan at payment, missing webhook activation, notification events never sent (9 of 24), reassignment without slot rules, admins landing on the patient dashboard, money strings added as text on dashboards (last fix: Therapy Admin "Top 10 Services" and the payout pipeline charts), and others listed in each commit message.

## Not verified here (needs live accounts)
Real Gemini answer (`AI_MODEL_ID` + key), real Exotel call, Razorpay checkout popup, Meta WhatsApp / MSG91 / SendGrid delivery, a GitHub Actions run, a manual look at every screen at 375 px beyond the dashboard homes.

## Found, not fixed / owner decisions
- `0000` baseline is a placeholder: production's real schema dump must be added by the owner (the runner expects it).
- Bank details are hard-coded on the appointment and order invoices.
- AI summary blocks on admin dashboards are static text.
- No admin screen to mark a product non-returnable (kept as the pack says).
- Care packs: price and the 10% cancellation fee are from D14 and must be confirmed; the refund is pro-rata of the price paid per unused session.
- GST/SAC code and the invoice treatment need the CA's confirmation (D1); GSTIN, CIN, PAN stay empty until the company enters them.
- Vendors (D12) and DLT template ids are placeholders until registered.
- `findSpecialty` returns therapists only when the patient shares a location.
