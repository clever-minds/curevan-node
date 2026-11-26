# Curevan Omnichannel Notification System & WhatsApp Cloud API Guide

## 1. Overview
Curevan uses an omnichannel notification architecture across **WhatsApp Cloud API (Meta Graph API)**, **SMS (DLT-compliant gateway)**, and **Transactional Email**.

All outbound communications are strictly opt-in, non-marketing, and compliant with Meta Business Messaging Policies and Indian healthcare data privacy principles:
- **No clinical details or diagnosis words** are ever transmitted over WhatsApp.
- **Start Codes (OTP)** are **never** included in `booking_confirmed` or utility templates. The Start Code is delivered exclusively through an **AUTHENTICATION** category template (`curevan_start_code`) inside the 2-hour pre-visit window directly to the patient.
- Customer message bodies and OTPs are **never logged or persisted** in plain text.
- Customer phone numbers in admin logs are strictly masked (`+91 ••••• 46292`).

---

## 2. Environment Variables Reference

| Variable | Description | Example / Default | Required in Production |
|---|---|---|---|
| `WHATSAPP_PROVIDER` | Active WhatsApp provider (`meta` or `mock`) | `meta` | Yes |
| `WHATSAPP_ACCESS_TOKEN` | Meta System User permanent token | `EAA...` (Secret) | Yes |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Phone Number ID (from WhatsApp App dashboard) | `1029384756...` | Yes |
| `WHATSAPP_WABA_ID` | WhatsApp Business Account ID | `9876543210...` | Yes |
| `WHATSAPP_APP_ID` | Meta Developer App ID | `123456789...` | Yes |
| `WHATSAPP_APP_SECRET` | Meta Developer App Secret (used for webhook HMAC validation) | `abcdef...` (Secret) | Yes |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Custom verification token for Meta webhook GET challenge | `curevan_wh_verify_...` | Yes |
| `WHATSAPP_GRAPH_VERSION` | Graph API version | `v22.0` | Optional (default: `v22.0`) |
| `WHATSAPP_TEMPLATE_LANG` | Default template language code | `en` | Optional (default: `en`) |

> **IMPORTANT**: Never commit actual secrets or access tokens to Git. Read all secrets exclusively via `process.env`.

---

## 3. Step A: One-Time Meta Business Setup Runbook

Follow these steps to configure your Meta WhatsApp Cloud API app for live production:

