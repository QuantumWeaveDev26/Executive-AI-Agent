-- ============================================================================
-- Migration: 0006_task003_procedure_hardening.sql
-- Description: Task 003 Phase 2 Revision 16 — Universal Mutation Procedures,
--              Token-Bound Read RLS, Direct-DML Denial, 11-Procedure Hardening,
--              and Fail-Closed current_authenticated_scope().
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
-- Section 1: current_authenticated_scope()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_authenticated_scope()
RETURNS TABLE (
  workspace_id UUID,
  user_id UUID,
  role TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_token_hash TEXT;
BEGIN
  v_token_hash := NULLIF(pg_catalog.current_setting('app.session_token_hash', true), '');
  
  -- Fail-closed: if token hash is absent or empty, return 0 rows immediately
  IF v_token_hash IS NULL THEN
    RETURN;
  END IF;

  -- Resolve session scope. If session is invalid, revoked, or expired, resolve_session_scope returns 0 rows.
  RETURN QUERY
  SELECT s.workspace_id, s.user_id, s.role
  FROM public.resolve_session_scope(v_token_hash) s;
END;
$$;

-- ============================================================================
-- Section 2: create_conversation
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_conversation(
  p_session_token_hash TEXT,
  p_title TEXT,
  p_channel TEXT,
  p_metadata JSONB
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
  v_id UUID := pg_catalog.gen_random_uuid();
BEGIN
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  IF p_title IS NULL OR pg_catalog.length(pg_catalog.btrim(p_title)) = 0 OR pg_catalog.length(p_title) > 255 THEN
    RAISE EXCEPTION 'Conversation title must be between 1 and 255 characters';
  END IF;

  IF p_channel IS NOT NULL AND p_channel NOT IN ('web', 'api') THEN
    RAISE EXCEPTION 'Invalid conversation channel: %', p_channel;
  END IF;

  INSERT INTO public.conversations (
    id,
    workspace_id,
    user_id,
    title,
    channel,
    status,
    metadata
  ) VALUES (
    v_id,
    v_workspace_id,
    v_user_id,
    pg_catalog.btrim(p_title),
    COALESCE(p_channel, 'web'),
    'active',
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN v_id;
END;
$$;

-- ============================================================================
-- Section 3: update_conversation_status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_conversation_status(
  p_session_token_hash TEXT,
  p_conversation_id UUID,
  p_status TEXT
)
RETURNS BOOLEAN
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
BEGIN
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  IF p_status NOT IN ('active', 'archived', 'closed') THEN
    RAISE EXCEPTION 'Invalid conversation status: %', p_status;
  END IF;

  SELECT id, workspace_id, user_id, status
  INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id AND workspace_id = v_workspace_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation % not found or unauthorized', p_conversation_id;
  END IF;

  UPDATE public.conversations
  SET status = p_status,
      updated_at = pg_catalog.now()
  WHERE id = p_conversation_id;

  RETURN TRUE;
END;
$$;

-- ============================================================================
-- Section 4: append_conversation_message
-- ============================================================================
CREATE OR REPLACE FUNCTION public.append_conversation_message(
  p_session_token_hash TEXT,
  p_conversation_id UUID,
  p_content TEXT,
  p_metadata JSONB
)
RETURNS TABLE (
  message_id UUID,
  sequence_number INTEGER,
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
  v_conv RECORD;
  v_next_seq INTEGER;
  v_msg_id UUID := pg_catalog.gen_random_uuid();
  v_created_at TIMESTAMPTZ := pg_catalog.now();
BEGIN
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  IF p_content IS NULL OR pg_catalog.length(pg_catalog.btrim(p_content)) = 0 OR pg_catalog.length(p_content) > 32768 THEN
    RAISE EXCEPTION 'Message content must be between 1 and 32768 characters';
  END IF;

  SELECT id, status
  INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id AND workspace_id = v_workspace_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation % not found or unauthorized', p_conversation_id;
  END IF;

  IF v_conv.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot append message to non-active conversation % (status: %)', p_conversation_id, v_conv.status;
  END IF;

  SELECT COALESCE(MAX(msg.sequence_number) + 1, 0)
  INTO v_next_seq
  FROM public.conversation_messages msg
  WHERE msg.workspace_id = v_workspace_id AND msg.conversation_id = p_conversation_id;

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
    v_msg_id,
    v_workspace_id,
    p_conversation_id,
    v_user_id,
    v_next_seq,
    'user',
    v_user_id,
    p_content,
    COALESCE(p_metadata, '{}'::jsonb),
    v_created_at
  );

  UPDATE public.conversations
  SET updated_at = v_created_at
  WHERE id = p_conversation_id;

  RETURN QUERY SELECT v_msg_id, v_next_seq, v_created_at;
END;
$$;

-- ============================================================================
-- Section 5: create_memory_item
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_memory_item(
  p_session_token_hash TEXT,
  p_scope TEXT,
  p_category TEXT,
  p_key TEXT,
  p_value TEXT,
  p_confidence NUMERIC,
  p_provenance TEXT,
  p_provenance_conversation_id UUID,
  p_provenance_message_id UUID,
  p_expires_at TIMESTAMPTZ
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
  v_target_user_id UUID;
  v_id UUID := pg_catalog.gen_random_uuid();
BEGIN
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  IF p_scope NOT IN ('user', 'workspace') THEN
    RAISE EXCEPTION 'Invalid memory scope: %', p_scope;
  END IF;

  IF p_scope = 'workspace' AND v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: workspace-scoped memory creation requires owner or admin role';
  END IF;

  IF p_category NOT IN ('preference', 'fact', 'guideline', 'decision') THEN
    RAISE EXCEPTION 'Invalid memory category: %', p_category;
  END IF;

  IF p_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_key)) = 0 OR pg_catalog.length(p_key) > 255 THEN
    RAISE EXCEPTION 'Memory key must be between 1 and 255 characters';
  END IF;

  IF p_value IS NULL OR pg_catalog.length(pg_catalog.btrim(p_value)) = 0 OR pg_catalog.length(p_value) > 16384 THEN
    RAISE EXCEPTION 'Memory value must be between 1 and 16384 characters';
  END IF;

  IF p_confidence IS NOT NULL AND (p_confidence < 0.0 OR p_confidence > 1.0) THEN
    RAISE EXCEPTION 'Confidence must be between 0.0 and 1.0';
  END IF;

  IF p_provenance NOT IN ('explicit_user_input', 'conversation_message') THEN
    RAISE EXCEPTION 'Invalid provenance: %', p_provenance;
  END IF;

  IF p_provenance = 'explicit_user_input' THEN
    IF p_provenance_conversation_id IS NOT NULL OR p_provenance_message_id IS NOT NULL THEN
      RAISE EXCEPTION 'explicit_user_input provenance cannot reference conversation or message IDs';
    END IF;
  ELSIF p_provenance = 'conversation_message' THEN
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

  v_target_user_id := CASE WHEN p_scope = 'user' THEN v_user_id ELSE NULL END;

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
    provenance,
    provenance_conversation_id,
    provenance_message_id,
    provenance_user_id,
    lifecycle_status,
    version,
    expires_at
  ) VALUES (
    v_id,
    v_workspace_id,
    p_scope,
    v_target_user_id,
    p_category,
    pg_catalog.btrim(p_key),
    pg_catalog.btrim(p_value),
    COALESCE(p_confidence, 1.0),
    'pending_consent',
    p_provenance,
    p_provenance_conversation_id,
    p_provenance_message_id,
    CASE WHEN p_provenance IN ('conversation_message', 'explicit_user_input') THEN v_user_id ELSE NULL END,
    'active',
    1,
    p_expires_at
  );

  RETURN v_id;
END;
$$;

-- ============================================================================
-- Section 6: RLS Policies — Token-Bound Read & Direct-DML Denial
-- ============================================================================

-- 1. conversations
DROP POLICY IF EXISTS tenant_and_owner_isolation_conversations ON public.conversations;
DROP POLICY IF EXISTS conversations_select_policy ON public.conversations;
DROP POLICY IF EXISTS conversations_insert_policy ON public.conversations;
DROP POLICY IF EXISTS conversations_update_policy ON public.conversations;
DROP POLICY IF EXISTS conversations_delete_policy ON public.conversations;

CREATE POLICY conversations_select_policy ON public.conversations
  FOR SELECT
  USING (
    (workspace_id, user_id) IN (
      SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s
    )
  );

CREATE POLICY conversations_insert_policy ON public.conversations
  FOR INSERT WITH CHECK (false);

CREATE POLICY conversations_update_policy ON public.conversations
  FOR UPDATE USING (false);

CREATE POLICY conversations_delete_policy ON public.conversations
  FOR DELETE USING (false);

-- 2. conversation_messages
DROP POLICY IF EXISTS tenant_and_owner_isolation_conversation_messages ON public.conversation_messages;
DROP POLICY IF EXISTS conversation_messages_select_policy ON public.conversation_messages;
DROP POLICY IF EXISTS conversation_messages_insert_policy ON public.conversation_messages;
DROP POLICY IF EXISTS conversation_messages_update_policy ON public.conversation_messages;
DROP POLICY IF EXISTS conversation_messages_delete_policy ON public.conversation_messages;

CREATE POLICY conversation_messages_select_policy ON public.conversation_messages
  FOR SELECT
  USING (
    (workspace_id, user_id) IN (
      SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s
    )
  );

CREATE POLICY conversation_messages_insert_policy ON public.conversation_messages
  FOR INSERT WITH CHECK (false);

CREATE POLICY conversation_messages_update_policy ON public.conversation_messages
  FOR UPDATE USING (false);

CREATE POLICY conversation_messages_delete_policy ON public.conversation_messages
  FOR DELETE USING (false);

-- 3. memory_items
DROP POLICY IF EXISTS memory_items_select_policy ON public.memory_items;
DROP POLICY IF EXISTS memory_items_insert_policy ON public.memory_items;
DROP POLICY IF EXISTS memory_items_update_policy ON public.memory_items;
DROP POLICY IF EXISTS memory_items_delete_policy ON public.memory_items;

CREATE POLICY memory_items_select_policy ON public.memory_items
  FOR SELECT
  USING (
    workspace_id IN (SELECT s.workspace_id FROM public.current_authenticated_scope() s)
    AND (
      (scope = 'user' AND user_id IN (SELECT s.user_id FROM public.current_authenticated_scope() s))
      OR (scope = 'workspace')
    )
  );

CREATE POLICY memory_items_insert_policy ON public.memory_items
  FOR INSERT WITH CHECK (false);

CREATE POLICY memory_items_update_policy ON public.memory_items
  FOR UPDATE USING (false);

CREATE POLICY memory_items_delete_policy ON public.memory_items
  FOR DELETE USING (false);

-- ============================================================================
-- Section 7: Privilege Hardening for all 11 Application Procedures
-- ============================================================================

-- 1. Revoke all privileges from PUBLIC across all 11 procedures
REVOKE ALL ON FUNCTION public.current_authenticated_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_conversation(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_conversation_status(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_conversation_message(TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_memory_item(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_memory_consent(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_memory_consent(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.supersede_memory_item(TEXT, UUID, TEXT, NUMERIC, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initiate_self_privacy_purge(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.export_user_conversation_history(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inspect_private_conversation(TEXT, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;

-- 2. Revoke all privileges from thaara_worker and grant strictly to thaara_app (and thaara_admin for inspection)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_worker') THEN
    REVOKE ALL ON FUNCTION public.current_authenticated_scope() FROM thaara_worker;
    REVOKE ALL ON FUNCTION public.create_conversation(TEXT, TEXT, TEXT, JSONB) FROM thaara_worker;
    REVOKE ALL ON FUNCTION public.update_conversation_status(TEXT, UUID, TEXT) FROM thaara_worker;
    REVOKE ALL ON FUNCTION public.append_conversation_message(TEXT, UUID, TEXT, JSONB) FROM thaara_worker;
    REVOKE ALL ON FUNCTION public.create_memory_item(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, TIMESTAMPTZ) FROM thaara_worker;
    REVOKE ALL ON FUNCTION public.grant_memory_consent(TEXT, UUID) FROM thaara_worker;
    REVOKE ALL ON FUNCTION public.revoke_memory_consent(TEXT, UUID) FROM thaara_worker;
    REVOKE ALL ON FUNCTION public.supersede_memory_item(TEXT, UUID, TEXT, NUMERIC, TEXT, UUID, UUID) FROM thaara_worker;
    REVOKE ALL ON FUNCTION public.initiate_self_privacy_purge(TEXT, TEXT) FROM thaara_worker;
    REVOKE ALL ON FUNCTION public.export_user_conversation_history(TEXT) FROM thaara_worker;
    REVOKE ALL ON FUNCTION public.inspect_private_conversation(TEXT, UUID, TEXT, INTEGER, INTEGER) FROM thaara_worker;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_app') THEN
    GRANT EXECUTE ON FUNCTION public.current_authenticated_scope() TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.create_conversation(TEXT, TEXT, TEXT, JSONB) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.update_conversation_status(TEXT, UUID, TEXT) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.append_conversation_message(TEXT, UUID, TEXT, JSONB) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.create_memory_item(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, TIMESTAMPTZ) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.grant_memory_consent(TEXT, UUID) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.revoke_memory_consent(TEXT, UUID) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.supersede_memory_item(TEXT, UUID, TEXT, NUMERIC, TEXT, UUID, UUID) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.initiate_self_privacy_purge(TEXT, TEXT) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.export_user_conversation_history(TEXT) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.inspect_private_conversation(TEXT, UUID, TEXT, INTEGER, INTEGER) TO thaara_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_admin') THEN
    GRANT EXECUTE ON FUNCTION public.inspect_private_conversation(TEXT, UUID, TEXT, INTEGER, INTEGER) TO thaara_admin;
  END IF;
END;
$$;

-- ============================================================================
-- Section 8: Catalog Privilege & Signature Assertions (Fails Migration on Any Discrepancy)
-- ============================================================================
DO $$
DECLARE
  v_rec RECORD;
  v_app_role_oid OID;
  v_admin_role_oid OID;
  v_worker_role_oid OID;
  v_expected_functions TEXT[] := ARRAY[
    'current_authenticated_scope',
    'create_conversation',
    'update_conversation_status',
    'append_conversation_message',
    'create_memory_item',
    'grant_memory_consent',
    'revoke_memory_consent',
    'supersede_memory_item',
    'initiate_self_privacy_purge',
    'export_user_conversation_history',
    'inspect_private_conversation'
  ];
  v_found_count INTEGER := 0;
BEGIN
  SELECT oid INTO v_app_role_oid FROM pg_catalog.pg_roles WHERE rolname = 'thaara_app';
  SELECT oid INTO v_admin_role_oid FROM pg_catalog.pg_roles WHERE rolname = 'thaara_admin';
  SELECT oid INTO v_worker_role_oid FROM pg_catalog.pg_roles WHERE rolname = 'thaara_worker';

  FOR v_rec IN (
    SELECT p.oid,
           p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
           p.prosecdef,
           p.proconfig,
           p.proowner,
           p.proacl
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(v_expected_functions)
  ) LOOP
    v_found_count := v_found_count + 1;

    -- 1. Verify exact function signatures
    CASE v_rec.proname
      WHEN 'current_authenticated_scope' THEN
        IF v_rec.identity_args <> '' THEN
          RAISE EXCEPTION 'Signature mismatch for current_authenticated_scope: expected "", got "%"', v_rec.identity_args;
        END IF;
      WHEN 'create_conversation' THEN
        IF v_rec.identity_args <> 'p_session_token_hash text, p_title text, p_channel text, p_metadata jsonb' THEN
          RAISE EXCEPTION 'Signature mismatch for create_conversation: got "%"', v_rec.identity_args;
        END IF;
      WHEN 'update_conversation_status' THEN
        IF v_rec.identity_args <> 'p_session_token_hash text, p_conversation_id uuid, p_status text' THEN
          RAISE EXCEPTION 'Signature mismatch for update_conversation_status: got "%"', v_rec.identity_args;
        END IF;
      WHEN 'append_conversation_message' THEN
        IF v_rec.identity_args <> 'p_session_token_hash text, p_conversation_id uuid, p_content text, p_metadata jsonb' THEN
          RAISE EXCEPTION 'Signature mismatch for append_conversation_message: got "%"', v_rec.identity_args;
        END IF;
      WHEN 'create_memory_item' THEN
        IF v_rec.identity_args <> 'p_session_token_hash text, p_scope text, p_category text, p_key text, p_value text, p_confidence numeric, p_provenance text, p_provenance_conversation_id uuid, p_provenance_message_id uuid, p_expires_at timestamp with time zone' THEN
          RAISE EXCEPTION 'Signature mismatch for create_memory_item: got "%"', v_rec.identity_args;
        END IF;
      WHEN 'grant_memory_consent' THEN
        IF v_rec.identity_args <> 'p_session_token_hash text, p_memory_id uuid' THEN
          RAISE EXCEPTION 'Signature mismatch for grant_memory_consent: got "%"', v_rec.identity_args;
        END IF;
      WHEN 'revoke_memory_consent' THEN
        IF v_rec.identity_args <> 'p_session_token_hash text, p_memory_id uuid' THEN
          RAISE EXCEPTION 'Signature mismatch for revoke_memory_consent: got "%"', v_rec.identity_args;
        END IF;
      WHEN 'supersede_memory_item' THEN
        IF v_rec.identity_args <> 'p_session_token_hash text, p_predecessor_id uuid, p_new_value text, p_new_confidence numeric, p_provenance text, p_provenance_conversation_id uuid, p_provenance_message_id uuid' THEN
          RAISE EXCEPTION 'Signature mismatch for supersede_memory_item: got "%"', v_rec.identity_args;
        END IF;
      WHEN 'initiate_self_privacy_purge' THEN
        IF v_rec.identity_args <> 'p_session_token_hash text, p_mode text' THEN
          RAISE EXCEPTION 'Signature mismatch for initiate_self_privacy_purge: got "%"', v_rec.identity_args;
        END IF;
      WHEN 'export_user_conversation_history' THEN
        IF v_rec.identity_args <> 'p_session_token_hash text' THEN
          RAISE EXCEPTION 'Signature mismatch for export_user_conversation_history: got "%"', v_rec.identity_args;
        END IF;
      WHEN 'inspect_private_conversation' THEN
        IF v_rec.identity_args <> 'p_session_token_hash text, p_conversation_id uuid, p_justification text, p_limit integer, p_offset integer' THEN
          RAISE EXCEPTION 'Signature mismatch for inspect_private_conversation: got "%"', v_rec.identity_args;
        END IF;
    END CASE;

    -- 2. Verify prosecdef = true
    IF NOT v_rec.prosecdef THEN
      RAISE EXCEPTION 'Catalog Verification Failure: public.% must be SECURITY DEFINER', v_rec.proname;
    END IF;

    -- 3. Verify pinned search_path in proconfig
    IF v_rec.proconfig IS NULL OR NOT (
      'search_path=pg_catalog, public, pg_temp' = ANY(v_rec.proconfig)
      OR 'search_path=pg_catalog, public' = ANY(v_rec.proconfig)
    ) THEN
      RAISE EXCEPTION 'Catalog Verification Failure: public.% must have pinned search_path (found: %)', v_rec.proname, v_rec.proconfig;
    END IF;

    -- 4. Verify proacl IS NOT NULL (guarantees default PUBLIC execute privileges were modified)
    IF v_rec.proacl IS NULL THEN
      RAISE EXCEPTION 'Catalog Verification Failure: public.% has NULL proacl (default PUBLIC privileges intact)', v_rec.proname;
    END IF;

    -- 5. Inspect ACL entries explicitly: PUBLIC (grantee = 0 / empty grantee) must NOT have EXECUTE
    IF EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(v_rec.proacl) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.unnest(v_rec.proacl) entry
      WHERE pg_catalog.split_part(entry::text, '=', 1) = ''
    ) THEN
      RAISE EXCEPTION 'Catalog Verification Failure: PUBLIC has EXECUTE in proacl of public.% (proacl: %)', v_rec.proname, v_rec.proacl;
    END IF;

    -- 6. Verify only authorized roles (and function owner) have EXECUTE in ACL entries
    IF v_rec.proname = 'inspect_private_conversation' THEN
      IF EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(v_rec.proacl) acl
        WHERE acl.grantee <> v_rec.proowner
          AND acl.grantee <> v_app_role_oid
          AND acl.grantee <> v_admin_role_oid
          AND acl.privilege_type = 'EXECUTE'
      ) THEN
        RAISE EXCEPTION 'Catalog Verification Failure: Unauthorized role possesses EXECUTE on public.inspect_private_conversation (proacl: %)', v_rec.proacl;
      END IF;
    ELSE
      IF v_app_role_oid IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(v_rec.proacl) acl
        WHERE acl.grantee <> v_rec.proowner
          AND acl.grantee <> v_app_role_oid
          AND acl.privilege_type = 'EXECUTE'
      ) THEN
        RAISE EXCEPTION 'Catalog Verification Failure: Unauthorized role possesses EXECUTE on public.% (proacl: %)', v_rec.proname, v_rec.proacl;
      END IF;
    END IF;

    -- 7. Verify thaara_app has EXECUTE privilege
    IF v_app_role_oid IS NOT NULL AND NOT pg_catalog.has_function_privilege(v_app_role_oid, v_rec.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Catalog Verification Failure: thaara_app lacks EXECUTE on public.%', v_rec.proname;
    END IF;

    -- 8. Verify thaara_worker is denied EXECUTE
    IF v_worker_role_oid IS NOT NULL AND pg_catalog.has_function_privilege(v_worker_role_oid, v_rec.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Catalog Verification Failure: thaara_worker has EXECUTE on public.%', v_rec.proname;
    END IF;
  END LOOP;

  IF v_found_count <> 11 THEN
    RAISE EXCEPTION 'Catalog Verification Failure: Expected 11 verified SECURITY DEFINER procedures, found %', v_found_count;
  END IF;
END;
$$;
