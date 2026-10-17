-- 0014 (P22): quality and credentials for therapists
ALTER TABLE therapist_profiles
  ADD COLUMN IF NOT EXISTS council TEXT,
  ADD COLUMN IF NOT EXISTS registration_valid_until DATE,
  ADD COLUMN IF NOT EXISTS registration_doc_id INT,
  ADD COLUMN IF NOT EXISTS quality_status TEXT DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS quality_note TEXT;

CREATE TABLE IF NOT EXISTS therapist_quality_actions (
  id           SERIAL PRIMARY KEY,
  therapist_id INT NOT NULL,
  action       TEXT NOT NULL,
  note         TEXT,
  actor_id     INT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_therapist_quality_actions_therapist ON therapist_quality_actions (therapist_id);
