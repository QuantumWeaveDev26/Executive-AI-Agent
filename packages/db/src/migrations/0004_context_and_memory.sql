-- Migration 0004: Context, Memory, Privacy Purge, and Deterministic Foundation
-- Establishes owner-private conversations, authenticated user messages, typed consent-controlled memory,
-- exact provenance, durable privacy purge, transactional outbox, and least-privilege runtime security boundaries.

-- ============================================================================
-- Section 1: Helper Validation & Safe Reconciliation Procedures (pg_temp)
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.assert_column(
  p_table TEXT,
  p_column TEXT,
  p_type TEXT,
  p_not_null BOOLEAN,
  p_default TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_type TEXT;
  v_notnull BOOLEAN;
  v_null_count BIGINT;
BEGIN
  SELECT t.typname, a.attnotnull
  INTO v_type, v_notnull
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
  JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
  JOIN pg_catalog.pg_type t ON a.atttypid = t.oid
  WHERE n.nspname = 'public'
    AND c.relname = p_table
    AND a.attname = p_column
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF NOT FOUND THEN
    IF p_default IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I %s DEFAULT %s', p_table, p_column, p_type, p_default);
      IF p_not_null THEN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', p_table, p_column);
      END IF;
      RETURN;
    ELSE
      RAISE EXCEPTION 'Architectural Migration Failure: Table public.% is missing required column % without safe default', p_table, p_column;
    END IF;
  END IF;

  IF v_type <> p_type THEN
    RAISE EXCEPTION 'Architectural Migration Failure: Column public.%.% has type %, expected %', p_table, p_column, v_type, p_type;
  END IF;

  IF p_not_null AND NOT v_notnull THEN
    EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE %I IS NULL', p_table, p_column) INTO v_null_count;
    IF v_null_count > 0 THEN
      RAISE EXCEPTION 'Architectural Migration Failure: Cannot set public.%.% NOT NULL: % violating rows exist', p_table, p_column, v_null_count;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', p_table, p_column);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_unique(
  p_table TEXT,
  p_conname TEXT,
  p_cols TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_found BOOLEAN := FALSE;
  v_dup_count BIGINT;
  v_col_list TEXT;
  v_sql TEXT;
BEGIN
  SELECT TRUE INTO v_found
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class cl ON c.conrelid = cl.oid
  JOIN pg_catalog.pg_namespace n ON cl.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND cl.relname = p_table
    AND c.contype IN ('u', 'p')
    AND (
      SELECT array_agg(a.attname::text ORDER BY u.ord)
      FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
    ) = p_cols;

  IF NOT FOUND OR v_found IS NOT TRUE THEN
    v_col_list := array_to_string(p_cols, ', ');
    v_sql := format('SELECT COUNT(*) FROM (SELECT %s FROM public.%I GROUP BY %s HAVING COUNT(*) > 1) d', v_col_list, p_table, v_col_list);
    EXECUTE v_sql INTO v_dup_count;
    IF v_dup_count > 0 THEN
      RAISE EXCEPTION 'Architectural Migration Failure: Cannot add UNIQUE constraint % on public.% (%): % duplicate key groups exist', p_conname, p_table, v_col_list, v_dup_count;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (%s)', p_table, p_conname, v_col_list);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_fk(
  p_table TEXT,
  p_conname TEXT,
  p_cols TEXT[],
  p_target_table TEXT,
  p_target_cols TEXT[],
  p_deltype "char" DEFAULT 'r'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_found BOOLEAN := FALSE;
  v_orphan_count BIGINT;
  v_cols_list TEXT;
  v_target_cols_list TEXT;
  v_join_clause TEXT;
  v_null_clause TEXT;
  v_sql TEXT;
  i INT;
BEGIN
  SELECT TRUE INTO v_found
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class cl ON c.conrelid = cl.oid
  JOIN pg_catalog.pg_class fcl ON c.confrelid = fcl.oid
  JOIN pg_catalog.pg_namespace n ON cl.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND cl.relname = p_table
    AND fcl.relname = p_target_table
    AND c.contype = 'f'
    AND c.confdeltype = p_deltype
    AND (
      SELECT array_agg(a.attname::text ORDER BY u.ord)
      FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
    ) = p_cols
    AND (
      SELECT array_agg(fa.attname::text ORDER BY fu.ord)
      FROM unnest(c.confkey) WITH ORDINALITY AS fu(attnum, ord)
      JOIN pg_catalog.pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = fu.attnum
    ) = p_target_cols;

  IF NOT FOUND OR v_found IS NOT TRUE THEN
    v_cols_list := array_to_string(p_cols, ', ');
    v_target_cols_list := array_to_string(p_target_cols, ', ');
    
    v_join_clause := '';
    v_null_clause := '';
    FOR i IN 1 .. array_length(p_cols, 1) LOOP
      IF i > 1 THEN
        v_join_clause := v_join_clause || ' AND ';
        v_null_clause := v_null_clause || ' OR ';
      END IF;
      v_join_clause := v_join_clause || format('src.%I = tgt.%I', p_cols[i], p_target_cols[i]);
      v_null_clause := v_null_clause || format('src.%I IS NOT NULL', p_cols[i]);
    END LOOP;

    v_sql := format('SELECT COUNT(*) FROM public.%I src LEFT JOIN public.%I tgt ON %s WHERE (%s) AND tgt.%I IS NULL',
                    p_table, p_target_table, v_join_clause, v_null_clause, p_target_cols[1]);
    EXECUTE v_sql INTO v_orphan_count;

    IF v_orphan_count > 0 THEN
      RAISE EXCEPTION 'Architectural Migration Failure: Cannot add FOREIGN KEY % on public.% (%): % orphan rows exist', p_conname, p_table, v_cols_list, v_orphan_count;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', p_table, p_conname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.%I (%s) ON DELETE RESTRICT',
                   p_table, p_conname, v_cols_list, p_target_table, v_target_cols_list);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_check(
  p_table TEXT,
  p_conname TEXT,
  p_sql_expr TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_found BOOLEAN := FALSE;
  v_invalid_count BIGINT;
BEGIN
  SELECT TRUE INTO v_found
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class cl ON c.conrelid = cl.oid
  JOIN pg_catalog.pg_namespace n ON cl.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND cl.relname = p_table
    AND c.contype = 'c'
    AND c.conname = p_conname;

  IF NOT FOUND OR v_found IS NOT TRUE THEN
    EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE NOT (%s)', p_table, p_sql_expr) INTO v_invalid_count;
    IF v_invalid_count > 0 THEN
      RAISE EXCEPTION 'Architectural Migration Failure: Cannot add CHECK constraint % on public.%: % violating rows exist', p_conname, p_table, v_invalid_count;
    END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', p_table, p_conname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s)', p_table, p_conname, p_sql_expr);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_rls(p_table TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_rls BOOLEAN;
  v_force BOOLEAN;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO v_rls, v_force
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public' AND c.relname = p_table;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Architectural Migration Failure: Table public.% does not exist for RLS check', p_table;
  END IF;

  IF NOT v_rls THEN
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  END IF;
  IF NOT v_force THEN
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', p_table);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_trigger(
  p_table TEXT,
  p_trigger_name TEXT,
  p_proc_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_found BOOLEAN := FALSE;
BEGIN
  SELECT TRUE INTO v_found
  FROM pg_catalog.pg_trigger tr
  JOIN pg_catalog.pg_class cl ON tr.tgrelid = cl.oid
  JOIN pg_catalog.pg_namespace n ON cl.relnamespace = n.oid
  JOIN pg_catalog.pg_proc p ON tr.tgfoid = p.oid
  WHERE n.nspname = 'public'
    AND cl.relname = p_table
    AND tr.tgname = p_trigger_name
    AND p.proname = p_proc_name
    AND NOT tr.tgisinternal;

  IF NOT FOUND OR v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'Architectural Migration Failure: Required trigger % on public.% calling % is missing', p_trigger_name, p_table, p_proc_name;
  END IF;
END;
$$;

-- ============================================================================
-- Section 2: Privilege Roles Creation (NOLOGIN)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_admin') THEN
    CREATE ROLE thaara_admin WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_worker') THEN
    CREATE ROLE thaara_worker WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_seeder') THEN
    CREATE ROLE thaara_seeder WITH NOLOGIN;
  END IF;
END
$$;

-- ============================================================================
-- Section 3: Prerequisites & Table Definitions
-- ============================================================================

-- 1. Table: conversations
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'web',
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Table: conversation_messages
CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  user_id UUID NOT NULL,
  sequence_number INTEGER NOT NULL,
  sender_type TEXT NOT NULL DEFAULT 'user',
  sender_id UUID NOT NULL,
  content TEXT NOT NULL,
  advisory_token_count INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Table: memory_items
CREATE TABLE IF NOT EXISTS public.memory_items (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL,
  scope TEXT NOT NULL DEFAULT 'user',
  user_id UUID,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence NUMERIC NOT NULL DEFAULT 1.0,
  consent_status TEXT NOT NULL DEFAULT 'pending_consent',
  consent_actor_user_id UUID,
  consented_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  provenance TEXT NOT NULL DEFAULT 'explicit_user_input',
  provenance_conversation_id UUID,
  provenance_message_id UUID,
  provenance_user_id UUID,
  lifecycle_status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  superseded_by_id UUID,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Table: user_purge_cutoffs
CREATE TABLE IF NOT EXISTS public.user_purge_cutoffs (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Table: user_purge_operations
CREATE TABLE IF NOT EXISTS public.user_purge_operations (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  generation INTEGER NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  checkpoint_conversations_completed BOOLEAN NOT NULL DEFAULT FALSE,
  checkpoint_messages_completed BOOLEAN NOT NULL DEFAULT FALSE,
  checkpoint_memories_completed BOOLEAN NOT NULL DEFAULT FALSE,
  checkpoint_membership_completed BOOLEAN NOT NULL DEFAULT FALSE,
  purged_messages_count INTEGER NOT NULL DEFAULT 0,
  purged_conversations_count INTEGER NOT NULL DEFAULT 0,
  purged_memories_count INTEGER NOT NULL DEFAULT 0,
  lease_token UUID,
  lease_worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  error_code TEXT,
  error_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 6. Table: worker_dispatch_outbox
CREATE TABLE IF NOT EXISTS public.worker_dispatch_outbox (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL,
  topic TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  claim_token UUID,
  lease_worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  error_code TEXT,
  error_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ
);

-- ============================================================================
-- Section 4: Semantic Column & Type Validation / Reconciliation
-- ============================================================================

-- conversations
SELECT pg_temp.assert_column('conversations', 'id', 'uuid', true);
SELECT pg_temp.assert_column('conversations', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('conversations', 'user_id', 'uuid', true);
SELECT pg_temp.assert_column('conversations', 'title', 'text', true);
SELECT pg_temp.assert_column('conversations', 'channel', 'text', true, '''web''');
SELECT pg_temp.assert_column('conversations', 'status', 'text', true, '''active''');
SELECT pg_temp.assert_column('conversations', 'metadata', 'jsonb', true, '''{}''::jsonb');
SELECT pg_temp.assert_column('conversations', 'created_at', 'timestamptz', true, 'NOW()');
SELECT pg_temp.assert_column('conversations', 'updated_at', 'timestamptz', true, 'NOW()');

-- conversation_messages
SELECT pg_temp.assert_column('conversation_messages', 'id', 'uuid', true);
SELECT pg_temp.assert_column('conversation_messages', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('conversation_messages', 'conversation_id', 'uuid', true);
SELECT pg_temp.assert_column('conversation_messages', 'user_id', 'uuid', true);
SELECT pg_temp.assert_column('conversation_messages', 'sequence_number', 'int4', true);
SELECT pg_temp.assert_column('conversation_messages', 'sender_type', 'text', true, '''user''');
SELECT pg_temp.assert_column('conversation_messages', 'sender_id', 'uuid', true);
SELECT pg_temp.assert_column('conversation_messages', 'content', 'text', true);
SELECT pg_temp.assert_column('conversation_messages', 'advisory_token_count', 'int4', false);
SELECT pg_temp.assert_column('conversation_messages', 'metadata', 'jsonb', true, '''{}''::jsonb');
SELECT pg_temp.assert_column('conversation_messages', 'created_at', 'timestamptz', true, 'NOW()');

-- memory_items
SELECT pg_temp.assert_column('memory_items', 'id', 'uuid', true);
SELECT pg_temp.assert_column('memory_items', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('memory_items', 'scope', 'text', true, '''user''');
SELECT pg_temp.assert_column('memory_items', 'user_id', 'uuid', false);
SELECT pg_temp.assert_column('memory_items', 'category', 'text', true);
SELECT pg_temp.assert_column('memory_items', 'key', 'text', true);
SELECT pg_temp.assert_column('memory_items', 'value', 'text', true);
SELECT pg_temp.assert_column('memory_items', 'confidence', 'numeric', true, '1.0');
SELECT pg_temp.assert_column('memory_items', 'consent_status', 'text', true, '''pending_consent''');
SELECT pg_temp.assert_column('memory_items', 'consent_actor_user_id', 'uuid', false);
SELECT pg_temp.assert_column('memory_items', 'consented_at', 'timestamptz', false);
SELECT pg_temp.assert_column('memory_items', 'revoked_at', 'timestamptz', false);
SELECT pg_temp.assert_column('memory_items', 'provenance', 'text', true, '''explicit_user_input''');
SELECT pg_temp.assert_column('memory_items', 'provenance_conversation_id', 'uuid', false);
SELECT pg_temp.assert_column('memory_items', 'provenance_message_id', 'uuid', false);
SELECT pg_temp.assert_column('memory_items', 'provenance_user_id', 'uuid', false);
SELECT pg_temp.assert_column('memory_items', 'lifecycle_status', 'text', true, '''active''');
SELECT pg_temp.assert_column('memory_items', 'version', 'int4', true, '1');
SELECT pg_temp.assert_column('memory_items', 'superseded_by_id', 'uuid', false);
SELECT pg_temp.assert_column('memory_items', 'expires_at', 'timestamptz', false);
SELECT pg_temp.assert_column('memory_items', 'created_at', 'timestamptz', true, 'NOW()');
SELECT pg_temp.assert_column('memory_items', 'updated_at', 'timestamptz', true, 'NOW()');

-- user_purge_cutoffs
SELECT pg_temp.assert_column('user_purge_cutoffs', 'id', 'uuid', true);
SELECT pg_temp.assert_column('user_purge_cutoffs', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('user_purge_cutoffs', 'user_id', 'uuid', true);
SELECT pg_temp.assert_column('user_purge_cutoffs', 'cutoff_at', 'timestamptz', true);
SELECT pg_temp.assert_column('user_purge_cutoffs', 'generation', 'int4', true, '1');
SELECT pg_temp.assert_column('user_purge_cutoffs', 'created_at', 'timestamptz', true, 'NOW()');

-- user_purge_operations
SELECT pg_temp.assert_column('user_purge_operations', 'id', 'uuid', true);
SELECT pg_temp.assert_column('user_purge_operations', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('user_purge_operations', 'user_id', 'uuid', true);
SELECT pg_temp.assert_column('user_purge_operations', 'generation', 'int4', true);
SELECT pg_temp.assert_column('user_purge_operations', 'cutoff_at', 'timestamptz', true);
SELECT pg_temp.assert_column('user_purge_operations', 'mode', 'text', true);
SELECT pg_temp.assert_column('user_purge_operations', 'status', 'text', true, '''pending''');
SELECT pg_temp.assert_column('user_purge_operations', 'checkpoint_conversations_completed', 'bool', true, 'false');
SELECT pg_temp.assert_column('user_purge_operations', 'checkpoint_messages_completed', 'bool', true, 'false');
SELECT pg_temp.assert_column('user_purge_operations', 'checkpoint_memories_completed', 'bool', true, 'false');
SELECT pg_temp.assert_column('user_purge_operations', 'checkpoint_membership_completed', 'bool', true, 'false');
SELECT pg_temp.assert_column('user_purge_operations', 'purged_messages_count', 'int4', true, '0');
SELECT pg_temp.assert_column('user_purge_operations', 'purged_conversations_count', 'int4', true, '0');
SELECT pg_temp.assert_column('user_purge_operations', 'purged_memories_count', 'int4', true, '0');
SELECT pg_temp.assert_column('user_purge_operations', 'lease_token', 'uuid', false);
SELECT pg_temp.assert_column('user_purge_operations', 'lease_worker_id', 'text', false);
SELECT pg_temp.assert_column('user_purge_operations', 'lease_expires_at', 'timestamptz', false);
SELECT pg_temp.assert_column('user_purge_operations', 'attempts', 'int4', true, '0');
SELECT pg_temp.assert_column('user_purge_operations', 'max_attempts', 'int4', true, '5');
SELECT pg_temp.assert_column('user_purge_operations', 'error_code', 'text', false);
SELECT pg_temp.assert_column('user_purge_operations', 'error_category', 'text', false);
SELECT pg_temp.assert_column('user_purge_operations', 'created_at', 'timestamptz', true, 'NOW()');
SELECT pg_temp.assert_column('user_purge_operations', 'updated_at', 'timestamptz', true, 'NOW()');
SELECT pg_temp.assert_column('user_purge_operations', 'completed_at', 'timestamptz', false);

-- worker_dispatch_outbox
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'id', 'uuid', true);
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'topic', 'text', true);
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'dedup_key', 'text', true);
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'payload', 'jsonb', true, '''{}''::jsonb');
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'status', 'text', true, '''pending''');
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'claim_token', 'uuid', false);
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'lease_worker_id', 'text', false);
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'lease_expires_at', 'timestamptz', false);
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'attempts', 'int4', true, '0');
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'max_attempts', 'int4', true, '5');
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'error_code', 'text', false);
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'error_category', 'text', false);
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'created_at', 'timestamptz', true, 'NOW()');
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'updated_at', 'timestamptz', true, 'NOW()');
SELECT pg_temp.assert_column('worker_dispatch_outbox', 'dispatched_at', 'timestamptz', false);

-- ============================================================================
-- Section 5: Constraints, Foreign Keys & Checks Validation / Reconciliation
-- ============================================================================

-- 1. conversations constraints
SELECT pg_temp.assert_unique('conversations', 'uq_conversations_workspace_user_id', ARRAY['workspace_id', 'user_id', 'id']);
SELECT pg_temp.assert_unique('conversations', 'uq_conversations_workspace_id', ARRAY['workspace_id', 'id']);
SELECT pg_temp.assert_fk('conversations', 'fk_conversations_workspace', ARRAY['workspace_id'], 'workspaces', ARRAY['id'], 'r');
SELECT pg_temp.assert_fk('conversations', 'fk_conversations_user', ARRAY['user_id'], 'users', ARRAY['id'], 'r');
SELECT pg_temp.assert_check('conversations', 'chk_conversations_channel', 'channel IN (''web'', ''api'')');
SELECT pg_temp.assert_check('conversations', 'chk_conversations_status', 'status IN (''active'', ''archived'', ''closed'', ''purged'')');
SELECT pg_temp.assert_check('conversations', 'chk_conversations_title', 'length(trim(title)) > 0 AND length(title) <= 255');

-- 2. conversation_messages constraints
SELECT pg_temp.assert_unique('conversation_messages', 'uq_conversation_messages_seq', ARRAY['conversation_id', 'sequence_number']);
SELECT pg_temp.assert_unique('conversation_messages', 'uq_conversation_messages_provenance', ARRAY['workspace_id', 'user_id', 'conversation_id', 'id']);
SELECT pg_temp.assert_unique('conversation_messages', 'uq_conversation_messages_workspace_id', ARRAY['workspace_id', 'id']);
SELECT pg_temp.assert_fk('conversation_messages', 'fk_conversation_messages_parent', ARRAY['workspace_id', 'user_id', 'conversation_id'], 'conversations', ARRAY['workspace_id', 'user_id', 'id'], 'r');
SELECT pg_temp.assert_fk('conversation_messages', 'fk_conversation_messages_sender', ARRAY['sender_id'], 'users', ARRAY['id'], 'r');
SELECT pg_temp.assert_check('conversation_messages', 'chk_conversation_messages_sender_type', 'sender_type = ''user''');
SELECT pg_temp.assert_check('conversation_messages', 'chk_conversation_messages_sender_match', 'sender_id = user_id');
SELECT pg_temp.assert_check('conversation_messages', 'chk_conversation_messages_content', 'length(content) > 0 AND length(content) <= 32768');
SELECT pg_temp.assert_check('conversation_messages', 'chk_conversation_messages_seq', 'sequence_number >= 0');

-- 3. memory_items constraints
SELECT pg_temp.assert_unique('memory_items', 'uq_memory_items_workspace_id', ARRAY['workspace_id', 'id']);
SELECT pg_temp.assert_fk('memory_items', 'fk_memory_items_workspace', ARRAY['workspace_id'], 'workspaces', ARRAY['id'], 'r');
SELECT pg_temp.assert_fk('memory_items', 'fk_memory_items_user', ARRAY['user_id'], 'users', ARRAY['id'], 'r');
SELECT pg_temp.assert_fk('memory_items', 'fk_memory_items_consent_actor', ARRAY['consent_actor_user_id'], 'users', ARRAY['id'], 'r');
SELECT pg_temp.assert_fk('memory_items', 'fk_memory_items_provenance_user', ARRAY['provenance_user_id'], 'users', ARRAY['id'], 'r');
SELECT pg_temp.assert_fk('memory_items', 'fk_memory_items_provenance_message', ARRAY['workspace_id', 'provenance_user_id', 'provenance_conversation_id', 'provenance_message_id'], 'conversation_messages', ARRAY['workspace_id', 'user_id', 'conversation_id', 'id'], 'r');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_scope', 'scope IN (''user'', ''workspace'')');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_category', 'category IN (''preference'', ''fact'', ''guideline'', ''decision'')');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_key', 'length(trim(key)) > 0 AND length(key) <= 255');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_value', 'length(trim(value)) > 0 AND length(value) <= 16384');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_confidence', 'confidence >= 0.0 AND confidence <= 1.0');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_consent_status', 'consent_status IN (''pending_consent'', ''consented'', ''revoked'')');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_provenance', 'provenance IN (''explicit_user_input'', ''conversation_message'', ''system_default'')');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_lifecycle', 'lifecycle_status IN (''active'', ''superseded'', ''archived'', ''deleted'', ''expired'')');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_version', 'version >= 1');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_scope_user', '(scope = ''user'' AND user_id IS NOT NULL) OR (scope = ''workspace'' AND user_id IS NULL)');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_provenance_system', '(provenance <> ''system_default'') OR (provenance_conversation_id IS NULL AND provenance_message_id IS NULL AND provenance_user_id IS NULL AND scope = ''workspace'')');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_provenance_message', '(provenance <> ''conversation_message'') OR (provenance_conversation_id IS NOT NULL AND provenance_message_id IS NOT NULL AND provenance_user_id IS NOT NULL)');
SELECT pg_temp.assert_check('memory_items', 'chk_memory_provenance_explicit', '(provenance <> ''explicit_user_input'') OR (provenance_conversation_id IS NULL AND provenance_message_id IS NULL AND (scope = ''workspace'' OR provenance_user_id IS NOT NULL))');

