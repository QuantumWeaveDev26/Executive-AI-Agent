-- ============================================================================
-- Migration: 0007_task003_token_bound_auxiliary_rls.sql
-- Description: Task 003 Phase 2 Final Correction — Token-Bound Fail-Closed RLS
--              for user_purge_cutoffs, user_purge_operations, and worker_dispatch_outbox.
--              Eliminates mutable GUC reliance (app.workspace_id, app.user_id) for
--              all remaining Task 003 persisted tenant tables.
-- ============================================================================

-- Ensure standard privilege roles exist (NOLOGIN)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_app') THEN
    CREATE ROLE thaara_app WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_admin') THEN
    CREATE ROLE thaara_admin WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_worker') THEN
    CREATE ROLE thaara_worker WITH NOLOGIN;
  END IF;
END;
$$;

-- ============================================================================
-- Section 1: Replace user_purge_cutoffs Policies
-- ============================================================================
ALTER TABLE public.user_purge_cutoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_purge_cutoffs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_and_owner_isolation_user_purge_cutoffs ON public.user_purge_cutoffs;
DROP POLICY IF EXISTS user_purge_cutoffs_select_policy ON public.user_purge_cutoffs;
DROP POLICY IF EXISTS user_purge_cutoffs_insert_policy ON public.user_purge_cutoffs;
DROP POLICY IF EXISTS user_purge_cutoffs_update_policy ON public.user_purge_cutoffs;
DROP POLICY IF EXISTS user_purge_cutoffs_delete_policy ON public.user_purge_cutoffs;

CREATE POLICY user_purge_cutoffs_select_policy ON public.user_purge_cutoffs
  FOR SELECT
  USING (
    (workspace_id, user_id) IN (
      SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s
    )
  );

CREATE POLICY user_purge_cutoffs_insert_policy ON public.user_purge_cutoffs
  FOR INSERT WITH CHECK (false);

CREATE POLICY user_purge_cutoffs_update_policy ON public.user_purge_cutoffs
  FOR UPDATE USING (false);

CREATE POLICY user_purge_cutoffs_delete_policy ON public.user_purge_cutoffs
  FOR DELETE USING (false);

-- ============================================================================
-- Section 2: Replace user_purge_operations Policies
-- ============================================================================
ALTER TABLE public.user_purge_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_purge_operations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_and_owner_isolation_user_purge_operations ON public.user_purge_operations;
DROP POLICY IF EXISTS user_purge_operations_select_policy ON public.user_purge_operations;
DROP POLICY IF EXISTS user_purge_operations_insert_policy ON public.user_purge_operations;
DROP POLICY IF EXISTS user_purge_operations_update_policy ON public.user_purge_operations;
DROP POLICY IF EXISTS user_purge_operations_delete_policy ON public.user_purge_operations;

CREATE POLICY user_purge_operations_select_policy ON public.user_purge_operations
  FOR SELECT
  USING (
    (workspace_id, user_id) IN (
      SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s
    )
  );

CREATE POLICY user_purge_operations_insert_policy ON public.user_purge_operations
  FOR INSERT WITH CHECK (false);

CREATE POLICY user_purge_operations_update_policy ON public.user_purge_operations
  FOR UPDATE USING (false);

CREATE POLICY user_purge_operations_delete_policy ON public.user_purge_operations
  FOR DELETE USING (false);

-- ============================================================================
-- Section 3: Replace worker_dispatch_outbox Policies
-- ============================================================================
ALTER TABLE public.worker_dispatch_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_dispatch_outbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_worker_dispatch_outbox ON public.worker_dispatch_outbox;
DROP POLICY IF EXISTS worker_dispatch_outbox_select_policy ON public.worker_dispatch_outbox;
DROP POLICY IF EXISTS worker_dispatch_outbox_insert_policy ON public.worker_dispatch_outbox;
DROP POLICY IF EXISTS worker_dispatch_outbox_update_policy ON public.worker_dispatch_outbox;
DROP POLICY IF EXISTS worker_dispatch_outbox_delete_policy ON public.worker_dispatch_outbox;

CREATE POLICY worker_dispatch_outbox_select_policy ON public.worker_dispatch_outbox
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT s.workspace_id FROM public.current_authenticated_scope() s
    )
  );

CREATE POLICY worker_dispatch_outbox_insert_policy ON public.worker_dispatch_outbox
  FOR INSERT WITH CHECK (false);

CREATE POLICY worker_dispatch_outbox_update_policy ON public.worker_dispatch_outbox
  FOR UPDATE USING (false);

CREATE POLICY worker_dispatch_outbox_delete_policy ON public.worker_dispatch_outbox
  FOR DELETE USING (false);

-- ============================================================================
-- Section 4: Catalog Verification Assertions
-- ============================================================================
DO $$
DECLARE
  v_old_policy_count INTEGER;
  v_new_policy_count INTEGER;
BEGIN
  -- 1. Ensure obsolete mutable-GUC policies are completely gone
  SELECT COUNT(*) INTO v_old_policy_count
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND pol.polname IN (
      'tenant_and_owner_isolation_user_purge_cutoffs',
      'tenant_and_owner_isolation_user_purge_operations',
      'tenant_isolation_worker_dispatch_outbox'
    );

  IF v_old_policy_count > 0 THEN
    RAISE EXCEPTION 'Catalog Verification Failure: Found % obsolete mutable-GUC policies on auxiliary tables', v_old_policy_count;
  END IF;

  -- 2. Verify all 12 new token-bound and direct-DML denial policies exist
  SELECT COUNT(*) INTO v_new_policy_count
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('user_purge_cutoffs', 'user_purge_operations', 'worker_dispatch_outbox')
    AND pol.polname IN (
      'user_purge_cutoffs_select_policy',
      'user_purge_cutoffs_insert_policy',
      'user_purge_cutoffs_update_policy',
      'user_purge_cutoffs_delete_policy',
      'user_purge_operations_select_policy',
      'user_purge_operations_insert_policy',
      'user_purge_operations_update_policy',
      'user_purge_operations_delete_policy',
      'worker_dispatch_outbox_select_policy',
      'worker_dispatch_outbox_insert_policy',
      'worker_dispatch_outbox_update_policy',
      'worker_dispatch_outbox_delete_policy'
    );

  IF v_new_policy_count <> 12 THEN
    RAISE EXCEPTION 'Catalog Verification Failure: Expected 12 new policies on auxiliary tables, found %', v_new_policy_count;
  END IF;

  -- 3. Verify relrowsecurity and relforcerowsecurity are active on all three tables
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('user_purge_cutoffs', 'user_purge_operations', 'worker_dispatch_outbox')
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Catalog Verification Failure: relrowsecurity or relforcerowsecurity not active on all auxiliary tables';
  END IF;
END;
$$;
