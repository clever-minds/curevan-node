-- P10: SOS alerts, in-app notifications, consent log.
-- Safe to re-run. Needs PostgreSQL 13+ (gen_random_uuid is built in).

CREATE TABLE IF NOT EXISTS sos_alerts (
  id              SERIAL PRIMARY KEY,
  appointment_id  INT NULL,
  raised_by       INT NOT NULL,
  role            TEXT,
  alert_type      TEXT DEFAULT 'sos',          -- sos | missed-checkin
  lat             NUMERIC,
  lng             NUMERIC,
  message         TEXT,
  status          TEXT DEFAULT 'active',       -- active | resolved
  resolved_by     INT,
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sos_alerts_status_idx ON sos_alerts (status, created_at DESC);

-- The notifications table already exists in production (keyed by user_uid, which holds the numeric user id as text).
-- This only creates it on a fresh database and adds the lookup index.
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uid   VARCHAR(255) NOT NULL,
  type       VARCHAR(100),
  title      VARCHAR(255) NOT NULL,
  message    TEXT,
  link       VARCHAR(255),
  is_read    BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_read_idx ON notifications (user_uid, is_read);

CREATE TABLE IF NOT EXISTS consent_logs (
  id             SERIAL PRIMARY KEY,
  user_id        INT NULL,                      -- NULL for anonymous (cookie) consent
  consent_type   TEXT NOT NULL,                 -- terms | privacy | medical | marketing | cookies
  policy_version TEXT,
  granted        BOOLEAN DEFAULT true,
  ip             TEXT,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_logs_user_idx ON consent_logs (user_id, consent_type);
