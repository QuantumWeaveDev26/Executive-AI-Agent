-- ============================================================================
-- Migration: 0010_task003_purge_recovery_after_claim.sql
-- Description: Task 003 Phase 4 Durability Correction —
--              Atomic recovery for expired running operations without pending
--              continuation and retryable pending operations without durable dispatch.
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
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_seeder') THEN
    CREATE ROLE thaara_seeder WITH NOLOGIN;
  END IF;
END;
$$;

-- Index supporting fast lookup of stranded running or pending operations
CREATE INDEX IF NOT EXISTS idx_user_purge_operations_recovery
  ON public.user_purge_operations (status, lease_expires_at)
  WHERE status IN ('running', 'pending');

-- ============================================================================
-- Section 1: Procedure recover_stranded_purge_operations
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recover_stranded_purge_operations(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 10,
  p_lease_extension_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  operation_id UUID,
  workspace_id UUID,
  user_id UUID,
  generation INTEGER,
  mode TEXT,
  cutoff_at TIMESTAMPTZ,
  continuation_sequence INTEGER,
  continuation_token UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_rec RECORD;
  v_token UUID;
  v_lease_token UUID;
  v_seq INTEGER;
  v_expires TIMESTAMPTZ := pg_catalog.now() + (p_lease_extension_seconds || ' seconds')::interval;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'Worker identifier is required';
  END IF;

  FOR v_rec IN
    SELECT *
    FROM public.user_purge_operations u
    WHERE
      -- Case a: Expired running operations (with or without pending continuation)
      (
        u.status = 'running'
        AND u.lease_expires_at < pg_catalog.now()
      )
      OR
      -- Case b: Retryable pending operations with no active durable dispatch
      (
        u.status = 'pending'
        AND (u.lease_expires_at IS NULL OR u.lease_expires_at < pg_catalog.now())
        AND NOT EXISTS (
          SELECT 1
          FROM public.worker_dispatch_outbox o
          WHERE o.topic = 'privacy_purge'
            AND (o.payload->>'operation_id')::uuid = u.id
            AND (
              o.status = 'pending'
              OR (o.status = 'claimed' AND o.lease_expires_at > pg_catalog.now())
            )
        )
      )
    ORDER BY u.updated_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Terminal failure if maximum attempts exceeded
    IF v_rec.attempts >= v_rec.max_attempts THEN
      UPDATE public.user_purge_operations
      SET status = 'failed',
          continuation_pending = FALSE,
          continuation_token = NULL,
          lease_token = NULL,
          lease_worker_id = NULL,
          lease_expires_at = NULL,
          error_code = 'PURGE_MAX_ATTEMPTS_EXCEEDED',
          error_category = 'TRANSIENT_INFRASTRUCTURE',
          updated_at = pg_catalog.now()
      WHERE public.user_purge_operations.id = v_rec.id;

      INSERT INTO public.audit_events (
        workspace_id,
        actor_user_id,
        action,
        target_type,
        target_id,
        payload
      ) VALUES (
        v_rec.workspace_id,
        v_rec.user_id,
        'privacy.purge_failed',
        'user_purge_operation',
        v_rec.id::text,
        jsonb_build_object(
          'generation', v_rec.generation,
          'mode', v_rec.mode,
          'error_code', 'PURGE_MAX_ATTEMPTS_EXCEEDED',
          'error_category', 'TRANSIENT_INFRASTRUCTURE',
          'attempts', v_rec.attempts
        )
      );
    ELSE
      -- Persist fresh durable continuation identity and unseat stale lease
      v_lease_token := pg_catalog.gen_random_uuid();
      v_token := COALESCE(v_rec.continuation_token, pg_catalog.gen_random_uuid());
      v_seq := CASE
        WHEN v_rec.continuation_token IS NULL THEN v_rec.continuation_sequence + 1
        ELSE v_rec.continuation_sequence
      END;

      UPDATE public.user_purge_operations
      SET status = 'running',
          attempts = public.user_purge_operations.attempts + 1,
          continuation_sequence = v_seq,
          continuation_token = v_token,
          continuation_pending = TRUE,
          lease_token = v_lease_token,
          lease_worker_id = p_worker_id,
          lease_expires_at = v_expires,
          updated_at = pg_catalog.now()
      WHERE public.user_purge_operations.id = v_rec.id;

      operation_id := v_rec.id;
      workspace_id := v_rec.workspace_id;
      user_id := v_rec.user_id;
      generation := v_rec.generation;
      mode := v_rec.mode;
      cutoff_at := v_rec.cutoff_at;
      continuation_sequence := v_seq;
      continuation_token := v_token;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================================
-- Section 2: Update claim_unrecovered_purge_continuations to delegate to recover_stranded_purge_operations
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_unrecovered_purge_continuations(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 10,
  p_lease_extension_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  operation_id UUID,
  workspace_id UUID,
  user_id UUID,
  generation INTEGER,
  mode TEXT,
  cutoff_at TIMESTAMPTZ,
  continuation_sequence INTEGER,
  continuation_token UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.recover_stranded_purge_operations(
    p_worker_id,
    p_batch_size,
    p_lease_extension_seconds
  );
END;
$$;

-- ============================================================================
-- Section 3: Privileges & Grants
-- ============================================================================

REVOKE ALL ON FUNCTION public.recover_stranded_purge_operations(TEXT, INTEGER, INTEGER) FROM PUBLIC, thaara_app;
REVOKE ALL ON FUNCTION public.claim_unrecovered_purge_continuations(TEXT, INTEGER, INTEGER) FROM PUBLIC, thaara_app;

GRANT EXECUTE ON FUNCTION public.recover_stranded_purge_operations(TEXT, INTEGER, INTEGER) TO thaara_worker;
GRANT EXECUTE ON FUNCTION public.claim_unrecovered_purge_continuations(TEXT, INTEGER, INTEGER) TO thaara_worker;

-- ============================================================================
-- Section 4: Catalog Assertions
-- ============================================================================

DO $$
DECLARE
  v_missing_proc TEXT;
BEGIN
  FOREACH v_missing_proc IN ARRAY ARRAY[
    'recover_stranded_purge_operations',
    'claim_unrecovered_purge_continuations'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_missing_proc
        AND p.prosecdef = true
        AND array_to_string(p.proconfig, ',') LIKE '%search_path=pg_catalog, public, pg_temp%'
    ) THEN
      RAISE EXCEPTION 'Assertion failed: procedure % is missing, not SECURITY DEFINER, or search_path is unpinned', v_missing_proc;
    END IF;
  END LOOP;
END;
$$;
