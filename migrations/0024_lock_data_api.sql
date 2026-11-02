-- Lock Supabase's public Data API (PostgREST) out of every table.
--
-- The portal NEVER uses the Data API or the anon key: all access is direct
-- Postgres via Hyperdrive, connecting as the table owner — and row level
-- security does not apply to a table's owner, so the app is unaffected.
-- Tables were created in the public schema with RLS off, which Supabase
-- exposes to anyone holding the project's anon key (reported against prod
-- 2026-11). RLS-on with NO policies denies the api roles everything; the
-- revokes and default-privilege changes make it belt-and-braces, including
-- for tables future migrations add.
DO $$
DECLARE t record; r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END $$;
