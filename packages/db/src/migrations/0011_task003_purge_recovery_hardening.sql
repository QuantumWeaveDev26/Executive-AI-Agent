-- ============================================================================
-- Migration: 0011_task003_purge_recovery_hardening.sql
-- Description: Task 003 Phase 4 Durability Hardening —
--              Explicit postgres ownership, exact grant assertions,
--              dispatched outbox grace interval, and safe JSON payload matching.
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

-- Drop legacy 3-parameter function overloads to prevent bypass or ambiguous resolution
DROP FUNCTION IF EXISTS public.recover_stranded_purge_operations(TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.claim_unrecovered_purge_continuations(TEXT, INTEGER, INTEGER);

-- ============================================================================
-- Section 1: Procedure recover_stranded_purge_operations (Hardened)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recover_stranded_purge_operations(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 10,
  p_lease_extension_seconds INTEGER DEFAULT 300,
  p_dispatched_grace_seconds INTEGER DEFAULT 300
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
            -- Safe string-to-string comparison without unsafe UUID cast from untrusted payload
            AND o.payload->>'operation_id' = u.id::text
            AND (
              o.status = 'pending'
              OR (o.status = 'claimed' AND o.lease_expires_at > pg_catalog.now())
              OR (
                o.status = 'dispatched'
                AND COALESCE(o.dispatched_at, o.updated_at) > pg_catalog.now() - (p_dispatched_grace_seconds || ' seconds')::interval
              )
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
-- Section 2: Procedure claim_unrecovered_purge_continuations (Delegating)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_unrecovered_purge_continuations(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 10,
  p_lease_extension_seconds INTEGER DEFAULT 300,
  p_dispatched_grace_seconds INTEGER DEFAULT 300
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
    p_lease_extension_seconds,
    p_dispatched_grace_seconds
  );
END;
$$;

-- ============================================================================
-- Section 3: Ownership and Grants
-- ============================================================================

ALTER FUNCTION public.recover_stranded_purge_operations(TEXT, INTEGER, INTEGER, INTEGER) OWNER TO postgres;
ALTER FUNCTION public.claim_unrecovered_purge_continuations(TEXT, INTEGER, INTEGER, INTEGER) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.recover_stranded_purge_operations(TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, thaara_app;
REVOKE ALL ON FUNCTION public.claim_unrecovered_purge_continuations(TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, thaara_app;

GRANT EXECUTE ON FUNCTION public.recover_stranded_purge_operations(TEXT, INTEGER, INTEGER, INTEGER) TO thaara_worker;
GRANT EXECUTE ON FUNCTION public.claim_unrecovered_purge_continuations(TEXT, INTEGER, INTEGER, INTEGER) TO thaara_worker;

-- ============================================================================
-- Section 4: Catalog Assertions
-- ============================================================================

DO $$
DECLARE
  v_proc_name TEXT;
  v_count INTEGER;
  v_postgres_oid OID;
BEGIN
  SELECT oid INTO v_postgres_oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres';

  IF v_postgres_oid IS NULL THEN
    RAISE EXCEPTION 'Assertion failed: postgres role not found';
  END IF;

  FOREACH v_proc_name IN ARRAY ARRAY[
    'recover_stranded_purge_operations',
    'claim_unrecovered_purge_continuations'
  ]
  LOOP
    -- 1. Exact count assertion: exactly 1 function definition exists in public schema (no overloads)
    SELECT count(*) INTO v_count
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = v_proc_name;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Assertion failed: expected exactly 1 function named %, found %', v_proc_name, v_count;
    END IF;

    -- 2. Security definer, owner postgres, pinned search_path
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_proc_name
        AND p.prosecdef = true
        AND p.proowner = v_postgres_oid
        AND array_to_string(p.proconfig, ',') LIKE '%search_path=pg_catalog, public, pg_temp%'
    ) THEN
      RAISE EXCEPTION 'Assertion failed: function % failed security definer, owner postgres, or pinned search_path check', v_proc_name;
    END IF;

    -- 3. Exact privilege isolation: thaara_worker has EXECUTE, thaara_app and PUBLIC do NOT
    IF NOT (
      SELECT bool_and(
        has_function_privilege('thaara_worker', p.oid, 'EXECUTE') = true
        AND has_function_privilege('thaara_app', p.oid, 'EXECUTE') = false
        AND has_function_privilege('public', p.oid, 'EXECUTE') = false
      )
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_proc_name
    ) THEN
      RAISE EXCEPTION 'Assertion failed: privilege isolation check failed for % (worker=true, app=false, public=false)', v_proc_name;
    END IF;
  END LOOP;
END;
$$;
