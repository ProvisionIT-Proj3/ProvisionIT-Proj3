-- Immutable-style security and access audit events. Application code only
-- inserts rows; no update or delete helpers are exposed by the persistence API.
-- Runs after main's 003_enable_rls.sql and the access-control migrations.

CREATE TABLE IF NOT EXISTS security_audit_log (
  audit_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at    timestamp with time zone NOT NULL DEFAULT now(),
  actor_user_id  uuid,
  connection_id  uuid,
  provider       varchar(32),
  action         varchar(80) NOT NULL,
  outcome        varchar(16) NOT NULL
                 CHECK (outcome IN ('success', 'failure', 'denied')),
  error_code     varchar(128),
  request_id     varchar(128),
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS security_audit_log_occurred_at_idx
  ON security_audit_log (occurred_at DESC);

CREATE INDEX IF NOT EXISTS security_audit_log_actor_user_id_idx
  ON security_audit_log (actor_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS security_audit_log_connection_id_idx
  ON security_audit_log (connection_id, occurred_at DESC);