-- Deferred self-reference FK for supersession
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'fk_memory_superseded_by'
  ) THEN
    ALTER TABLE public.memory_items
      ADD CONSTRAINT fk_memory_superseded_by
      FOREIGN KEY (workspace_id, superseded_by_id)
      REFERENCES public.memory_items (workspace_id, id)
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$$;

-- 4. user_purge_cutoffs constraints
SELECT pg_temp.assert_unique('user_purge_cutoffs', 'uq_user_purge_cutoffs_gen', ARRAY['workspace_id', 'user_id', 'generation']);
SELECT pg_temp.assert_unique('user_purge_cutoffs', 'uq_user_purge_cutoffs_id', ARRAY['workspace_id', 'id']);
SELECT pg_temp.assert_fk('user_purge_cutoffs', 'fk_user_purge_cutoffs_workspace', ARRAY['workspace_id'], 'workspaces', ARRAY['id'], 'r');
SELECT pg_temp.assert_fk('user_purge_cutoffs', 'fk_user_purge_cutoffs_user', ARRAY['user_id'], 'users', ARRAY['id'], 'r');
SELECT pg_temp.assert_check('user_purge_cutoffs', 'chk_user_purge_cutoffs_gen', 'generation >= 1');

-- 5. user_purge_operations constraints
SELECT pg_temp.assert_unique('user_purge_operations', 'uq_user_purge_operations_id', ARRAY['workspace_id', 'id']);
SELECT pg_temp.assert_fk('user_purge_operations', 'fk_user_purge_operations_workspace', ARRAY['workspace_id'], 'workspaces', ARRAY['id'], 'r');
SELECT pg_temp.assert_fk('user_purge_operations', 'fk_user_purge_operations_user', ARRAY['user_id'], 'users', ARRAY['id'], 'r');
SELECT pg_temp.assert_check('user_purge_operations', 'chk_user_purge_operations_mode', 'mode IN (''history_and_memory'', ''account_closure'')');
SELECT pg_temp.assert_check('user_purge_operations', 'chk_user_purge_operations_status', 'status IN (''pending'', ''running'', ''completed'', ''partially_failed'', ''failed'')');
SELECT pg_temp.assert_check('user_purge_operations', 'chk_user_purge_operations_gen', 'generation >= 1');