### 3.1. Permanent System User Access Token
1. Open [Meta Business Manager](https://business.facebook.com/settings).
2. Go to **Users** -> **System Users**.
3. Create or select a System User with the **Admin** role (e.g., `curevan-whatsapp-service`).
4. Under **Assigned Assets**, assign your WhatsApp Business Account (WABA) with full control (`whatsapp_business_messaging`, `whatsapp_business_management`).
5. Click **Generate New Token**:
   - Select your Curevan Meta App.
   - Token expiration: **Never**.
   - Scopes required: `whatsapp_business_messaging`, `whatsapp_business_management`.
6. Save this token as `WHATSAPP_ACCESS_TOKEN` in production environment configuration.

### 3.2. Two-Step Verification PIN Registration
1. In Meta App Dashboard -> **WhatsApp** -> **API Setup**.
2. Select your registered production phone number (+91 95144 46292 or business number).
3. Set and register a 6-digit Two-step verification PIN. Keep this PIN safe.
4. Execute the one-time registration request (via Graph API or Meta dashboard) to register the number:
   ```bash
   curl -X POST "https://graph.facebook.com/v22.0/<PHONE_NUMBER_ID>/register" \
     -H "Authorization: Bearer <WHATSAPP_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"messaging_product": "whatsapp", "pin": "<YOUR_6_DIGIT_PIN>"}'
   ```

### 3.3. Webhook Setup & Subscription
1. In Meta App Dashboard -> **WhatsApp** -> **Configuration**.
2. Click **Edit** under Webhook:
   - **Callback URL**: `https://<api-domain>/api/hooks/whatsapp`
   - **Verify Token**: Must match `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in your environment.
3. Click **Verify and Save**. Meta will send a GET challenge to verify the endpoint.
4. Under **Webhook fields**, click **Manage** and subscribe to:
   - `messages` (delivers incoming messages, STOP/START replies, and delivery/read status updates).

---

## 4. Templates Registry & Synchronization

All WhatsApp templates are defined in `src/services/notifications/templates.js`.

### 4.1. Meta Template Rules & Guardrails
- **Greeting**: Every template starts with `Namaste {{1}},` or `Hello {{1}},`.
- **Brand Identity**: The `Curevan` brand name must appear in every template.
- **Support Contact**: Utility templates must end with:
  ```text
  Need help? Call +91 95144 46292
  ```
- **No Clinical Terminology**: Never use words like `diagnosis`, `stroke`, `paralysis`, `pain`, `injury`, `surgery`, or `condition`.
- **No Hardcoded Numbers / OTPs in Utility**: No 4-6 digit numeric literals. Utility templates must not contain the words `OTP` or `code`.
- **Links**: URLs must link strictly to `https://www.curevan.com/...`.

### 4.2. CLI Template Management
Check the status of templates or submit all registered templates to Meta Graph API using the built-in CLI:

- **List existing templates from Meta WABA**:
  ```bash
  npm run wa:templates
  ```
- **Submit missing templates for Meta approval**:
  ```bash
  npm run wa:submit
  ```

### 4.3. Adding New Templates or Handling Rejections
1. If Meta rejects a template:
   - Do **NOT** delete or re-submit the same name.
   - Update the template name in `src/services/notifications/templates.js` with a new version suffix (e.g. `curevan_booking_confirmed_v2`).
   - Run `npm run wa:submit` to submit the new version for review.
2. Run unit tests to verify compliance before submission:
   ```bash
   npm run test:whatsapp
   ```

---

## 5. Recipient Matrix & Opt-In Rules

Notifications are dispatched according to user roles and explicit consent:

| Event | Patient | Caregivers | Assigned Therapist | Admin Roles |
|---|---|---|---|---|
| `booking_created` | WhatsApp + SMS | WhatsApp (if linked) | WhatsApp | `admin.therapy` |
| `booking_confirmed` | WhatsApp + SMS (NO start code) | WhatsApp (if linked) | WhatsApp | `admin.therapy` |
| `reminder_24h` | WhatsApp | WhatsApp (if linked) | WhatsApp | - |
| `reminder_2h` | WhatsApp (NO start code) | WhatsApp (if linked) | WhatsApp | - |
| `curevan_start_code` | WhatsApp (AUTH category, Patient only) | - | - | - |
| `therapist_on_the_way` | WhatsApp + SMS | WhatsApp (if linked) | - | - |
| `session_completed` | WhatsApp + SMS | WhatsApp (if linked) | - | `admin.therapy` |
| `order_placed` | WhatsApp + Email | - | - | `admin.ecom` |
| `order_dispatched` | WhatsApp + SMS | - | - | `admin.ecom` |
| `order_delivered` | WhatsApp | - | - | `admin.ecom` |
| `sos_triggered` | - | WhatsApp + SMS | - | `admin.super`, `admin.therapy` |

### Opt-In & Opt-Out Enforcement
- **Consent Check**: Before any WhatsApp notification is queued, the system verifies `user.whatsapp_opt_in === true`. If false, the message is skipped (or routed to SMS if configured).
- **Inbound Keywords**:
  - `STOP`, `UNSUBSCRIBE`: Webhook immediately sets `users.whatsapp_opt_in = false` and logs an opt-out event in `consent_logs`.
  - `START`, `UNSTOP`: Sets `users.whatsapp_opt_in = true` with source `whatsapp_reply`.

---

## 6. Admin Delivery Log & Resend Screen

Super Admins can monitor real-time message delivery and handle delivery exceptions at:
**`/dashboard/admin/notification-log`**

- **Filterable by**: Channel (`whatsapp`, `sms`, `email`), Status (`sent`, `delivered`, `read`, `failed`), and Event.
- **Privacy Protections**: Recipient phone numbers are masked (`+91 ••••• 46292`) and customer message bodies/OTPs are never stored or exposed.
- **Manual Resend**: Super Admin can trigger a 1-click re-dispatch for failed notifications.
