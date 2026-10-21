# Curevan Notification Service: Approved Templates & Vendor Integration (P24)

This document specifies the exact approved templates, variables, DLT entity IDs, and routing channels for Curevan's notification service operated by Himaya Care Pvt. Ltd.

---

## 1. Regulatory Context & Provider Settings

| Parameter | Value |
|---|---|
| **Operating Entity** | Himaya Care Pvt. Ltd. |
| **Brand / Sender ID (DLT Header)** | `CURVAN` |
| **TRAI Principal Entity ID (DLT)** | set via `DLT_ENTITY_ID` (from the TRAI DLT portal; no default) |
| **Supported WhatsApp Provider** | Meta WhatsApp Cloud API (`WHATSAPP_PROVIDER=meta`), console dev fallback |
| **Supported SMS Provider** | MSG91 (`SMS_PROVIDER=msg91`), console dev fallback |
| **Transactional Email Provider** | `MAIL_PROVIDER=sendgrid` (HTTP API, needs `SENDGRID_API_KEY`, `MAIL_FROM` on curevan.com) in production; `smtp` = old Gmail/SMTP transporter, development fallback only; `console` (default) prints only |
| **Sender Email** | `notifications@curevan.com` (set via `MAIL_FROM`) |
| **Timezone** | Asia/Kolkata (IST, UTC+5:30) |

> **Strict Compliance Rules**:
> 1. **Utility Category**: No marketing or promotional text is permitted inside utility templates.
> 2. **OTP Zero-Leak Boundary**: OTP (Start Code) is strictly prohibited from being sent via email or recorded in database log tables or stdout logs.
> 3. **High-Availability Fallback**: WhatsApp failure on critical transactional messages (`booking_confirmed`) automatically falls back to TRAI DLT SMS.

---

## 2. Event & Channel Routing Matrix

| Event | Patient Channels | Therapist Channels | Admin Channels |
|---|---|---|---|
| `booking_confirmed` | WhatsApp Utility + SMS Fallback + In-App + Email (No OTP) | Push + In-App | — |
| `followup_proposed` | WhatsApp Utility (Confirm link) + In-App | — | — |
| `followup_nudge` | WhatsApp Utility + In-App | — | — |
| `followup_expired` | WhatsApp + In-App | Push + In-App | — |
| `followup_no_slot` | WhatsApp + In-App | Push + In-App | — |
| `reminder_24h` | WhatsApp Utility + SMS Fallback | — | — |
| `reminder_2h` | WhatsApp Utility + SMS Fallback | — | — |
| `reminder_30_min` | WhatsApp | Push | — |
| `therapist_daily_agenda` | — | WhatsApp or Push | — |
| `therapist_60min` | — | WhatsApp or Push | — |
| `followup_overdue` | WhatsApp + In-App | In-App | In-App (Therapy Admin) |
| `hep_daily` | WhatsApp or Push (Opt-in only) | — | — |
| `progress_report_ready` | WhatsApp document + In-App + Email (to Patient & consented Caregiver) | — | — |
| `therapist_on_the_way` | WhatsApp + Push | — | — |
| `session_completed_review`| WhatsApp + In-App | — | — |
| `pcr_pdf_ready` | WhatsApp document + Email | — | — |
| `booking_cancelled` | WhatsApp + In-App | Push + In-App | In-App |
| `booking_reassigned` | WhatsApp + In-App | Push + In-App | In-App |
| `order_paid` | WhatsApp + Email | — | — |
| `order_shipped` | WhatsApp (Tracking Link) + Email | — | — |
| `order_delivered` | WhatsApp + Email | — | — |
| `refund_processed` | WhatsApp + Email | — | — |
| `payout_paid` | — | WhatsApp + Email (Statement) | — |
| `sos_raised` | — | — | Push + SMS to On-Call |

---

## 3. Meta WhatsApp Cloud API Templates (To Submit in Meta Business Manager)

All templates below are classified strictly under the **UTILITY** category.

