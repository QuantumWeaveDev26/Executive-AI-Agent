-- Migration: 0005_task003_runtime_fixes.sql
-- Description: Additive security, provenance, and function compatibility corrections for Task 003
--
-- 1. Replace invalid pg_catalog.trim calls with pg_catalog.btrim in insert_system_default_memory.
-- 2. Update supersede_memory_item so explicit_user_input and conversation_message successors set provenance_user_id.
-- 3. Replace inspect_private_conversation with explicit, fully qualified relation/column references and pg_catalog.btrim.
-- 4. Preserve SECURITY DEFINER, search_path = pg_catalog, public, pg_temp, PUBLIC revocation, owner semantics, and minimal grants.

-- ============================================================================
-- Section 1: Helper assertion functions in pg_temp
-- ============================================================================
CREATE OR REPLACE FUNCTION pg_temp.assert_0005(condition BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT condition THEN
    RAISE EXCEPTION 'Migration 0005 assertion failed: %', message;
  END IF;
END;
$$;

-- ============================================================================
-- Section 2: Function 1 - insert_system_default_memory
-- ============================================================================
CREATE OR REPLACE FUNCTION public.insert_system_default_memory(
  p_workspace_id UUID,
  p_category TEXT,
  p_key TEXT,
  p_value TEXT,
  p_confidence NUMERIC DEFAULT 1.0,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Safe caller-boundary verification:
  -- 1) In PostgreSQL SECURITY DEFINER, CURRENT_USER is function owner.
  -- 2) Invocation authorization is strictly enforced via EXECUTE grant to role thaara_seeder.
  -- 3) Runtime verification confirms login SESSION_USER possesses membership in thaara_seeder.
  IF NOT pg_catalog.pg_has_role(SESSION_USER, 'thaara_seeder', 'MEMBER') THEN
    RAISE EXCEPTION 'Permission denied: session_user "%" lacks thaara_seeder membership', SESSION_USER;
  END IF;

  -- Validate workspace exists
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = p_workspace_id) THEN
    RAISE EXCEPTION 'Referenced workspace % does not exist', p_workspace_id;
  END IF;

  -- Validate bounded inputs using PostgreSQL-valid btrim
  IF p_category NOT IN ('preference', 'fact', 'guideline', 'decision') THEN
    RAISE EXCEPTION 'Invalid memory category: %', p_category;
  END IF;
  IF p_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_key)) = 0 OR pg_catalog.length(p_key) > 255 THEN
    RAISE EXCEPTION 'Memory key must be non-empty and at most 255 characters';
  END IF;
  IF p_value IS NULL OR pg_catalog.length(pg_catalog.btrim(p_value)) = 0 OR pg_catalog.length(p_value) > 16384 THEN
    RAISE EXCEPTION 'Memory value must be non-empty and at most 16384 characters';
  END IF;
  IF p_confidence IS NULL OR p_confidence < 0.0 OR p_confidence > 1.0 THEN
    RAISE EXCEPTION 'Memory confidence must be between 0.0 and 1.0';
  END IF;

  INSERT INTO public.memory_items (
    workspace_id,
    scope,
    user_id,
    category,
    key,
    value,
    confidence,
    consent_status,
    consent_actor_user_id,
    consented_at,
    revoked_at,
    provenance,
    provenance_conversation_id,
    provenance_message_id,
    provenance_user_id,
    lifecycle_status,
    version,
    superseded_by_id,
    expires_at
  ) VALUES (
    p_workspace_id,
    'workspace',
    NULL,
    p_category,
    pg_catalog.btrim(p_key),
    pg_catalog.btrim(p_value),
    p_confidence,
    'pending_consent',
    NULL,
    NULL,
    NULL,
    'system_default',
    NULL,
    NULL,
    NULL,
    'active',
    1,
    NULL,
    p_expires_at
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- Section 3: Function 4 - supersede_memory_item
-- ============================================================================
CREATE OR REPLACE FUNCTION public.supersede_memory_item(
  p_session_token_hash TEXT,
  p_predecessor_id UUID,
  p_new_value TEXT,
  p_new_confidence NUMERIC DEFAULT 1.0,
  p_provenance TEXT DEFAULT 'explicit_user_input',
  p_provenance_conversation_id UUID DEFAULT NULL,
  p_provenance_message_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session_id UUID;
  v_workspace_id UUID;
  v_user_id UUID;
  v_role TEXT;
  v_predecessor RECORD;
  v_successor_id UUID := pg_catalog.gen_random_uuid();
BEGIN
  -- Authenticate through session token hash
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  -- Validate inputs
  IF p_new_value IS NULL OR pg_catalog.length(pg_catalog.btrim(p_new_value)) = 0 OR pg_catalog.length(p_new_value) > 16384 THEN
    RAISE EXCEPTION 'New memory value must be non-empty and at most 16384 characters';
  END IF;
  IF p_new_confidence IS NULL OR p_new_confidence < 0.0 OR p_new_confidence > 1.0 THEN
    RAISE EXCEPTION 'Confidence must be between 0.0 and 1.0';
  END IF;
  IF p_provenance NOT IN ('explicit_user_input', 'conversation_message') THEN
    RAISE EXCEPTION 'Invalid provenance for user supersession: %', p_provenance;
  END IF;

  -- Lock predecessor
  SELECT *
  INTO v_predecessor
  FROM public.memory_items
  WHERE id = p_predecessor_id AND workspace_id = v_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Predecessor memory item % not found in authenticated workspace', p_predecessor_id;
  END IF;

  IF v_predecessor.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot supersede non-active memory item (status is %)', v_predecessor.lifecycle_status;
  END IF;

  -- Authorization
  IF v_predecessor.scope = 'user' THEN
    IF v_predecessor.user_id <> v_user_id THEN
      RAISE EXCEPTION 'Permission denied: cannot supersede another user''s memory';
    END IF;
  ELSIF v_predecessor.scope = 'workspace' THEN
    IF v_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'Permission denied: workspace memory supersession requires owner or admin role';
    END IF;
  END IF;

  -- Validate message provenance if specified
  IF p_provenance = 'conversation_message' THEN
    IF p_provenance_conversation_id IS NULL OR p_provenance_message_id IS NULL THEN
      RAISE EXCEPTION 'conversation_message provenance requires both conversation_id and message_id';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.conversation_messages
      WHERE workspace_id = v_workspace_id
        AND conversation_id = p_provenance_conversation_id
        AND id = p_provenance_message_id
        AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'Referenced message does not exist or does not belong to the authenticated user';
    END IF;
  END IF;

  -- 1. Mark predecessor superseded first (clears active status so unique constraint uq_memory_active_user is not violated; deferred FK permits temporary forward-reference)
  UPDATE public.memory_items
  SET lifecycle_status = 'superseded',
      superseded_by_id = v_successor_id,
      updated_at = pg_catalog.now()
  WHERE id = p_predecessor_id;

  -- 2. Insert successor as active
  -- Both conversation_message and user-scoped explicit_user_input require provenance_user_id = v_user_id
  INSERT INTO public.memory_items (
    id,
    workspace_id,
    scope,
    user_id,
    category,
    key,
    value,
    confidence,
    consent_status,
    consent_actor_user_id,
    consented_at,
    revoked_at,
    provenance,
    provenance_conversation_id,
    provenance_message_id,
    provenance_user_id,
    lifecycle_status,
    version,
    superseded_by_id,
    expires_at
  ) VALUES (
    v_successor_id,
    v_workspace_id,
    v_predecessor.scope,
    v_predecessor.user_id,
    v_predecessor.category,
    v_predecessor.key,
    pg_catalog.btrim(p_new_value),
    p_new_confidence,
    'pending_consent',
    NULL,
    NULL,
    NULL,
    p_provenance,
    p_provenance_conversation_id,
    p_provenance_message_id,
    CASE WHEN p_provenance IN ('conversation_message', 'explicit_user_input') THEN v_user_id ELSE NULL END,
    'active',
    v_predecessor.version + 1,
    NULL,
    v_predecessor.expires_at
  );

  -- Audit event
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
    'memory.superseded',
    'memory_item',
    v_successor_id::text,
    jsonb_build_object(
      'predecessor_id', p_predecessor_id,
      'successor_id', v_successor_id,
      'category', v_predecessor.category,
      'key', v_predecessor.key,
      'new_version', v_predecessor.version + 1
    )
  );

  RETURN v_successor_id;
END;
$$;

-- ============================================================================
-- Section 4: Function 17 - inspect_private_conversation
-- ============================================================================
-- Fully qualified, unambiguous relation and column references throughout.
CREATE OR REPLACE FUNCTION public.inspect_private_conversation(
  p_session_token_hash TEXT,
  p_conversation_id UUID,
  p_justification TEXT,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  sequence_number INTEGER,
  sender_type TEXT,
  sender_id UUID,
  content TEXT,
  advisory_token_count INTEGER,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session_id UUID;
  v_workspace_id UUID;
  v_user_id UUID;
  v_role TEXT;
  v_count INTEGER;
BEGIN
  -- Authenticate through session token hash
  SELECT sess.session_id, sess.workspace_id, sess.user_id, sess.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) AS sess;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  -- Administrative role check
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: administrative inspection requires owner or admin role';
  END IF;

  -- Validate justification using pg_catalog.btrim
  IF p_justification IS NULL OR pg_catalog.length(pg_catalog.btrim(p_justification)) < 10 OR pg_catalog.length(p_justification) > 500 THEN
    RAISE EXCEPTION 'Inspection justification must be between 10 and 500 characters';
  END IF;

  -- Validate conversation exists in same workspace with explicit table and column qualification
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations AS conv
    WHERE conv.id = p_conversation_id AND conv.workspace_id = v_workspace_id
  ) THEN
    RAISE EXCEPTION 'Conversation % not found in authenticated workspace', p_conversation_id;
  END IF;

  -- Count rows to be returned with explicit table and column qualification
  SELECT count(*)
  INTO v_count
  FROM (
    SELECT msg.id
    FROM public.conversation_messages AS msg
    WHERE msg.workspace_id = v_workspace_id
      AND msg.conversation_id = p_conversation_id
    ORDER BY msg.sequence_number ASC
    LIMIT p_limit OFFSET p_offset
  ) AS sub;

  -- Emit mandatory audit event with actual returned counts (NO message content)
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
    'admin.inspection',
    'conversation',
    p_conversation_id::text,
    jsonb_build_object(
      'justification', pg_catalog.btrim(p_justification),
      'returned_count', v_count,
      'limit', p_limit,
      'offset', p_offset
    )
  );

  RETURN QUERY
  SELECT
    msg.id,
    msg.sequence_number,
    msg.sender_type,
    msg.sender_id,
    msg.content,
    msg.advisory_token_count,
    msg.created_at
  FROM public.conversation_messages AS msg
  WHERE msg.workspace_id = v_workspace_id
    AND msg.conversation_id = p_conversation_id
  ORDER BY msg.sequence_number ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ============================================================================
