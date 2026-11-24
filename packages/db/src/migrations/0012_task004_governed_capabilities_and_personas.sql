-- ============================================================================
-- Migration: 0012_task004_governed_capabilities_and_personas.sql
-- Description: Task 004 Phase B — Governed Capabilities, Tenant Personas,
--              Platform Preset Catalog, Monotonic Policy Bindings,
--              Fail-Closed Definer Procedures, and Search-Path Containment.
-- ============================================================================

-- 1. Pin migration search_path to prevent operator path hijacking and untrusted shadowing
SET LOCAL search_path = pg_catalog, public, pg_temp;

-- 2. Managed Role Prerequisites, Authority Verification, and Schema Ownership Guard
DO $$
DECLARE
  v_current_user TEXT := CURRENT_USER;
  v_schema_owner TEXT;
  v_table_owner TEXT;
BEGIN
  -- a. Verify or provision thaara_definer
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_definer') THEN
    CREATE ROLE thaara_definer WITH NOLOGIN NOBYPASSRLS NOSUPERUSER;
  END IF;

  -- b. Verify or provision thaara_platform_owner
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_platform_owner') THEN
    CREATE ROLE thaara_platform_owner WITH NOLOGIN NOBYPASSRLS NOSUPERUSER;
  END IF;

  -- c. Verify thaara_definer authority & membership for migration identity
  IF NOT (
    pg_catalog.pg_has_role(v_current_user, 'thaara_definer', 'MEMBER') AND
    pg_catalog.pg_has_role(v_current_user, 'thaara_definer', 'SET')
  ) THEN
    BEGIN
      EXECUTE pg_catalog.format('GRANT thaara_definer TO %I WITH ADMIN OPTION', v_current_user);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'MIGRATION_DATABASE_URL identity "%" lacks ADMIN OPTION / SET authority on role "thaara_definer". IaC must pre-grant "thaara_definer" to the migration identity WITH ADMIN OPTION.', v_current_user;
    END;
  END IF;

  IF NOT (
    pg_catalog.pg_has_role(v_current_user, 'thaara_definer', 'MEMBER') AND
    pg_catalog.pg_has_role(v_current_user, 'thaara_definer', 'SET')
  ) THEN
    RAISE EXCEPTION 'MIGRATION_DATABASE_URL identity "%" does not possess verified SET ROLE capability on "thaara_definer". Migration cannot safely assign procedure ownership.', v_current_user;
  END IF;

  -- d. Verify migration identity has authorized membership/delegation & SET ROLE capability on thaara_platform_owner
  IF NOT (
    pg_catalog.pg_has_role(v_current_user, 'thaara_platform_owner', 'MEMBER') AND
    pg_catalog.pg_has_role(v_current_user, 'thaara_platform_owner', 'SET')
  ) THEN
    BEGIN
      EXECUTE pg_catalog.format('GRANT thaara_platform_owner TO %I WITH ADMIN OPTION', v_current_user);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'MIGRATION_DATABASE_URL identity "%" lacks ADMIN OPTION / SET authority on role "thaara_platform_owner". IaC must pre-grant "thaara_platform_owner" to the migration identity WITH ADMIN OPTION.', v_current_user;
    END;
  END IF;

  -- Double-check SET ROLE capability explicitly after grant attempt
  IF NOT (
    pg_catalog.pg_has_role(v_current_user, 'thaara_platform_owner', 'MEMBER') AND
    pg_catalog.pg_has_role(v_current_user, 'thaara_platform_owner', 'SET')
  ) THEN
    RAISE EXCEPTION 'MIGRATION_DATABASE_URL identity "%" does not possess verified SET ROLE capability on "thaara_platform_owner". Migration cannot safely manage ownership or default privileges.', v_current_user;
  END IF;

  -- e. Fail-closed ownership rerun guard:
  -- If platform schema already exists, assert owner is either CURRENT_USER or thaara_platform_owner
  SELECT pg_catalog.pg_get_userbyid(nspowner) INTO v_schema_owner
  FROM pg_catalog.pg_namespace WHERE nspname = 'platform';

  IF v_schema_owner IS NOT NULL AND v_schema_owner NOT IN (v_current_user, 'thaara_platform_owner') THEN
    RAISE EXCEPTION 'Schema platform is owned by unauthorized role "%". Expected "%" or "thaara_platform_owner". Failing closed.', v_schema_owner, v_current_user;
  END IF;

  -- If platform.preset_catalog already exists, assert owner is either CURRENT_USER or thaara_platform_owner
  SELECT pg_catalog.pg_get_userbyid(relowner) INTO v_table_owner
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'platform' AND c.relname = 'preset_catalog';

  IF v_table_owner IS NOT NULL AND v_table_owner NOT IN (v_current_user, 'thaara_platform_owner') THEN
    RAISE EXCEPTION 'Table platform.preset_catalog is owned by unauthorized role "%". Expected "%" or "thaara_platform_owner". Failing closed.', v_table_owner, v_current_user;
  END IF;
END;
$$;

-- Schema public privileges: Grant USAGE and temporary CREATE to thaara_definer for procedure ownership transfer
GRANT USAGE, CREATE ON SCHEMA public TO thaara_definer;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, thaara_app, thaara_worker;

-- Ensure resolve_session_scope and current_authenticated_scope can be called by thaara_definer
REVOKE ALL ON FUNCTION public.resolve_session_scope(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_session_scope(TEXT) TO thaara_app, thaara_definer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proname = 'current_authenticated_scope') THEN
    GRANT EXECUTE ON FUNCTION public.current_authenticated_scope() TO thaara_definer;
  END IF;
END;
$$;

-- ============================================================================
-- 3. SECURITY INVOKER Immutability Trigger Function
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reject_mutation_on_immutable_table()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Immutable relation violation: UPDATE and DELETE operations are prohibited on table %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

-- PUBLIC is revoked; zero direct EXECUTE grants to runtime roles
REVOKE ALL ON FUNCTION public.reject_mutation_on_immutable_table() FROM PUBLIC;

-- ============================================================================
-- 4. Protected Platform Schema & Preset Catalog
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.preset_catalog (
  preset_id TEXT NOT NULL,
  preset_version INTEGER NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 100),
  language TEXT NOT NULL CHECK (char_length(language) >= 2 AND char_length(language) <= 10),
  tone TEXT NOT NULL CHECK (char_length(tone) >= 1 AND char_length(tone) <= 50),
  working_style TEXT NOT NULL CHECK (char_length(working_style) >= 1 AND char_length(working_style) <= 50),
  expertise_labels TEXT[] NOT NULL DEFAULT '{}',
  untrusted_guidance TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (preset_id, preset_version)
);

