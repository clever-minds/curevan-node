-- 0008 (P15): PCR becomes a longitudinal record: two quick scores, HEP, baseline carried forward, hash + PDF, access log.
ALTER TABLE pcr ADD COLUMN IF NOT EXISTS functional_score   SMALLINT CHECK (functional_score BETWEEN 1 AND 10);
ALTER TABLE pcr ADD COLUMN IF NOT EXISTS pain_vas           SMALLINT CHECK (pain_vas BETWEEN 0 AND 10);
ALTER TABLE pcr ADD COLUMN IF NOT EXISTS functional_measure TEXT;     -- what the functional score measures: ROM, muscle power, ADL, articulation...
ALTER TABLE pcr ADD COLUMN IF NOT EXISTS hep                TEXT;     -- home exercise programme
ALTER TABLE pcr ADD COLUMN IF NOT EXISTS baseline           JSONB;    -- chief complaint, diagnosis, medical history, allergies, long-term goal
ALTER TABLE pcr ADD COLUMN IF NOT EXISTS submitted_at       TIMESTAMPTZ;
ALTER TABLE pcr ADD COLUMN IF NOT EXISTS locked_at          TIMESTAMPTZ;
ALTER TABLE pcr ADD COLUMN IF NOT EXISTS content_hash       TEXT;     -- SHA-256 of the PCR content at lock time
ALTER TABLE pcr ADD COLUMN IF NOT EXISTS pdf_path           TEXT;     -- file inside storage/private/

CREATE TABLE IF NOT EXISTS pcr_access_log (
  id         SERIAL PRIMARY KEY,
  pcr_id     INT NOT NULL,
  user_id    INT,
  action     TEXT NOT NULL,        -- view | edit | submit | lock | unlock | return | pdf | progress
  note       TEXT,                 -- e.g. the admin's reason for a return / unlock
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pcr_access_log_pcr ON pcr_access_log (pcr_id, created_at);