### 1. `curevan_booking_confirmed_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your Curevan home session with {{2}} is confirmed for {{3}} at {{4}} in {{5}}. Please share your Start Code {{6}} with the therapist only when they arrive at your home. View session details: {{7}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` therapist_name, `{{3}}` date, `{{4}}` time, `{{5}}` locality, `{{6}}` start_otp, `{{7}}` booking_link.

### 2. `curevan_followup_proposed_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, {{2}} has recommended your next session for {{3}} at {{4}}. We have reserved this slot for you. Confirm your slot here: {{5}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` therapist_name, `{{3}}` date, `{{4}}` time, `{{5}}` confirm_link.

### 3. `curevan_followup_nudge_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your recommended session on {{2}} at {{3}} is still reserved. Confirm your session soon to keep the slot: {{4}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` date, `{{3}}` time, `{{4}}` confirm_link.

### 4. `curevan_followup_expired_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, the slot reserved for your session on {{2}} has been released because it was not confirmed in time. You can book again anytime: {{3}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` date, `{{3}}` booking_link.

### 5. `curevan_followup_noslot_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your therapist recommended a session, but no matching slot was available. Please select an alternate slot here: {{2}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` booking_link.

### 6. `curevan_reminder_24h_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, reminder: your Curevan home therapy session with {{2}} is tomorrow at {{3}}. View booking: {{4}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` therapist_name, `{{3}}` time, `{{4}}` booking_link.

### 7. `curevan_reminder_2h_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your Curevan home therapy session with {{2}} starts in 2 hours at {{3}}. Your start code is available in the app: {{4}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` therapist_name, `{{3}}` time, `{{4}}` booking_link.