-- Seed Thaara V2 default preset while migration identity is authorized
INSERT INTO platform.preset_catalog (
  preset_id, preset_version, name, language, tone, working_style, expertise_labels, untrusted_guidance
) VALUES (
  'preset_thaara_v2', 1, 'Thaara', 'en', 'executive', 'concise',
  ARRAY['executive_operations', 'strategic_planning', 'governance']::text[],
  'Proactively summarize next actions, propose structured plans, highlight risks.'
) ON CONFLICT (preset_id, preset_version) DO NOTHING;

-- Transfer ownership of schema and table to thaara_platform_owner
ALTER SCHEMA platform OWNER TO thaara_platform_owner;
ALTER TABLE platform.preset_catalog OWNER TO thaara_platform_owner;

-- Runtime roles receive ONLY schema USAGE for foreign-key resolution; zero table privileges
REVOKE ALL ON SCHEMA platform FROM PUBLIC, thaara_app, thaara_worker, thaara_definer;
GRANT USAGE ON SCHEMA platform TO thaara_app, thaara_worker, thaara_definer;

REVOKE ALL ON TABLE platform.preset_catalog FROM PUBLIC, thaara_app, thaara_worker, thaara_definer;

-- Lock default privileges for thaara_platform_owner
ALTER DEFAULT PRIVILEGES FOR ROLE thaara_platform_owner IN SCHEMA platform REVOKE ALL ON TABLES FROM PUBLIC, thaara_app, thaara_worker, thaara_definer;
ALTER DEFAULT PRIVILEGES FOR ROLE thaara_platform_owner IN SCHEMA platform REVOKE ALL ON FUNCTIONS FROM PUBLIC, thaara_app, thaara_worker, thaara_definer;
ALTER DEFAULT PRIVILEGES FOR ROLE thaara_platform_owner IN SCHEMA platform REVOKE ALL ON SEQUENCES FROM PUBLIC, thaara_app, thaara_worker, thaara_definer;

-- Immutability trigger on preset_catalog
DROP TRIGGER IF EXISTS trg_immutable_preset_catalog ON platform.preset_catalog;
CREATE TRIGGER trg_immutable_preset_catalog
  BEFORE UPDATE OR DELETE ON platform.preset_catalog
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation_on_immutable_table();

