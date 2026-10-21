-- 0017 (P26): AI chat sessions and messages, ticket fields for escalations.
CREATE TABLE IF NOT EXISTS chat_sessions (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL,
  channel    TEXT NOT NULL DEFAULT 'web',                 -- web now; whatsapp reuses it later
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'escalated', 'closed')),
  ai_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions (user_id, status);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         SERIAL PRIMARY KEY,
  session_id INT NOT NULL,
  sender     TEXT NOT NULL CHECK (sender IN ('user', 'ai', 'system')),
  text       TEXT,
  tool_calls JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, id);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority        TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category        TEXT;       -- clinical | ecommerce | billing | general
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_summary      TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS chat_session_id INT;
