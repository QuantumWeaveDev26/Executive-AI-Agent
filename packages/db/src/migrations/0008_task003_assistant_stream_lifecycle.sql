-- ============================================================================
-- Migration: 0008_task003_assistant_stream_lifecycle.sql
-- Description: Task 003 Phase 3 — Durable Assistant Stream & Immutable Event
--              Lifecycle, Reciprocal Bidirectional Constraint Trigger, Token-Bound
--              Executive Streaming Boundaries, Direct-DML Denial, and Server-Owned
--              Worker Stale Recovery.
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
-- Section 1: Additive Evolution of conversation_messages
-- ============================================================================

-- Make sender_id nullable for assistant messages
ALTER TABLE public.conversation_messages ALTER COLUMN sender_id DROP NOT NULL;

-- Replace existing sender type checks with additive valid sender check
ALTER TABLE public.conversation_messages DROP CONSTRAINT IF EXISTS chk_conversation_messages_sender_type;
ALTER TABLE public.conversation_messages DROP CONSTRAINT IF EXISTS chk_conversation_messages_sender_match;

ALTER TABLE public.conversation_messages ADD CONSTRAINT chk_conversation_messages_sender_valid CHECK (
  (sender_type = 'user' AND sender_id IS NOT NULL AND sender_id = user_id)
  OR
  (sender_type = 'assistant' AND sender_id IS NULL)
);

-- Add assistant_stream_id column with unique constraint per conversation and stream binding check
ALTER TABLE public.conversation_messages ADD COLUMN IF NOT EXISTS assistant_stream_id UUID;

ALTER TABLE public.conversation_messages DROP CONSTRAINT IF EXISTS uq_conversation_messages_assistant_stream;
ALTER TABLE public.conversation_messages ADD CONSTRAINT uq_conversation_messages_assistant_stream
  UNIQUE (workspace_id, conversation_id, assistant_stream_id);

ALTER TABLE public.conversation_messages DROP CONSTRAINT IF EXISTS chk_conversation_messages_stream_binding;
ALTER TABLE public.conversation_messages ADD CONSTRAINT chk_conversation_messages_stream_binding CHECK (
  (sender_type = 'assistant' AND assistant_stream_id IS NOT NULL)
  OR
  (sender_type = 'user' AND assistant_stream_id IS NULL)
);

