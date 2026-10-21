-- Migration 0015: Notification logging and user communication preferences (P24)
-- Idempotent and safe to run on existing databases

CREATE TABLE IF NOT EXISTS notification_log (
  id                  SERIAL PRIMARY KEY,
  user_id             INT NULL,
  event               TEXT NOT NULL,
  channel             TEXT NOT NULL, -- whatsapp | sms | email | push | inapp
  template            TEXT NULL,
  status              TEXT NOT NULL, -- sent | failed | skipped | pending
  provider_message_id TEXT NULL,
  error               TEXT NULL,
  created_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS notification_log_user_id_idx ON notification_log (user_id);
CREATE INDEX IF NOT EXISTS notification_log_event_idx ON notification_log (event);
CREATE INDEX IF NOT EXISTS notification_log_created_at_idx ON notification_log (created_at);
