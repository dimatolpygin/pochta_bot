-- Whitelist of allowed users
CREATE TABLE IF NOT EXISTS whitelist (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User sessions (finite state machine)
CREATE TABLE IF NOT EXISTS sessions (
  session_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  state TEXT DEFAULT 'IDLE',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'active'
);

-- Deduplication of processed Telegram messages
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT now()
);

-- Log of each generation attempt
CREATE TABLE IF NOT EXISTS generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  user_id TEXT,
  recipient_email TEXT,
  upd_data JSONB,
  seed INTEGER,
  letter_count INTEGER,
  errors TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Light history: only params, not full texts
CREATE TABLE IF NOT EXISTS generation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed INTEGER,
  persona TEXT,
  length_templates JSONB,
  tech_params JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast session lookup by user
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
