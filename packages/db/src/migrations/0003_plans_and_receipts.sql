-- Migration 0003: Plans, Plan Steps, Dependencies, Approval Bindings, Step Executions, and Receipts
-- Establishes deterministic tenant-scoped DAG execution, approval binding, crash-safe leases, and immutable truthful receipts

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

    -- Drop existing constraint with same name if it had different definition
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
-- Section 2: Prerequisites & Table Definitions
-- ============================================================================

-- Prerequisite: approval_requests must exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'approval_requests') THEN
    RAISE EXCEPTION 'Architectural Migration Failure: Prerequisite table public.approval_requests is missing';
  END IF;
END;
$$;

-- Conditionally ensure uq_approval_requests_workspace_id exists
SELECT pg_temp.assert_unique('approval_requests', 'uq_approval_requests_workspace_id', ARRAY['workspace_id', 'id']);

-- 1. Table: plans
CREATE TABLE IF NOT EXISTS public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  created_by_user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Table: plan_steps
CREATE TABLE IF NOT EXISTS public.plan_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  step_index INTEGER NOT NULL,
  action_name TEXT NOT NULL,
  action_class TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  approval_mode TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  parameter_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  version INTEGER NOT NULL DEFAULT 1,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Table: plan_step_dependencies
CREATE TABLE IF NOT EXISTS public.plan_step_dependencies (
  workspace_id UUID NOT NULL,
  plan_id UUID NOT NULL,
  step_id UUID NOT NULL,
  depends_on_step_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (step_id, depends_on_step_id)
);

-- 4. Table: plan_step_approval_bindings
CREATE TABLE IF NOT EXISTS public.plan_step_approval_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  plan_id UUID NOT NULL,
  step_id UUID NOT NULL,
  approval_request_id UUID NOT NULL,
  parameter_hash TEXT NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Table: step_executions
CREATE TABLE IF NOT EXISTS public.step_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  plan_id UUID NOT NULL,
  step_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  lease_token UUID NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

-- 6. Table: receipts
CREATE TABLE IF NOT EXISTS public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  plan_id UUID NOT NULL,
  plan_step_id UUID NOT NULL,
  action_name TEXT NOT NULL,
  status TEXT NOT NULL,
  proof JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_method TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);


-- ============================================================================
-- Section 3: Semantic Column & Type Validation / Reconciliation
-- ============================================================================

