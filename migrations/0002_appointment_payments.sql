-- P07: server-verified payments for appointments.
-- Safe to re-run: every statement is idempotent.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS razorpay_order_id   TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS paid_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS price_source        TEXT,   -- therapist_rate | service_type | pending_match
  ADD COLUMN IF NOT EXISTS payment_method      TEXT;   -- razorpay | manual_cash | manual_upi | manual_bank ...

CREATE INDEX IF NOT EXISTS appointments_razorpay_order_id_idx
  ON appointments (razorpay_order_id);

-- Price used for "Request a therapist" before a therapist is known.
-- Leave NULL to price such requests from the accepting therapist's hourly rate.
ALTER TABLE service_types
  ADD COLUMN IF NOT EXISTS base_price NUMERIC;

-- Sanity check to run after testing (should return 0 rows):
--   SELECT id FROM appointments
--   WHERE payment_status = 'Paid' AND razorpay_payment_id IS NULL AND COALESCE(payment_method, '') NOT LIKE 'manual\_%';
