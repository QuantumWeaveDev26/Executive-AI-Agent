import {
  ActionClass,
  ApprovalMode,
  PlanStepState,
  RiskLevel
} from '@thaara/contracts';
import { DbClient } from '../migrator.js';
import { AuditEventRepository } from './audit.js';

export interface PlanStepRecord {
  id: string;
  plan_id: string;
  workspace_id: string;
  step_index: number;
  action_name: string;
  action_class: ActionClass;
  risk_level: RiskLevel;
  approval_mode: ApprovalMode;
  parameters: Record<string, unknown>;
  parameter_hash: string;
  status: PlanStepState;
  version: number;
  depends_on_step_ids: string[];
  approval_request_id: string | null;
  error: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export class PlanStepRepository {
  constructor(private client: DbClient) {}

  async create(
    workspaceId: string,
    planId: string,
    stepIndex: number,
    actionName: string,
    actionClass: ActionClass,
    riskLevel: RiskLevel,
    approvalMode: ApprovalMode,
    parameters: Record<string, unknown>,
    parameterHash: string
  ): Promise<PlanStepRecord> {
    const { rows } = await this.client.query<{
      id: string;
      plan_id: string;
      workspace_id: string;
      step_index: number;
      action_name: string;
      action_class: ActionClass;
      risk_level: RiskLevel;
      approval_mode: ApprovalMode;
      parameters: Record<string, unknown>;
      parameter_hash: string;
      status: PlanStepState;
      version: number;
      error: Record<string, unknown> | null;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO plan_steps (
        workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode,
        parameters, parameter_hash, status, version
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'blocked', 1)
       RETURNING id, plan_id, workspace_id, step_index, action_name, action_class, risk_level,
                 approval_mode, parameters, parameter_hash, status, version,
                 error, created_at, updated_at;`,
      [
        workspaceId,
        planId,
        stepIndex,
        actionName,
        actionClass,
        riskLevel,
        approvalMode,
        JSON.stringify(parameters),
        parameterHash
      ]
    );

    const r = rows[0]!;
    return {
      ...r,
      depends_on_step_ids: [],
      approval_request_id: null
    };
  }

  async findById(workspaceId: string, id: string): Promise<PlanStepRecord | null> {
    const { rows } = await this.client.query<PlanStepRecord>(
      `SELECT ps.id, ps.plan_id, ps.workspace_id, ps.step_index, ps.action_name, ps.action_class,
              ps.risk_level, ps.approval_mode, ps.parameters, ps.parameter_hash, ps.status, ps.version,
              ps.error, ps.created_at, ps.updated_at,
              b.approval_request_id,
              COALESCE(
                ARRAY_AGG(d.depends_on_step_id) FILTER (WHERE d.depends_on_step_id IS NOT NULL),
                ARRAY[]::uuid[]
              ) AS depends_on_step_ids
       FROM plan_steps ps
       LEFT JOIN plan_step_dependencies d ON d.workspace_id = ps.workspace_id AND d.step_id = ps.id
       LEFT JOIN plan_step_approval_bindings b ON b.workspace_id = ps.workspace_id AND b.step_id = ps.id
       WHERE ps.workspace_id = $1 AND ps.id = $2
       GROUP BY ps.id, ps.plan_id, ps.workspace_id, ps.step_index, ps.action_name, ps.action_class,
                ps.risk_level, ps.approval_mode, ps.parameters, ps.parameter_hash, ps.status, ps.version,
                ps.error, ps.created_at, ps.updated_at, b.approval_request_id;`,
      [workspaceId, id]
    );
    return rows[0] ?? null;
  }

  async listByPlanId(workspaceId: string, planId: string): Promise<PlanStepRecord[]> {
    const { rows } = await this.client.query<PlanStepRecord>(
      `SELECT ps.id, ps.plan_id, ps.workspace_id, ps.step_index, ps.action_name, ps.action_class,
              ps.risk_level, ps.approval_mode, ps.parameters, ps.parameter_hash, ps.status, ps.version,
              ps.error, ps.created_at, ps.updated_at,
              b.approval_request_id,
              COALESCE(
                ARRAY_AGG(d.depends_on_step_id) FILTER (WHERE d.depends_on_step_id IS NOT NULL),
                ARRAY[]::uuid[]
              ) AS depends_on_step_ids
       FROM plan_steps ps
       LEFT JOIN plan_step_dependencies d ON d.workspace_id = ps.workspace_id AND d.step_id = ps.id
       LEFT JOIN plan_step_approval_bindings b ON b.workspace_id = ps.workspace_id AND b.step_id = ps.id
       WHERE ps.workspace_id = $1 AND ps.plan_id = $2
       GROUP BY ps.id, ps.plan_id, ps.workspace_id, ps.step_index, ps.action_name, ps.action_class,
                ps.risk_level, ps.approval_mode, ps.parameters, ps.parameter_hash, ps.status, ps.version,
                ps.error, ps.created_at, ps.updated_at, b.approval_request_id
       ORDER BY ps.step_index ASC;`,
      [workspaceId, planId]
    );
    return rows;
  }

  async transitionStatus(
    workspaceId: string,
    id: string,
    expectedStatus: PlanStepState | PlanStepState[],
    nextStatus: PlanStepState,
    error?: Record<string, unknown> | null,
    expectedVersion?: number
  ): Promise<PlanStepRecord | null> {
    const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    let sql = `UPDATE plan_steps
               SET status = $3, error = COALESCE($4, error), version = version + 1, updated_at = NOW()
               WHERE workspace_id = $1 AND id = $2 AND status = ANY($5) AND status <> $3`;
    const params: any[] = [
      workspaceId,
      id,
      nextStatus,
      error ? JSON.stringify(error) : null,
      expectedStatuses
    ];

    if (typeof expectedVersion === 'number') {
      params.push(expectedVersion);
      sql += ` AND version = $${params.length}`;
    }

    sql += ` RETURNING id;`;

    const { rows } = await this.client.query<{ id: string }>(sql, params);
    if (rows.length === 0) return null;

    const updated = await this.findById(workspaceId, id);
    if (updated && nextStatus === 'queued') {
      // The guarded update wins once; the caller's transaction commits both state and audit.
      await new AuditEventRepository(this.client).create(workspaceId, 'step.queued', 'plan_step',
        { status: 'queued', version: updated.version }, undefined, id);
    }
    return updated;
  }

  async cancelNonTerminalSteps(workspaceId: string, planId: string): Promise<number> {
    const { rows } = await this.client.query<{ count: string }>(
      `WITH updated AS (
         UPDATE plan_steps
         SET status = 'cancelled', version = version + 1, updated_at = NOW()
         WHERE workspace_id = $1 AND plan_id = $2
           AND status NOT IN ('verified', 'unverified', 'failed', 'not_configured', 'skipped', 'cancelled')
         RETURNING id
       )
       SELECT COUNT(*)::text as count FROM updated;`,
      [workspaceId, planId]
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}
