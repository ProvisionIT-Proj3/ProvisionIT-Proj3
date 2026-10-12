-- Which companies each user may see. Admins are not listed here, they see all.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS user_connection_access (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES connections(connection_id) ON DELETE CASCADE,
  granted_at    timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, connection_id)
);

CREATE INDEX IF NOT EXISTS user_connection_access_connection_idx
  ON user_connection_access (connection_id);

-- the backend connects as the database owner, so this only blocks the public API
ALTER TABLE user_connection_access ENABLE ROW LEVEL SECURITY;
