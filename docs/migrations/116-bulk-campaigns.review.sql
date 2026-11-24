-- =============================================================================
-- THAARA V2 — BULK CAMPAIGNS — OPTIONAL DEDICATED TABLE MIGRATION (REVIEW ONLY)
-- =============================================================================
-- STATUS: REVIEW / DOCUMENTATION ONLY — NOT REQUIRED FOR RUNTIME DEPLOYMENT.
--
-- Why no production DDL migration is required for the current Simulation-Only release:
-- `BulkCampaignWorkspaceStore` persists full tenant-scoped campaign state inside the
-- already-deployed, RLS-protected `public.plans` table (`0003_plans_and_receipts.sql`)
-- using `metadata->>'recordKind' = 'bulk_campaign_state_v1'` and `status = 'draft'`
-- inside `db.withScopedTransaction(scope, ...)`.
--
-- If the owner approves a dedicated relational table in a future phase, the DDL below
-- may be scheduled in a separate maintenance window.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.bulk_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'draft',
      'draft_requires_reapproval',
      'approved',
      'running',
      'paused',
      'stopped',
      'completed'
    )
  ),
  execution_mode TEXT NOT NULL DEFAULT 'planned' CHECK (execution_mode IN ('planned', 'simulation')),
  live_calling_enabled BOOLEAN NOT NULL DEFAULT FALSE CHECK (live_calling_enabled = FALSE),
  live_sending_enabled BOOLEAN NOT NULL DEFAULT FALSE CHECK (live_sending_enabled = FALSE),
  material_hash TEXT NOT NULL,
  governed_approval_id UUID NULL,
  campaign_state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_workspace_created
  ON public.bulk_campaigns (workspace_id, created_at ASC);

ALTER TABLE public.bulk_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_campaigns FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bulk_campaigns_tenant_isolation ON public.bulk_campaigns;
CREATE POLICY bulk_campaigns_tenant_isolation ON public.bulk_campaigns
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