-- Validate plans columns
SELECT pg_temp.assert_column('plans', 'id', 'uuid', true);
SELECT pg_temp.assert_column('plans', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('plans', 'created_by_user_id', 'uuid', true);
SELECT pg_temp.assert_column('plans', 'title', 'text', true);
SELECT pg_temp.assert_column('plans', 'description', 'text', false);
SELECT pg_temp.assert_column('plans', 'status', 'text', true, '''draft''');
SELECT pg_temp.assert_column('plans', 'version', 'int4', true, '1');
SELECT pg_temp.assert_column('plans', 'metadata', 'jsonb', true, '''{}''::jsonb');
SELECT pg_temp.assert_column('plans', 'created_at', 'timestamptz', true, 'NOW()');
SELECT pg_temp.assert_column('plans', 'updated_at', 'timestamptz', true, 'NOW()');

-- Validate plan_steps columns
SELECT pg_temp.assert_column('plan_steps', 'id', 'uuid', true);
SELECT pg_temp.assert_column('plan_steps', 'plan_id', 'uuid', true);
SELECT pg_temp.assert_column('plan_steps', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('plan_steps', 'step_index', 'int4', true);
SELECT pg_temp.assert_column('plan_steps', 'action_name', 'text', true);
SELECT pg_temp.assert_column('plan_steps', 'action_class', 'text', true);
SELECT pg_temp.assert_column('plan_steps', 'risk_level', 'text', true);
SELECT pg_temp.assert_column('plan_steps', 'approval_mode', 'text', true);
SELECT pg_temp.assert_column('plan_steps', 'parameters', 'jsonb', true, '''{}''::jsonb');
SELECT pg_temp.assert_column('plan_steps', 'parameter_hash', 'text', true);
SELECT pg_temp.assert_column('plan_steps', 'status', 'text', true, '''ready''');
SELECT pg_temp.assert_column('plan_steps', 'version', 'int4', true, '1');
SELECT pg_temp.assert_column('plan_steps', 'error', 'jsonb', false);
SELECT pg_temp.assert_column('plan_steps', 'created_at', 'timestamptz', true, 'NOW()');
SELECT pg_temp.assert_column('plan_steps', 'updated_at', 'timestamptz', true, 'NOW()');

-- Validate plan_step_dependencies columns
SELECT pg_temp.assert_column('plan_step_dependencies', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('plan_step_dependencies', 'plan_id', 'uuid', true);
SELECT pg_temp.assert_column('plan_step_dependencies', 'step_id', 'uuid', true);
SELECT pg_temp.assert_column('plan_step_dependencies', 'depends_on_step_id', 'uuid', true);
SELECT pg_temp.assert_column('plan_step_dependencies', 'created_at', 'timestamptz', true, 'NOW()');

-- Validate plan_step_approval_bindings columns
SELECT pg_temp.assert_column('plan_step_approval_bindings', 'id', 'uuid', true);
SELECT pg_temp.assert_column('plan_step_approval_bindings', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('plan_step_approval_bindings', 'plan_id', 'uuid', true);
SELECT pg_temp.assert_column('plan_step_approval_bindings', 'step_id', 'uuid', true);
SELECT pg_temp.assert_column('plan_step_approval_bindings', 'approval_request_id', 'uuid', true);
SELECT pg_temp.assert_column('plan_step_approval_bindings', 'parameter_hash', 'text', true);
SELECT pg_temp.assert_column('plan_step_approval_bindings', 'bound_at', 'timestamptz', true, 'NOW()');

-- Validate step_executions columns
SELECT pg_temp.assert_column('step_executions', 'id', 'uuid', true);
SELECT pg_temp.assert_column('step_executions', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('step_executions', 'plan_id', 'uuid', true);
SELECT pg_temp.assert_column('step_executions', 'step_id', 'uuid', true);
SELECT pg_temp.assert_column('step_executions', 'idempotency_key', 'text', true);
SELECT pg_temp.assert_column('step_executions', 'worker_id', 'text', true);
SELECT pg_temp.assert_column('step_executions', 'lease_token', 'uuid', true);
SELECT pg_temp.assert_column('step_executions', 'attempt_number', 'int4', true, '1');
SELECT pg_temp.assert_column('step_executions', 'status', 'text', true);
SELECT pg_temp.assert_column('step_executions', 'started_at', 'timestamptz', true, 'NOW()');
SELECT pg_temp.assert_column('step_executions', 'lease_expires_at', 'timestamptz', true);
SELECT pg_temp.assert_column('step_executions', 'completed_at', 'timestamptz', false);

-- Validate receipts columns
SELECT pg_temp.assert_column('receipts', 'id', 'uuid', true);
SELECT pg_temp.assert_column('receipts', 'workspace_id', 'uuid', true);
SELECT pg_temp.assert_column('receipts', 'plan_id', 'uuid', true);
SELECT pg_temp.assert_column('receipts', 'plan_step_id', 'uuid', true);
SELECT pg_temp.assert_column('receipts', 'action_name', 'text', true);
SELECT pg_temp.assert_column('receipts', 'status', 'text', true);
SELECT pg_temp.assert_column('receipts', 'proof', 'jsonb', true, '''{}''::jsonb');
SELECT pg_temp.assert_column('receipts', 'verification_method', 'text', true);
SELECT pg_temp.assert_column('receipts', 'issued_at', 'timestamptz', true, 'NOW()');
SELECT pg_temp.assert_column('receipts', 'verified_at', 'timestamptz', false);


-- ============================================================================
-- Section 4: Constraints, Foreign Keys & Checks Validation / Reconciliation
-- ============================================================================

-- 1. plans constraints
SELECT pg_temp.assert_unique('plans', 'uq_plans_workspace_id', ARRAY['workspace_id', 'id']);
SELECT pg_temp.assert_check('plans', 'chk_plans_status',
  'status IN (''draft'', ''awaiting_approval'', ''queued'', ''running'', ''paused'', ''completed'', ''failed'', ''cancelled'')');
SELECT pg_temp.assert_fk('plans', 'fk_plans_workspace', ARRAY['workspace_id'], 'workspaces', ARRAY['id'], 'r');
SELECT pg_temp.assert_fk('plans', 'fk_plans_created_by', ARRAY['created_by_user_id'], 'users', ARRAY['id'], 'r');

-- 2. plan_steps constraints
SELECT pg_temp.assert_unique('plan_steps', 'uq_plan_step_workspace_plan_id', ARRAY['workspace_id', 'plan_id', 'id']);
SELECT pg_temp.assert_unique('plan_steps', 'uq_plan_step_workspace_id', ARRAY['workspace_id', 'id']);
SELECT pg_temp.assert_unique('plan_steps', 'uq_plan_step_index', ARRAY['plan_id', 'step_index']);
SELECT pg_temp.assert_fk('plan_steps', 'fk_plan_steps_plan', ARRAY['workspace_id', 'plan_id'], 'plans', ARRAY['workspace_id', 'id'], 'r');
SELECT pg_temp.assert_check('plan_steps', 'chk_plan_steps_action_class', 'action_class IN (''read'', ''write'')');
SELECT pg_temp.assert_check('plan_steps', 'chk_plan_steps_risk_level', 'risk_level IN (''low'', ''medium'', ''high'', ''critical'')');
SELECT pg_temp.assert_check('plan_steps', 'chk_plan_steps_approval_mode', 'approval_mode IN (''none'', ''explicit'', ''explicit_single'', ''two_person'')');
SELECT pg_temp.assert_check('plan_steps', 'chk_plan_steps_status',
  'status IN (''blocked'', ''ready'', ''awaiting_approval'', ''queued'', ''running'', ''verified'', ''unverified'', ''failed'', ''not_configured'', ''skipped'', ''cancelled'')');

-- 3. plan_step_dependencies constraints
SELECT pg_temp.assert_check('plan_step_dependencies', 'chk_no_self_dependency', 'step_id <> depends_on_step_id');
SELECT pg_temp.assert_fk('plan_step_dependencies', 'fk_dep_step', ARRAY['workspace_id', 'plan_id', 'step_id'], 'plan_steps', ARRAY['workspace_id', 'plan_id', 'id'], 'r');
SELECT pg_temp.assert_fk('plan_step_dependencies', 'fk_dep_parent', ARRAY['workspace_id', 'plan_id', 'depends_on_step_id'], 'plan_steps', ARRAY['workspace_id', 'plan_id', 'id'], 'r');

-- 4. plan_step_approval_bindings constraints
SELECT pg_temp.assert_unique('plan_step_approval_bindings', 'uq_binding_step', ARRAY['step_id']);
SELECT pg_temp.assert_unique('plan_step_approval_bindings', 'uq_binding_approval', ARRAY['approval_request_id']);
SELECT pg_temp.assert_fk('plan_step_approval_bindings', 'fk_binding_step', ARRAY['workspace_id', 'plan_id', 'step_id'], 'plan_steps', ARRAY['workspace_id', 'plan_id', 'id'], 'r');
SELECT pg_temp.assert_fk('plan_step_approval_bindings', 'fk_binding_approval', ARRAY['workspace_id', 'approval_request_id'], 'approval_requests', ARRAY['workspace_id', 'id'], 'r');

-- 5. step_executions constraints
SELECT pg_temp.assert_unique('step_executions', 'uq_step_executions_idempotency', ARRAY['workspace_id', 'idempotency_key']);
SELECT pg_temp.assert_check('step_executions', 'chk_step_executions_status', 'status IN (''started'', ''completed'', ''failed'')');
SELECT pg_temp.assert_fk('step_executions', 'fk_step_executions_step', ARRAY['workspace_id', 'plan_id', 'step_id'], 'plan_steps', ARRAY['workspace_id', 'plan_id', 'id'], 'r');

-- 6. receipts constraints
SELECT pg_temp.assert_unique('receipts', 'uq_receipt_step', ARRAY['plan_step_id']);
SELECT pg_temp.assert_check('receipts', 'chk_receipts_status', 'status IN (''verified'', ''unverified'', ''failed'', ''not_configured'')');
SELECT pg_temp.assert_check('receipts', 'chk_receipt_verified_at',
  '((status = ''verified'' AND verified_at IS NOT NULL) OR (status <> ''verified'' AND verified_at IS NULL))');
SELECT pg_temp.assert_fk('receipts', 'fk_receipts_step', ARRAY['workspace_id', 'plan_id', 'plan_step_id'], 'plan_steps', ARRAY['workspace_id', 'plan_id', 'id'], 'r');


-- ============================================================================
-- Section 5: Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_plans_workspace ON public.plans(workspace_id);
CREATE INDEX IF NOT EXISTS idx_plans_status ON public.plans(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_plans_created_by ON public.plans(workspace_id, created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON public.plan_steps(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_steps_workspace ON public.plan_steps(workspace_id);
CREATE INDEX IF NOT EXISTS idx_plan_steps_status ON public.plan_steps(plan_id, status);

CREATE INDEX IF NOT EXISTS idx_dep_plan ON public.plan_step_dependencies(workspace_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_dep_parent ON public.plan_step_dependencies(depends_on_step_id);

CREATE INDEX IF NOT EXISTS idx_binding_plan ON public.plan_step_approval_bindings(workspace_id, plan_id);

CREATE INDEX IF NOT EXISTS idx_step_executions_step ON public.step_executions(workspace_id, step_id);
CREATE INDEX IF NOT EXISTS idx_step_executions_lease ON public.step_executions(status, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_receipts_plan ON public.receipts(workspace_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_receipts_workspace ON public.receipts(workspace_id);


-- ============================================================================
-- Section 6: State Machine & Immutability Triggers
-- ============================================================================

-- Trigger Procedure: enforce_plan_state_transition
CREATE OR REPLACE FUNCTION public.enforce_plan_state_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_step_count INT;
  v_unverified_count INT;
BEGIN
  -- Identity immutability
  IF OLD.workspace_id <> NEW.workspace_id
     OR OLD.id <> NEW.id
     OR OLD.created_by_user_id <> NEW.created_by_user_id THEN
    RAISE EXCEPTION 'Plan identity fields (workspace_id, id, created_by_user_id) are immutable';
  END IF;

  -- Optimistic version enforcement
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Optimistic concurrency violation on plans: expected version %, got %', OLD.version + 1, NEW.version;
  END IF;

  -- Terminal state immutability: reject every mutation of terminal plans
  IF OLD.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Plan % is in terminal state % and cannot be modified', OLD.id, OLD.status;
  END IF;

  -- Allowed nonterminal state transition matrix
  IF OLD.status <> NEW.status THEN
    IF OLD.status = 'draft' AND NEW.status NOT IN ('awaiting_approval', 'queued', 'running', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid plan state transition from % to %', OLD.status, NEW.status;
    ELSIF OLD.status = 'awaiting_approval' AND NEW.status NOT IN ('queued', 'running', 'failed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid plan state transition from % to %', OLD.status, NEW.status;
    ELSIF OLD.status = 'queued' AND NEW.status NOT IN ('running', 'failed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid plan state transition from % to %', OLD.status, NEW.status;
    ELSIF OLD.status = 'running' AND NEW.status NOT IN ('paused', 'completed', 'failed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid plan state transition from % to %', OLD.status, NEW.status;
    ELSIF OLD.status = 'paused' AND NEW.status NOT IN ('running', 'failed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid plan state transition from % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  -- Completion Guard: every step must be verified and step count must be > 0
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    SELECT pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE status <> 'verified')
    INTO v_step_count, v_unverified_count
    FROM public.plan_steps
    WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.id;

    IF v_step_count = 0 THEN
      RAISE EXCEPTION 'Cannot mark plan completed: plan has no steps';
    END IF;

    IF v_unverified_count > 0 THEN
      RAISE EXCEPTION 'Cannot mark plan completed: not all steps are verified (% unverified steps remain)', v_unverified_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_plan_state_transition ON public.plans;
CREATE TRIGGER trg_enforce_plan_state_transition
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_state_transition();

-- Trigger Procedure: enforce_plan_step_state_transition
CREATE OR REPLACE FUNCTION public.enforce_plan_step_state_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_plan_status TEXT;
BEGIN
  -- Identity immutability
  IF OLD.workspace_id <> NEW.workspace_id
     OR OLD.plan_id <> NEW.plan_id
     OR OLD.id <> NEW.id
     OR OLD.step_index <> NEW.step_index THEN
    RAISE EXCEPTION 'Plan step identity fields (workspace_id, plan_id, id, step_index) are immutable';
  END IF;

  -- Optimistic version enforcement
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Optimistic concurrency violation on plan_steps: expected version %, got %', OLD.version + 1, NEW.version;
  END IF;

  -- Terminal state immutability: reject every mutation of terminal steps
  IF OLD.status IN ('verified', 'unverified', 'failed', 'not_configured', 'skipped', 'cancelled') THEN
    RAISE EXCEPTION 'Plan step % is in terminal state % and cannot be modified', OLD.id, OLD.status;
  END IF;

  -- Structural definition immutability after plan submission
  SELECT status INTO v_plan_status
  FROM public.plans
  WHERE workspace_id = OLD.workspace_id AND id = OLD.plan_id;

  IF v_plan_status IS NOT NULL AND v_plan_status <> 'draft' THEN
    IF OLD.action_name <> NEW.action_name
       OR OLD.action_class <> NEW.action_class
       OR OLD.risk_level <> NEW.risk_level
       OR OLD.approval_mode <> NEW.approval_mode
       OR OLD.parameters <> NEW.parameters
       OR OLD.parameter_hash <> NEW.parameter_hash THEN
      RAISE EXCEPTION 'Plan step structural definition is immutable after plan submission (parent plan status is %)', v_plan_status;
    END IF;
  END IF;

  -- Allowed nonterminal state transition matrix
  IF OLD.status <> NEW.status THEN
    IF OLD.status = 'blocked' AND NEW.status NOT IN ('ready', 'awaiting_approval', 'queued', 'running', 'cancelled', 'skipped') THEN
      RAISE EXCEPTION 'Invalid plan step state transition from % to %', OLD.status, NEW.status;
    ELSIF OLD.status = 'ready' AND NEW.status NOT IN ('awaiting_approval', 'queued', 'running', 'cancelled', 'skipped') THEN
      RAISE EXCEPTION 'Invalid plan step state transition from % to %', OLD.status, NEW.status;
    ELSIF OLD.status = 'awaiting_approval' AND NEW.status NOT IN ('queued', 'running', 'failed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid plan step state transition from % to %', OLD.status, NEW.status;
    ELSIF OLD.status = 'queued' AND NEW.status NOT IN ('running', 'cancelled', 'failed') THEN
      RAISE EXCEPTION 'Invalid plan step state transition from % to %', OLD.status, NEW.status;
    ELSIF OLD.status = 'running' AND NEW.status NOT IN ('queued', 'verified', 'unverified', 'failed', 'not_configured', 'cancelled', 'skipped') THEN
      RAISE EXCEPTION 'Invalid plan step state transition from % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_step_state_transition ON public.plan_steps;
CREATE TRIGGER trg_enforce_step_state_transition
  BEFORE UPDATE ON public.plan_steps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_step_state_transition();

-- Trigger Procedure: enforce_dep_immutability
CREATE OR REPLACE FUNCTION public.enforce_dep_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_plan_status TEXT;
  v_target_ws UUID;
  v_target_plan UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_target_ws := OLD.workspace_id;
    v_target_plan := OLD.plan_id;
  ELSE
    v_target_ws := NEW.workspace_id;
    v_target_plan := NEW.plan_id;
  END IF;

  SELECT status INTO v_plan_status
  FROM public.plans
  WHERE workspace_id = v_target_ws AND id = v_target_plan;

  IF v_plan_status IS NULL THEN
    RAISE EXCEPTION 'Parent plan % does not exist in workspace %', v_target_plan, v_target_ws;
  END IF;

  IF v_plan_status <> 'draft' THEN
    RAISE EXCEPTION 'Plan dependencies cannot be modified after submission (plan status is %)', v_plan_status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_dep_immutability ON public.plan_step_dependencies;
CREATE TRIGGER trg_enforce_dep_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.plan_step_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dep_immutability();

-- Trigger Procedure: enforce_step_exec_immutability
CREATE OR REPLACE FUNCTION public.enforce_step_exec_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Step executions are durable records and cannot be deleted';
  END IF;

  IF OLD.workspace_id <> NEW.workspace_id OR OLD.plan_id <> NEW.plan_id OR OLD.step_id <> NEW.step_id OR OLD.idempotency_key <> NEW.idempotency_key THEN
    RAISE EXCEPTION 'Step execution identity fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_step_exec_immutability ON public.step_executions;
CREATE TRIGGER trg_enforce_step_exec_immutability
  BEFORE UPDATE OR DELETE ON public.step_executions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_step_exec_immutability();

-- Trigger Procedure: enforce_receipt_integrity
CREATE OR REPLACE FUNCTION public.enforce_receipt_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_step_action TEXT;
  v_step_status TEXT;
BEGIN
  SELECT action_name, status
  INTO v_step_action, v_step_status
  FROM public.plan_steps
  WHERE workspace_id = NEW.workspace_id
    AND plan_id = NEW.plan_id
    AND id = NEW.plan_step_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referenced plan_step % does not exist in workspace % and plan %', NEW.plan_step_id, NEW.workspace_id, NEW.plan_id;
  END IF;

  IF NEW.action_name <> v_step_action THEN
    RAISE EXCEPTION 'Receipt action_name % does not match step action_name %', NEW.action_name, v_step_action;
  END IF;

  IF NEW.status = v_step_status THEN
    RETURN NEW;
  END IF;

  -- Controlled Exception: In-flight cancelled step produces an unverified receipt
  IF NEW.status = 'unverified' AND v_step_status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Receipt status % does not match terminal step status %', NEW.status, v_step_status;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_receipt_integrity ON public.receipts;
CREATE TRIGGER trg_enforce_receipt_integrity
  BEFORE INSERT ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_receipt_integrity();

-- Trigger Procedure: reject_receipt_mutation
CREATE OR REPLACE FUNCTION public.reject_receipt_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Receipts are immutable terminal records and cannot be updated or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_receipt_mutation ON public.receipts;
CREATE TRIGGER trg_reject_receipt_mutation
  BEFORE UPDATE OR DELETE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.reject_receipt_mutation();


-- ============================================================================
-- Section 7: Row-Level Security Policies
-- ============================================================================

SELECT pg_temp.assert_rls('plans');
DROP POLICY IF EXISTS tenant_isolation_plans ON public.plans;
CREATE POLICY tenant_isolation_plans ON public.plans
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

SELECT pg_temp.assert_rls('plan_steps');
DROP POLICY IF EXISTS tenant_isolation_plan_steps ON public.plan_steps;
CREATE POLICY tenant_isolation_plan_steps ON public.plan_steps
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

SELECT pg_temp.assert_rls('plan_step_dependencies');
DROP POLICY IF EXISTS tenant_isolation_plan_step_dependencies ON public.plan_step_dependencies;
CREATE POLICY tenant_isolation_plan_step_dependencies ON public.plan_step_dependencies
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

SELECT pg_temp.assert_rls('plan_step_approval_bindings');
DROP POLICY IF EXISTS tenant_isolation_plan_step_approval_bindings ON public.plan_step_approval_bindings;
CREATE POLICY tenant_isolation_plan_step_approval_bindings ON public.plan_step_approval_bindings
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

SELECT pg_temp.assert_rls('step_executions');
DROP POLICY IF EXISTS tenant_isolation_step_executions ON public.step_executions;
CREATE POLICY tenant_isolation_step_executions ON public.step_executions
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

SELECT pg_temp.assert_rls('receipts');
DROP POLICY IF EXISTS tenant_isolation_receipts ON public.receipts;
CREATE POLICY tenant_isolation_receipts ON public.receipts
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);


-- ============================================================================
-- Section 8: Role Grants & Permissions (thaara_app)
-- ============================================================================

-- Ensure public schema cannot be made writable by untrusted roles
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Explicitly revoke all privileges on SECURITY DEFINER functions from PUBLIC unconditionally
REVOKE ALL ON FUNCTION public.enforce_plan_state_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_plan_step_state_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_dep_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_step_exec_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_receipt_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_receipt_mutation() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_app') THEN
    REVOKE CREATE ON SCHEMA public FROM thaara_app;
    GRANT USAGE ON SCHEMA public TO thaara_app;

    -- Explicitly apply:
    -- REVOKE ALL ON FUNCTION ... FROM thaara_app;
    -- then grant only the minimum required execution privilege to the intended application role
    REVOKE ALL ON FUNCTION public.enforce_plan_state_transition() FROM thaara_app;
    REVOKE ALL ON FUNCTION public.enforce_plan_step_state_transition() FROM thaara_app;
    REVOKE ALL ON FUNCTION public.enforce_dep_immutability() FROM thaara_app;
    REVOKE ALL ON FUNCTION public.enforce_step_exec_immutability() FROM thaara_app;
    REVOKE ALL ON FUNCTION public.enforce_receipt_integrity() FROM thaara_app;
    REVOKE ALL ON FUNCTION public.reject_receipt_mutation() FROM thaara_app;

    GRANT EXECUTE ON FUNCTION public.enforce_plan_state_transition() TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.enforce_plan_step_state_transition() TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.enforce_dep_immutability() TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.enforce_step_exec_immutability() TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.enforce_receipt_integrity() TO thaara_app;
    GRANT EXECUTE ON FUNCTION public.reject_receipt_mutation() TO thaara_app;

    GRANT SELECT, INSERT, UPDATE ON TABLE public.plans TO thaara_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.plan_steps TO thaara_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plan_step_dependencies TO thaara_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.plan_step_approval_bindings TO thaara_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.step_executions TO thaara_app;
    GRANT SELECT, INSERT ON TABLE public.receipts TO thaara_app;

    REVOKE UPDATE, DELETE ON TABLE public.receipts FROM thaara_app;
    REVOKE DELETE ON TABLE public.step_executions FROM thaara_app;
    REVOKE DELETE ON TABLE public.plan_step_approval_bindings FROM thaara_app;
    REVOKE DELETE ON TABLE public.plans FROM thaara_app;
    REVOKE DELETE ON TABLE public.plan_steps FROM thaara_app;
  END IF;
END;
$$;


-- ============================================================================
-- Section 9: Final Post-Migration Verification Suite
-- ============================================================================

-- Ensure all triggers are bound
SELECT pg_temp.assert_trigger('plans', 'trg_enforce_plan_state_transition', 'enforce_plan_state_transition');
SELECT pg_temp.assert_trigger('plan_steps', 'trg_enforce_step_state_transition', 'enforce_plan_step_state_transition');
SELECT pg_temp.assert_trigger('plan_step_dependencies', 'trg_enforce_dep_immutability', 'enforce_dep_immutability');
SELECT pg_temp.assert_trigger('step_executions', 'trg_enforce_step_exec_immutability', 'enforce_step_exec_immutability');
SELECT pg_temp.assert_trigger('receipts', 'trg_enforce_receipt_integrity', 'enforce_receipt_integrity');
SELECT pg_temp.assert_trigger('receipts', 'trg_reject_receipt_mutation', 'reject_receipt_mutation');

-- Security Definer and search_path verification
DO $$
DECLARE
  v_fn TEXT;
  v_secdef BOOLEAN;
  v_config TEXT[];
  v_fn_list TEXT[] := ARRAY[
    'enforce_plan_state_transition',
    'enforce_plan_step_state_transition',
    'enforce_dep_immutability',
    'enforce_step_exec_immutability',
    'enforce_receipt_integrity',
    'reject_receipt_mutation'
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_fn_list LOOP
    SELECT p.prosecdef, p.proconfig
    INTO v_secdef, v_config
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
    IF has_function_privilege('public', 'public.' || v_fn || '()', 'execute') THEN
      RAISE EXCEPTION 'Architectural Migration Error: PUBLIC has execute privilege on public.%', v_fn;
    END IF;
  END LOOP;

  -- Ensure schema public is not writable by PUBLIC
  IF has_schema_privilege('public', 'public', 'create') THEN
    RAISE EXCEPTION 'Architectural Migration Error: public schema is writable by PUBLIC';
  END IF;
END;
$$;
