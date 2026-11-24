-- Migration 0002: Row Level Security Policies
-- Ensures direct queries fail closed without transaction-local request claims

-- 1. Memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_memberships ON memberships;
CREATE POLICY tenant_isolation_memberships ON memberships
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- 2. Sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_sessions ON sessions;
CREATE POLICY tenant_isolation_sessions ON sessions
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- 3. Audit Events
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_audit_events ON audit_events;
CREATE POLICY tenant_isolation_audit_events ON audit_events
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- 4. Idempotency Keys
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_idempotency_keys ON idempotency_keys;
CREATE POLICY tenant_isolation_idempotency_keys ON idempotency_keys
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- 5. Approval Requests
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_approval_requests ON approval_requests;
CREATE POLICY tenant_isolation_approval_requests ON approval_requests
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- 6. Job Runs
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_job_runs ON job_runs;
CREATE POLICY tenant_isolation_job_runs ON job_runs
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- 7. SECURITY DEFINER helpers for authentication scope resolution
-- Resolves session token hash to scope tuple without unscoped table reads
-- Search path is pinned to (pg_catalog, public) with fully qualified table references
CREATE OR REPLACE FUNCTION resolve_session_scope(p_token_hash TEXT)
RETURNS TABLE (
  session_id UUID,
  workspace_id UUID,
  user_id UUID,
  role TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.workspace_id, s.user_id, m.role, s.expires_at
  FROM public.sessions s
  INNER JOIN public.memberships m ON m.workspace_id = s.workspace_id AND m.user_id = s.user_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > NOW();
$$;

-- Retrieves memberships strictly for an authenticated user verified by email
-- Narrowed to prevent general tenant/membership enumeration or privilege escalation
CREATE OR REPLACE FUNCTION get_authenticated_user_memberships(p_user_id UUID, p_email TEXT)
RETURNS TABLE (
  id UUID,
  workspace_id UUID,
  user_id UUID,
  role TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT m.id, m.workspace_id, m.user_id, m.role, m.created_at, m.updated_at
  FROM public.memberships m
  INNER JOIN public.users u ON u.id = m.user_id
  WHERE m.user_id = p_user_id
    AND u.email = p_email;
$$;

-- 8. Non-Superuser Application Role for strict RLS enforcement (created NOLOGIN; credentials provisioned separately by admin)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'thaara_app') THEN
    CREATE ROLE thaara_app WITH NOLOGIN;
  END IF;
END
$$;

-- Hardened Schema Privileges:
-- Revoke CREATE on public from PUBLIC and thaara_app so thaara_app cannot create objects
REVOKE ALL ON SCHEMA public FROM thaara_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM thaara_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Grant minimal necessary DML and schema usage to thaara_app
GRANT USAGE ON SCHEMA public TO thaara_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO thaara_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO thaara_app;

-- Explicitly grant execution on auth functions only to thaara_app (never PUBLIC)
REVOKE EXECUTE ON FUNCTION resolve_session_scope(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_session_scope(TEXT) TO thaara_app;

REVOKE EXECUTE ON FUNCTION get_authenticated_user_memberships(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_authenticated_user_memberships(UUID, TEXT) TO thaara_app;

-- Ensure future functions created by admin also do not default to PUBLIC execute
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO thaara_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO thaara_app;

