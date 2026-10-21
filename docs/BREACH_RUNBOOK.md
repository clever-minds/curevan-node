# Personal data breach runbook (DPDP Act 2023 / DPDP Rules 2025, CERT-In Directions 2022)

Owner of this runbook: **[OWNER TO CONFIRM: name and role of the incident lead]**. Review it every 6 months and after every incident.

A personal data breach is any unauthorised or accidental access, disclosure, alteration, loss or destruction of personal data that Curevan (Himaya Care Pvt. Ltd.) holds: patient records, session records (PCR), addresses, phone numbers, payment references, therapist documents.

## 1. The first hour: contain it
1. **Stop the leak.** Disable the affected account, key, token or integration. Rotate secrets (database password, JWT secret, Razorpay keys, WhatsApp/SMS/mail provider keys, Firebase service account).
2. **Preserve evidence.** Do not delete logs. Copy the server, database and provider logs and the `audit_logs`, `notification_log` and `pcr_access_log` tables to a read-only location.
3. **Tell the incident lead** and the Super Admin. Write down the time you found out: all deadlines below run from that moment.
4. **Do not** discuss the incident on public channels or with the press. All statements go through the incident lead.

## 2. Assess (first 2 hours)
Record in the incident log: what data (which tables, how many people, any clinical data, any minors), how it happened, whether it is still happening, who could have seen it, and the likely harm to the people affected.

## 3. Report (legal deadlines)
| Who | When | What |
|---|---|---|
| **CERT-In** (incident@cert-in.org.in) | within **6 hours** of noticing a reportable cyber incident | Short report of the incident; keep logs for 180 days inside India |
| **Data Protection Board of India** | **without delay** once a personal data breach is known | Description of the breach: nature, extent, timing, location, likely impact |
| **Data Protection Board of India** | **detailed report within 72 hours** | Facts, cause, people affected, mitigation taken, findings about who caused it, steps to prevent a repeat, and proof that the affected individuals were told |
| **Affected users** | **without delay**, in plain language | What happened, which of their data, the possible consequences, what we did, what they can do to protect themselves, and who to contact |
| **Payment partner** (Razorpay) | at once if payment data or keys are involved | Follow their security incident process |
| **Police / cyber cell** | if a crime is suspected | File a complaint; keep the acknowledgement |

Contacts to fill in: **[OWNER TO CONFIRM: incident lead phone and e-mail, grievance officer, legal counsel, hosting provider support, Data Protection Officer if appointed]**.

## 4. Inform the affected users
* Send by the channels in `docs/NOTIFICATIONS.md` (in-app, e-mail, WhatsApp utility template). Do not put marketing text in the message.
* For a minor, inform the parent or guardian recorded in `patient_guardians`.
* Keep a list of who was told, when and how: the Board report asks for it.

## 5. Recover and learn
Fix the cause, restore from backup if data was altered, re-check access control (`docs/ROUTE_PERMISSIONS.md`), add a test that would have caught it, and write the post-incident review within 14 days: timeline, root cause, what worked, what changes.

## 6. Quick checklist
- [ ] Contained and secrets rotated
- [ ] Logs preserved
- [ ] CERT-In told within 6 hours
- [ ] Data Protection Board told without delay
- [ ] Affected users told without delay
- [ ] Detailed report to the Board within 72 hours
- [ ] Post-incident review done
