import type { AutomationDetail, AutomationListQuery, AutomationListResponse, AutomationSummary } from '@thaara/contracts';
import { DbClient } from '../migrator.js';

// Only persisted steps identify an automation; caller-supplied plan metadata is not authoritative.
// Every subquery repeats workspace scope in addition to the database's existing RLS policies.
const AUTOMATION_PLANS = `
  SELECT p.id, p.title, p.status, p.created_at, p.updated_at,
    CASE WHEN p.status = 'cancelled' THEN 'cancelled'
      WHEN EXISTS (SELECT 1 FROM public.plan_steps s
        WHERE s.workspace_id = p.workspace_id AND s.plan_id = p.id AND s.status = 'unverified')
        OR EXISTS (SELECT 1 FROM public.receipts r
        WHERE r.workspace_id = p.workspace_id AND r.plan_id = p.id AND r.status = 'unverified')
      THEN 'unverified' ELSE p.status END AS display_status
  FROM public.plans p
  WHERE p.workspace_id = $1 AND EXISTS (
    SELECT 1 FROM public.plan_steps s
    WHERE s.workspace_id = p.workspace_id AND s.plan_id = p.id AND s.action_name LIKE 'automation.%'
  )`;

export class AutomationManagementRepository {
  constructor(private client: DbClient) {}

  async list(workspaceId: string, options: AutomationListQuery = {}): Promise<AutomationListResponse> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const { rows } = await this.client.query<AutomationSummary>(
      `WITH automations AS (${AUTOMATION_PLANS})
       SELECT * FROM automations WHERE ($2::text IS NULL OR display_status = $2)
       ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
      [workspaceId, options.status ?? null, limit + 1, offset]
    );
    return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }

  async detail(workspaceId: string, planId: string): Promise<AutomationDetail | null> {
    const { rows } = await this.client.query<AutomationSummary>(
      `WITH automations AS (${AUTOMATION_PLANS}) SELECT * FROM automations WHERE id = $2`,
      [workspaceId, planId]
    );
    const plan = rows[0];
    if (!plan) return null;

    const steps = await this.client.query<AutomationDetail['steps'][number]>(
      `SELECT s.id, s.step_index, s.action_name, s.status, s.approval_mode,
        COALESCE((SELECT array_agg(d.depends_on_step_id ORDER BY d.depends_on_step_id)
          FROM public.plan_step_dependencies d
          WHERE d.workspace_id = s.workspace_id AND d.plan_id = s.plan_id AND d.step_id = s.id),
        ARRAY[]::uuid[]) AS depends_on_step_ids
       FROM public.plan_steps s WHERE s.workspace_id = $1 AND s.plan_id = $2
       ORDER BY s.step_index, s.id`, [workspaceId, planId]);
    const approvals = await this.client.query<AutomationDetail['approvals'][number]>(
      `SELECT a.id, b.step_id, a.status, a.risk_level, a.requester_user_id, a.approver_user_id,
        a.created_at, a.updated_at, a.expires_at, b.bound_at
       FROM public.plan_step_approval_bindings b
       JOIN public.approval_requests a ON a.workspace_id = b.workspace_id AND a.id = b.approval_request_id
       WHERE b.workspace_id = $1 AND b.plan_id = $2 ORDER BY a.created_at, a.id`,
      [workspaceId, planId]);
    const receipts = await this.client.query<AutomationDetail['receipts'][number]>(
      `SELECT id, plan_step_id, action_name, status, verification_method, issued_at, verified_at
       FROM public.receipts WHERE workspace_id = $1 AND plan_id = $2 ORDER BY issued_at, id`,
      [workspaceId, planId]);
    return { ...plan, steps: steps.rows, approvals: approvals.rows, receipts: receipts.rows };
  }
}
