-- 0007 (P14): cancellation details on the booking, and a log of therapist reliability events.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_at                 TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_by                 INT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancel_reason                TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_charge          NUMERIC DEFAULT 0;   -- INR kept from the patient
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS refund_amount                NUMERIC DEFAULT 0;   -- INR returned to the patient
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_therapist_share NUMERIC DEFAULT 0;   -- INR of the charge that goes to the therapist (used by P18)

CREATE TABLE IF NOT EXISTS therapist_reliability_events (
  id             SERIAL PRIMARY KEY,
  therapist_id   INT NOT NULL,
  appointment_id INT,
  type           TEXT NOT NULL,          -- cancelled_by_therapist | late_arrival | no_show
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reliability_therapist ON therapist_reliability_events (therapist_id, created_at);