### 8. `curevan_reminder_30min_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your therapist {{2}} will arrive in approximately 30 minutes for your session at {{3}}. Please be ready with your start code.
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` therapist_name, `{{3}}` time.

### 9. `curevan_therapist_agenda_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Dr {{1}}, your Curevan schedule for today ({{2}}): {{3}}. View schedule: {{4}}
  ```
- **Variables**: `{{1}}` therapist_name, `{{2}}` date, `{{3}}` agenda_summary, `{{4}}` schedule_link.

### 10. `curevan_therapist_60min_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Dr {{1}}, your session with {{2}} starts in 60 minutes at {{3}} in {{4}}. View details: {{5}}
  ```
- **Variables**: `{{1}}` therapist_name, `{{2}}` patient_name, `{{3}}` time, `{{4}}` city, `{{5}}` schedule_link.

### 11. `curevan_followup_overdue_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, it has been a while since your last session. Book your next appointment to keep your recovery plan on track: {{2}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` booking_link.

### 12. `curevan_hep_daily_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, time for your home exercises! A few minutes of prescribed exercises today keeps your recovery progressing: {{2}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` exercise_link.

### 13. `curevan_progress_report_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your clinical progress report from Dr {{2}} is ready. View your recovery milestones: {{3}}
  ```
- **Variables**: `{{1}}` recipient_name, `{{2}}` therapist_name, `{{3}}` report_link.

### 14. `curevan_therapist_ontheway_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your therapist {{2}} is on the way to your home for the {{3}} session. Please keep your Start Code ready.
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` therapist_name, `{{3}}` time.

### 15. `curevan_session_completed_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your session with {{2}} is complete. How did it go? Rate your experience and help us maintain quality care: {{3}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` therapist_name, `{{3}}` review_link.

### 16. `curevan_pcr_ready_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your Patient Care Record (PCR) summary for session #{{2}} on {{3}} has been finalized. View record: {{4}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` session_number, `{{3}}` date, `{{4}}` record_link.

### 17. `curevan_booking_cancelled_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your booking for {{2}} at {{3}} has been cancelled. Reason: {{4}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` date, `{{3}}` time, `{{4}}` reason.

### 18. `curevan_booking_reassigned_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your session on {{2}} at {{3}} has been reassigned to {{4}}. View details: {{5}}
  ```
- **Variables**: `{{1}}` patient_name, `{{2}}` date, `{{3}}` time, `{{4}}` new_therapist_name, `{{5}}` link.

### 19. `curevan_order_paid_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, thank you! We received your payment of INR {{2}} for Order #{{3}}. We will pack and ship your wellness items shortly. Track order: {{4}}
  ```
- **Variables**: `{{1}}` customer_name, `{{2}}` amount, `{{3}}` order_number, `{{4}}` track_link.

### 20. `curevan_order_shipped_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your Curevan order #{{2}} has been shipped via {{3}}. Tracking AWB: {{4}}. Track here: {{5}}
  ```
- **Variables**: `{{1}}` customer_name, `{{2}}` order_number, `{{3}}` courier, `{{4}}` awb, `{{5}}` track_link.

### 21. `curevan_order_delivered_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, your Curevan order #{{2}} has been delivered. You have 7 days to report any issues or request a return: {{3}}
  ```
- **Variables**: `{{1}}` customer_name, `{{2}}` order_number, `{{3}}` return_link.

### 22. `curevan_refund_processed_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Namaste {{1}}, a refund of INR {{2}} has been initiated for {{3}} (Ref: {{4}}). It typically reflects in your bank account within 5-7 business days.
  ```
- **Variables**: `{{1}}` customer_name, `{{2}}` amount, `{{3}}` reference, `{{4}}` refund_id.

### 23. `curevan_payout_paid_v1`
- **Category**: UTILITY
- **Language**: English (en_US)
- **Approved Body Text**:
  ```
  Dr {{1}}, your weekly payout of INR {{2}} for the week of {{3}} has been transferred. Bank UTR: {{4}}. Statement: {{5}}
  ```
- **Variables**: `{{1}}` therapist_name, `{{2}}` amount, `{{3}}` week, `{{4}}` utr, `{{5}}` statement_link.

---

## 4. TRAI DLT SMS Templates (India Registration)

- **Principal Entity ID**: set `DLT_ENTITY_ID` (from the TRAI DLT portal; no default)
- **Header**: `CURVAN`
- **Category**: Service Implicit

### 1. Booking Confirmed Fallback
- **Template ID**: assigned by the DLT portal after approval (env: `DLT_TID_BOOKING_CONFIRMED`)
- **Approved Text**:
  ```
  Your Curevan home session with {#var#} is confirmed for {#var#} at {#var#}. Share Start Code {#var#} only when therapist arrives. - Curevan
  ```

### 2. Reminder 24 Hours Before
- **Template ID**: assigned by the DLT portal after approval (env: `DLT_TID_REMINDER_24H`)
- **Approved Text**:
  ```
  Reminder: Your Curevan home therapy session with {#var#} is tomorrow at {#var#}. Details: {#var#} - Curevan
  ```

### 3. Reminder 2 Hours Before
- **Template ID**: assigned by the DLT portal after approval (env: `DLT_TID_REMINDER_2H`)
- **Approved Text**:
  ```
  Your Curevan home therapy session with {#var#} starts in 2 hours at {#var#}. Check your app for details. - Curevan
  ```

### 4. SOS Emergency Alert (On-Call Staff)
- **Template ID**: assigned by the DLT portal after approval (env: `DLT_TID_SOS`)
- **Approved Text**:
  ```
  EMERGENCY ALERT: SOS raised by therapist Dr {#var#} (Phone: {#var#}) for Booking #{#var#} at {#var#}. Lat/Lng: {#var#},{#var#}. Action required immediately. - Curevan
  ```

---

## 5. Audit Logging (`notification_log`)

Every notification dispatch is logged in the `notification_log` database table with the following schema:
- `id SERIAL PRIMARY KEY`
- `user_id INT NULL` (foreign key to `users.id`)
- `event TEXT NOT NULL`
- `channel TEXT NOT NULL` (`whatsapp`, `sms`, `email`, `push`, `inapp`)
- `template TEXT NULL` (Meta template name or DLT Template ID)
- `status TEXT NOT NULL` (`sent`, `failed`, `skipped`)
- `provider_message_id TEXT NULL`
- `error TEXT NULL` (strictly sanitized to redact any numbers or sensitive tokens)
- `created_at TIMESTAMPTZ DEFAULT now()`