-- 6. worker_dispatch_outbox constraints
SELECT pg_temp.assert_unique('worker_dispatch_outbox', 'uq_worker_dispatch_outbox_dedup', ARRAY['workspace_id', 'topic', 'dedup_key']);
SELECT pg_temp.assert_unique('worker_dispatch_outbox', 'uq_worker_dispatch_outbox_id', ARRAY['workspace_id', 'id']);
SELECT pg_temp.assert_fk('worker_dispatch_outbox', 'fk_worker_dispatch_outbox_workspace', ARRAY['workspace_id'], 'workspaces', ARRAY['id'], 'r');
SELECT pg_temp.assert_check('worker_dispatch_outbox', 'chk_worker_dispatch_outbox_status', 'status IN (''pending'', ''claimed'', ''dispatched'', ''failed'')');

-- ============================================================================
-- Section 6: Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON public.conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON public.conversations(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv ON public.conversation_messages(conversation_id, sequence_number ASC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_user ON public.conversation_messages(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_memory_items_workspace ON public.memory_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memory_items_user ON public.memory_items(workspace_id, user_id) WHERE scope = 'user';
CREATE INDEX IF NOT EXISTS idx_memory_items_category ON public.memory_items(workspace_id, category);
CREATE INDEX IF NOT EXISTS idx_memory_items_expiry ON public.memory_items(lifecycle_status, expires_at) WHERE expires_at IS NOT NULL;

-- Partial unique indexes enforcing one active memory item per logical group
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_active_user ON public.memory_items (workspace_id, user_id, category, key) WHERE lifecycle_status = 'active' AND scope = 'user';
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_active_workspace ON public.memory_items (workspace_id, category, key) WHERE lifecycle_status = 'active' AND scope = 'workspace';

CREATE INDEX IF NOT EXISTS idx_user_purge_cutoffs_user ON public.user_purge_cutoffs(workspace_id, user_id, generation DESC);
CREATE INDEX IF NOT EXISTS idx_user_purge_operations_status ON public.user_purge_operations(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_worker_dispatch_outbox_claim ON public.worker_dispatch_outbox(status, lease_expires_at, attempts);

-- ============================================================================
-- Section 7: State Machine & Immutability Triggers
-- ============================================================================

-- Trigger Procedure: enforce_conversation_state_transition
CREATE OR REPLACE FUNCTION public.enforce_conversation_state_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Identity immutability
  IF OLD.workspace_id <> NEW.workspace_id
     OR OLD.id <> NEW.id
     OR OLD.user_id <> NEW.user_id
     OR OLD.created_at <> NEW.created_at THEN
    RAISE EXCEPTION 'Conversation identity fields (workspace_id, id, user_id, created_at) are immutable';
  END IF;

  -- Terminal state immutability: purged conversations remain purged
  IF OLD.status = 'purged' AND NEW.status <> 'purged' THEN
    RAISE EXCEPTION 'Conversation % is purged and cannot be modified or reopened', OLD.id;
  END IF;

  -- Closed conversations cannot reopen (can only transition to purged)
  IF OLD.status = 'closed' AND NEW.status NOT IN ('closed', 'purged') THEN
    RAISE EXCEPTION 'Closed conversation % cannot be reopened (allowed next status is purged)', OLD.id;
  END IF;

  -- Allowed status transitions
  IF OLD.status <> NEW.status THEN
    IF OLD.status = 'active' AND NEW.status NOT IN ('archived', 'closed', 'purged') THEN
      RAISE EXCEPTION 'Invalid conversation status transition from % to %', OLD.status, NEW.status;
    ELSIF OLD.status = 'archived' AND NEW.status NOT IN ('active', 'closed', 'purged') THEN
      RAISE EXCEPTION 'Invalid conversation status transition from % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_conversation_state_transition ON public.conversations;
CREATE TRIGGER trg_enforce_conversation_state_transition
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_state_transition();

-- Trigger Procedure: enforce_conversation_message_immutability
CREATE OR REPLACE FUNCTION public.enforce_conversation_message_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Conversation messages are immutable and cannot be deleted directly';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Identity immutability
    IF OLD.workspace_id <> NEW.workspace_id
       OR OLD.conversation_id <> NEW.conversation_id
       OR OLD.id <> NEW.id
       OR OLD.user_id <> NEW.user_id
       OR OLD.sequence_number <> NEW.sequence_number
       OR OLD.sender_type <> NEW.sender_type
       OR OLD.sender_id <> NEW.sender_id
       OR OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'Conversation message identity fields are strictly immutable';
    END IF;

    -- Only redaction by privacy purge is allowed
    IF NEW.content <> '[REDACTED_BY_PRIVACY_PURGE]' AND NEW.content <> OLD.content THEN
      RAISE EXCEPTION 'Conversation message content is append-only except controlled privacy redaction';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_conversation_message_immutability ON public.conversation_messages;
CREATE TRIGGER trg_enforce_conversation_message_immutability
  BEFORE UPDATE OR DELETE ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_message_immutability();

-- Trigger Procedure: enforce_memory_item_immutability
CREATE OR REPLACE FUNCTION public.enforce_memory_item_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Memory items are durable records and cannot be deleted directly';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Identity and provenance immutability: use IS DISTINCT FROM for all nullable and non-nullable fields
    IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR OLD.id IS DISTINCT FROM NEW.id
       OR OLD.scope IS DISTINCT FROM NEW.scope
       OR OLD.user_id IS DISTINCT FROM NEW.user_id
       OR OLD.category IS DISTINCT FROM NEW.category
       OR OLD.key IS DISTINCT FROM NEW.key
       OR OLD.provenance IS DISTINCT FROM NEW.provenance
       OR OLD.provenance_conversation_id IS DISTINCT FROM NEW.provenance_conversation_id
       OR OLD.provenance_message_id IS DISTINCT FROM NEW.provenance_message_id
       OR OLD.provenance_user_id IS DISTINCT FROM NEW.provenance_user_id
       OR OLD.created_at IS DISTINCT FROM NEW.created_at
       OR OLD.version IS DISTINCT FROM NEW.version THEN
      RAISE EXCEPTION 'Memory item identity, provenance, version and creation fields are strictly immutable';
    END IF;

    -- Direct update to confidence and expires_at is prohibited
    IF OLD.confidence IS DISTINCT FROM NEW.confidence THEN
      RAISE EXCEPTION 'Direct update to memory_items.confidence is prohibited';
    END IF;

    IF OLD.expires_at IS DISTINCT FROM NEW.expires_at THEN
      RAISE EXCEPTION 'Direct update to memory_items.expires_at is prohibited';
    END IF;

    -- Value updates are strictly prohibited except for privacy purge redaction
    IF OLD.value IS DISTINCT FROM NEW.value THEN
      IF NOT (NEW.value = '[REDACTED_BY_PRIVACY_PURGE]' AND NEW.lifecycle_status = 'deleted') THEN
        RAISE EXCEPTION 'Direct update to memory_items.value is prohibited; content is immutable except by privacy purge';
      END IF;
    END IF;

    -- Lifecycle transitions: only approved state transitions are permitted
    IF OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status THEN
      IF OLD.lifecycle_status IN ('superseded', 'deleted', 'expired') AND NEW.lifecycle_status = 'active' THEN
        RAISE EXCEPTION 'Memory item % is in terminal lifecycle status % and cannot be reactivated', OLD.id, OLD.lifecycle_status;
      END IF;

      IF OLD.lifecycle_status = 'active' AND NEW.lifecycle_status = 'superseded' THEN
        IF OLD.superseded_by_id IS NOT NULL OR NEW.superseded_by_id IS NULL THEN
          RAISE EXCEPTION 'Supersession requires setting superseded_by_id to the successor item';
        END IF;
      ELSIF OLD.lifecycle_status = 'active' AND NEW.lifecycle_status = 'expired' THEN
        IF OLD.expires_at IS NULL OR OLD.expires_at > pg_catalog.now() THEN
          RAISE EXCEPTION 'Memory item has not reached its expiration timestamp';
        END IF;
      ELSIF NEW.lifecycle_status = 'deleted' THEN
        IF NEW.value <> '[REDACTED_BY_PRIVACY_PURGE]' THEN
          RAISE EXCEPTION 'Deletion lifecycle requires privacy purge redaction value';
        END IF;
      ELSE
        RAISE EXCEPTION 'Invalid memory lifecycle transition from % to %', OLD.lifecycle_status, NEW.lifecycle_status;
      END IF;
    ELSE
      -- Without lifecycle transition, superseded_by_id cannot be modified
      IF OLD.superseded_by_id IS DISTINCT FROM NEW.superseded_by_id THEN
        RAISE EXCEPTION 'Direct update to superseded_by_id without supersession lifecycle transition is prohibited';
      END IF;
    END IF;

    -- Consent transition rules: only approved transitions with valid actor and timestamp
    IF OLD.consent_status IS DISTINCT FROM NEW.consent_status THEN
      IF OLD.consent_status = 'pending_consent' AND NEW.consent_status = 'consented' THEN
        IF NEW.consent_actor_user_id IS NULL OR NEW.consented_at IS NULL OR OLD.revoked_at IS DISTINCT FROM NEW.revoked_at THEN
          RAISE EXCEPTION 'Granting consent requires actor and consented timestamp';
        END IF;
      ELSIF (OLD.consent_status IN ('pending_consent', 'consented')) AND NEW.consent_status = 'revoked' THEN
        IF NEW.consent_actor_user_id IS NULL OR NEW.revoked_at IS NULL OR OLD.consented_at IS DISTINCT FROM NEW.consented_at THEN
          RAISE EXCEPTION 'Revoking consent requires actor and revoked timestamp';
        END IF;
      ELSE
        RAISE EXCEPTION 'Invalid consent status transition from % to %', OLD.consent_status, NEW.consent_status;
      END IF;
    ELSE
      -- Consent actor and timestamp fields cannot change without status transition
      IF OLD.consent_actor_user_id IS DISTINCT FROM NEW.consent_actor_user_id
         OR OLD.consented_at IS DISTINCT FROM NEW.consented_at
         OR OLD.revoked_at IS DISTINCT FROM NEW.revoked_at THEN
        RAISE EXCEPTION 'Direct update to consent metadata fields is prohibited';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_memory_item_immutability ON public.memory_items;
CREATE TRIGGER trg_enforce_memory_item_immutability
  BEFORE UPDATE OR DELETE ON public.memory_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_memory_item_immutability();

-- ============================================================================
-- Section 8: Row-Level Security Policies
-- ============================================================================

-- 1. conversations (Owner-private and workspace-scoped fail-closed)
SELECT pg_temp.assert_rls('conversations');
DROP POLICY IF EXISTS tenant_and_owner_isolation_conversations ON public.conversations;
CREATE POLICY tenant_and_owner_isolation_conversations ON public.conversations
  FOR ALL
  USING (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
  );

-- 2. conversation_messages (Owner-private and workspace-scoped fail-closed)
SELECT pg_temp.assert_rls('conversation_messages');
DROP POLICY IF EXISTS tenant_and_owner_isolation_conversation_messages ON public.conversation_messages;
CREATE POLICY tenant_and_owner_isolation_conversation_messages ON public.conversation_messages
  FOR ALL
  USING (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
  );

-- 3. memory_items (Workspace and user scope fail-closed policies)
SELECT pg_temp.assert_rls('memory_items');
DROP POLICY IF EXISTS memory_items_select_policy ON public.memory_items;
CREATE POLICY memory_items_select_policy ON public.memory_items
  FOR SELECT
  USING (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND (
      (scope = 'user' AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid)
      OR
      (scope = 'workspace')
    )
  );

DROP POLICY IF EXISTS memory_items_insert_policy ON public.memory_items;
CREATE POLICY memory_items_insert_policy ON public.memory_items
  FOR INSERT
  WITH CHECK (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND (
      (scope = 'user' AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid)
      OR
      (scope = 'workspace' AND NULLIF(pg_catalog.current_setting('app.role', true), '') IN ('owner', 'admin'))
    )
  );

DROP POLICY IF EXISTS memory_items_update_policy ON public.memory_items;
CREATE POLICY memory_items_update_policy ON public.memory_items
  FOR UPDATE
  USING (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND (
      (scope = 'user' AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid)
      OR
      (scope = 'workspace' AND NULLIF(pg_catalog.current_setting('app.role', true), '') IN ('owner', 'admin'))
    )
  )
  WITH CHECK (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND (
      (scope = 'user' AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid)
      OR
      (scope = 'workspace' AND NULLIF(pg_catalog.current_setting('app.role', true), '') IN ('owner', 'admin'))
    )
  );

DROP POLICY IF EXISTS memory_items_delete_policy ON public.memory_items;
CREATE POLICY memory_items_delete_policy ON public.memory_items
  FOR DELETE
  USING (false);

-- 4. user_purge_cutoffs (Owner-private and workspace-scoped fail-closed)
SELECT pg_temp.assert_rls('user_purge_cutoffs');
DROP POLICY IF EXISTS tenant_and_owner_isolation_user_purge_cutoffs ON public.user_purge_cutoffs;
CREATE POLICY tenant_and_owner_isolation_user_purge_cutoffs ON public.user_purge_cutoffs
  FOR ALL
  USING (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
  );

-- 5. user_purge_operations (Owner-private and workspace-scoped fail-closed)
SELECT pg_temp.assert_rls('user_purge_operations');
DROP POLICY IF EXISTS tenant_and_owner_isolation_user_purge_operations ON public.user_purge_operations;
CREATE POLICY tenant_and_owner_isolation_user_purge_operations ON public.user_purge_operations
  FOR ALL
  USING (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    AND user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
  );

-- 6. worker_dispatch_outbox (Workspace-scoped fail-closed)
SELECT pg_temp.assert_rls('worker_dispatch_outbox');
DROP POLICY IF EXISTS tenant_isolation_worker_dispatch_outbox ON public.worker_dispatch_outbox;
CREATE POLICY tenant_isolation_worker_dispatch_outbox ON public.worker_dispatch_outbox
  FOR ALL
  USING (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  )
  WITH CHECK (
    workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  );

-- ============================================================================
-- Section 9: Hardened SECURITY DEFINER Functions
-- ============================================================================

-- Function 1: insert_system_default_memory
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

  -- Validate bounded inputs
  IF p_category NOT IN ('preference', 'fact', 'guideline', 'decision') THEN
    RAISE EXCEPTION 'Invalid memory category: %', p_category;
  END IF;
  IF p_key IS NULL OR pg_catalog.length(pg_catalog.trim(p_key)) = 0 OR pg_catalog.length(p_key) > 255 THEN
    RAISE EXCEPTION 'Memory key must be non-empty and at most 255 characters';
  END IF;
  IF p_value IS NULL OR pg_catalog.length(pg_catalog.trim(p_value)) = 0 OR pg_catalog.length(p_value) > 16384 THEN
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
    trim(p_key),
    trim(p_value),
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

-- Function 2: grant_memory_consent
CREATE OR REPLACE FUNCTION public.grant_memory_consent(
  p_session_token_hash TEXT,
  p_memory_id UUID
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
  v_memory RECORD;
BEGIN
  -- Authenticate through session token hash
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  -- Lock target memory item
  SELECT id, workspace_id, scope, user_id, category, key, consent_status, lifecycle_status
  INTO v_memory
  FROM public.memory_items
  WHERE id = p_memory_id AND workspace_id = v_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Memory item % not found in authenticated workspace', p_memory_id;
  END IF;

  IF v_memory.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot grant consent to non-active memory item (status is %)', v_memory.lifecycle_status;
  END IF;

  -- Authorization check
  IF v_memory.scope = 'user' THEN
    IF v_memory.user_id <> v_user_id THEN
      RAISE EXCEPTION 'Permission denied: cannot grant consent for another user''s memory';
    END IF;
  ELSIF v_memory.scope = 'workspace' THEN
    IF v_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'Permission denied: workspace memory consent requires owner or admin role';
    END IF;
  END IF;

  -- Transition check
  IF v_memory.consent_status = 'consented' THEN
    RAISE EXCEPTION 'Memory item is already consented';
  ELSIF v_memory.consent_status = 'revoked' THEN
    RAISE EXCEPTION 'Cannot grant consent to revoked memory item';
  END IF;

  -- Update consent
  UPDATE public.memory_items
  SET consent_status = 'consented',
      consent_actor_user_id = v_user_id,
      consented_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = p_memory_id;

  -- Emit content-free audit record
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
    'memory.consent_granted',
    'memory_item',
    p_memory_id::text,
    jsonb_build_object(
      'category', v_memory.category,
      'key', v_memory.key,
      'scope', v_memory.scope
    )
  );

  RETURN TRUE;
END;
$$;

-- Function 3: revoke_memory_consent
CREATE OR REPLACE FUNCTION public.revoke_memory_consent(
  p_session_token_hash TEXT,
  p_memory_id UUID
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
  v_memory RECORD;
BEGIN
  -- Authenticate through session token hash
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  -- Lock target memory item
  SELECT id, workspace_id, scope, user_id, category, key, consent_status, lifecycle_status
  INTO v_memory
  FROM public.memory_items
  WHERE id = p_memory_id AND workspace_id = v_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Memory item % not found in authenticated workspace', p_memory_id;
  END IF;

  IF v_memory.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot revoke consent for non-active memory item (status is %)', v_memory.lifecycle_status;
  END IF;

  -- Authorization check
  IF v_memory.scope = 'user' THEN
    IF v_memory.user_id <> v_user_id THEN
      RAISE EXCEPTION 'Permission denied: cannot revoke consent for another user''s memory';
    END IF;
  ELSIF v_memory.scope = 'workspace' THEN
    IF v_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'Permission denied: workspace memory consent revocation requires owner or admin role';
    END IF;
  END IF;

  -- Transition check
  IF v_memory.consent_status = 'revoked' THEN
    RAISE EXCEPTION 'Memory item consent is already revoked';
  END IF;

  -- Update consent
  UPDATE public.memory_items
  SET consent_status = 'revoked',
      consent_actor_user_id = v_user_id,
      revoked_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = p_memory_id;

  -- Emit content-free audit record
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
    'memory.consent_revoked',
    'memory_item',
    p_memory_id::text,
    jsonb_build_object(
      'category', v_memory.category,
      'key', v_memory.key,
      'scope', v_memory.scope
    )
  );

  RETURN TRUE;
END;
$$;

-- Function 4: supersede_memory_item
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
  IF p_new_value IS NULL OR length(trim(p_new_value)) = 0 OR length(p_new_value) > 16384 THEN
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

  -- Insert successor first (deferred FK allows predecessor to point to successor)
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
    trim(p_new_value),
    p_new_confidence,
    'pending_consent',
    NULL,
    NULL,
    NULL,
    p_provenance,
    p_provenance_conversation_id,
    p_provenance_message_id,
    CASE WHEN p_provenance = 'conversation_message' THEN v_user_id ELSE NULL END,
    'active',
    v_predecessor.version + 1,
    NULL,
    v_predecessor.expires_at
  );

  -- Mark predecessor superseded
  UPDATE public.memory_items
  SET lifecycle_status = 'superseded',
      superseded_by_id = v_successor_id,
      updated_at = pg_catalog.now()
  WHERE id = p_predecessor_id;

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

-- Function 5: expire_memory_items
CREATE OR REPLACE FUNCTION public.expire_memory_items(
  p_workspace_id UUID DEFAULT NULL,
  p_batch_size INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count INTEGER := 0;
  v_ids UUID[];
BEGIN
  SELECT array_agg(id)
  INTO v_ids
  FROM (
    SELECT id
    FROM public.memory_items
    WHERE (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND lifecycle_status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= pg_catalog.now()
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) sub;

  IF v_ids IS NOT NULL AND cardinality(v_ids) > 0 THEN
    UPDATE public.memory_items
    SET lifecycle_status = 'expired',
        updated_at = pg_catalog.now()
    WHERE id = ANY(v_ids);

    v_count := cardinality(v_ids);
  END IF;

  RETURN v_count;
END;
$$;

-- Function 6: initiate_self_privacy_purge
CREATE OR REPLACE FUNCTION public.initiate_self_privacy_purge(
  p_session_token_hash TEXT,
  p_mode TEXT
)
RETURNS TABLE (
  operation_id UUID,
  generation INTEGER,
  cutoff_at TIMESTAMPTZ
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
  v_gen INTEGER;
  v_cutoff TIMESTAMPTZ := pg_catalog.now();
  v_op_id UUID := pg_catalog.gen_random_uuid();
BEGIN
  -- Authenticate through session token hash
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  IF p_mode NOT IN ('history_and_memory', 'account_closure') THEN
    RAISE EXCEPTION 'Invalid purge mode: % (must be history_and_memory or account_closure)', p_mode;
  END IF;

  -- Transaction-safe serialization: prevent concurrent generation allocation race per (workspace, user)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_workspace_id::text),
    pg_catalog.hashtext(v_user_id::text)
  );

  -- Determine next generation atomically
  SELECT COALESCE(MAX(c.generation), 0) + 1
  INTO v_gen
  FROM public.user_purge_cutoffs c
  WHERE c.workspace_id = v_workspace_id AND c.user_id = v_user_id;

  -- Record permanent cutoff
  INSERT INTO public.user_purge_cutoffs (
    workspace_id,
    user_id,
    cutoff_at,
    generation
  ) VALUES (
    v_workspace_id,
    v_user_id,
    v_cutoff,
    v_gen
  );

  -- Record purge operation
  INSERT INTO public.user_purge_operations (
    id,
    workspace_id,
    user_id,
    generation,
    cutoff_at,
    mode,
    status
  ) VALUES (
    v_op_id,
    v_workspace_id,
    v_user_id,
    v_gen,
    v_cutoff,
    p_mode,
    'pending'
  );

  -- Enqueue into outbox
  INSERT INTO public.worker_dispatch_outbox (
    workspace_id,
    topic,
    dedup_key,
    payload,
    status
  ) VALUES (
    v_workspace_id,
    'privacy_purge',
    format('purge:%s:%s:%s', v_workspace_id, v_user_id, v_gen),
    jsonb_build_object(
      'operation_id', v_op_id,
      'workspace_id', v_workspace_id,
      'user_id', v_user_id,
      'generation', v_gen,
      'mode', p_mode,
      'cutoff_at', v_cutoff
    ),
    'pending'
  );

  -- If account closure, revoke all active sessions for this user in this workspace
  IF p_mode = 'account_closure' THEN
    UPDATE public.sessions
    SET revoked_at = pg_catalog.now()
    WHERE workspace_id = v_workspace_id AND user_id = v_user_id AND revoked_at IS NULL;
  END IF;

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
    'privacy.purge_initiated',
    'user_purge_operation',
    v_op_id::text,
    jsonb_build_object(
      'generation', v_gen,
      'mode', p_mode
    )
  );

  RETURN QUERY SELECT v_op_id, v_gen, v_cutoff;
END;
$$;

-- Function 7: acquire_purge_lease
CREATE OR REPLACE FUNCTION public.acquire_purge_lease(
  p_operation_id UUID,
  p_worker_id TEXT,
  p_lease_duration_seconds INTEGER DEFAULT 60
)
RETURNS TABLE (
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  mode TEXT,
  cutoff_at TIMESTAMPTZ,
  workspace_id UUID,
  user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_op RECORD;
  v_token UUID := pg_catalog.gen_random_uuid();
  v_expires TIMESTAMPTZ := pg_catalog.now() + (p_lease_duration_seconds || ' seconds')::interval;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'Worker identifier is required';
  END IF;

  SELECT *
  INTO v_op
  FROM public.user_purge_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purge operation % not found', p_operation_id;
  END IF;

  -- Can acquire only if pending or (running with expired lease)
  IF v_op.status NOT IN ('pending', 'running') THEN
    RAISE EXCEPTION 'Purge operation % is in terminal state %', p_operation_id, v_op.status;
  END IF;

  IF v_op.status = 'running' AND v_op.lease_expires_at > pg_catalog.now() THEN
    RAISE EXCEPTION 'Purge operation % is currently leased until %', p_operation_id, v_op.lease_expires_at;
  END IF;

  IF v_op.attempts >= v_op.max_attempts THEN
    RAISE EXCEPTION 'Purge operation % has exhausted maximum attempts (%)', p_operation_id, v_op.max_attempts;
  END IF;

  UPDATE public.user_purge_operations
  SET status = 'running',
      lease_token = v_token,
      lease_worker_id = p_worker_id,
      lease_expires_at = v_expires,
      attempts = attempts + 1,
      updated_at = pg_catalog.now()
  WHERE id = p_operation_id;

  RETURN QUERY SELECT v_token, v_expires, v_op.mode, v_op.cutoff_at, v_op.workspace_id, v_op.user_id;
END;
$$;

-- Function 8: renew_purge_lease
CREATE OR REPLACE FUNCTION public.renew_purge_lease(
  p_operation_id UUID,
  p_lease_token UUID,
  p_worker_id TEXT,
  p_extension_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.user_purge_operations
  SET lease_expires_at = pg_catalog.now() + (p_extension_seconds || ' seconds')::interval,
      updated_at = pg_catalog.now()
  WHERE id = p_operation_id
    AND lease_token = p_lease_token
    AND lease_worker_id = p_worker_id
    AND status = 'running'
    AND lease_expires_at > pg_catalog.now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- Function 9: process_purge_batch_messages
CREATE OR REPLACE FUNCTION public.process_purge_batch_messages(
  p_operation_id UUID,
  p_lease_token UUID,
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 100
)
RETURNS TABLE (
  processed_count INTEGER,
  has_more BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_op RECORD;
  v_ids UUID[];
  v_processed INTEGER := 0;
  v_remaining BIGINT;
BEGIN
  -- Validate lease fencing
  SELECT *
  INTO v_op
  FROM public.user_purge_operations
  WHERE id = p_operation_id
    AND lease_token = p_lease_token
    AND lease_worker_id = p_worker_id
    AND status = 'running'
    AND lease_expires_at > pg_catalog.now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purge fence violation: invalid or expired lease for operation %', p_operation_id;
  END IF;

  SELECT array_agg(sub.id)
  INTO v_ids
  FROM (
    SELECT m.id
    FROM public.conversation_messages m
    WHERE m.workspace_id = v_op.workspace_id
      AND m.user_id = v_op.user_id
      AND m.created_at <= v_op.cutoff_at
      AND m.content <> '[REDACTED_BY_PRIVACY_PURGE]'
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) sub;

  IF v_ids IS NOT NULL AND cardinality(v_ids) > 0 THEN
    UPDATE public.conversation_messages
    SET content = '[REDACTED_BY_PRIVACY_PURGE]',
        metadata = '{}'::jsonb
    WHERE id = ANY(v_ids);

    v_processed := cardinality(v_ids);
    UPDATE public.user_purge_operations
    SET purged_messages_count = purged_messages_count + v_processed,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id;
  END IF;

  SELECT count(*)
  INTO v_remaining
  FROM public.conversation_messages
  WHERE workspace_id = v_op.workspace_id
    AND user_id = v_op.user_id
    AND created_at <= v_op.cutoff_at
    AND content <> '[REDACTED_BY_PRIVACY_PURGE]';

  IF v_remaining = 0 THEN
    UPDATE public.user_purge_operations
    SET checkpoint_messages_completed = TRUE,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id;
  END IF;

  RETURN QUERY SELECT v_processed, (v_remaining > 0);
END;
$$;

-- Function 10: process_purge_batch_conversations
CREATE OR REPLACE FUNCTION public.process_purge_batch_conversations(
  p_operation_id UUID,
  p_lease_token UUID,
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 100
)
RETURNS TABLE (
  processed_count INTEGER,
  has_more BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_op RECORD;
  v_ids UUID[];
  v_processed INTEGER := 0;
  v_remaining BIGINT;
BEGIN
  -- Validate lease fencing
  SELECT *
  INTO v_op
  FROM public.user_purge_operations
  WHERE id = p_operation_id
    AND lease_token = p_lease_token
    AND lease_worker_id = p_worker_id
    AND status = 'running'
    AND lease_expires_at > pg_catalog.now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purge fence violation: invalid or expired lease for operation %', p_operation_id;
  END IF;

  SELECT array_agg(sub.id)
  INTO v_ids
  FROM (
    SELECT c.id
    FROM public.conversations c
    WHERE c.workspace_id = v_op.workspace_id
      AND c.user_id = v_op.user_id
      AND c.created_at <= v_op.cutoff_at
      AND c.status <> 'purged'
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) sub;

  IF v_ids IS NOT NULL AND cardinality(v_ids) > 0 THEN
    UPDATE public.conversations
    SET status = 'purged',
        title = '[REDACTED_BY_PRIVACY_PURGE]',
        metadata = '{}'::jsonb,
        updated_at = pg_catalog.now()
    WHERE id = ANY(v_ids);

    v_processed := cardinality(v_ids);
    UPDATE public.user_purge_operations
    SET purged_conversations_count = purged_conversations_count + v_processed,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id;
  END IF;

  SELECT count(*)
  INTO v_remaining
  FROM public.conversations
  WHERE workspace_id = v_op.workspace_id
    AND user_id = v_op.user_id
    AND created_at <= v_op.cutoff_at
    AND status <> 'purged';

  IF v_remaining = 0 THEN
    UPDATE public.user_purge_operations
    SET checkpoint_conversations_completed = TRUE,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id;
  END IF;

  RETURN QUERY SELECT v_processed, (v_remaining > 0);
END;
$$;

-- Function 11: process_purge_batch_memories
CREATE OR REPLACE FUNCTION public.process_purge_batch_memories(
  p_operation_id UUID,
  p_lease_token UUID,
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 100
)
RETURNS TABLE (
  processed_count INTEGER,
  has_more BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_op RECORD;
  v_ids UUID[];
  v_processed INTEGER := 0;
  v_remaining BIGINT;
BEGIN
  -- Validate lease fencing
  SELECT *
  INTO v_op
  FROM public.user_purge_operations
  WHERE id = p_operation_id
    AND lease_token = p_lease_token
    AND lease_worker_id = p_worker_id
    AND status = 'running'
    AND lease_expires_at > pg_catalog.now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purge fence violation: invalid or expired lease for operation %', p_operation_id;
  END IF;

  SELECT array_agg(sub.id)
  INTO v_ids
  FROM (
    SELECT m.id
    FROM public.memory_items m
    WHERE m.workspace_id = v_op.workspace_id
      AND m.scope = 'user'
      AND m.user_id = v_op.user_id
      AND m.created_at <= v_op.cutoff_at
      AND m.lifecycle_status <> 'deleted'
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) sub;

  IF v_ids IS NOT NULL AND cardinality(v_ids) > 0 THEN
    UPDATE public.memory_items
    SET lifecycle_status = 'deleted',
        value = '[REDACTED_BY_PRIVACY_PURGE]',
        updated_at = pg_catalog.now()
    WHERE id = ANY(v_ids);

    v_processed := cardinality(v_ids);
    UPDATE public.user_purge_operations
    SET purged_memories_count = purged_memories_count + v_processed,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id;
  END IF;

  SELECT count(*)
  INTO v_remaining
  FROM public.memory_items
  WHERE workspace_id = v_op.workspace_id
    AND scope = 'user'
    AND user_id = v_op.user_id
    AND created_at <= v_op.cutoff_at
    AND lifecycle_status <> 'deleted';

  IF v_remaining = 0 THEN
    UPDATE public.user_purge_operations
    SET checkpoint_memories_completed = TRUE,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id;
  END IF;

  RETURN QUERY SELECT v_processed, (v_remaining > 0);
END;
$$;

-- Function 12: complete_purge_operation
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
DECLARE
  v_op RECORD;
BEGIN
  SELECT *
  INTO v_op
  FROM public.user_purge_operations
  WHERE id = p_operation_id
    AND lease_token = p_lease_token
    AND lease_worker_id = p_worker_id
    AND status = 'running'
    AND lease_expires_at > pg_catalog.now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purge fence violation: invalid or expired lease for operation %', p_operation_id;
  END IF;

  -- Prerequisite checkpoint validation: messages, conversations, memories checkpoints must all be completed
  IF NOT (v_op.checkpoint_messages_completed AND v_op.checkpoint_conversations_completed AND v_op.checkpoint_memories_completed) THEN
    RAISE EXCEPTION 'Cannot complete purge operation %: prerequisite checkpoints incomplete (messages: %, conversations: %, memories: %)',
      p_operation_id, v_op.checkpoint_messages_completed, v_op.checkpoint_conversations_completed, v_op.checkpoint_memories_completed;
  END IF;

  -- If account closure, remove membership and complete membership checkpoint
  IF v_op.mode = 'account_closure' THEN
    DELETE FROM public.memberships
    WHERE workspace_id = v_op.workspace_id AND user_id = v_op.user_id;

    UPDATE public.user_purge_operations
    SET checkpoint_membership_completed = TRUE
    WHERE id = p_operation_id;
  END IF;

  UPDATE public.user_purge_operations
  SET status = 'completed',
      completed_at = pg_catalog.now(),
      lease_token = NULL,
      lease_worker_id = NULL,
      lease_expires_at = NULL,
      updated_at = pg_catalog.now()
  WHERE id = p_operation_id;

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
      'purged_messages', v_op.purged_messages_count,
      'purged_conversations', v_op.purged_conversations_count,
      'purged_memories', v_op.purged_memories_count
    )
  );

  RETURN TRUE;
END;
$$;

-- Function 13: fail_purge_operation
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
DECLARE
  v_op RECORD;
  v_terminal BOOLEAN;
BEGIN
  SELECT *
  INTO v_op
  FROM public.user_purge_operations
  WHERE id = p_operation_id
    AND lease_token = p_lease_token
    AND lease_worker_id = p_worker_id
    AND status = 'running'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purge fence violation: cannot fail operation without active lease %', p_operation_id;
  END IF;

  v_terminal := p_terminal OR (v_op.attempts >= v_op.max_attempts);

  UPDATE public.user_purge_operations
  SET status = CASE WHEN v_terminal THEN 'failed' ELSE 'pending' END,
      error_code = p_error_code,
      error_category = p_error_category,
      lease_token = NULL,
      lease_worker_id = NULL,
      lease_expires_at = NULL,
      updated_at = pg_catalog.now()
  WHERE id = p_operation_id;

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

-- Function 14: claim_outbox_dispatches
CREATE OR REPLACE FUNCTION public.claim_outbox_dispatches(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 10,
  p_lease_seconds INTEGER DEFAULT 30
)
RETURNS TABLE (
  id UUID,
  workspace_id UUID,
  topic TEXT,
  dedup_key TEXT,
  payload JSONB,
  claim_token UUID,
  attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ids UUID[];
  v_token UUID := pg_catalog.gen_random_uuid();
  v_expires TIMESTAMPTZ := pg_catalog.now() + (p_lease_seconds || ' seconds')::interval;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'Worker identifier is required';
  END IF;

  SELECT array_agg(sub.id)
  INTO v_ids
  FROM (
    SELECT o.id
    FROM public.worker_dispatch_outbox o
    WHERE (
      o.status = 'pending'
      OR (o.status = 'claimed' AND o.lease_expires_at < pg_catalog.now())
    )
    AND o.attempts < o.max_attempts
    ORDER BY o.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) sub;

  IF v_ids IS NOT NULL AND cardinality(v_ids) > 0 THEN
    UPDATE public.worker_dispatch_outbox o
    SET status = 'claimed',
        claim_token = v_token,
        lease_worker_id = p_worker_id,
        lease_expires_at = v_expires,
        attempts = o.attempts + 1,
        updated_at = pg_catalog.now()
    WHERE o.id = ANY(v_ids);

    RETURN QUERY
    SELECT o.id, o.workspace_id, o.topic, o.dedup_key, o.payload, o.claim_token, o.attempts
    FROM public.worker_dispatch_outbox o
    WHERE o.id = ANY(v_ids);
  END IF;
END;
$$;

-- Function 15: mark_outbox_dispatched
CREATE OR REPLACE FUNCTION public.mark_outbox_dispatched(
  p_outbox_id UUID,
  p_claim_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.worker_dispatch_outbox
  SET status = 'dispatched',
      dispatched_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = p_outbox_id
    AND claim_token = p_claim_token
    AND status = 'claimed'
    AND lease_expires_at >= pg_catalog.now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- Function 16: mark_outbox_failed
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
DECLARE
  v_rec RECORD;
  v_terminal BOOLEAN;
BEGIN
  SELECT *
  INTO v_rec
  FROM public.worker_dispatch_outbox
  WHERE id = p_outbox_id AND claim_token = p_claim_token AND status = 'claimed'
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
  WHERE id = p_outbox_id;

  IF v_terminal THEN
    INSERT INTO public.audit_events (
      workspace_id,
      action,
      target_type,
      target_id,
      payload
    ) VALUES (
      v_rec.workspace_id,
      'outbox.dispatch_exhausted',
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

-- Function 17: inspect_private_conversation
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
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  -- Administrative role check
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: administrative inspection requires owner or admin role';
  END IF;

  -- Validate justification
  IF p_justification IS NULL OR length(trim(p_justification)) < 10 OR length(p_justification) > 500 THEN
    RAISE EXCEPTION 'Inspection justification must be between 10 and 500 characters';
  END IF;

  -- Validate conversation exists in same workspace
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = p_conversation_id AND workspace_id = v_workspace_id
  ) THEN
    RAISE EXCEPTION 'Conversation % not found in authenticated workspace', p_conversation_id;
  END IF;

  -- Count rows to be returned
  SELECT count(*)
  INTO v_count
  FROM (
    SELECT m.id
    FROM public.conversation_messages m
    WHERE m.workspace_id = v_workspace_id
      AND m.conversation_id = p_conversation_id
    ORDER BY m.sequence_number ASC
    LIMIT p_limit OFFSET p_offset
  ) sub;

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
      'justification', trim(p_justification),
      'returned_count', v_count,
      'limit', p_limit,
      'offset', p_offset
    )
  );

  RETURN QUERY
  SELECT m.id, m.sequence_number, m.sender_type, m.sender_id, m.content, m.advisory_token_count, m.created_at
  FROM public.conversation_messages m
  WHERE m.workspace_id = v_workspace_id
    AND m.conversation_id = p_conversation_id
  ORDER BY m.sequence_number ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Function 18: export_user_conversation_history
CREATE OR REPLACE FUNCTION public.export_user_conversation_history(
  p_session_token_hash TEXT
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
  v_conv_count INTEGER;
  v_msg_count INTEGER;
  v_result JSONB;
BEGIN
  -- Authenticate through session token hash
  SELECT s.session_id, s.workspace_id, s.user_id, s.role
  INTO v_session_id, v_workspace_id, v_user_id, v_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or invalid session token';
  END IF;

  SELECT count(*)
  INTO v_conv_count
  FROM public.conversations
  WHERE workspace_id = v_workspace_id AND user_id = v_user_id;

  SELECT count(*)
  INTO v_msg_count
  FROM public.conversation_messages
  WHERE workspace_id = v_workspace_id AND user_id = v_user_id;

  SELECT jsonb_build_object(
    'workspace_id', v_workspace_id,
    'user_id', v_user_id,
    'exported_at', pg_catalog.now(),
    'conversations', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'title', c.title,
            'channel', c.channel,
            'status', c.status,
            'metadata', c.metadata,
            'created_at', c.created_at,
            'updated_at', c.updated_at,
            'messages', COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', m.id,
                    'sequence_number', m.sequence_number,
                    'sender_type', m.sender_type,
                    'sender_id', m.sender_id,
                    'content', m.content,
                    'advisory_token_count', m.advisory_token_count,
                    'metadata', m.metadata,
                    'created_at', m.created_at
                  ) ORDER BY m.sequence_number ASC
                )
                FROM public.conversation_messages m
                WHERE m.conversation_id = c.id
              ),
              '[]'::jsonb
            )
          ) ORDER BY c.created_at ASC
        )
        FROM public.conversations c
        WHERE c.workspace_id = v_workspace_id AND c.user_id = v_user_id
      ),
      '[]'::jsonb
    )
  ) INTO v_result;

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
    'user.history_export',
    'user',
    v_user_id::text,
    jsonb_build_object(
      'conversation_count', v_conv_count,
      'message_count', v_msg_count
    )
  );

  RETURN v_result;
