-- Migration 0025: WhatsApp Cloud API delivery tracking, opt-in consent and inbound messages (P30)
-- Safe to re-run on existing databases

ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS error_code TEXT NULL;

CREATE INDEX IF NOT EXISTS notification_log_dedupe_key_idx ON notification_log (dedupe_key);
CREATE INDEX IF NOT EXISTS notification_log_provider_msg_idx ON notification_log (provider_message_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_source TEXT NULL;

-- Default opt-in to false for all new users (existing user values stay intact)
ALTER TABLE users ALTER COLUMN whatsapp_opt_in SET DEFAULT false;

CREATE TABLE IF NOT EXISTS whatsapp_inbound (
  id              SERIAL PRIMARY KEY,
  from_phone_hash TEXT NOT NULL,
  wamid           TEXT UNIQUE NOT NULL,
  type            TEXT NULL,
  text_snippet    VARCHAR(200) NULL,
  received_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_inbound_from_phone_hash_idx ON whatsapp_inbound (from_phone_hash);
CREATE INDEX IF NOT EXISTS whatsapp_inbound_received_at_idx ON whatsapp_inbound (received_at DESC);
