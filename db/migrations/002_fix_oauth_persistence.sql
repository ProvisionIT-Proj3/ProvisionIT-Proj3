-- Aligns the database schema with the OAuth persistence contract used by the
-- Xero and QuickBooks connection stores. Safe to run more than once.

CREATE TABLE IF NOT EXISTS oauth_credentials (
  credential_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        varchar NOT NULL,
  access_token    text,
  refresh_token   text,
  token_expires_at timestamp with time zone,
  status          varchar NOT NULL DEFAULT 'active',
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at      timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE oauth_credentials
  ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS credential_id uuid,
  ADD COLUMN IF NOT EXISTS external_connection_id varchar,
  ADD COLUMN IF NOT EXISTS external_account_id varchar,
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'connections_credential_id_fkey'
      AND conrelid = 'connections'::regclass
  ) THEN
    ALTER TABLE connections
      ADD CONSTRAINT connections_credential_id_fkey
      FOREIGN KEY (credential_id)
      REFERENCES oauth_credentials(credential_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS connections_credential_id_idx
  ON connections (credential_id);
