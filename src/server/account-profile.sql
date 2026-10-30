ALTER TABLE accounts ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar TEXT;

-- Email remains the account key; changing it must preserve every garage membership and identity.
DO $$
DECLARE item RECORD;
BEGIN
  FOR item IN
    SELECT c.conrelid::regclass AS relation, c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c WHERE c.contype='f' AND c.confrelid='accounts'::regclass AND c.confupdtype<>'c'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.relation, item.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', item.relation, item.conname,
      regexp_replace(item.definition, ' ON UPDATE (NO ACTION|RESTRICT|SET NULL|SET DEFAULT)', '') || ' ON UPDATE CASCADE');
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS account_email_changes (
  account_email TEXT PRIMARY KEY REFERENCES accounts(email) ON UPDATE CASCADE ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  new_email TEXT NOT NULL,
  new_code_hash TEXT NOT NULL,
  old_code_hash TEXT,
  password_snapshot TEXT,
  expires BIGINT NOT NULL,
  created BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  ready BOOLEAN NOT NULL DEFAULT false
);
