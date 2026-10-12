-- Admins bypass tenant checks, so this table stores only user-specific grants.

CREATE TABLE IF NOT EXISTS user_connection_access (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES connections(connection_id) ON DELETE CASCADE,
  granted_at    timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, connection_id)
);

CREATE INDEX IF NOT EXISTS user_connection_access_connection_idx
  ON user_connection_access (connection_id);

-- The backend connects as the database owner; RLS blocks direct public API access.
ALTER TABLE user_connection_access ENABLE ROW LEVEL SECURITY;
