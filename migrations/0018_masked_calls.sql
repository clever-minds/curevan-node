-- 0018 (P27): one row per masked call between a patient and the therapist of a booking. Real numbers are never stored here.
CREATE TABLE IF NOT EXISTS masked_calls (
  id                SERIAL PRIMARY KEY,
  appointment_id    INT NOT NULL,
  caller_role       TEXT NOT NULL CHECK (caller_role IN ('patient', 'therapist')),
  caller_user_id    INT NOT NULL,
  provider_call_sid TEXT,
  status            TEXT NOT NULL DEFAULT 'initiated',   -- initiated | ringing | in-progress | completed | busy | no-answer | failed | canceled
  duration_seconds  INT,
  started_at        TIMESTAMPTZ DEFAULT now(),
  ended_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_masked_calls_appointment ON masked_calls (appointment_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_masked_calls_sid ON masked_calls (provider_call_sid) WHERE provider_call_sid IS NOT NULL;
