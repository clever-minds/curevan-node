# Razorpay setup

Use **test** keys everywhere except production.

## Environment variables (backend `.env`)
| Variable | Purpose |
|---|---|
| `RAZORPAY_KEY_ID` | public key id (also sent to the browser with every order) |
| `RAZORPAY_KEY_SECRET` | server secret: creates orders, verifies payment signatures, sends refunds |
| `RAZORPAY_WEBHOOK_SECRET` | secret you type when you add the webhook (below); used to verify `X-Razorpay-Signature` |

Frontend `.env.local` needs only `NEXT_PUBLIC_RAZORPAY_KEY_ID` (the same public key id).

## Webhook
Razorpay Dashboard -> Account & Settings -> Webhooks -> Add new webhook

- **URL:** `https://<api-host>/api/payments/webhook`  (for local tests use a tunnel such as ngrok)
- **Secret:** the value of `RAZORPAY_WEBHOOK_SECRET`
- **Active events to tick:**
  - `payment.captured`  - marks the shop order / booking as paid (works even if the customer closes the browser)
  - `payment.failed`    - marks a shop order failed and gives the reserved stock back
  - `refund.processed`  - refund finished: order / booking becomes `Refunded` (or `Partially Refunded`)
  - `refund.failed`     - refund failed: status shows `failed`; refund manually
  - `order.paid` (optional, treated like `payment.captured`)

How it behaves:
- The body is verified with HMAC-SHA256 of the **raw** body; a wrong signature gets `400` and nothing is stored.
- Every event is stored once in `payment_webhook_events` (key = `X-Razorpay-Event-Id`). Replaying the same event does nothing.
- The endpoint answers `200` immediately and processes afterwards. If processing fails the error is saved on the event row and Razorpay's retry will process it again.
- The amount Razorpay captured must equal the amount the server expects, otherwise the event is saved with an error and the order is NOT confirmed.

## Checking an event manually
```sql
SELECT event_id, event, processed_at, error FROM payment_webhook_events ORDER BY id DESC LIMIT 20;
```

## Refunds
- Admin refund screen -> `POST /api/orders/refunds` -> Razorpay refund API; the row starts as `pending`.
- Customer cancelling a **paid, not yet shipped** order is refunded in full automatically.
- Final status (`processed` / `failed`) is set by the `refund.processed` / `refund.failed` webhook.
- A refund can never exceed *paid - already refunded (pending or processed)*.
- Offline payments recorded by an admin (cash / UPI / bank) have no Razorpay payment, so they cannot be refunded here.

## Test checklist (Razorpay test mode)
1. Pay a shop order; close the browser tab before the success page -> order still turns `Paid` (webhook).
2. Send the same `payment.captured` twice -> second call is ignored.
3. Refund the order from the admin screen -> status `pending`, then `processed` after the webhook.
4. Send a webhook with a wrong signature -> `400`.
5. Test card numbers: see https://razorpay.com/docs/payments/payments/test-card-details/
