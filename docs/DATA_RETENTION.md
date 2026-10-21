# Data retention schedule

Rules for how long Curevan (Himaya Care Pvt. Ltd.) keeps personal data. **[OWNER TO CONFIRM: this schedule with the company's legal adviser before go-live.]** Nothing is deleted automatically by the software: an erasure request (`privacy_requests`) is decided by the Super Admin against this table.

| Data | Keep for | Then |
|---|---|---|
| Clinical records (PCR, treatment plans, outcome results, progress reports) | **at least 3 years** after the patient's last session; **5 years recommended** | Review, then delete or anonymise |
| Records of a **minor** (patient under 18 at the time of the session) | until the patient is **18 plus 3 years** (never shorter than the adult rule) | Review, then delete or anonymise |
| Tax and payment records (invoices, payment transactions, refunds, payout statements) | **8 years** | Delete |
| Account and contact data of an active user | while the account is active | Delete or anonymise on a verified erasure request, except what the rows above require us to keep |
| Consent records (`consent_logs`, `patient_guardians`) | as long as the data they cover is kept | Delete with the data |
| Marketing messages and the data used only for them | until the user **withdraws marketing consent** (Account > Privacy) | Stop at once, delete on request |
| Notification and access logs (`notification_log`, `pcr_access_log`, `audit_logs`) | 1 year (CERT-In: keep security logs 180 days inside India) | Delete |
| Chat transcripts with the AI assistant | 1 year, longer only if attached to a ticket | Delete |

## Erasure requests
1. The user files the request in Account > Privacy. It appears in the Super Admin list.
2. The Super Admin checks the table above: data we must keep (clinical, tax) stays, with the reason told to the user; the rest is deleted or anonymised.
3. The request is closed with a note saying what was kept and why.

## Clinical records are never deleted by a script
Deleting or changing a clinical record is a manual, logged decision by the Super Admin. The access log of the record stays.
