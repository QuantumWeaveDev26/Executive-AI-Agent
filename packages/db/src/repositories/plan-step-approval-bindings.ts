import { DbClient } from '../migrator.js';

export interface PlanStepApprovalBindingRecord {
  id: string;
  workspace_id: string;
  plan_id: string;
  step_id: string;
  approval_request_id: string;
  parameter_hash: string;
  bound_at: string;
}

export class PlanStepApprovalBindingRepository {
  constructor(private client: DbClient) {}

  async create(
    workspaceId: string,
    planId: string,
    stepId: string,
    approvalRequestId: string,
    parameterHash: string
  ): Promise<PlanStepApprovalBindingRecord> {
    const { rows } = await this.client.query<PlanStepApprovalBindingRecord>(
      `INSERT INTO plan_step_approval_bindings (workspace_id, plan_id, step_id, approval_request_id, parameter_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, workspace_id, plan_id, step_id, approval_request_id, parameter_hash, bound_at;`,
      [workspaceId, planId, stepId, approvalRequestId, parameterHash]
    );
    return rows[0]!;
  }

  async findByStepId(
    workspaceId: string,
    stepId: string
  ): Promise<PlanStepApprovalBindingRecord | null> {
    const { rows } = await this.client.query<PlanStepApprovalBindingRecord>(
      `SELECT id, workspace_id, plan_id, step_id, approval_request_id, parameter_hash, bound_at
       FROM plan_step_approval_bindings
       WHERE workspace_id = $1 AND step_id = $2;`,
      [workspaceId, stepId]
    );
    return rows[0] ?? null;
  }

  async findByApprovalRequestId(
    workspaceId: string,
    approvalRequestId: string
  ): Promise<PlanStepApprovalBindingRecord | null> {
    const { rows } = await this.client.query<PlanStepApprovalBindingRecord>(
      `SELECT id, workspace_id, plan_id, step_id, approval_request_id, parameter_hash, bound_at
       FROM plan_step_approval_bindings
       WHERE workspace_id = $1 AND approval_request_id = $2;`,
      [workspaceId, approvalRequestId]
    );
    return rows[0] ?? null;
  }

  async listByPlanId(
    workspaceId: string,
    planId: string
  ): Promise<PlanStepApprovalBindingRecord[]> {
    const { rows } = await this.client.query<PlanStepApprovalBindingRecord>(
      `SELECT id, workspace_id, plan_id, step_id, approval_request_id, parameter_hash, bound_at
       FROM plan_step_approval_bindings
       WHERE workspace_id = $1 AND plan_id = $2;`,
      [workspaceId, planId]
    );
    return rows;
  }
}
