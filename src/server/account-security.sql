CREATE TABLE IF NOT EXISTS account_security (
  email TEXT PRIMARY KEY REFERENCES accounts(email) ON UPDATE CASCADE ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  secret TEXT,
  pending_secret TEXT,
  pending_expires BIGINT,
  last_step BIGINT NOT NULL DEFAULT -1,
  recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS two_factor_challenges (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES accounts(email) ON UPDATE CASCADE ON DELETE CASCADE,
  target JSONB NOT NULL,
  expires BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS id TEXT NOT NULL DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_public_id ON sessions(id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at BIGINT NOT NULL DEFAULT floor(extract(epoch FROM now())*1000)::bigint;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen BIGINT NOT NULL DEFAULT floor(extract(epoch FROM now())*1000)::bigint;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS authenticated_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';