-- ============================================================================
-- 5. Helper Validation Functions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_text_array_lengths(p_arr TEXT[], p_max_len INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(bool_and(char_length(elem) > 0 AND char_length(elem) <= p_max_len), true)
  FROM unnest(p_arr) AS elem;
$$;

REVOKE ALL ON FUNCTION public.check_text_array_lengths(TEXT[], INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_text_array_lengths(TEXT[], INTEGER) TO thaara_app, thaara_definer;

CREATE OR REPLACE FUNCTION public.validate_voice_preferences(p_vp JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_keys TEXT[];
  v_speed NUMERIC;
  v_pitch NUMERIC;
  v_voice_id TEXT;
BEGIN
  IF p_vp IS NULL THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(p_vp) <> 'object' THEN
    RETURN false;
  END IF;
  SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys(p_vp) AS k;
  IF NOT (v_keys <@ ARRAY['voiceId', 'speed', 'pitch']::text[] AND v_keys @> ARRAY['voiceId', 'speed', 'pitch']::text[]) THEN
    RETURN false;
  END IF;
  v_voice_id := p_vp->>'voiceId';
  IF v_voice_id IS NULL OR char_length(v_voice_id) < 1 OR char_length(v_voice_id) > 50 OR v_voice_id !~ '^[a-zA-Z0-9_-]+$' THEN
    RETURN false;
  END IF;
  BEGIN
    v_speed := (p_vp->>'speed')::numeric;
    v_pitch := (p_vp->>'pitch')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF v_speed < 0.5 OR v_speed > 2.0 OR v_pitch < 0.5 OR v_pitch > 2.0 THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_voice_preferences(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_voice_preferences(JSONB) TO thaara_app, thaara_definer;

-- ============================================================================
-- 6. Durable Governance Versioning on Plans
-- ============================================================================
-- a. Add nullable governance_version without legacy default
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS governance_version INTEGER;

-- b. Backfill existing legacy rows to 1 before trigger attachment (increment version for optimistic concurrency trigger)
UPDATE public.plans SET governance_version = 1, version = version + 1 WHERE governance_version IS NULL;

-- c. Set DEFAULT 2 for post-cutover governed plans
ALTER TABLE public.plans ALTER COLUMN governance_version SET DEFAULT 2;

-- d. Set NOT NULL
ALTER TABLE public.plans ALTER COLUMN governance_version SET NOT NULL;

-- e. Add CHECK constraint (governance_version IN (1, 2))
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_plans_governance_version') THEN
    ALTER TABLE public.plans ADD CONSTRAINT chk_plans_governance_version CHECK (governance_version IN (1, 2));
  END IF;
END;
$$;

-- f. Guard trigger to prevent runtime creation of version 1 or downgrades
CREATE OR REPLACE FUNCTION public.guard_plan_governance_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.governance_version = 1 THEN
      RAISE EXCEPTION 'Legacy governance_version 1 is prohibited for new plan creation on plan %', NEW.id;
    END IF;
    IF NEW.governance_version IS NULL THEN
      NEW.governance_version := 2;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.governance_version <> OLD.governance_version THEN
      RAISE EXCEPTION 'Immutable field violation: governance_version cannot be modified or downgraded on plan %', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_plan_governance_version() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_plan_governance_version ON public.plans;
CREATE TRIGGER trg_guard_plan_governance_version
  BEFORE INSERT OR UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.guard_plan_governance_version();

-- ============================================================================
-- 7. Tenant-Scoped Governance & Persona Tables
-- ============================================================================

-- Table 1: workspace_personas
CREATE TABLE IF NOT EXISTS public.workspace_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  preset_id TEXT,
  preset_version INTEGER,
  name TEXT NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 100),
  language TEXT NOT NULL DEFAULT 'en' CHECK (char_length(language) >= 2 AND char_length(language) <= 10),
  tone TEXT NOT NULL DEFAULT 'executive' CHECK (char_length(tone) >= 1 AND char_length(tone) <= 50),
  working_style TEXT NOT NULL DEFAULT 'concise' CHECK (char_length(working_style) >= 1 AND char_length(working_style) <= 50),
  expertise_labels TEXT[] NOT NULL DEFAULT '{}' CHECK (array_length(expertise_labels, 1) IS NULL OR array_length(expertise_labels, 1) <= 20),
  voice_preferences JSONB DEFAULT NULL,
  untrusted_guidance TEXT NOT NULL DEFAULT '' CHECK (char_length(untrusted_guidance) <= 2000),
  permitted_capabilities TEXT[] NOT NULL DEFAULT '{}' CHECK (array_length(permitted_capabilities, 1) IS NULL OR array_length(permitted_capabilities, 1) <= 100),
  is_default BOOLEAN NOT NULL DEFAULT false,
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'archived')),
  cosmetic_version INTEGER NOT NULL DEFAULT 1 CHECK (cosmetic_version > 0),
  entitlement_version INTEGER NOT NULL DEFAULT 1 CHECK (entitlement_version > 0),
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_preset_pairing CHECK ((preset_id IS NULL AND preset_version IS NULL) OR (preset_id IS NOT NULL AND preset_version IS NOT NULL AND preset_version > 0)),
  CONSTRAINT fk_persona_platform_preset FOREIGN KEY (preset_id, preset_version) REFERENCES platform.preset_catalog(preset_id, preset_version) ON DELETE RESTRICT,
  CONSTRAINT chk_expertise_labels_elements CHECK (public.check_text_array_lengths(expertise_labels, 50)),
  CONSTRAINT chk_permitted_capabilities_elements CHECK (public.check_text_array_lengths(permitted_capabilities, 100)),
  CONSTRAINT chk_voice_preferences_valid CHECK (public.validate_voice_preferences(voice_preferences)),
  CONSTRAINT uq_workspace_personas_workspace_id_id UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_personas_workspace ON public.workspace_personas(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_active_default_persona ON public.workspace_personas(workspace_id) WHERE (is_default = true AND lifecycle_status = 'active');

-- Table 2: workspace_capability_grants
CREATE TABLE IF NOT EXISTS public.workspace_capability_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  capability_name TEXT NOT NULL CHECK (char_length(capability_name) >= 1 AND char_length(capability_name) <= 100),
  enabled BOOLEAN NOT NULL DEFAULT true,
  granted_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workspace_capability UNIQUE (workspace_id, capability_name),
  CONSTRAINT uq_workspace_capability_grants_ws_id UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_capability_grants_ws ON public.workspace_capability_grants(workspace_id);

-- Table 3: workspace_policy_overrides
CREATE TABLE IF NOT EXISTS public.workspace_policy_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  capability_name TEXT NOT NULL CHECK (char_length(capability_name) >= 1 AND char_length(capability_name) <= 100),
  override_risk_level TEXT CHECK (override_risk_level IN ('low', 'medium', 'high', 'critical')),
  override_approval_mode TEXT CHECK (override_approval_mode IN ('none', 'explicit', 'two_person')),
  override_required_role TEXT CHECK (override_required_role IN ('viewer', 'member', 'admin', 'owner')),
  override_idempotency_required BOOLEAN,
  override_audit_required BOOLEAN,
  override_ttl_seconds INTEGER CHECK (override_ttl_seconds > 0 AND override_ttl_seconds <= 86400),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workspace_policy_override UNIQUE (workspace_id, capability_name),
  CONSTRAINT uq_workspace_policy_overrides_ws_id UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_policy_overrides_ws ON public.workspace_policy_overrides(workspace_id);

-- Table 4: conversation_persona_bindings
CREATE TABLE IF NOT EXISTS public.conversation_persona_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL,
  workspace_persona_id UUID,
  platform_preset_id TEXT CHECK (platform_preset_id IS NULL OR char_length(platform_preset_id) <= 100),
  platform_preset_version INTEGER,
  bound_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_conversation_persona_binding UNIQUE (workspace_id, conversation_id),
  CONSTRAINT chk_exactly_one_persona_source CHECK (
    (workspace_persona_id IS NOT NULL AND platform_preset_id IS NULL AND platform_preset_version IS NULL) OR
    (workspace_persona_id IS NULL AND platform_preset_id IS NOT NULL AND platform_preset_version IS NOT NULL AND platform_preset_version > 0)
  ),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES public.conversations(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, workspace_persona_id) REFERENCES public.workspace_personas(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (platform_preset_id, platform_preset_version) REFERENCES platform.preset_catalog(preset_id, preset_version) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_conversation_persona_bindings_ws ON public.conversation_persona_bindings(workspace_id);

-- Table 5: plan_step_policy_bindings
CREATE TABLE IF NOT EXISTS public.plan_step_policy_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  plan_id UUID NOT NULL,
  step_id UUID NOT NULL,
  workspace_persona_id UUID,
  platform_preset_id TEXT CHECK (platform_preset_id IS NULL OR char_length(platform_preset_id) <= 100),
  platform_preset_version INTEGER,
  registry_version TEXT NOT NULL CHECK (char_length(registry_version) <= 50),
  schema_identifier TEXT NOT NULL CHECK (char_length(schema_identifier) <= 100),
  action_name TEXT NOT NULL CHECK (char_length(action_name) >= 1 AND char_length(action_name) <= 100),
  action_class TEXT NOT NULL CHECK (action_class IN ('read', 'write')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  approval_mode TEXT NOT NULL CHECK (approval_mode IN ('none', 'explicit', 'two_person')),
  required_role TEXT NOT NULL CHECK (required_role IN ('viewer', 'member', 'admin', 'owner')),
  idempotency_required BOOLEAN NOT NULL,
  audit_required BOOLEAN NOT NULL,
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms >= 1000 AND timeout_ms <= 300000),
  parameter_hash TEXT NOT NULL CHECK (parameter_hash ~ '^[0-9a-f]{64}$'),
  effective_policy_hash TEXT NOT NULL CHECK (effective_policy_hash ~ '^[0-9a-f]{64}$'),
  entitlement_revision_hash TEXT NOT NULL CHECK (entitlement_revision_hash ~ '^[0-9a-f]{64}$'),
  policy_snapshot JSONB NOT NULL CHECK (jsonb_typeof(policy_snapshot) = 'object' AND pg_column_size(policy_snapshot) <= 2048),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_plan_step_policy_binding UNIQUE (workspace_id, plan_id, step_id),
  CONSTRAINT chk_plan_step_policy_persona_source CHECK (
    (workspace_persona_id IS NULL AND platform_preset_id IS NULL AND platform_preset_version IS NULL) OR
    (workspace_persona_id IS NOT NULL AND platform_preset_id IS NULL AND platform_preset_version IS NULL) OR
    (workspace_persona_id IS NULL AND platform_preset_id IS NOT NULL AND platform_preset_version IS NOT NULL AND platform_preset_version > 0)
  ),
  FOREIGN KEY (workspace_id, plan_id, step_id) REFERENCES public.plan_steps(workspace_id, plan_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, workspace_persona_id) REFERENCES public.workspace_personas(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (platform_preset_id, platform_preset_version) REFERENCES platform.preset_catalog(preset_id, preset_version) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_plan_step_policy_bindings_ws_plan ON public.plan_step_policy_bindings(workspace_id, plan_id);

-- Immutability triggers on bindings
DROP TRIGGER IF EXISTS trg_immutable_conversation_persona_bindings ON public.conversation_persona_bindings;
CREATE TRIGGER trg_immutable_conversation_persona_bindings
  BEFORE UPDATE OR DELETE ON public.conversation_persona_bindings
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation_on_immutable_table();

DROP TRIGGER IF EXISTS trg_immutable_plan_step_policy_bindings ON public.plan_step_policy_bindings;
CREATE TRIGGER trg_immutable_plan_step_policy_bindings
  BEFORE UPDATE OR DELETE ON public.plan_step_policy_bindings
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation_on_immutable_table();

-- ============================================================================
-- 8. Row Level Security on Tenant Tables
-- ============================================================================
ALTER TABLE public.workspace_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_personas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_workspace_personas ON public.workspace_personas;
CREATE POLICY tenant_isolation_workspace_personas ON public.workspace_personas
  FOR ALL
  USING (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE public.workspace_capability_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_capability_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_workspace_capability_grants ON public.workspace_capability_grants;
CREATE POLICY tenant_isolation_workspace_capability_grants ON public.workspace_capability_grants
  FOR ALL
  USING (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE public.workspace_policy_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_policy_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_workspace_policy_overrides ON public.workspace_policy_overrides;
CREATE POLICY tenant_isolation_workspace_policy_overrides ON public.workspace_policy_overrides
  FOR ALL
  USING (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE public.conversation_persona_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_persona_bindings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_conversation_persona_bindings ON public.conversation_persona_bindings;
CREATE POLICY tenant_isolation_conversation_persona_bindings ON public.conversation_persona_bindings
  FOR ALL
  USING (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE public.plan_step_policy_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_step_policy_bindings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_plan_step_policy_bindings ON public.plan_step_policy_bindings;
CREATE POLICY tenant_isolation_plan_step_policy_bindings ON public.plan_step_policy_bindings
  FOR ALL
  USING (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid);

-- ============================================================================
-- 9. Table Privilege Boundary Enforcement
-- ============================================================================
-- Revoke all table direct permissions from PUBLIC and runtime roles
REVOKE ALL ON TABLE public.workspace_personas FROM PUBLIC, thaara_app, thaara_worker, thaara_definer;
REVOKE ALL ON TABLE public.workspace_capability_grants FROM PUBLIC, thaara_app, thaara_worker, thaara_definer;
REVOKE ALL ON TABLE public.workspace_policy_overrides FROM PUBLIC, thaara_app, thaara_worker, thaara_definer;
REVOKE ALL ON TABLE public.conversation_persona_bindings FROM PUBLIC, thaara_app, thaara_worker, thaara_definer;
REVOKE ALL ON TABLE public.plan_step_policy_bindings FROM PUBLIC, thaara_app, thaara_worker, thaara_definer;

-- SELECT granted to thaara_app and thaara_worker (RLS enforced)
GRANT SELECT ON TABLE public.workspace_personas TO thaara_app, thaara_worker;
GRANT SELECT ON TABLE public.workspace_capability_grants TO thaara_app, thaara_worker;
GRANT SELECT ON TABLE public.workspace_policy_overrides TO thaara_app, thaara_worker;
GRANT SELECT ON TABLE public.conversation_persona_bindings TO thaara_app, thaara_worker;
GRANT SELECT ON TABLE public.plan_step_policy_bindings TO thaara_app, thaara_worker;

-- thaara_definer gets mutation privileges for managed procedures
GRANT SELECT, INSERT, UPDATE ON TABLE public.workspace_personas TO thaara_definer;
GRANT SELECT, INSERT, UPDATE ON TABLE public.workspace_capability_grants TO thaara_definer;
GRANT SELECT, INSERT, UPDATE ON TABLE public.workspace_policy_overrides TO thaara_definer;
GRANT SELECT, INSERT ON TABLE public.conversation_persona_bindings TO thaara_definer;
GRANT SELECT, INSERT ON TABLE public.plan_step_policy_bindings TO thaara_definer;

-- thaara_definer needs read access and row-level locking on prerequisite relation tables
GRANT SELECT, UPDATE ON TABLE public.workspaces TO thaara_definer;
GRANT SELECT ON TABLE public.users TO thaara_definer;
GRANT SELECT ON TABLE public.conversations TO thaara_definer;
GRANT SELECT ON TABLE public.plans TO thaara_definer;
GRANT SELECT ON TABLE public.plan_steps TO thaara_definer;

-- ============================================================================
-- 10. Fail-Closed SECURITY DEFINER Stored Procedures
-- ============================================================================

-- 10.1 create_workspace_persona
CREATE OR REPLACE FUNCTION public.create_workspace_persona(
  p_session_token_hash TEXT,
  p_name TEXT,
  p_language TEXT DEFAULT 'en',
  p_tone TEXT DEFAULT 'executive',
  p_working_style TEXT DEFAULT 'concise',
  p_expertise_labels TEXT[] DEFAULT '{}',
  p_voice_preferences JSONB DEFAULT NULL,
  p_untrusted_guidance TEXT DEFAULT '',
  p_permitted_capabilities TEXT[] DEFAULT '{}',
  p_is_default BOOLEAN DEFAULT false,
  p_preset_id TEXT DEFAULT NULL,
  p_preset_version INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_ws UUID;
  v_auth_user UUID;
  v_auth_role TEXT;
  v_new_id UUID;
BEGIN
  -- Resolve session scope fail-closed
  SELECT s.workspace_id, s.user_id, s.role
  INTO v_auth_ws, v_auth_user, v_auth_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_auth_ws IS NULL THEN
    RAISE EXCEPTION 'Authentication failure: invalid, expired, or revoked session';
  END IF;

  IF v_auth_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin or owner role required to manage personas';
  END IF;

  -- Overwrite caller GUCs with trusted session claims
  PERFORM pg_catalog.set_config('app.workspace_id', v_auth_ws::text, true);
  PERFORM pg_catalog.set_config('app.user_id', v_auth_user::text, true);
  PERFORM pg_catalog.set_config('app.role', v_auth_role, true);
  PERFORM pg_catalog.set_config('app.session_token_hash', p_session_token_hash, true);

  -- If setting as default, serialize on workspace lock
  IF p_is_default = true THEN
    PERFORM 1 FROM public.workspaces WHERE id = v_auth_ws FOR UPDATE;
    UPDATE public.workspace_personas
    SET is_default = false, updated_at = NOW()
    WHERE workspace_id = v_auth_ws AND is_default = true;
  END IF;

  INSERT INTO public.workspace_personas (
    workspace_id, preset_id, preset_version, name, language, tone, working_style,
    expertise_labels, voice_preferences, untrusted_guidance, permitted_capabilities,
    is_default, lifecycle_status, cosmetic_version, entitlement_version, created_by_user_id
  ) VALUES (
    v_auth_ws, p_preset_id, p_preset_version, p_name, p_language, p_tone, p_working_style,
    p_expertise_labels, p_voice_preferences, p_untrusted_guidance, p_permitted_capabilities,
    p_is_default, 'active', 1, 1, v_auth_user
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

ALTER FUNCTION public.create_workspace_persona(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], JSONB, TEXT, TEXT[], BOOLEAN, TEXT, INTEGER) OWNER TO thaara_definer;
REVOKE ALL ON FUNCTION public.create_workspace_persona(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], JSONB, TEXT, TEXT[], BOOLEAN, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workspace_persona(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], JSONB, TEXT, TEXT[], BOOLEAN, TEXT, INTEGER) TO thaara_app;

-- 10.2 update_workspace_persona
CREATE OR REPLACE FUNCTION public.update_workspace_persona(
  p_session_token_hash TEXT,
  p_persona_id UUID,
  p_name TEXT,
  p_language TEXT,
  p_tone TEXT,
  p_working_style TEXT,
  p_expertise_labels TEXT[],
  p_voice_preferences JSONB,
  p_untrusted_guidance TEXT,
  p_permitted_capabilities TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_ws UUID;
  v_auth_user UUID;
  v_auth_role TEXT;
  v_existing_entitlement INTEGER;
  v_existing_cosmetic INTEGER;
  v_existing_capabilities TEXT[];
  v_entitlement_bump INTEGER := 0;
BEGIN
  SELECT s.workspace_id, s.user_id, s.role
  INTO v_auth_ws, v_auth_user, v_auth_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_auth_ws IS NULL THEN
    RAISE EXCEPTION 'Authentication failure: invalid, expired, or revoked session';
  END IF;

  IF v_auth_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin or owner role required to manage personas';
  END IF;

  PERFORM pg_catalog.set_config('app.workspace_id', v_auth_ws::text, true);
  PERFORM pg_catalog.set_config('app.user_id', v_auth_user::text, true);
  PERFORM pg_catalog.set_config('app.role', v_auth_role, true);
  PERFORM pg_catalog.set_config('app.session_token_hash', p_session_token_hash, true);

  SELECT entitlement_version, cosmetic_version, permitted_capabilities
  INTO v_existing_entitlement, v_existing_cosmetic, v_existing_capabilities
  FROM public.workspace_personas
  WHERE workspace_id = v_auth_ws AND id = p_persona_id AND lifecycle_status = 'active';

  IF v_existing_entitlement IS NULL THEN
    RAISE EXCEPTION 'Persona % not found or archived in workspace', p_persona_id;
  END IF;

  -- Monotonic versioning: bump entitlement_version only if capabilities changed
  IF v_existing_capabilities IS DISTINCT FROM p_permitted_capabilities THEN
    v_entitlement_bump := 1;
  END IF;

  UPDATE public.workspace_personas
  SET name = p_name,
      language = p_language,
      tone = p_tone,
      working_style = p_working_style,
      expertise_labels = p_expertise_labels,
      voice_preferences = p_voice_preferences,
      untrusted_guidance = p_untrusted_guidance,
      permitted_capabilities = p_permitted_capabilities,
      cosmetic_version = v_existing_cosmetic + 1,
      entitlement_version = v_existing_entitlement + v_entitlement_bump,
      updated_at = NOW()
  WHERE workspace_id = v_auth_ws AND id = p_persona_id;
END;
$$;

ALTER FUNCTION public.update_workspace_persona(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], JSONB, TEXT, TEXT[]) OWNER TO thaara_definer;
REVOKE ALL ON FUNCTION public.update_workspace_persona(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], JSONB, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_workspace_persona(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], JSONB, TEXT, TEXT[]) TO thaara_app;

-- 10.3 archive_workspace_persona
CREATE OR REPLACE FUNCTION public.archive_workspace_persona(
  p_session_token_hash TEXT,
  p_persona_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_ws UUID;
  v_auth_user UUID;
  v_auth_role TEXT;
  v_is_default BOOLEAN;
BEGIN
  SELECT s.workspace_id, s.user_id, s.role
  INTO v_auth_ws, v_auth_user, v_auth_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_auth_ws IS NULL THEN
    RAISE EXCEPTION 'Authentication failure: invalid, expired, or revoked session';
  END IF;

  IF v_auth_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin or owner role required to manage personas';
  END IF;

  PERFORM pg_catalog.set_config('app.workspace_id', v_auth_ws::text, true);
  PERFORM pg_catalog.set_config('app.user_id', v_auth_user::text, true);
  PERFORM pg_catalog.set_config('app.role', v_auth_role, true);
  PERFORM pg_catalog.set_config('app.session_token_hash', p_session_token_hash, true);

  SELECT is_default INTO v_is_default
  FROM public.workspace_personas
  WHERE workspace_id = v_auth_ws AND id = p_persona_id AND lifecycle_status = 'active';

  IF v_is_default IS NULL THEN
    RAISE EXCEPTION 'Persona % not found or already archived', p_persona_id;
  END IF;

  IF v_is_default = true THEN
    RAISE EXCEPTION 'Cannot archive default persona %; set another default first', p_persona_id;
  END IF;

  UPDATE public.workspace_personas
  SET lifecycle_status = 'archived', updated_at = NOW()
  WHERE workspace_id = v_auth_ws AND id = p_persona_id;
END;
$$;

ALTER FUNCTION public.archive_workspace_persona(TEXT, UUID) OWNER TO thaara_definer;
REVOKE ALL ON FUNCTION public.archive_workspace_persona(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_workspace_persona(TEXT, UUID) TO thaara_app;

-- 10.4 set_default_workspace_persona
CREATE OR REPLACE FUNCTION public.set_default_workspace_persona(
  p_session_token_hash TEXT,
  p_persona_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_ws UUID;
  v_auth_user UUID;
  v_auth_role TEXT;
  v_found_active BOOLEAN;
BEGIN
  SELECT s.workspace_id, s.user_id, s.role
  INTO v_auth_ws, v_auth_user, v_auth_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_auth_ws IS NULL THEN
    RAISE EXCEPTION 'Authentication failure: invalid, expired, or revoked session';
  END IF;

  IF v_auth_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin or owner role required to manage personas';
  END IF;

  PERFORM pg_catalog.set_config('app.workspace_id', v_auth_ws::text, true);
  PERFORM pg_catalog.set_config('app.user_id', v_auth_user::text, true);
  PERFORM pg_catalog.set_config('app.role', v_auth_role, true);
  PERFORM pg_catalog.set_config('app.session_token_hash', p_session_token_hash, true);

  -- Workspace-level row lock serializes concurrent default updates
  PERFORM 1 FROM public.workspaces WHERE id = v_auth_ws FOR UPDATE;

  SELECT (lifecycle_status = 'active') INTO v_found_active
  FROM public.workspace_personas
  WHERE workspace_id = v_auth_ws AND id = p_persona_id;

  IF v_found_active IS NULL OR v_found_active = false THEN
    RAISE EXCEPTION 'Persona % does not exist or is not active in workspace', p_persona_id;
  END IF;

  UPDATE public.workspace_personas
  SET is_default = false, updated_at = NOW()
  WHERE workspace_id = v_auth_ws AND is_default = true;

  UPDATE public.workspace_personas
  SET is_default = true, updated_at = NOW()
  WHERE workspace_id = v_auth_ws AND id = p_persona_id;
END;
$$;

ALTER FUNCTION public.set_default_workspace_persona(TEXT, UUID) OWNER TO thaara_definer;
REVOKE ALL ON FUNCTION public.set_default_workspace_persona(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_workspace_persona(TEXT, UUID) TO thaara_app;

-- 10.5 grant_workspace_capability
CREATE OR REPLACE FUNCTION public.grant_workspace_capability(
  p_session_token_hash TEXT,
  p_capability_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_ws UUID;
  v_auth_user UUID;
  v_auth_role TEXT;
  v_grant_id UUID;
BEGIN
  SELECT s.workspace_id, s.user_id, s.role
  INTO v_auth_ws, v_auth_user, v_auth_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_auth_ws IS NULL THEN
    RAISE EXCEPTION 'Authentication failure: invalid, expired, or revoked session';
  END IF;

  IF v_auth_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin or owner role required to grant capabilities';
  END IF;

  PERFORM pg_catalog.set_config('app.workspace_id', v_auth_ws::text, true);
  PERFORM pg_catalog.set_config('app.user_id', v_auth_user::text, true);
  PERFORM pg_catalog.set_config('app.role', v_auth_role, true);
  PERFORM pg_catalog.set_config('app.session_token_hash', p_session_token_hash, true);

  INSERT INTO public.workspace_capability_grants (
    workspace_id, capability_name, enabled, granted_by_user_id, granted_at, revoked_at, version
  ) VALUES (
    v_auth_ws, p_capability_name, true, v_auth_user, NOW(), NULL, 1
  )
  ON CONFLICT (workspace_id, capability_name) DO UPDATE
  SET enabled = true,
      granted_by_user_id = v_auth_user,
      granted_at = NOW(),
      revoked_at = NULL,
      version = public.workspace_capability_grants.version + 1,
      updated_at = NOW()
  RETURNING id INTO v_grant_id;

  RETURN v_grant_id;
END;
$$;

ALTER FUNCTION public.grant_workspace_capability(TEXT, TEXT) OWNER TO thaara_definer;
REVOKE ALL ON FUNCTION public.grant_workspace_capability(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_workspace_capability(TEXT, TEXT) TO thaara_app;

-- 10.6 revoke_workspace_capability
CREATE OR REPLACE FUNCTION public.revoke_workspace_capability(
  p_session_token_hash TEXT,
  p_capability_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_ws UUID;
  v_auth_user UUID;
  v_auth_role TEXT;
BEGIN
  SELECT s.workspace_id, s.user_id, s.role
  INTO v_auth_ws, v_auth_user, v_auth_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_auth_ws IS NULL THEN
    RAISE EXCEPTION 'Authentication failure: invalid, expired, or revoked session';
  END IF;

  IF v_auth_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin or owner role required to revoke capabilities';
  END IF;

  PERFORM pg_catalog.set_config('app.workspace_id', v_auth_ws::text, true);
  PERFORM pg_catalog.set_config('app.user_id', v_auth_user::text, true);
  PERFORM pg_catalog.set_config('app.role', v_auth_role, true);
  PERFORM pg_catalog.set_config('app.session_token_hash', p_session_token_hash, true);

  INSERT INTO public.workspace_capability_grants (
    workspace_id, capability_name, enabled, granted_by_user_id, granted_at, revoked_at, version
  ) VALUES (
    v_auth_ws, p_capability_name, false, v_auth_user, NOW(), NOW(), 1
  )
  ON CONFLICT (workspace_id, capability_name) DO UPDATE
  SET enabled = false,
      revoked_at = NOW(),
      version = public.workspace_capability_grants.version + 1,
      updated_at = NOW();
END;
$$;

ALTER FUNCTION public.revoke_workspace_capability(TEXT, TEXT) OWNER TO thaara_definer;
REVOKE ALL ON FUNCTION public.revoke_workspace_capability(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_workspace_capability(TEXT, TEXT) TO thaara_app;

-- 10.7 set_workspace_policy_override
CREATE OR REPLACE FUNCTION public.set_workspace_policy_override(
  p_session_token_hash TEXT,
  p_capability_name TEXT,
  p_override_risk_level TEXT DEFAULT NULL,
  p_override_approval_mode TEXT DEFAULT NULL,
  p_override_required_role TEXT DEFAULT NULL,
  p_override_idempotency_required BOOLEAN DEFAULT NULL,
  p_override_audit_required BOOLEAN DEFAULT NULL,
  p_override_ttl_seconds INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_ws UUID;
  v_auth_user UUID;
  v_auth_role TEXT;
  v_override_id UUID;
BEGIN
  SELECT s.workspace_id, s.user_id, s.role
  INTO v_auth_ws, v_auth_user, v_auth_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_auth_ws IS NULL THEN
    RAISE EXCEPTION 'Authentication failure: invalid, expired, or revoked session';
  END IF;

  IF v_auth_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin or owner role required to configure policy overrides';
  END IF;

  PERFORM pg_catalog.set_config('app.workspace_id', v_auth_ws::text, true);
  PERFORM pg_catalog.set_config('app.user_id', v_auth_user::text, true);
  PERFORM pg_catalog.set_config('app.role', v_auth_role, true);
  PERFORM pg_catalog.set_config('app.session_token_hash', p_session_token_hash, true);

  INSERT INTO public.workspace_policy_overrides (
    workspace_id, capability_name, override_risk_level, override_approval_mode,
    override_required_role, override_idempotency_required, override_audit_required,
    override_ttl_seconds, version, created_by_user_id
  ) VALUES (
    v_auth_ws, p_capability_name, p_override_risk_level, p_override_approval_mode,
    p_override_required_role, p_override_idempotency_required, p_override_audit_required,
    p_override_ttl_seconds, 1, v_auth_user
  )
  ON CONFLICT (workspace_id, capability_name) DO UPDATE
  SET override_risk_level = p_override_risk_level,
      override_approval_mode = p_override_approval_mode,
      override_required_role = p_override_required_role,
      override_idempotency_required = p_override_idempotency_required,
      override_audit_required = p_override_audit_required,
      override_ttl_seconds = p_override_ttl_seconds,
      version = public.workspace_policy_overrides.version + 1,
      updated_at = NOW()
  RETURNING id INTO v_override_id;

  RETURN v_override_id;
END;
$$;

ALTER FUNCTION public.set_workspace_policy_override(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER) OWNER TO thaara_definer;
REVOKE ALL ON FUNCTION public.set_workspace_policy_override(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_workspace_policy_override(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER) TO thaara_app;

-- 10.8 bind_conversation_persona_atomic
CREATE OR REPLACE FUNCTION public.bind_conversation_persona_atomic(
  p_session_token_hash TEXT,
  p_conversation_id UUID,
  p_workspace_persona_id UUID DEFAULT NULL,
  p_platform_preset_id TEXT DEFAULT NULL,
  p_platform_preset_version INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_ws UUID;
  v_auth_user UUID;
  v_auth_role TEXT;
  v_binding_id UUID;
BEGIN
  SELECT s.workspace_id, s.user_id, s.role
  INTO v_auth_ws, v_auth_user, v_auth_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_auth_ws IS NULL THEN
    RAISE EXCEPTION 'Authentication failure: invalid, expired, or revoked session';
  END IF;

  PERFORM pg_catalog.set_config('app.workspace_id', v_auth_ws::text, true);
  PERFORM pg_catalog.set_config('app.user_id', v_auth_user::text, true);
  PERFORM pg_catalog.set_config('app.role', v_auth_role, true);
  PERFORM pg_catalog.set_config('app.session_token_hash', p_session_token_hash, true);

  -- Assert conversation belongs to authenticated workspace
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE workspace_id = v_auth_ws AND id = p_conversation_id
  ) THEN
    RAISE EXCEPTION 'Conversation % not found in workspace %', p_conversation_id, v_auth_ws;
  END IF;

  INSERT INTO public.conversation_persona_bindings (
    workspace_id, conversation_id, workspace_persona_id, platform_preset_id,
    platform_preset_version, bound_by_user_id
  ) VALUES (
    v_auth_ws, p_conversation_id, p_workspace_persona_id, p_platform_preset_id,
    p_platform_preset_version, v_auth_user
  ) RETURNING id INTO v_binding_id;

  RETURN v_binding_id;
END;
$$;

ALTER FUNCTION public.bind_conversation_persona_atomic(TEXT, UUID, UUID, TEXT, INTEGER) OWNER TO thaara_definer;
REVOKE ALL ON FUNCTION public.bind_conversation_persona_atomic(TEXT, UUID, UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_conversation_persona_atomic(TEXT, UUID, UUID, TEXT, INTEGER) TO thaara_app;

-- 10.9 bind_plan_step_policy_atomic
CREATE OR REPLACE FUNCTION public.bind_plan_step_policy_atomic(
  p_session_token_hash TEXT,
  p_plan_id UUID,
  p_step_id UUID,
  p_workspace_persona_id UUID,
  p_platform_preset_id TEXT,
  p_platform_preset_version INTEGER,
  p_registry_version TEXT,
  p_schema_identifier TEXT,
  p_action_name TEXT,
  p_action_class TEXT,
  p_risk_level TEXT,
  p_approval_mode TEXT,
  p_required_role TEXT,
  p_idempotency_required BOOLEAN,
  p_audit_required BOOLEAN,
  p_timeout_ms INTEGER,
  p_parameter_hash TEXT,
  p_effective_policy_hash TEXT,
  p_entitlement_revision_hash TEXT,
  p_baseline_version TEXT,
  p_override_version INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_ws UUID;
  v_auth_user UUID;
  v_auth_role TEXT;
  v_policy_snapshot JSONB;
  v_binding_id UUID;
BEGIN
  SELECT s.workspace_id, s.user_id, s.role
  INTO v_auth_ws, v_auth_user, v_auth_role
  FROM public.resolve_session_scope(p_session_token_hash) s;

  IF v_auth_ws IS NULL THEN
    RAISE EXCEPTION 'Authentication failure: invalid, expired, or revoked session';
  END IF;

  PERFORM pg_catalog.set_config('app.workspace_id', v_auth_ws::text, true);
  PERFORM pg_catalog.set_config('app.user_id', v_auth_user::text, true);
  PERFORM pg_catalog.set_config('app.role', v_auth_role, true);
  PERFORM pg_catalog.set_config('app.session_token_hash', p_session_token_hash, true);

  -- Assert plan step exists and belongs to workspace
  IF NOT EXISTS (
    SELECT 1 FROM public.plan_steps
    WHERE workspace_id = v_auth_ws AND plan_id = p_plan_id AND id = p_step_id
  ) THEN
    RAISE EXCEPTION 'Plan step % for plan % not found in workspace %', p_step_id, p_plan_id, v_auth_ws;
  END IF;

  -- Construct policy snapshot strictly from trusted scalar procedure parameters
  v_policy_snapshot := jsonb_build_object(
    'actionName', p_action_name,
    'actionClass', p_action_class,
    'risk', p_risk_level,
    'approvalMode', p_approval_mode,
    'requiredRole', p_required_role,
    'idempotencyRequired', p_idempotency_required,
    'auditRequired', p_audit_required,
    'timeoutMs', p_timeout_ms,
    'baselineVersion', p_baseline_version,
    'overrideVersion', p_override_version,
    'schemaIdentifier', p_schema_identifier
  );

  INSERT INTO public.plan_step_policy_bindings (
    workspace_id, plan_id, step_id, workspace_persona_id, platform_preset_id,
    platform_preset_version, registry_version, schema_identifier, action_name,
    action_class, risk_level, approval_mode, required_role, idempotency_required,
    audit_required, timeout_ms, parameter_hash, effective_policy_hash,
    entitlement_revision_hash, policy_snapshot
  ) VALUES (
    v_auth_ws, p_plan_id, p_step_id, p_workspace_persona_id, p_platform_preset_id,
    p_platform_preset_version, p_registry_version, p_schema_identifier, p_action_name,
    p_action_class, p_risk_level, p_approval_mode, p_required_role, p_idempotency_required,
    p_audit_required, p_timeout_ms, p_parameter_hash, p_effective_policy_hash,
    p_entitlement_revision_hash, v_policy_snapshot
  ) RETURNING id INTO v_binding_id;

  RETURN v_binding_id;
END;
$$;

ALTER FUNCTION public.bind_plan_step_policy_atomic(
  TEXT, UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER
) OWNER TO thaara_definer;
REVOKE ALL ON FUNCTION public.bind_plan_step_policy_atomic(
  TEXT, UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_plan_step_policy_atomic(
  TEXT, UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER
) TO thaara_app;

-- Revoke CREATE on schema public from thaara_definer now that procedure ownership is transferred
REVOKE CREATE ON SCHEMA public FROM thaara_definer;

-- ============================================================================
-- 11. Post-Migration Security and Catalog Assertions
-- ============================================================================
DO $$
DECLARE
  v_rec RECORD;
  v_app_role_oid OID;
  v_worker_role_oid OID;
  v_definer_role_oid OID;
  v_platform_owner_oid OID;
  v_found_procs INTEGER := 0;
BEGIN
  SELECT oid INTO v_app_role_oid FROM pg_catalog.pg_roles WHERE rolname = 'thaara_app';
  SELECT oid INTO v_worker_role_oid FROM pg_catalog.pg_roles WHERE rolname = 'thaara_worker';
  SELECT oid INTO v_definer_role_oid FROM pg_catalog.pg_roles WHERE rolname = 'thaara_definer';
  SELECT oid INTO v_platform_owner_oid FROM pg_catalog.pg_roles WHERE rolname = 'thaara_platform_owner';

  -- 1. Assert platform schema and table ownership
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace
    WHERE nspname = 'platform' AND nspowner = v_platform_owner_oid
  ) THEN
    RAISE EXCEPTION 'Assertion Failure: Schema platform must be owned by thaara_platform_owner';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'platform' AND c.relname = 'preset_catalog' AND c.relowner = v_platform_owner_oid
  ) THEN
    RAISE EXCEPTION 'Assertion Failure: Table platform.preset_catalog must be owned by thaara_platform_owner';
  END IF;

  -- 2. Assert zero table privileges on platform.preset_catalog for runtime roles
  IF v_app_role_oid IS NOT NULL AND pg_catalog.has_table_privilege(v_app_role_oid, 'platform.preset_catalog', 'SELECT') THEN
    RAISE EXCEPTION 'Assertion Failure: thaara_app must have zero table privileges on platform.preset_catalog';
  END IF;
  IF v_worker_role_oid IS NOT NULL AND pg_catalog.has_table_privilege(v_worker_role_oid, 'platform.preset_catalog', 'SELECT') THEN
    RAISE EXCEPTION 'Assertion Failure: thaara_worker must have zero table privileges on platform.preset_catalog';
  END IF;
  IF v_definer_role_oid IS NOT NULL AND pg_catalog.has_table_privilege(v_definer_role_oid, 'platform.preset_catalog', 'SELECT') THEN
    RAISE EXCEPTION 'Assertion Failure: thaara_definer must have zero table privileges on platform.preset_catalog';
  END IF;

  -- 3. Assert zero direct EXECUTE grants on trigger functions
  FOR v_rec IN
    SELECT p.oid, p.proname, p.prosecdef
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('reject_mutation_on_immutable_table', 'guard_plan_governance_version')
  LOOP
    IF v_rec.prosecdef THEN
      RAISE EXCEPTION 'Assertion Failure: Trigger function % must be SECURITY INVOKER', v_rec.proname;
    END IF;
    IF pg_catalog.has_function_privilege('public', v_rec.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Assertion Failure: PUBLIC must not possess EXECUTE on trigger function %', v_rec.proname;
    END IF;
    IF v_app_role_oid IS NOT NULL AND pg_catalog.has_function_privilege(v_app_role_oid, v_rec.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Assertion Failure: thaara_app must not have direct EXECUTE on trigger function %', v_rec.proname;
    END IF;
    IF v_worker_role_oid IS NOT NULL AND pg_catalog.has_function_privilege(v_worker_role_oid, v_rec.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Assertion Failure: thaara_worker must not have direct EXECUTE on trigger function %', v_rec.proname;
    END IF;
    IF v_definer_role_oid IS NOT NULL AND pg_catalog.has_function_privilege(v_definer_role_oid, v_rec.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Assertion Failure: thaara_definer must not have direct EXECUTE on trigger function %', v_rec.proname;
    END IF;
  END LOOP;

  -- 4. Assert 9 SECURITY DEFINER procedures owned by thaara_definer with thaara_app EXECUTE
  FOR v_rec IN
    SELECT p.oid, p.proname, p.prosecdef, p.proowner
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'create_workspace_persona',
      'update_workspace_persona',
      'archive_workspace_persona',
      'set_default_workspace_persona',
      'grant_workspace_capability',
      'revoke_workspace_capability',
      'set_workspace_policy_override',
      'bind_conversation_persona_atomic',
      'bind_plan_step_policy_atomic'
    )
  LOOP
    v_found_procs := v_found_procs + 1;
    IF NOT v_rec.prosecdef THEN
      RAISE EXCEPTION 'Assertion Failure: Procedure % must be SECURITY DEFINER', v_rec.proname;
    END IF;
    IF v_rec.proowner <> v_definer_role_oid THEN
      RAISE EXCEPTION 'Assertion Failure: Procedure % must be owned by thaara_definer', v_rec.proname;
    END IF;
    IF pg_catalog.has_function_privilege('public', v_rec.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Assertion Failure: PUBLIC must not possess EXECUTE on procedure %', v_rec.proname;
    END IF;
    IF v_app_role_oid IS NOT NULL AND NOT pg_catalog.has_function_privilege(v_app_role_oid, v_rec.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Assertion Failure: thaara_app must possess EXECUTE on procedure %', v_rec.proname;
    END IF;
    IF v_worker_role_oid IS NOT NULL AND pg_catalog.has_function_privilege(v_worker_role_oid, v_rec.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Assertion Failure: thaara_worker must not possess EXECUTE on procedure %', v_rec.proname;
    END IF;
  END LOOP;

  IF v_found_procs <> 9 THEN
    RAISE EXCEPTION 'Assertion Failure: Expected 9 verified Task 004 procedures, found %', v_found_procs;
  END IF;

  -- 5. Assert Task 001 schema hardening: CREATE on schema public is revoked from PUBLIC and runtime roles
  IF pg_catalog.has_schema_privilege('public', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Assertion Failure: PUBLIC must not possess CREATE on schema public';
  END IF;
  IF v_app_role_oid IS NOT NULL AND pg_catalog.has_schema_privilege(v_app_role_oid, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Assertion Failure: thaara_app must not possess CREATE on schema public';
  END IF;
  IF v_worker_role_oid IS NOT NULL AND pg_catalog.has_schema_privilege(v_worker_role_oid, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Assertion Failure: thaara_worker must not possess CREATE on schema public';
  END IF;
  IF v_definer_role_oid IS NOT NULL AND pg_catalog.has_schema_privilege(v_definer_role_oid, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Assertion Failure: thaara_definer must not possess CREATE on schema public';
  END IF;
END;
$$;
