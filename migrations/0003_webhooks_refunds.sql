-- P08: Razorpay webhook log and refunds that go through Razorpay.
-- Safe to re-run: every statement is idempotent.

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id           SERIAL PRIMARY KEY,
  event_id     TEXT UNIQUE NOT NULL,        -- X-Razorpay-Event-Id (replays are ignored)
  event        TEXT,
  payload      JSONB,
  received_at  TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error        TEXT
);

ALTER TABLE order_refunds
  ADD COLUMN IF NOT EXISTS razorpay_refund_id TEXT,
  ADD COLUMN IF NOT EXISTS appointment_id     INT NULL,
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ;

-- appointment refunds have no shop order
ALTER TABLE order_refunds ALTER COLUMN order_id DROP NOT NULL;

-- new statuses are lower case: pending | processed | failed  (older rows keep 'Processed')
CREATE UNIQUE INDEX IF NOT EXISTS order_refunds_razorpay_refund_uidx
  ON order_refunds (razorpay_refund_id)
  WHERE razorpay_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_refunds_appointment_idx ON order_refunds (appointment_id);
