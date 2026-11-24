-- ============================================================================
-- Migration: 0009_task003_privacy_purge_and_outbox_hardening.sql
-- Description: Task 003 Phase 4 — Privacy Purge Continuation Identity,
--              Strict Lease Expiration Fencing, Outbox Hardening,
--              Sole-Owner Account Closure Protection, and Recovery Procedures.
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

-- ============================================================================
-- Section 1: Additive Columns to user_purge_operations
-- ============================================================================

ALTER TABLE public.user_purge_operations
  ADD COLUMN IF NOT EXISTS continuation_sequence INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS continuation_token UUID,
  ADD COLUMN IF NOT EXISTS continuation_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_user_purge_operations_continuation
  ON public.user_purge_operations (status, continuation_pending, lease_expires_at);

-- ============================================================================
-- Section 2: Procedure schedule_purge_continuation (Idempotent)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.schedule_purge_continuation(
  p_operation_id UUID,
  p_lease_token UUID,
  p_worker_id TEXT,
  p_extension_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  continuation_sequence INTEGER,
  continuation_token UUID,
  lease_expires_at TIMESTAMPTZ,
  already_pending BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_op RECORD;
  v_token UUID;
  v_expires TIMESTAMPTZ := pg_catalog.now() + (p_extension_seconds || ' seconds')::interval;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'Worker identifier is required';
  END IF;

  SELECT *
  INTO v_op
  FROM public.user_purge_operations
  WHERE public.user_purge_operations.id = p_operation_id
    AND public.user_purge_operations.lease_token = p_lease_token
    AND public.user_purge_operations.lease_worker_id = p_worker_id
    AND public.user_purge_operations.status = 'running'
    AND public.user_purge_operations.lease_expires_at > pg_catalog.now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purge fence violation: invalid or expired lease for operation %', p_operation_id;
  END IF;

  -- Idempotency: if a continuation is already pending, return existing token and sequence
  IF v_op.continuation_pending THEN
    RETURN QUERY SELECT v_op.continuation_sequence, v_op.continuation_token, v_op.lease_expires_at, TRUE;
    RETURN;
  END IF;

  v_token := pg_catalog.gen_random_uuid();

  UPDATE public.user_purge_operations
  SET continuation_sequence = v_op.continuation_sequence + 1,
      continuation_token = v_token,
      continuation_pending = TRUE,
      lease_expires_at = v_expires,
      updated_at = pg_catalog.now()
  WHERE public.user_purge_operations.id = p_operation_id;

  RETURN QUERY SELECT v_op.continuation_sequence + 1, v_token, v_expires, FALSE;
END;
$$;

-- ============================================================================
-- Section 3: Procedure claim_purge_continuation (Attempt-Accounted)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_purge_continuation(
  p_operation_id UUID,
  p_continuation_token UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_op RECORD;
  v_new_token UUID := pg_catalog.gen_random_uuid();
  v_expires TIMESTAMPTZ := pg_catalog.now() + (p_lease_seconds || ' seconds')::interval;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'Worker identifier is required';
  END IF;

  SELECT *
  INTO v_op
  FROM public.user_purge_operations
  WHERE public.user_purge_operations.id = p_operation_id
    AND public.user_purge_operations.continuation_token = p_continuation_token
    AND public.user_purge_operations.continuation_pending = TRUE
    AND public.user_purge_operations.status = 'running'
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Duplicate delivery or continuation already resolved: return empty
    RETURN;
  END IF;

  -- Terminal failure if attempts exhausted
  IF v_op.attempts >= v_op.max_attempts THEN
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
    WHERE public.user_purge_operations.id = p_operation_id;

    INSERT INTO public.audit_events (
      workspace_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      payload
    ) VALUES (
      v_op.workspace_id,
      v_op.user_id,
      'privacy.purge_failed',
      'user_purge_operation',
      p_operation_id::text,
      jsonb_build_object(
        'generation', v_op.generation,
        'mode', v_op.mode,
        'error_code', 'PURGE_MAX_ATTEMPTS_EXCEEDED',
        'error_category', 'TRANSIENT_INFRASTRUCTURE',
        'attempts', v_op.attempts
      )
    );

    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, 'failed'::text;
    RETURN;
  END IF;

  -- Atomically increment attempts and issue fresh lease
  UPDATE public.user_purge_operations
  SET attempts = public.user_purge_operations.attempts + 1,
      continuation_pending = FALSE,
      continuation_token = NULL,
      lease_token = v_new_token,
      lease_worker_id = p_worker_id,
      lease_expires_at = v_expires,
      updated_at = pg_catalog.now()
  WHERE public.user_purge_operations.id = p_operation_id;

  RETURN QUERY SELECT v_new_token, v_expires, 'running'::text;
END;
$$;

-- ============================================================================
-- Section 4: Procedure claim_unrecovered_purge_continuations (Recovery Sweeper)
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
#variable_conflict use_column
DECLARE
  v_expired_rec RECORD;
  v_token UUID;
  v_expires TIMESTAMPTZ := pg_catalog.now() + (p_lease_extension_seconds || ' seconds')::interval;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'Worker identifier is required';
  END IF;

  FOR v_expired_rec IN
    SELECT *
    FROM public.user_purge_operations
    WHERE public.user_purge_operations.status = 'running'
      AND public.user_purge_operations.continuation_pending = TRUE
      AND public.user_purge_operations.lease_expires_at < pg_catalog.now()
    ORDER BY public.user_purge_operations.updated_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    IF v_expired_rec.attempts >= v_expired_rec.max_attempts THEN
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
      WHERE public.user_purge_operations.id = v_expired_rec.id;

      INSERT INTO public.audit_events (
        workspace_id,
        actor_user_id,
        action,
        target_type,
        target_id,
        payload
      ) VALUES (
        v_expired_rec.workspace_id,
        v_expired_rec.user_id,
        'privacy.purge_failed',
        'user_purge_operation',
        v_expired_rec.id::text,
        jsonb_build_object(
          'generation', v_expired_rec.generation,
          'mode', v_expired_rec.mode,
          'error_code', 'PURGE_MAX_ATTEMPTS_EXCEEDED',
          'error_category', 'TRANSIENT_INFRASTRUCTURE',
          'attempts', v_expired_rec.attempts
        )
      );
    ELSE
      v_token := pg_catalog.gen_random_uuid();
      UPDATE public.user_purge_operations
      SET attempts = public.user_purge_operations.attempts + 1,
          lease_token = v_token,
          lease_worker_id = p_worker_id,
          lease_expires_at = v_expires,
          updated_at = pg_catalog.now()
      WHERE public.user_purge_operations.id = v_expired_rec.id;

      operation_id := v_expired_rec.id;
      workspace_id := v_expired_rec.workspace_id;
      user_id := v_expired_rec.user_id;
      generation := v_expired_rec.generation;
      mode := v_expired_rec.mode;
      cutoff_at := v_expired_rec.cutoff_at;
      continuation_sequence := v_expired_rec.continuation_sequence;
      continuation_token := v_expired_rec.continuation_token;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================================
-- Section 5: Hardened complete_purge_operation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_purge_operation(
  p_operation_id UUID,
  p_lease_token UUID,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_op RECORD;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'Worker identifier is required';
  END IF;

  SELECT *
  INTO v_op
  FROM public.user_purge_operations
  WHERE public.user_purge_operations.id = p_operation_id
    AND public.user_purge_operations.lease_token = p_lease_token
    AND public.user_purge_operations.lease_worker_id = p_worker_id
    AND public.user_purge_operations.status = 'running'
    AND public.user_purge_operations.lease_expires_at > pg_catalog.now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purge fence violation: invalid or expired lease for operation %', p_operation_id;
  END IF;

  -- Completion barrier: cannot complete if continuation is pending
  IF v_op.continuation_pending THEN
    RAISE EXCEPTION 'Cannot complete purge operation %: continuation is currently pending', p_operation_id;
  END IF;

  -- Prerequisite checkpoint validation
  IF NOT (v_op.checkpoint_messages_completed AND v_op.checkpoint_conversations_completed AND v_op.checkpoint_memories_completed) THEN
    RAISE EXCEPTION 'Cannot complete purge operation %: prerequisite checkpoints incomplete (messages: %, conversations: %, memories: %)',
      p_operation_id, v_op.checkpoint_messages_completed, v_op.checkpoint_conversations_completed, v_op.checkpoint_memories_completed;
  END IF;

  -- Sole-owner account closure policy
  IF v_op.mode = 'account_closure' THEN
    IF EXISTS (
      SELECT 1 FROM public.memberships
      WHERE workspace_id = v_op.workspace_id AND user_id = v_op.user_id AND role = 'owner'
    ) THEN
      IF (
        SELECT count(*) FROM public.memberships
        WHERE workspace_id = v_op.workspace_id AND role = 'owner' AND user_id <> v_op.user_id
      ) = 0 THEN
        RAISE EXCEPTION 'Cannot close account: user is the sole owner of workspace %. Transfer ownership or delete workspace first.', v_op.workspace_id;
      END IF;
    END IF;

    DELETE FROM public.memberships
    WHERE workspace_id = v_op.workspace_id AND user_id = v_op.user_id;

    UPDATE public.user_purge_operations
    SET checkpoint_membership_completed = TRUE
    WHERE public.user_purge_operations.id = p_operation_id;
  END IF;

  UPDATE public.user_purge_operations
  SET status = 'completed',
      completed_at = pg_catalog.now(),
      lease_token = NULL,
      lease_worker_id = NULL,
      lease_expires_at = NULL,
      continuation_pending = FALSE,
      continuation_token = NULL,
      updated_at = pg_catalog.now()
  WHERE public.user_purge_operations.id = p_operation_id;

  INSERT INTO public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    payload
  ) VALUES (
    v_op.workspace_id,
    v_op.user_id,
    'privacy.purge_completed',
    'user_purge_operation',
    p_operation_id::text,
    jsonb_build_object(
      'generation', v_op.generation,
      'mode', v_op.mode,
      'cutoff_at', v_op.cutoff_at
    )
  );

  RETURN TRUE;
END;
$$;

-- ============================================================================
-- Section 6: Hardened fail_purge_operation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fail_purge_operation(
  p_operation_id UUID,
  p_lease_token UUID,
  p_worker_id TEXT,
  p_error_code TEXT,
  p_error_category TEXT,
  p_terminal BOOLEAN DEFAULT false
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_op RECORD;
  v_terminal BOOLEAN;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'Worker identifier is required';
  END IF;

  SELECT *
  INTO v_op
  FROM public.user_purge_operations
  WHERE public.user_purge_operations.id = p_operation_id
    AND public.user_purge_operations.lease_token = p_lease_token
    AND public.user_purge_operations.lease_worker_id = p_worker_id
    AND public.user_purge_operations.status = 'running'
    AND public.user_purge_operations.lease_expires_at > pg_catalog.now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purge fence violation: cannot fail operation without active lease %', p_operation_id;
  END IF;

  v_terminal := p_terminal OR (v_op.attempts >= v_op.max_attempts);

  UPDATE public.user_purge_operations
  SET status = CASE WHEN v_terminal THEN 'failed' ELSE 'pending' END,
      continuation_pending = FALSE,
      continuation_token = NULL,
      lease_token = NULL,
      lease_worker_id = NULL,
      lease_expires_at = NULL,
      error_code = p_error_code,
      error_category = p_error_category,
      updated_at = pg_catalog.now()
  WHERE public.user_purge_operations.id = p_operation_id;

  IF v_terminal THEN
    INSERT INTO public.audit_events (
      workspace_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      payload
    ) VALUES (
      v_op.workspace_id,
      v_op.user_id,
      'privacy.purge_failed',
      'user_purge_operation',
      p_operation_id::text,
      jsonb_build_object(
        'generation', v_op.generation,
        'mode', v_op.mode,
        'error_code', p_error_code,
        'error_category', p_error_category,
        'attempts', v_op.attempts
      )
    );
  END IF;

  RETURN TRUE;
END;
$$;

-- ============================================================================
-- Section 7: Hardened mark_outbox_failed
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_outbox_failed(
  p_outbox_id UUID,
  p_claim_token UUID,
  p_error_code TEXT,
  p_error_category TEXT,
  p_terminal BOOLEAN DEFAULT false
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_rec RECORD;
  v_terminal BOOLEAN;
BEGIN
  SELECT *
  INTO v_rec
  FROM public.worker_dispatch_outbox
  WHERE public.worker_dispatch_outbox.id = p_outbox_id
    AND public.worker_dispatch_outbox.claim_token = p_claim_token
    AND public.worker_dispatch_outbox.status = 'claimed'
    AND public.worker_dispatch_outbox.lease_expires_at >= pg_catalog.now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  v_terminal := p_terminal OR (v_rec.attempts >= v_rec.max_attempts);

  UPDATE public.worker_dispatch_outbox
  SET status = CASE WHEN v_terminal THEN 'failed' ELSE 'pending' END,
      error_code = p_error_code,
      error_category = p_error_category,
      claim_token = NULL,
      lease_expires_at = NULL,
      updated_at = pg_catalog.now()
  WHERE public.worker_dispatch_outbox.id = p_outbox_id;

  IF v_terminal THEN
    INSERT INTO public.audit_events (
      workspace_id,
      action,
      target_type,
      target_id,
      payload
    ) VALUES (
      v_rec.workspace_id,
      'outbox.dispatch_failed',
      'worker_dispatch_outbox',
      p_outbox_id::text,
      jsonb_build_object(
        'topic', v_rec.topic,
        'dedup_key', v_rec.dedup_key,
        'error_code', p_error_code,
        'error_category', p_error_category,
        'attempts', v_rec.attempts
      )
    );
  END IF;

  RETURN TRUE;
END;
$$;

-- ============================================================================
-- Section 7B: Procedure get_purge_operation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_purge_operation(
  p_operation_id UUID
)
RETURNS SETOF public.user_purge_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.user_purge_operations
  WHERE public.user_purge_operations.id = p_operation_id;
END;
$$;

-- ============================================================================
-- Section 8: Privilege Grants & Security Controls
-- ============================================================================

ALTER FUNCTION public.schedule_purge_continuation(UUID, UUID, TEXT, INTEGER) OWNER TO postgres;
ALTER FUNCTION public.claim_purge_continuation(UUID, UUID, TEXT, INTEGER) OWNER TO postgres;
ALTER FUNCTION public.claim_unrecovered_purge_continuations(TEXT, INTEGER, INTEGER) OWNER TO postgres;
ALTER FUNCTION public.complete_purge_operation(UUID, UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.fail_purge_operation(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.mark_outbox_failed(UUID, UUID, TEXT, TEXT, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.get_purge_operation(UUID) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.schedule_purge_continuation(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, thaara_app;
REVOKE ALL ON FUNCTION public.claim_purge_continuation(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, thaara_app;
REVOKE ALL ON FUNCTION public.claim_unrecovered_purge_continuations(TEXT, INTEGER, INTEGER) FROM PUBLIC, thaara_app;
REVOKE ALL ON FUNCTION public.complete_purge_operation(UUID, UUID, TEXT) FROM PUBLIC, thaara_app;
REVOKE ALL ON FUNCTION public.fail_purge_operation(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, thaara_app;
REVOKE ALL ON FUNCTION public.mark_outbox_failed(UUID, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, thaara_app;
REVOKE ALL ON FUNCTION public.get_purge_operation(UUID) FROM PUBLIC, thaara_app;

GRANT EXECUTE ON FUNCTION public.schedule_purge_continuation(UUID, UUID, TEXT, INTEGER) TO thaara_worker;
GRANT EXECUTE ON FUNCTION public.claim_purge_continuation(UUID, UUID, TEXT, INTEGER) TO thaara_worker;
GRANT EXECUTE ON FUNCTION public.claim_unrecovered_purge_continuations(TEXT, INTEGER, INTEGER) TO thaara_worker;
GRANT EXECUTE ON FUNCTION public.complete_purge_operation(UUID, UUID, TEXT) TO thaara_worker;
GRANT EXECUTE ON FUNCTION public.fail_purge_operation(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) TO thaara_worker;
GRANT EXECUTE ON FUNCTION public.mark_outbox_failed(UUID, UUID, TEXT, TEXT, BOOLEAN) TO thaara_worker;
GRANT EXECUTE ON FUNCTION public.get_purge_operation(UUID) TO thaara_worker;

-- ============================================================================
-- Section 9: Catalog Assertions
-- ============================================================================

DO $$
DECLARE
  v_missing_proc TEXT;
BEGIN
  -- Verify columns exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_purge_operations' AND column_name = 'continuation_sequence'
  ) THEN
    RAISE EXCEPTION 'Assertion failed: column continuation_sequence missing from user_purge_operations';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_purge_operations' AND column_name = 'continuation_token'
  ) THEN
    RAISE EXCEPTION 'Assertion failed: column continuation_token missing from user_purge_operations';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_purge_operations' AND column_name = 'continuation_pending'
  ) THEN
    RAISE EXCEPTION 'Assertion failed: column continuation_pending missing from user_purge_operations';
  END IF;

  -- Verify procedures exist with pinned search path
  FOREACH v_missing_proc IN ARRAY ARRAY[
    'schedule_purge_continuation',
    'claim_purge_continuation',
    'claim_unrecovered_purge_continuations',
    'complete_purge_operation',
    'fail_purge_operation',
    'mark_outbox_failed',
    'get_purge_operation'
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
