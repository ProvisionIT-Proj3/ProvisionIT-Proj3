-- Audit reads must go through an authorized backend rather than the public API.
-- The trusted database owner can continue inserting events with DATABASE_URL.
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;