-- ============================================================================
-- Section 2: Create Table assistant_stream_executions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.assistant_stream_executions (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  user_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  user_message_id UUID NOT NULL,
  assistant_message_id UUID,
  status TEXT NOT NULL CHECK (status IN ('queued', 'streaming', 'completed', 'cancelled', 'failed', 'not_configured')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  advisory_token_count INTEGER NOT NULL DEFAULT 0 CHECK (advisory_token_count >= 0),
  accumulated_content TEXT NOT NULL DEFAULT '' CHECK (pg_catalog.length(accumulated_content) <= 32768),
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT uq_assistant_stream_idempotency UNIQUE (workspace_id, user_id, conversation_id, idempotency_key),
  CONSTRAINT uq_assistant_stream_composite UNIQUE (workspace_id, user_id, conversation_id, id),
  CONSTRAINT uq_assistant_stream_assistant_message UNIQUE (workspace_id, conversation_id, assistant_message_id),
  CONSTRAINT fk_assistant_stream_conversation FOREIGN KEY (workspace_id, user_id, conversation_id)
    REFERENCES public.conversations (workspace_id, user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_assistant_stream_user_message FOREIGN KEY (workspace_id, user_id, conversation_id, user_message_id)
    REFERENCES public.conversation_messages (workspace_id, user_id, conversation_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_assistant_stream_assistant_message FOREIGN KEY (workspace_id, user_id, conversation_id, assistant_message_id)
    REFERENCES public.conversation_messages (workspace_id, user_id, conversation_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_assistant_stream_message_status CHECK (
    (status = 'completed' AND assistant_message_id IS NOT NULL)
    OR
    (status <> 'completed' AND assistant_message_id IS NULL)
  )
);

-- Reciprocal composite foreign key from conversation_messages to assistant_stream_executions
ALTER TABLE public.conversation_messages DROP CONSTRAINT IF EXISTS fk_conversation_messages_assistant_stream;
ALTER TABLE public.conversation_messages ADD CONSTRAINT fk_conversation_messages_assistant_stream
  FOREIGN KEY (workspace_id, user_id, conversation_id, assistant_stream_id)
  REFERENCES public.assistant_stream_executions (workspace_id, user_id, conversation_id, id) ON DELETE RESTRICT;

-- ============================================================================
-- Section 3: Create Table assistant_stream_events
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.assistant_stream_events (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  user_id UUID NOT NULL,
  stream_id UUID NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('context_ready', 'token', 'stream_status', 'done', 'error')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (pg_catalog.length(payload::text) <= 8192),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT fk_assistant_stream_events_parent FOREIGN KEY (workspace_id, user_id, conversation_id, stream_id)
    REFERENCES public.assistant_stream_executions (workspace_id, user_id, conversation_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_assistant_stream_events_seq UNIQUE (workspace_id, stream_id, sequence_number)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_assistant_stream_conv ON public.assistant_stream_executions (workspace_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_stream_stale ON public.assistant_stream_executions (status, started_at)
  WHERE status IN ('queued', 'streaming');
CREATE INDEX IF NOT EXISTS idx_assistant_stream_events_stream ON public.assistant_stream_events (workspace_id, stream_id, sequence_number ASC);

-- ============================================================================
-- Section 4: Table Privileges & Direct-DML Denial Policies
-- ============================================================================

ALTER TABLE public.assistant_stream_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_stream_executions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_stream_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_stream_events FORCE ROW LEVEL SECURITY;

-- Revoke all privileges from PUBLIC and all runtime roles
REVOKE ALL ON public.assistant_stream_executions FROM PUBLIC, thaara_app, thaara_admin, thaara_worker, thaara_seeder;
REVOKE ALL ON public.assistant_stream_events FROM PUBLIC, thaara_app, thaara_admin, thaara_worker, thaara_seeder;

-- Grant SELECT strictly to thaara_app
GRANT SELECT ON public.assistant_stream_executions TO thaara_app;
GRANT SELECT ON public.assistant_stream_events TO thaara_app;

-- Direct-table RLS policies: SELECT allowed for thaara_app; all direct DML denied
DROP POLICY IF EXISTS assistant_stream_select_policy ON public.assistant_stream_executions;
DROP POLICY IF EXISTS assistant_stream_insert_policy ON public.assistant_stream_executions;
DROP POLICY IF EXISTS assistant_stream_update_policy ON public.assistant_stream_executions;
DROP POLICY IF EXISTS assistant_stream_delete_policy ON public.assistant_stream_executions;

CREATE POLICY assistant_stream_select_policy ON public.assistant_stream_executions
  FOR SELECT TO thaara_app
  USING ((workspace_id, user_id) IN (SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s));

CREATE POLICY assistant_stream_insert_policy ON public.assistant_stream_executions FOR INSERT TO thaara_app WITH CHECK (false);
CREATE POLICY assistant_stream_update_policy ON public.assistant_stream_executions FOR UPDATE TO thaara_app USING (false);
CREATE POLICY assistant_stream_delete_policy ON public.assistant_stream_executions FOR DELETE TO thaara_app USING (false);

DROP POLICY IF EXISTS assistant_stream_events_select_policy ON public.assistant_stream_events;
DROP POLICY IF EXISTS assistant_stream_events_insert_policy ON public.assistant_stream_events;
DROP POLICY IF EXISTS assistant_stream_events_update_policy ON public.assistant_stream_events;
DROP POLICY IF EXISTS assistant_stream_events_delete_policy ON public.assistant_stream_events;

CREATE POLICY assistant_stream_events_select_policy ON public.assistant_stream_events
  FOR SELECT TO thaara_app
  USING ((workspace_id, user_id) IN (SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s));

CREATE POLICY assistant_stream_events_insert_policy ON public.assistant_stream_events FOR INSERT TO thaara_app WITH CHECK (false);
CREATE POLICY assistant_stream_events_update_policy ON public.assistant_stream_events FOR UPDATE TO thaara_app USING (false);
CREATE POLICY assistant_stream_events_delete_policy ON public.assistant_stream_events FOR DELETE TO thaara_app USING (false);

-- ============================================================================
-- Section 5: Hardened Constraint-Trigger Function & Deferred Invariants
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_assistant_stream_bidirectional_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count pg_catalog.int4;
BEGIN
  -- Branch 1: Triggered by changes on assistant_stream_executions
  IF TG_TABLE_NAME = 'assistant_stream_executions' THEN
    IF TG_OP = 'DELETE' THEN
      IF EXISTS (
        SELECT 1 FROM public.conversation_messages
        WHERE assistant_stream_id = OLD.id
      ) THEN
        RAISE EXCEPTION 'Bidirectional Integrity Failure: Cannot delete stream % with referenced assistant messages', OLD.id;
      END IF;
      RETURN OLD;
    END IF;

    -- Case 1A: Stream is marked 'completed'
    IF NEW.status = 'completed' THEN
      IF NEW.assistant_message_id IS NULL THEN
        RAISE EXCEPTION 'Bidirectional Integrity Failure: Completed stream % must have non-null assistant_message_id at commit', NEW.id;
      END IF;

      SELECT pg_catalog.count(*) INTO v_count
      FROM public.conversation_messages m
      WHERE m.id = NEW.assistant_message_id
        AND m.assistant_stream_id = NEW.id
        AND m.sender_type = 'assistant'
        AND m.workspace_id = NEW.workspace_id
        AND m.user_id = NEW.user_id
        AND m.conversation_id = NEW.conversation_id;

      IF v_count <> 1 THEN
        RAISE EXCEPTION 'Bidirectional Integrity Failure: Completed stream % does not have matching reciprocal assistant message (found: %)', NEW.id, v_count;
      END IF;

    -- Case 1B: Stream is non-completed
    ELSE
      IF NEW.assistant_message_id IS NOT NULL THEN
        RAISE EXCEPTION 'Bidirectional Integrity Failure: Non-completed stream % cannot reference an assistant_message_id at commit', NEW.id;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.conversation_messages
        WHERE assistant_stream_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'Bidirectional Integrity Failure: Non-completed stream % cannot have associated assistant conversation messages', NEW.id;
      END IF;
    END IF;

    RETURN NEW;

  -- Branch 2: Triggered by changes on conversation_messages
  ELSIF TG_TABLE_NAME = 'conversation_messages' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.sender_type = 'assistant' AND EXISTS (
        SELECT 1 FROM public.assistant_stream_executions
        WHERE assistant_message_id = OLD.id
      ) THEN
        RAISE EXCEPTION 'Bidirectional Integrity Failure: Cannot delete assistant message % linked to completed stream', OLD.id;
      END IF;
      RETURN OLD;
    END IF;

    -- Case 2A: Message is assistant message
    IF NEW.sender_type = 'assistant' THEN
      IF NEW.assistant_stream_id IS NULL THEN
        RAISE EXCEPTION 'Bidirectional Integrity Failure: Assistant message % must have non-null assistant_stream_id at commit', NEW.id;
      END IF;

      SELECT pg_catalog.count(*) INTO v_count
      FROM public.assistant_stream_executions s
      WHERE s.id = NEW.assistant_stream_id
        AND s.assistant_message_id = NEW.id
        AND s.status = 'completed'
        AND s.workspace_id = NEW.workspace_id
        AND s.user_id = NEW.user_id
        AND s.conversation_id = NEW.conversation_id;

      IF v_count <> 1 THEN
        RAISE EXCEPTION 'Bidirectional Integrity Failure: Assistant message % does not link reciprocally to completed stream % (found: %)', NEW.id, NEW.assistant_stream_id, v_count;
      END IF;

    -- Case 2B: Message is user message
    ELSE
      IF NEW.assistant_stream_id IS NOT NULL THEN
        RAISE EXCEPTION 'Bidirectional Integrity Failure: User message % cannot reference an assistant_stream_id', NEW.id;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- Revoke execute from PUBLIC and all runtime roles (NO EXECUTE to any runtime role)
REVOKE ALL ON FUNCTION public.enforce_assistant_stream_bidirectional_integrity() FROM PUBLIC, thaara_app, thaara_admin, thaara_worker, thaara_seeder;

-- Create deferrable initially deferred constraint triggers
DROP TRIGGER IF EXISTS trg_assistant_stream_bidirectional_integrity ON public.assistant_stream_executions;
CREATE CONSTRAINT TRIGGER trg_assistant_stream_bidirectional_integrity
  AFTER INSERT OR UPDATE OR DELETE ON public.assistant_stream_executions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_assistant_stream_bidirectional_integrity();

DROP TRIGGER IF EXISTS trg_conversation_messages_assistant_stream_integrity ON public.conversation_messages;
CREATE CONSTRAINT TRIGGER trg_conversation_messages_assistant_stream_integrity
  AFTER INSERT OR UPDATE OR DELETE ON public.conversation_messages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_assistant_stream_bidirectional_integrity();

-- ============================================================================
-- Section 6: User-Facing SECURITY DEFINER Functions (thaara_app)
-- ============================================================================

-- 1. initiate_assistant_stream
CREATE OR REPLACE FUNCTION public.initiate_assistant_stream(
  p_session_token_hash TEXT,
  p_conversation_id UUID,
  p_idempotency_key TEXT,
  p_user_content TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session_id UUID;
  v_workspace_id UUID;
  v_user_id UUID;
  v_role TEXT;
  v_conv RECORD;
  v_existing RECORD;
  v_user_message_id UUID;
  v_stream_id UUID;
  v_next_msg_seq INTEGER;
BEGIN
  -- Resolve session scope
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  -- Input validation
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation_id is required';
  END IF;

  IF p_idempotency_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) = 0 OR pg_catalog.length(p_idempotency_key) > 255 THEN
    RAISE EXCEPTION 'idempotency_key must be between 1 and 255 characters';
  END IF;

  IF p_user_content IS NULL OR pg_catalog.length(pg_catalog.btrim(p_user_content)) = 0 OR pg_catalog.length(p_user_content) > 32768 THEN
    RAISE EXCEPTION 'Message content must be between 1 and 32768 characters';
  END IF;

  -- Idempotency check: if stream already exists, return current state
  SELECT id, status, user_message_id, assistant_message_id, version
  INTO v_existing
  FROM public.assistant_stream_executions
  WHERE workspace_id = v_workspace_id
    AND user_id = v_user_id
    AND conversation_id = p_conversation_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'stream_id', v_existing.id,
      'status', v_existing.status,
      'user_message_id', v_existing.user_message_id,
      'assistant_message_id', v_existing.assistant_message_id,
      'version', v_existing.version,
      'idempotent_replay', true
    );
  END IF;

  -- Verify conversation is active and belongs to user
  SELECT id, status INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id
    AND workspace_id = v_workspace_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation % not found or unauthorized', p_conversation_id;
  END IF;

  IF v_conv.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot initiate stream on non-active conversation % (status: %)', p_conversation_id, v_conv.status;
  END IF;

  -- Append user message
  SELECT COALESCE(MAX(msg.sequence_number) + 1, 0)
  INTO v_next_msg_seq
  FROM public.conversation_messages msg
  WHERE msg.workspace_id = v_workspace_id AND msg.conversation_id = p_conversation_id;

  v_user_message_id := pg_catalog.gen_random_uuid();

  INSERT INTO public.conversation_messages (
    id,
    workspace_id,
    conversation_id,
    user_id,
    sequence_number,
    sender_type,
    sender_id,
    content,
    metadata,
    created_at
  ) VALUES (
    v_user_message_id,
    v_workspace_id,
    p_conversation_id,
    v_user_id,
    v_next_msg_seq,
    'user',
    v_user_id,
    pg_catalog.btrim(p_user_content),
    '{}'::jsonb,
    pg_catalog.clock_timestamp()
  );

  UPDATE public.conversations
  SET updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_conversation_id;

  -- Create stream execution row in 'queued' status
  v_stream_id := pg_catalog.gen_random_uuid();

  INSERT INTO public.assistant_stream_executions (
    id,
    workspace_id,
    conversation_id,
    user_id,
    idempotency_key,
    user_message_id,
    assistant_message_id,
    status,
    version,
    advisory_token_count,
    accumulated_content,
    started_at,
    created_at,
    updated_at
  ) VALUES (
    v_stream_id,
    v_workspace_id,
    p_conversation_id,
    v_user_id,
    p_idempotency_key,
    v_user_message_id,
    NULL,
    'queued',
    1,
    0,
    '',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  );

  -- Append initial context_ready event
  INSERT INTO public.assistant_stream_events (
    workspace_id,
    conversation_id,
    user_id,
    stream_id,
    sequence_number,
    event_type,
    payload,
    created_at
  ) VALUES (
    v_workspace_id,
    p_conversation_id,
    v_user_id,
    v_stream_id,
    0,
    'context_ready',
    jsonb_build_object(
      'user_message_id', v_user_message_id,
      'status', 'queued'
    ),
    pg_catalog.clock_timestamp()
  );

  -- Emit stream initiated audit log
  INSERT INTO public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    payload
  ) VALUES (
    v_workspace_id,
    v_user_id,
    'assistant.stream_initiated',
    'assistant_stream',
    v_stream_id::text,
    jsonb_build_object(
      'conversation_id', p_conversation_id,
      'user_message_id', v_user_message_id,
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN jsonb_build_object(
    'stream_id', v_stream_id,
    'status', 'queued',
    'user_message_id', v_user_message_id,
    'assistant_message_id', NULL,
    'version', 1,
    'idempotent_replay', false
  );
END;
$$;

-- 2. append_assistant_stream_event
CREATE OR REPLACE FUNCTION public.append_assistant_stream_event(
  p_session_token_hash TEXT,
  p_stream_id UUID,
  p_expected_version INTEGER,
  p_event_type TEXT,
  p_payload JSONB,
  p_content_delta TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session_id UUID;
  v_workspace_id UUID;
  v_user_id UUID;
  v_role TEXT;
  v_stream RECORD;
  v_new_status TEXT;
  v_new_version INTEGER;
  v_error_code TEXT;
  v_error_message TEXT;
  v_next_event_seq INTEGER;
BEGIN
  -- Resolve session scope
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  -- Lock stream row FOR UPDATE
  SELECT * INTO v_stream
  FROM public.assistant_stream_executions
  WHERE id = p_stream_id
    AND workspace_id = v_workspace_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant stream % not found or unauthorized', p_stream_id;
  END IF;

  -- Optimistic lock check
  IF v_stream.version <> p_expected_version THEN
    RAISE EXCEPTION 'Concurrency conflict: expected version %, actual version %', p_expected_version, v_stream.version;
  END IF;

  -- Terminal guard
  IF v_stream.status IN ('completed', 'cancelled', 'failed', 'not_configured') THEN
    RAISE EXCEPTION 'Invalid Stream State Transition: Cannot append event to terminal stream "%"', v_stream.status;
  END IF;

  -- Prohibited command forms
  IF p_event_type = 'done' THEN
    RAISE EXCEPTION 'Terminal done events must be emitted via finalize_assistant_stream';
  END IF;

  IF p_event_type = 'stream_status' AND (p_payload->>'status') = 'cancelled' THEN
    RAISE EXCEPTION 'Stream cancellation must be performed via cancel_assistant_stream';
  END IF;

  -- Transition 1: queued -> streaming
  IF p_event_type = 'stream_status' AND (p_payload->>'status') = 'streaming' THEN
    IF v_stream.status <> 'queued' THEN
      RAISE EXCEPTION 'Invalid Stream State Transition: Cannot transition from % to streaming', v_stream.status;
    END IF;

    v_new_status := 'streaming';
    v_new_version := v_stream.version + 1;

    UPDATE public.assistant_stream_executions
    SET status = v_new_status,
        version = v_new_version,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_stream_id;

  -- Transition 2: streaming/queued -> failed or not_configured
  ELSIF p_event_type = 'stream_status' AND (p_payload->>'status') IN ('failed', 'not_configured') THEN
    IF v_stream.status NOT IN ('queued', 'streaming') THEN
      RAISE EXCEPTION 'Invalid Stream State Transition: Cannot transition from % to %', v_stream.status, p_payload->>'status';
    END IF;

    v_error_code := p_payload->>'error_code';
    v_error_message := p_payload->>'message';

    IF v_error_code IS NOT NULL AND pg_catalog.length(v_error_code) > 64 THEN
      RAISE EXCEPTION 'error_code exceeds maximum allowed length of 64 characters';
    END IF;
    IF v_error_message IS NOT NULL AND pg_catalog.length(v_error_message) > 512 THEN
      RAISE EXCEPTION 'message exceeds maximum allowed length of 512 characters';
    END IF;

    v_new_status := p_payload->>'status';
    v_new_version := v_stream.version + 1;

    UPDATE public.assistant_stream_executions
    SET status = v_new_status,
        error_code = v_error_code,
        completed_at = pg_catalog.clock_timestamp(),
        version = v_new_version,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_stream_id;

    -- Emit audit record
    INSERT INTO public.audit_events (
      workspace_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      payload
    ) VALUES (
      v_workspace_id,
      v_user_id,
      'assistant.stream_status_updated',
      'assistant_stream',
      p_stream_id::text,
      jsonb_build_object(
        'previous_status', v_stream.status,
        'new_status', v_new_status,
        'error_code', v_error_code
      )
    );

  -- Transition 3: token delta
  ELSIF p_event_type = 'token' THEN
    IF v_stream.status <> 'streaming' THEN
      RAISE EXCEPTION 'Invalid Stream State Transition: Cannot append token event when stream status is %', v_stream.status;
    END IF;

    IF p_content_delta IS NULL OR pg_catalog.length(p_content_delta) = 0 OR pg_catalog.length(p_content_delta) > 4096 THEN
      RAISE EXCEPTION 'content_delta must be non-empty and <= 4096 characters';
    END IF;

    IF (p_payload->>'delta') IS DISTINCT FROM p_content_delta THEN
      RAISE EXCEPTION 'Token delta mismatch between parameter and payload';
    END IF;

    IF pg_catalog.length(v_stream.accumulated_content) + pg_catalog.length(p_content_delta) > 32768 THEN
      RAISE EXCEPTION 'Accumulated content exceeds maximum length of 32768 characters';
    END IF;

    v_new_status := v_stream.status;
    v_new_version := v_stream.version + 1;

    UPDATE public.assistant_stream_executions
    SET accumulated_content = v_stream.accumulated_content || p_content_delta,
        advisory_token_count = v_stream.advisory_token_count + 1,
        version = v_new_version,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_stream_id;

  ELSE
    RAISE EXCEPTION 'Invalid event type % or unsupported stream status payload', p_event_type;
  END IF;

  -- Append event with monotonic sequence number
  SELECT COALESCE(MAX(sequence_number) + 1, 0)
  INTO v_next_event_seq
  FROM public.assistant_stream_events
  WHERE workspace_id = v_workspace_id AND stream_id = p_stream_id;

  INSERT INTO public.assistant_stream_events (
    workspace_id,
    conversation_id,
    user_id,
    stream_id,
    sequence_number,
    event_type,
    payload,
    created_at
  ) VALUES (
    v_workspace_id,
    v_stream.conversation_id,
    v_user_id,
    p_stream_id,
    v_next_event_seq,
    p_event_type,
    p_payload,
    pg_catalog.clock_timestamp()
  );

  RETURN jsonb_build_object(
    'stream_id', p_stream_id,
    'sequence_number', v_next_event_seq,
    'version', v_new_version,
    'status', v_new_status
  );
END;
$$;

-- 3. finalize_assistant_stream
CREATE OR REPLACE FUNCTION public.finalize_assistant_stream(
  p_session_token_hash TEXT,
  p_stream_id UUID,
  p_expected_version INTEGER,
  p_duration_ms INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session_id UUID;
  v_workspace_id UUID;
  v_user_id UUID;
  v_role TEXT;
  v_stream RECORD;
  v_assistant_msg_id UUID;
  v_next_msg_seq INTEGER;
  v_next_event_seq INTEGER;
BEGIN
  -- Resolve session scope
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  -- Lock stream row FOR UPDATE
  SELECT * INTO v_stream
  FROM public.assistant_stream_executions
  WHERE id = p_stream_id
    AND workspace_id = v_workspace_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant stream % not found or unauthorized', p_stream_id;
  END IF;

  IF v_stream.version <> p_expected_version THEN
    RAISE EXCEPTION 'Concurrency conflict: expected version %, actual version %', p_expected_version, v_stream.version;
  END IF;

  IF v_stream.status <> 'streaming' THEN
    RAISE EXCEPTION 'Invalid Stream State Transition: Cannot finalize stream with status %', v_stream.status;
  END IF;

  IF pg_catalog.length(pg_catalog.btrim(v_stream.accumulated_content)) = 0 THEN
    RAISE EXCEPTION 'Cannot finalize stream with empty accumulated content';
  END IF;

  -- Lock conversation FOR UPDATE
  PERFORM 1 FROM public.conversations
  WHERE id = v_stream.conversation_id
    AND workspace_id = v_workspace_id
    AND user_id = v_user_id
  FOR UPDATE;

  -- Append assistant message
  SELECT COALESCE(MAX(sequence_number) + 1, 0)
  INTO v_next_msg_seq
  FROM public.conversation_messages
  WHERE workspace_id = v_workspace_id AND conversation_id = v_stream.conversation_id;

  v_assistant_msg_id := pg_catalog.gen_random_uuid();

  INSERT INTO public.conversation_messages (
    id,
    workspace_id,
    conversation_id,
    user_id,
    sequence_number,
    sender_type,
    sender_id,
    content,
    advisory_token_count,
    metadata,
    assistant_stream_id,
    created_at
  ) VALUES (
    v_assistant_msg_id,
    v_workspace_id,
    v_stream.conversation_id,
    v_user_id,
    v_next_msg_seq,
    'assistant',
    NULL,
    v_stream.accumulated_content,
    v_stream.advisory_token_count,
    jsonb_build_object('duration_ms', p_duration_ms),
    p_stream_id,
    pg_catalog.clock_timestamp()
  );

  UPDATE public.conversations
  SET updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_stream.conversation_id;

  -- Append terminal done event
  SELECT COALESCE(MAX(sequence_number) + 1, 0)
  INTO v_next_event_seq
  FROM public.assistant_stream_events
  WHERE workspace_id = v_workspace_id AND stream_id = p_stream_id;

  INSERT INTO public.assistant_stream_events (
    workspace_id,
    conversation_id,
    user_id,
    stream_id,
    sequence_number,
    event_type,
    payload,
    created_at
  ) VALUES (
    v_workspace_id,
    v_stream.conversation_id,
    v_user_id,
    p_stream_id,
    v_next_event_seq,
    'done',
    jsonb_build_object(
      'assistant_message_id', v_assistant_msg_id,
      'total_tokens', v_stream.advisory_token_count,
      'duration_ms', p_duration_ms
    ),
    pg_catalog.clock_timestamp()
  );

  -- Update stream row to completed
  UPDATE public.assistant_stream_executions
  SET status = 'completed',
    assistant_message_id = v_assistant_msg_id,
    completed_at = pg_catalog.clock_timestamp(),
    version = v_stream.version + 1,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_stream_id;

  -- Emit stream completed audit record
  INSERT INTO public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    payload
  ) VALUES (
    v_workspace_id,
    v_user_id,
    'assistant.stream_completed',
    'assistant_stream',
    p_stream_id::text,
    jsonb_build_object(
      'conversation_id', v_stream.conversation_id,
      'assistant_message_id', v_assistant_msg_id,
      'total_tokens', v_stream.advisory_token_count,
      'duration_ms', p_duration_ms
    )
  );

  RETURN jsonb_build_object(
    'stream_id', p_stream_id,
    'status', 'completed',
    'assistant_message_id', v_assistant_msg_id,
    'sequence_number', v_next_event_seq,
    'version', v_stream.version + 1
  );
END;
$$;

-- 4. cancel_assistant_stream
CREATE OR REPLACE FUNCTION public.cancel_assistant_stream(
  p_session_token_hash TEXT,
  p_stream_id UUID,
  p_expected_version INTEGER,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session_id UUID;
  v_workspace_id UUID;
  v_user_id UUID;
  v_role TEXT;
  v_stream RECORD;
  v_new_version INTEGER;
  v_next_event_seq INTEGER;
BEGIN
  -- Resolve session scope
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  -- Lock stream row FOR UPDATE
  SELECT * INTO v_stream
  FROM public.assistant_stream_executions
  WHERE id = p_stream_id
    AND workspace_id = v_workspace_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant stream % not found or unauthorized', p_stream_id;
  END IF;

  -- Idempotency: if already cancelled, return cleanly
  IF v_stream.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'stream_id', p_stream_id,
      'status', 'cancelled',
      'version', v_stream.version,
      'idempotent', true
    );
  END IF;

  -- Terminal guard: completed, failed, or not_configured cannot be cancelled
  IF v_stream.status IN ('completed', 'failed', 'not_configured') THEN
    RAISE EXCEPTION 'Invalid Stream State Transition: Cannot cancel stream in terminal state "%"', v_stream.status;
  END IF;

  IF v_stream.version <> p_expected_version THEN
    RAISE EXCEPTION 'Concurrency conflict: expected version %, actual version %', p_expected_version, v_stream.version;
  END IF;

  v_new_version := v_stream.version + 1;

  UPDATE public.assistant_stream_executions
  SET status = 'cancelled',
      completed_at = pg_catalog.clock_timestamp(),
      error_code = 'CLIENT_CANCELLED',
      version = v_new_version,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_stream_id;

  -- Append stream_status cancelled event
  SELECT COALESCE(MAX(sequence_number) + 1, 0)
  INTO v_next_event_seq
  FROM public.assistant_stream_events
  WHERE workspace_id = v_workspace_id AND stream_id = p_stream_id;

  INSERT INTO public.assistant_stream_events (
    workspace_id,
    conversation_id,
    user_id,
    stream_id,
    sequence_number,
    event_type,
    payload,
    created_at
  ) VALUES (
    v_workspace_id,
    v_stream.conversation_id,
    v_user_id,
    p_stream_id,
    v_next_event_seq,
    'stream_status',
    jsonb_build_object(
      'status', 'cancelled',
      'reason', COALESCE(p_reason, 'Client requested stream cancellation')
    ),
    pg_catalog.clock_timestamp()
  );

  -- Emit audit record
  INSERT INTO public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    payload
  ) VALUES (
    v_workspace_id,
    v_user_id,
    'assistant.stream_cancelled',
    'assistant_stream',
    p_stream_id::text,
    jsonb_build_object(
      'conversation_id', v_stream.conversation_id,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'stream_id', p_stream_id,
    'status', 'cancelled',
    'version', v_new_version,
    'idempotent', false
  );
END;
$$;

-- 5. get_assistant_stream_events_after
CREATE OR REPLACE FUNCTION public.get_assistant_stream_events_after(
  p_session_token_hash TEXT,
  p_stream_id UUID,
  p_after_sequence INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session_id UUID;
  v_workspace_id UUID;
  v_user_id UUID;
  v_role TEXT;
  v_stream RECORD;
  v_events JSONB;
BEGIN
  -- Resolve session scope
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  SELECT id, status, version INTO v_stream
  FROM public.assistant_stream_executions
  WHERE id = p_stream_id
    AND workspace_id = v_workspace_id
    AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant stream % not found or unauthorized', p_stream_id;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'sequence_number', e.sequence_number,
        'event_type', e.event_type,
        'payload', e.payload,
        'created_at', e.created_at
      ) ORDER BY e.sequence_number ASC
    ),
    '[]'::jsonb
  ) INTO v_events
  FROM public.assistant_stream_events e
  WHERE e.workspace_id = v_workspace_id
    AND e.stream_id = p_stream_id
    AND e.sequence_number > p_after_sequence;

  RETURN jsonb_build_object(
    'stream_id', p_stream_id,
    'status', v_stream.status,
    'version', v_stream.version,
    'events', v_events
  );
END;
$$;

-- Privilege boundaries for app functions
REVOKE ALL ON FUNCTION public.initiate_assistant_stream(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, thaara_app, thaara_admin, thaara_worker, thaara_seeder;
REVOKE ALL ON FUNCTION public.append_assistant_stream_event(TEXT, UUID, INTEGER, TEXT, JSONB, TEXT) FROM PUBLIC, thaara_app, thaara_admin, thaara_worker, thaara_seeder;
REVOKE ALL ON FUNCTION public.finalize_assistant_stream(TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC, thaara_app, thaara_admin, thaara_worker, thaara_seeder;
REVOKE ALL ON FUNCTION public.cancel_assistant_stream(TEXT, UUID, INTEGER, TEXT) FROM PUBLIC, thaara_app, thaara_admin, thaara_worker, thaara_seeder;
REVOKE ALL ON FUNCTION public.get_assistant_stream_events_after(TEXT, UUID, INTEGER) FROM PUBLIC, thaara_app, thaara_admin, thaara_worker, thaara_seeder;

GRANT EXECUTE ON FUNCTION public.initiate_assistant_stream(TEXT, UUID, TEXT, TEXT) TO thaara_app;
GRANT EXECUTE ON FUNCTION public.append_assistant_stream_event(TEXT, UUID, INTEGER, TEXT, JSONB, TEXT) TO thaara_app;
GRANT EXECUTE ON FUNCTION public.finalize_assistant_stream(TEXT, UUID, INTEGER, INTEGER) TO thaara_app;
GRANT EXECUTE ON FUNCTION public.cancel_assistant_stream(TEXT, UUID, INTEGER, TEXT) TO thaara_app;
GRANT EXECUTE ON FUNCTION public.get_assistant_stream_events_after(TEXT, UUID, INTEGER) TO thaara_app;

-- ============================================================================
-- Section 7: Worker-Only SECURITY DEFINER Recovery Functions (thaara_worker)
-- ============================================================================

-- 1. recover_stale_assistant_stream
CREATE OR REPLACE FUNCTION public.recover_stale_assistant_stream(
  p_stream_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_stream RECORD;
  v_new_version INTEGER;
  v_next_event_seq INTEGER;
BEGIN
  -- Row lock candidate stream FOR UPDATE
  SELECT * INTO v_stream
  FROM public.assistant_stream_executions
  WHERE id = p_stream_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant stream % not found', p_stream_id;
  END IF;

  -- Re-check status post-lock: idempotent if already terminal
  IF v_stream.status NOT IN ('queued', 'streaming') THEN
    RETURN jsonb_build_object(
      'stream_id', p_stream_id,
      'recovered', false,
      'reason', 'Stream already in terminal state',
      'status', v_stream.status
    );
  END IF;

  -- Re-check age post-lock: must be >= 60 seconds
  IF pg_catalog.clock_timestamp() - v_stream.started_at < interval '60 seconds' THEN
    RAISE EXCEPTION 'Stream % is not stale (elapsed: %)', p_stream_id, (pg_catalog.clock_timestamp() - v_stream.started_at);
  END IF;

  v_new_version := v_stream.version + 1;

  UPDATE public.assistant_stream_executions
  SET status = 'failed',
      completed_at = pg_catalog.clock_timestamp(),
      error_code = 'STREAM_TIMEOUT',
      version = v_new_version,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_stream_id;

  -- Append single error event
  SELECT COALESCE(MAX(sequence_number) + 1, 0)
  INTO v_next_event_seq
  FROM public.assistant_stream_events
  WHERE workspace_id = v_stream.workspace_id AND stream_id = p_stream_id;

  INSERT INTO public.assistant_stream_events (
    workspace_id,
    conversation_id,
    user_id,
    stream_id,
    sequence_number,
    event_type,
    payload,
    created_at
  ) VALUES (
    v_stream.workspace_id,
    v_stream.conversation_id,
    v_stream.user_id,
    p_stream_id,
    v_next_event_seq,
    'error',
    jsonb_build_object(
      'error', 'STREAM_TIMEOUT',
      'message', 'Stream timed out after exceeding 60-second active threshold'
    ),
    pg_catalog.clock_timestamp()
  );

  -- Emit single audit record
  INSERT INTO public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    payload
  ) VALUES (
    v_stream.workspace_id,
    NULL,
    'assistant.stream_stale_recovered',
    'assistant_stream',
    p_stream_id::text,
    jsonb_build_object(
      'conversation_id', v_stream.conversation_id,
      'previous_status', v_stream.status,
      'error_code', 'STREAM_TIMEOUT',
      'duration_ms', EXTRACT(EPOCH FROM (pg_catalog.clock_timestamp() - v_stream.started_at)) * 1000
    )
  );

  RETURN jsonb_build_object(
    'stream_id', p_stream_id,
    'recovered', true,
    'status', 'failed',
    'version', v_new_version
  );
END;
$$;

-- 2. reconcile_stale_assistant_streams
CREATE OR REPLACE FUNCTION public.reconcile_stale_assistant_streams(
  p_batch_size INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_recovered_count INTEGER := 0;
  v_stream_ids JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 500 THEN
    p_batch_size := 50;
  END IF;

  FOR v_rec IN (
    SELECT id
    FROM public.assistant_stream_executions
    WHERE status IN ('queued', 'streaming')
      AND started_at < pg_catalog.clock_timestamp() - interval '60 seconds'
    ORDER BY started_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  LOOP
    v_result := public.recover_stale_assistant_stream(v_rec.id);
    IF (v_result->>'recovered')::boolean = true THEN
      v_recovered_count := v_recovered_count + 1;
      v_stream_ids := v_stream_ids || jsonb_build_array(v_rec.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'recovered_count', v_recovered_count,
    'stream_ids', v_stream_ids
  );
END;
$$;

-- Privilege boundaries for worker recovery functions
REVOKE ALL ON FUNCTION public.recover_stale_assistant_stream(UUID) FROM PUBLIC, thaara_app, thaara_admin, thaara_worker, thaara_seeder;
REVOKE ALL ON FUNCTION public.reconcile_stale_assistant_streams(INTEGER) FROM PUBLIC, thaara_app, thaara_admin, thaara_worker, thaara_seeder;

GRANT EXECUTE ON FUNCTION public.recover_stale_assistant_stream(UUID) TO thaara_worker;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_assistant_streams(INTEGER) TO thaara_worker;

-- ============================================================================
-- Section 8: Migration 0008 Catalog & Strict Exclusive ACL Assertions
-- ============================================================================

DO $$
DECLARE
  v_proc_oid pg_catalog.oid;
  v_identity_args pg_catalog.text;
  v_trusted_owner_oid pg_catalog.oid;
  v_trusted_owner pg_catalog.text;
  v_owner_super pg_catalog.bool;
  v_owner_bypass pg_catalog.bool;
  v_runtime_violators pg_catalog.int4;
  v_escalation_violators pg_catalog.int4;
  v_trigger_count pg_catalog.int4;
  v_unauthorized_grants pg_catalog.int4;
  v_app_role_oid pg_catalog.oid;
  v_worker_role_oid pg_catalog.oid;

  v_app_sigs CONSTANT TEXT[] := ARRAY[
    'public.initiate_assistant_stream(text,uuid,text,text)',
    'public.append_assistant_stream_event(text,uuid,integer,text,jsonb,text)',
    'public.finalize_assistant_stream(text,uuid,integer,integer)',
    'public.cancel_assistant_stream(text,uuid,integer,text)',
    'public.get_assistant_stream_events_after(text,uuid,integer)'
  ];

  v_worker_sigs CONSTANT TEXT[] := ARRAY[
    'public.recover_stale_assistant_stream(uuid)',
    'public.reconcile_stale_assistant_streams(integer)'
  ];

  v_sig TEXT;
  v_fn_oid pg_catalog.oid;
  v_fn_secdef pg_catalog.bool;
  v_fn_config pg_catalog.text[];
  v_fn_owner pg_catalog.oid;
  v_fn_rettype pg_catalog.text;
  v_table_oid pg_catalog.oid;
  v_table_name TEXT;
BEGIN
  -- 0. Resolve role OIDs
  SELECT oid INTO v_app_role_oid FROM pg_catalog.pg_roles WHERE rolname = 'thaara_app';
  SELECT oid INTO v_worker_role_oid FROM pg_catalog.pg_roles WHERE rolname = 'thaara_worker';

  IF v_app_role_oid IS NULL OR v_worker_role_oid IS NULL THEN
    RAISE EXCEPTION 'Catalog Assertion Failure: Required runtime roles thaara_app or thaara_worker missing';
  END IF;

  -- 1. Safely resolve existing create_conversation function
  v_proc_oid := pg_catalog.to_regprocedure('public.create_conversation(text,text,text,jsonb)')::pg_catalog.oid;
  IF v_proc_oid IS NULL THEN
    RAISE EXCEPTION 'Catalog Assertion Failure: public.create_conversation(text,text,text,jsonb) does not resolve';
  END IF;

  v_identity_args := pg_catalog.pg_get_function_identity_arguments(v_proc_oid);
  IF v_identity_args <> 'p_session_token_hash text, p_title text, p_channel text, p_metadata jsonb' THEN
    RAISE EXCEPTION 'Catalog Assertion Failure: Identity argument mismatch for public.create_conversation: got "%"', v_identity_args;
  END IF;

  SELECT p.proowner, r.rolname, r.rolsuper, r.rolbypassrls
  INTO v_trusted_owner_oid, v_trusted_owner, v_owner_super, v_owner_bypass
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_roles r ON p.proowner = r.oid
  WHERE p.oid = v_proc_oid;

  IF NOT (COALESCE(v_owner_super, false) OR COALESCE(v_owner_bypass, false)) THEN
    RAISE EXCEPTION 'Catalog Assertion Failure: Owner "%" lacks rolsuper or rolbypassrls', v_trusted_owner;
  END IF;

  -- 2. Assert zero runtime roles have rolbypassrls = true or rolsuper = true
  SELECT pg_catalog.count(*) INTO v_runtime_violators
  FROM pg_catalog.pg_roles
  WHERE rolname IN ('thaara_app', 'thaara_admin', 'thaara_worker', 'thaara_seeder')
    AND (rolbypassrls = true OR rolsuper = true);

  IF v_runtime_violators > 0 THEN
    RAISE EXCEPTION 'Catalog Assertion Failure: Runtime roles possess unauthorized BypassRLS privileges';
  END IF;

  -- 3. Transitive role escalation check via pg_has_role (MEMBER, SET, USAGE)
  SELECT pg_catalog.count(*) INTO v_escalation_violators
  FROM pg_catalog.pg_roles r_runtime
  CROSS JOIN pg_catalog.pg_roles r_unsafe
  WHERE r_runtime.rolname IN ('thaara_app', 'thaara_admin', 'thaara_worker', 'thaara_seeder')
    AND (r_unsafe.rolsuper = true OR r_unsafe.rolbypassrls = true OR r_unsafe.oid = v_trusted_owner_oid)
    AND (
      pg_catalog.pg_has_role(r_runtime.oid, r_unsafe.oid, 'MEMBER')
      OR pg_catalog.pg_has_role(r_runtime.oid, r_unsafe.oid, 'SET')
      OR pg_catalog.pg_has_role(r_runtime.oid, r_unsafe.oid, 'USAGE')
    );

  IF v_escalation_violators > 0 THEN
    RAISE EXCEPTION 'Catalog Assertion Failure: Runtime role can transitively inherit from or SET ROLE into superuser, BypassRLS, or trusted owner role';
  END IF;

  -- 4. Complete Exclusive Table ACL Verification via aclexplode
  FOREACH v_table_name IN ARRAY ARRAY['assistant_stream_executions', 'assistant_stream_events']
  LOOP
    v_table_oid := ('public.' || v_table_name)::pg_catalog.regclass::pg_catalog.oid;

    -- Prove EVERY table grant entry is EITHER owner access OR direct thaara_app SELECT
    SELECT pg_catalog.count(*) INTO v_unauthorized_grants
    FROM (
      SELECT (pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner)))).*
      FROM pg_catalog.pg_class c
      WHERE c.oid = v_table_oid
    ) a
    WHERE NOT (
      (a.grantee = v_trusted_owner_oid)
      OR
      (a.grantee = v_app_role_oid AND a.privilege_type = 'SELECT')
    );

    IF v_unauthorized_grants > 0 THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: Table % has unauthorized or non-exclusive grants', v_table_name;
    END IF;

    -- Assert thaara_app has effective SELECT
    IF NOT pg_catalog.has_table_privilege('thaara_app', v_table_oid, 'SELECT') THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: thaara_app missing SELECT on %', v_table_name;
    END IF;
  END LOOP;

  -- 5. Validate exact application functions (thaara_app only)
  FOREACH v_sig IN ARRAY v_app_sigs
  LOOP
    v_fn_oid := pg_catalog.to_regprocedure(v_sig)::pg_catalog.oid;
    IF v_fn_oid IS NULL THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: App function signature "%" does not resolve', v_sig;
    END IF;

    SELECT p.prosecdef, p.proconfig, p.proowner, pg_catalog.pg_get_function_result(p.oid)
    INTO v_fn_secdef, v_fn_config, v_fn_owner, v_fn_rettype
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_fn_oid;

    IF NOT COALESCE(v_fn_secdef, false) OR v_fn_rettype <> 'jsonb' OR v_fn_owner <> v_trusted_owner_oid THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: App function "%" properties invalid', v_sig;
    END IF;

    IF NOT ('search_path=pg_catalog, public, pg_temp' = ANY(v_fn_config)) THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: App function "%" search path not pinned', v_sig;
    END IF;

    -- Exclusive ACL check: ONLY owner OR thaara_app EXECUTE
    SELECT pg_catalog.count(*) INTO v_unauthorized_grants
    FROM (
      SELECT (pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)))).*
      FROM pg_catalog.pg_proc p
      WHERE p.oid = v_fn_oid
    ) a
    WHERE NOT (
      (a.grantee = v_trusted_owner_oid)
      OR
      (a.grantee = v_app_role_oid AND a.privilege_type = 'EXECUTE')
    );

    IF v_unauthorized_grants > 0 THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: App function "%" has unauthorized or non-exclusive grants', v_sig;
    END IF;

    IF NOT pg_catalog.has_function_privilege('thaara_app', v_fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: App function "%" missing effective EXECUTE for thaara_app', v_sig;
    END IF;
  END LOOP;

  -- 6. Validate exact worker recovery functions (thaara_worker only)
  FOREACH v_sig IN ARRAY v_worker_sigs
  LOOP
    v_fn_oid := pg_catalog.to_regprocedure(v_sig)::pg_catalog.oid;
    IF v_fn_oid IS NULL THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: Worker function signature "%" does not resolve', v_sig;
    END IF;

    SELECT p.prosecdef, p.proconfig, p.proowner, pg_catalog.pg_get_function_result(p.oid)
    INTO v_fn_secdef, v_fn_config, v_fn_owner, v_fn_rettype
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_fn_oid;

    IF NOT COALESCE(v_fn_secdef, false) OR v_fn_rettype <> 'jsonb' OR v_fn_owner <> v_trusted_owner_oid THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: Worker function "%" properties invalid', v_sig;
    END IF;

    IF NOT ('search_path=pg_catalog, public, pg_temp' = ANY(v_fn_config)) THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: Worker function "%" search path not pinned', v_sig;
    END IF;

    -- Exclusive ACL check: ONLY owner OR thaara_worker EXECUTE
    SELECT pg_catalog.count(*) INTO v_unauthorized_grants
    FROM (
      SELECT (pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)))).*
      FROM pg_catalog.pg_proc p
      WHERE p.oid = v_fn_oid
    ) a
    WHERE NOT (
      (a.grantee = v_trusted_owner_oid)
      OR
      (a.grantee = v_worker_role_oid AND a.privilege_type = 'EXECUTE')
    );

    IF v_unauthorized_grants > 0 THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: Worker function "%" has unauthorized or non-exclusive grants', v_sig;
    END IF;

    IF NOT pg_catalog.has_function_privilege('thaara_worker', v_fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Catalog Assertion Failure: Worker function "%" missing effective EXECUTE for thaara_worker', v_sig;
    END IF;
  END LOOP;

  -- 7. Constraint-trigger function hardening assertions
  v_fn_oid := pg_catalog.to_regprocedure('public.enforce_assistant_stream_bidirectional_integrity()')::pg_catalog.oid;
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Catalog Assertion Failure: enforce_assistant_stream_bidirectional_integrity() does not resolve';
  END IF;

  SELECT p.prosecdef, p.proconfig, p.proowner, pg_catalog.pg_get_function_result(p.oid)
  INTO v_fn_secdef, v_fn_config, v_fn_owner, v_fn_rettype
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_fn_oid;

  IF NOT COALESCE(v_fn_secdef, false) OR v_fn_rettype <> 'trigger' OR v_fn_owner <> v_trusted_owner_oid THEN
    RAISE EXCEPTION 'Catalog Assertion Failure: Trigger function properties invalid';
  END IF;

  -- Explicitly assert pinned search path for trigger function
  IF NOT ('search_path=pg_catalog, public, pg_temp' = ANY(v_fn_config)) THEN
    RAISE EXCEPTION 'Catalog Assertion Failure: enforce_assistant_stream_bidirectional_integrity search path not pinned';
  END IF;

  -- Exclusive ACL check: ONLY owner, ZERO runtime or PUBLIC grants
  SELECT pg_catalog.count(*) INTO v_unauthorized_grants
  FROM (
    SELECT (pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)))).*
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_fn_oid
  ) a
  WHERE a.grantee <> v_trusted_owner_oid;

  IF v_unauthorized_grants > 0 THEN
    RAISE EXCEPTION 'Catalog Assertion Failure: Trigger function has unauthorized grants to non-owner roles or PUBLIC';
  END IF;

  -- 8. Assert both deferred constraint triggers exist
  SELECT pg_catalog.count(*) INTO v_trigger_count
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_proc p ON t.tgfoid = p.oid
  WHERE p.oid = v_fn_oid
    AND t.tgdeferrable = true
    AND t.tginitdeferred = true
    AND (
      (t.tgrelid = 'public.assistant_stream_executions'::pg_catalog.regclass AND t.tgname = 'trg_assistant_stream_bidirectional_integrity')
      OR
      (t.tgrelid = 'public.conversation_messages'::pg_catalog.regclass AND t.tgname = 'trg_conversation_messages_assistant_stream_integrity')
    );

  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION 'Catalog Assertion Failure: Expected 2 DEFERRABLE INITIALLY DEFERRED triggers, found %', v_trigger_count;
  END IF;
END;
$$;
