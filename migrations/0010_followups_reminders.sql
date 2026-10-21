-- 0010 (P17): follow-up proposals, series, reminder log, reminder preferences, calendar token.
CREATE TABLE IF NOT EXISTS followup_series (
  id                SERIAL PRIMARY KEY,
  treatment_plan_id INT,
  patient_id        INT NOT NULL,
  therapist_id      INT NOT NULL,
  weekdays          SMALLINT[],
  time              TIME,
  start_date        DATE,
  occurrences       INT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS followup_proposals (
  id                  SERIAL PRIMARY KEY,
  source_pcr_id       INT,
  treatment_plan_id   INT,
  patient_id          INT NOT NULL,
  therapist_id        INT NOT NULL,
  proposed_start      TIMESTAMPTZ NOT NULL,
  series_id           INT,
  appointment_id      INT,
  status              TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'changed', 'declined', 'expired', 'no_slot')),
  hold_expires_at     TIMESTAMPTZ,
  patient_response_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_followup_proposals_patient ON followup_proposals (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_followup_proposals_appt ON followup_proposals (appointment_id);

CREATE TABLE IF NOT EXISTS reminder_log (
  id             SERIAL PRIMARY KEY,
  appointment_id INT NOT NULL,
  user_id        INT NOT NULL,
  type           TEXT NOT NULL,
  channel        TEXT NOT NULL DEFAULT 'inapp',
  sent_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (appointment_id, user_id, type)        -- the reason every reminder goes out exactly once
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_prefs JSONB DEFAULT '{"r24h":true,"r2h":true,"hep_daily":false}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_calendar_token_key ON users (calendar_token) WHERE calendar_token IS NOT NULL;

ALTER TABLE pcr ADD COLUMN IF NOT EXISTS next_session_plan JSONB;      -- the old next_treatment_date column stays and is filled from this
ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS follow_up_overdue BOOLEAN DEFAULT false;

-- "proposed" sessions hold their slot like any active booking (the P13 unique index must know the new status)
DROP INDEX IF EXISTS uq_appointments_active_slot;
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT therapist_id, date, time FROM appointments
    WHERE therapist_id IS NOT NULL
      AND status IN ('proposed', 'pending_payment', 'accepted_unpaid', 'confirmed', 'therapist_on_the_way', 'arrived', 'in_progress', 'pcr_pending')
    GROUP BY therapist_id, date, time HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE NOTICE 'P17: % duplicate active slot(s) found - unique slot index NOT re-created. Run docs/find_duplicate_slots.sql and resolve them.', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_active_slot ON appointments (therapist_id, date, time)
      WHERE therapist_id IS NOT NULL
        AND status IN ('proposed', 'pending_payment', 'accepted_unpaid', 'confirmed', 'therapist_on_the_way', 'arrived', 'in_progress', 'pcr_pending');
  END IF;
END $$;
