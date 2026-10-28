CREATE TABLE IF NOT EXISTS garages (id TEXT PRIMARY KEY, state JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS accounts (email TEXT PRIMARY KEY, hash TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE accounts ALTER COLUMN hash DROP NOT NULL;
CREATE TABLE IF NOT EXISTS google_identities (
  subject TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE REFERENCES accounts(email)
);
CREATE TABLE IF NOT EXISTS google_auth_requests (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  email TEXT NOT NULL REFERENCES accounts(email), garage_id TEXT NOT NULL REFERENCES garages(id), user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','mechanic','reception')), PRIMARY KEY(email,garage_id), UNIQUE(garage_id,user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, garage_id TEXT NOT NULL REFERENCES garages(id), user_id TEXT NOT NULL,
  account_email TEXT REFERENCES accounts(email), expires BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_email);
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, garage_id TEXT NOT NULL REFERENCES garages(id), email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('mechanic','reception')), expires BIGINT NOT NULL, UNIQUE(garage_id,email)
);