-- Section 5: Privilege Hardening and Grants
-- ============================================================================
-- Revoke all from PUBLIC
REVOKE ALL ON FUNCTION public.insert_system_default_memory(UUID, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.supersede_memory_item(TEXT, UUID, TEXT, NUMERIC, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inspect_private_conversation(TEXT, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;

-- Re-apply strictly scoped role grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_seeder') THEN
    GRANT EXECUTE ON FUNCTION public.insert_system_default_memory(UUID, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ) TO thaara_seeder;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_app') THEN
    REVOKE ALL ON FUNCTION public.insert_system_default_memory(UUID, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ) FROM thaara_app;
    GRANT EXECUTE ON FUNCTION public.supersede_memory_item(TEXT, UUID, TEXT, NUMERIC, TEXT, UUID, UUID) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.inspect_private_conversation(TEXT, UUID, TEXT, INTEGER, INTEGER) TO thaara_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_admin') THEN
    GRANT EXECUTE ON FUNCTION public.inspect_private_conversation(TEXT, UUID, TEXT, INTEGER, INTEGER) TO thaara_admin;
  END IF;
END;
$$;

-- ============================================================================
-- Section 6: Verification Assertions
-- ============================================================================
DO $$
DECLARE
  v_funcs TEXT[] := ARRAY[
    'insert_system_default_memory',
    'supersede_memory_item',
    'inspect_private_conversation'
  ];
  v_fn TEXT;
  v_secdef BOOLEAN;
  v_cfg TEXT[];
BEGIN
  FOREACH v_fn IN ARRAY v_funcs LOOP
    SELECT p.prosecdef, p.proconfig
    INTO v_secdef, v_cfg
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn;

    PERFORM pg_temp.assert_0005(v_secdef = true, v_fn || ' must be SECURITY DEFINER');
    PERFORM pg_temp.assert_0005(v_cfg IS NOT NULL, v_fn || ' must have proconfig');
    PERFORM pg_temp.assert_0005('search_path=pg_catalog, public, pg_temp' = ANY(v_cfg), v_fn || ' search_path must be pg_catalog, public, pg_temp');
  END LOOP;
END;
$$;
