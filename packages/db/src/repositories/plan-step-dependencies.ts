import { DbClient } from '../migrator.js';

export interface PlanStepDependencyRecord {
  workspace_id: string;
  plan_id: string;
  step_id: string;
  depends_on_step_id: string;
  created_at: string;
}

export class PlanStepDependencyRepository {
  constructor(private client: DbClient) {}

  async create(
    workspaceId: string,
    planId: string,
    stepId: string,
    dependsOnStepId: string
  ): Promise<PlanStepDependencyRecord> {
    const { rows } = await this.client.query<PlanStepDependencyRecord>(
      `INSERT INTO plan_step_dependencies (workspace_id, plan_id, step_id, depends_on_step_id)
       VALUES ($1, $2, $3, $4)
       RETURNING workspace_id, plan_id, step_id, depends_on_step_id, created_at;`,
      [workspaceId, planId, stepId, dependsOnStepId]
    );
    return rows[0]!;
  }

  async createMany(
    workspaceId: string,
    planId: string,
    stepId: string,
    dependsOnStepIds: string[]
  ): Promise<PlanStepDependencyRecord[]> {
    if (dependsOnStepIds.length === 0) return [];
    const results: PlanStepDependencyRecord[] = [];
    for (const parentId of dependsOnStepIds) {
      const dep = await this.create(workspaceId, planId, stepId, parentId);
      results.push(dep);
    }
    return results;
  }

  async listByPlanId(workspaceId: string, planId: string): Promise<PlanStepDependencyRecord[]> {
    const { rows } = await this.client.query<PlanStepDependencyRecord>(
      `SELECT workspace_id, plan_id, step_id, depends_on_step_id, created_at
       FROM plan_step_dependencies
       WHERE workspace_id = $1 AND plan_id = $2;`,
      [workspaceId, planId]
    );
    return rows;
  }

  async listDependenciesForStep(workspaceId: string, planId: string, stepId: string): Promise<string[]> {
    const { rows } = await this.client.query<{ depends_on_step_id: string }>(
      `SELECT depends_on_step_id
       FROM plan_step_dependencies
       WHERE workspace_id = $1 AND plan_id = $2 AND step_id = $3;`,
      [workspaceId, planId, stepId]
    );
    return rows.map((r) => r.depends_on_step_id);
  }
}