END;
$$;

-- ============================================================================
-- Section 10: Role Grants & Permissions (Privilege Boundaries)
-- ============================================================================

-- Ensure public schema cannot be made writable
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Explicitly revoke all privileges on SECURITY DEFINER functions from PUBLIC unconditionally
REVOKE ALL ON FUNCTION public.enforce_conversation_state_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_conversation_message_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_memory_item_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_system_default_memory(UUID, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_memory_consent(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_memory_consent(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.supersede_memory_item(TEXT, UUID, TEXT, NUMERIC, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_memory_items(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initiate_self_privacy_purge(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_purge_lease(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_purge_lease(UUID, UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_purge_batch_messages(UUID, UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_purge_batch_conversations(UUID, UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_purge_batch_memories(UUID, UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_purge_operation(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_purge_operation(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_outbox_dispatches(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_outbox_dispatched(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_outbox_failed(UUID, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inspect_private_conversation(TEXT, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.export_user_conversation_history(TEXT) FROM PUBLIC;

DO $$
BEGIN
  -- 1. Configuration for thaara_app
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_app') THEN
    REVOKE CREATE ON SCHEMA public FROM thaara_app;
    GRANT USAGE ON SCHEMA public TO thaara_app;

    GRANT EXECUTE ON FUNCTION public.enforce_conversation_state_transition() TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.enforce_conversation_message_immutability() TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.enforce_memory_item_immutability() TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.grant_memory_consent(TEXT, UUID) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.revoke_memory_consent(TEXT, UUID) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.supersede_memory_item(TEXT, UUID, TEXT, NUMERIC, TEXT, UUID, UUID) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.initiate_self_privacy_purge(TEXT, TEXT) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.inspect_private_conversation(TEXT, UUID, TEXT, INTEGER, INTEGER) TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.export_user_conversation_history(TEXT) TO thaara_app;
    -- expire_memory_items is worker-only; revoke from thaara_app
    REVOKE ALL ON FUNCTION public.expire_memory_items(UUID, INTEGER) FROM thaara_app;

    GRANT SELECT, INSERT, UPDATE ON TABLE public.conversations TO thaara_app;
    GRANT SELECT, INSERT ON TABLE public.conversation_messages TO thaara_app;
    GRANT SELECT, INSERT ON TABLE public.memory_items TO thaara_app;
    GRANT SELECT ON TABLE public.user_purge_cutoffs TO thaara_app;
    GRANT SELECT ON TABLE public.user_purge_operations TO thaara_app;
    GRANT SELECT ON TABLE public.worker_dispatch_outbox TO thaara_app;

    -- Strict least privilege: revoke direct DELETE on tenant tables
    REVOKE DELETE ON TABLE public.conversations FROM thaara_app;
    REVOKE DELETE ON TABLE public.conversation_messages FROM thaara_app;
    REVOKE DELETE ON TABLE public.memory_items FROM thaara_app;
    REVOKE DELETE ON TABLE public.user_purge_cutoffs FROM thaara_app;
    REVOKE DELETE ON TABLE public.user_purge_operations FROM thaara_app;
    REVOKE DELETE ON TABLE public.worker_dispatch_outbox FROM thaara_app;

    -- Strict append-only: revoke direct UPDATE on messages
    REVOKE UPDATE ON TABLE public.conversation_messages FROM thaara_app;

    -- Strict authorization boundary: revoke direct UPDATE on memory_items, user_purge_operations, worker_dispatch_outbox
    REVOKE UPDATE ON TABLE public.memory_items FROM thaara_app;
    REVOKE UPDATE ON TABLE public.user_purge_operations FROM thaara_app;
    REVOKE UPDATE ON TABLE public.worker_dispatch_outbox FROM thaara_app;

    -- Strict authorization boundary: revoke direct INSERT on user_purge_cutoffs, user_purge_operations, worker_dispatch_outbox
    REVOKE INSERT ON TABLE public.user_purge_cutoffs FROM thaara_app;
    REVOKE INSERT ON TABLE public.user_purge_operations FROM thaara_app;
    REVOKE INSERT ON TABLE public.worker_dispatch_outbox FROM thaara_app;

    -- Prohibit system default insertion by application role
    REVOKE ALL ON FUNCTION public.insert_system_default_memory(UUID, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ) FROM thaara_app;
  END IF;

  -- 2. Configuration for thaara_seeder
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_seeder') THEN
    REVOKE CREATE ON SCHEMA public FROM thaara_seeder;
    GRANT USAGE ON SCHEMA public TO thaara_seeder;
    GRANT EXECUTE ON FUNCTION public.insert_system_default_memory(UUID, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ) TO thaara_seeder;

    -- Strict authorization boundary: revoke direct table DML from thaara_seeder
    REVOKE ALL ON TABLE public.memory_items FROM thaara_seeder;
    REVOKE ALL ON TABLE public.conversations FROM thaara_seeder;
    REVOKE ALL ON TABLE public.conversation_messages FROM thaara_seeder;
    REVOKE ALL ON TABLE public.user_purge_cutoffs FROM thaara_seeder;
    REVOKE ALL ON TABLE public.user_purge_operations FROM thaara_seeder;
    REVOKE ALL ON TABLE public.worker_dispatch_outbox FROM thaara_seeder;
  END IF;

  -- 3. Configuration for thaara_worker
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_worker') THEN
    REVOKE CREATE ON SCHEMA public FROM thaara_worker;
    GRANT USAGE ON SCHEMA public TO thaara_worker;

    GRANT EXECUTE ON FUNCTION public.acquire_purge_lease(UUID, TEXT, INTEGER) TO thaara_worker;
    GRANT EXECUTE ON FUNCTION public.renew_purge_lease(UUID, UUID, TEXT, INTEGER) TO thaara_worker;
    GRANT EXECUTE ON FUNCTION public.process_purge_batch_messages(UUID, UUID, TEXT, INTEGER) TO thaara_worker;
    GRANT EXECUTE ON FUNCTION public.process_purge_batch_conversations(UUID, UUID, TEXT, INTEGER) TO thaara_worker;
    GRANT EXECUTE ON FUNCTION public.process_purge_batch_memories(UUID, UUID, TEXT, INTEGER) TO thaara_worker;
    GRANT EXECUTE ON FUNCTION public.complete_purge_operation(UUID, UUID, TEXT) TO thaara_worker;
    GRANT EXECUTE ON FUNCTION public.fail_purge_operation(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) TO thaara_worker;
    GRANT EXECUTE ON FUNCTION public.claim_outbox_dispatches(TEXT, INTEGER, INTEGER) TO thaara_worker;
    GRANT EXECUTE ON FUNCTION public.mark_outbox_dispatched(UUID, UUID) TO thaara_worker;
    GRANT EXECUTE ON FUNCTION public.mark_outbox_failed(UUID, UUID, TEXT, TEXT, BOOLEAN) TO thaara_worker;
    GRANT EXECUTE ON FUNCTION public.expire_memory_items(UUID, INTEGER) TO thaara_worker;
  END IF;

  -- 4. Configuration for thaara_admin
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_admin') THEN
    REVOKE CREATE ON SCHEMA public FROM thaara_admin;
    GRANT USAGE ON SCHEMA public TO thaara_admin;
    GRANT EXECUTE ON FUNCTION public.inspect_private_conversation(TEXT, UUID, TEXT, INTEGER, INTEGER) TO thaara_admin;
    -- expire_memory_items is worker-only; revoke from thaara_admin
    REVOKE ALL ON FUNCTION public.expire_memory_items(UUID, INTEGER) FROM thaara_admin;
  END IF;
END;
$$;

-- ============================================================================
-- Section 11: Final Post-Migration Verification Suite
-- ============================================================================

-- Ensure all triggers are bound
SELECT pg_temp.assert_trigger('conversations', 'trg_enforce_conversation_state_transition', 'enforce_conversation_state_transition');
SELECT pg_temp.assert_trigger('conversation_messages', 'trg_enforce_conversation_message_immutability', 'enforce_conversation_message_immutability');
SELECT pg_temp.assert_trigger('memory_items', 'trg_enforce_memory_item_immutability', 'enforce_memory_item_immutability');

-- Security Definer, search_path and privilege boundary assertions
DO $$
DECLARE
  v_fn TEXT;
  v_fn_oid OID;
  v_secdef BOOLEAN;
  v_config TEXT[];
  v_fn_list TEXT[] := ARRAY[
    'enforce_conversation_state_transition',
    'enforce_conversation_message_immutability',
    'enforce_memory_item_immutability',
    'insert_system_default_memory',
    'grant_memory_consent',
    'revoke_memory_consent',
    'supersede_memory_item',
    'expire_memory_items',
    'initiate_self_privacy_purge',
    'acquire_purge_lease',
    'renew_purge_lease',
    'process_purge_batch_messages',
    'process_purge_batch_conversations',
    'process_purge_batch_memories',
    'complete_purge_operation',
    'fail_purge_operation',
    'claim_outbox_dispatches',
    'mark_outbox_dispatched',
    'mark_outbox_failed',
    'inspect_private_conversation',
    'export_user_conversation_history'
  ];
  v_tables TEXT[] := ARRAY[
    'conversations',
    'conversation_messages',
    'memory_items',
    'user_purge_cutoffs',
    'user_purge_operations',
    'worker_dispatch_outbox'
  ];
  v_tbl TEXT;
  v_rls BOOLEAN;
  v_force BOOLEAN;
BEGIN
  -- Verify RLS and FORCE RLS on all 6 tables
  FOREACH v_tbl IN ARRAY v_tables LOOP
    SELECT relrowsecurity, relforcerowsecurity
    INTO v_rls, v_force
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND c.relname = v_tbl;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Architectural Migration Failure: Table public.% does not exist', v_tbl;
    END IF;

    IF NOT v_rls THEN
      RAISE EXCEPTION 'Architectural Migration Failure: Table public.% does not have RLS enabled', v_tbl;
    END IF;

    IF NOT v_force THEN
      RAISE EXCEPTION 'Architectural Migration Failure: Table public.% does not have FORCE RLS enabled', v_tbl;
    END IF;
  END LOOP;

  -- Verify all functions have SECURITY DEFINER and pinned search_path
  FOREACH v_fn IN ARRAY v_fn_list LOOP
    SELECT p.oid, p.prosecdef, p.proconfig
    INTO v_fn_oid, v_secdef, v_config
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Architectural Migration Error: Function public.% does not exist', v_fn;
    END IF;

    IF NOT v_secdef THEN
      RAISE EXCEPTION 'Architectural Migration Error: Function public.% is not SECURITY DEFINER', v_fn;
    END IF;

    IF v_config IS NULL OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY(v_config)) THEN
      RAISE EXCEPTION 'Architectural Migration Error: Function public.% does not have pinned search_path = pg_catalog, public, pg_temp (proconfig: %)', v_fn, v_config;
    END IF;

    -- Ensure PUBLIC does not have execute privilege
    IF has_function_privilege('public', v_fn_oid, 'execute') THEN
      RAISE EXCEPTION 'Architectural Migration Error: PUBLIC has execute privilege on public.%', v_fn;
    END IF;
  END LOOP;

  -- Privilege boundary assertions for thaara_app (when present)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_app') THEN
    IF has_function_privilege('thaara_app', 'public.insert_system_default_memory(uuid, text, text, text, numeric, timestamptz)', 'execute') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_app has execute privilege on insert_system_default_memory';
    END IF;

    IF has_function_privilege('thaara_app', 'public.expire_memory_items(uuid, integer)', 'execute') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_app has execute privilege on expire_memory_items';
    END IF;

    IF has_table_privilege('thaara_app', 'public.memory_items', 'update') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_app has direct UPDATE privilege on memory_items';
    END IF;

    IF has_table_privilege('thaara_app', 'public.user_purge_operations', 'update') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_app has direct UPDATE privilege on user_purge_operations';
    END IF;

    IF has_table_privilege('thaara_app', 'public.worker_dispatch_outbox', 'update') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_app has direct UPDATE privilege on worker_dispatch_outbox';
    END IF;

    IF has_table_privilege('thaara_app', 'public.user_purge_cutoffs', 'insert') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_app has direct INSERT privilege on user_purge_cutoffs';
    END IF;

    IF has_table_privilege('thaara_app', 'public.user_purge_operations', 'insert') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_app has direct INSERT privilege on user_purge_operations';
    END IF;

    IF has_table_privilege('thaara_app', 'public.worker_dispatch_outbox', 'insert') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_app has direct INSERT privilege on worker_dispatch_outbox';
    END IF;
  END IF;

  -- Privilege boundary assertions for thaara_admin (when present)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_admin') THEN
    IF has_function_privilege('thaara_admin', 'public.expire_memory_items(uuid, integer)', 'execute') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_admin has execute privilege on expire_memory_items';
    END IF;
  END IF;

  -- Privilege boundary assertions for thaara_seeder (when present)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_seeder') THEN
    IF has_table_privilege('thaara_seeder', 'public.memory_items', 'insert') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_seeder has direct INSERT privilege on memory_items';
    END IF;

    IF has_table_privilege('thaara_seeder', 'public.memory_items', 'select') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_seeder has direct SELECT privilege on memory_items';
    END IF;

    IF NOT has_function_privilege('thaara_seeder', 'public.insert_system_default_memory(uuid, text, text, text, numeric, timestamptz)', 'execute') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_seeder lacks execute privilege on insert_system_default_memory';
    END IF;
  END IF;

  -- Privilege boundary assertions for thaara_worker (when present)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_worker') THEN
    IF NOT has_function_privilege('thaara_worker', 'public.expire_memory_items(uuid, integer)', 'execute') THEN
      RAISE EXCEPTION 'Security Assertion Failure: thaara_worker lacks execute privilege on expire_memory_items';
    END IF;
  END IF;
END;
$$;
