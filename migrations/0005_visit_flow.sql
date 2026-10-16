-- 0005 (P12): visit flow - status history, OTP + timestamp columns, and the move from free-text labels to status codes.
-- Safe to re-run: every column/table uses IF NOT EXISTS and the status update only touches old labels.

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS start_otp_hash     TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS otp_attempts       INT DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS otp_verified_at    TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS travel_started_at  TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS arrived_at         TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS session_ended_at   TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS completed_at       TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS appointment_status_history (
  id             SERIAL PRIMARY KEY,
  appointment_id INT NOT NULL,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  actor_id       INT,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appt_status_history_appt ON appointment_status_history (appointment_id);

-- Old labels -> status codes. "Accepted" (a therapist took a request) and "Payment Pending" with a therapist
-- and no payment become accepted_unpaid, because the new table has that state for exactly this case.
UPDATE appointments SET status = CASE
  WHEN status IN ('Pending', 'Assigned', 'Confirmed', 'Accepted', 'Accept', 'Payment Pending') AND payment_status = 'Paid' THEN 'confirmed'
  WHEN status IN ('Accepted', 'Accept', 'Payment Pending') AND therapist_id IS NOT NULL THEN 'accepted_unpaid'
  WHEN status IN ('Pending', 'Assigned', 'Confirmed', 'Accepted', 'Accept', 'Payment Pending') THEN 'pending_payment'
  WHEN status = 'Pending Approval' THEN 'searching_therapist'
  WHEN status IN ('Navigating', 'On The Way') THEN 'therapist_on_the_way'
  WHEN status = 'Arrived' THEN 'arrived'
  WHEN status IN ('In Progress', 'Session Started') THEN 'in_progress'
  WHEN status IN ('Searching', 'Searching Therapist') THEN 'searching_therapist'
  WHEN status = 'Completed' THEN 'completed'
  WHEN status IN ('Cancelled', 'Rejected') THEN 'cancelled_by_admin'
  WHEN status = 'No-Show' THEN 'no_show'
  ELSE status
END
WHERE status IN ('Pending', 'Assigned', 'Confirmed', 'Accepted', 'Accept', 'Payment Pending', 'Pending Approval',
                 'Navigating', 'On The Way', 'Arrived', 'In Progress', 'Session Started', 'Searching',
                 'Searching Therapist', 'Completed', 'Cancelled', 'Rejected', 'No-Show');
