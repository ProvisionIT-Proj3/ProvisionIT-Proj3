-- Turns on Row Level Security for every table in the public schema, with NO
-- policies. That means the public (anon) key and logged-in users get nothing
-- when they query the tables directly through Supabase's REST API.
--
-- Why this matters: the portal ships the anon key inside its JavaScript, so
-- anyone can read it. Without RLS that key could read the connections and
-- oauth_credentials tables straight from Supabase, skipping the API entirely.
--
-- The API is NOT affected: it connects with DATABASE_URL as the `postgres`
-- role, which bypasses RLS. CHECK THAT FIRST, on the same connection string the
-- API uses:
--     select rolbypassrls from pg_roles where rolname = current_user;   -- must be true
-- If that returns false, do not run this migration, the API would lose access.
--
-- Run it on staging first and confirm sync and the portal still work.
-- Safe to run more than once. To undo one table:
--     alter table public.<name> disable row level security;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
