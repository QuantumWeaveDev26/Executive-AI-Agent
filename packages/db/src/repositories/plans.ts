import { PlanState } from '@thaara/contracts';
import { DbClient } from '../migrator.js';
import { AuditEventRepository } from './audit.js';

export interface PlanRecord {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  title: string;
  description: string | null;
  status: PlanState;
  version: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export class PlanRepository {
  constructor(private client: DbClient) {}

  async create(
    workspaceId: string,
    createdByUserId: string,
    title: string,
    description?: string | null,
    metadata: Record<string, unknown> = {}
  ): Promise<PlanRecord> {
    const { rows } = await this.client.query<PlanRecord>(
      `INSERT INTO plans (workspace_id, created_by_user_id, title, description, status, version, metadata)
       VALUES ($1, $2, $3, $4, 'draft', 1, $5)
       RETURNING id, workspace_id, created_by_user_id, title, description, status, version, metadata, created_at, updated_at;`,
      [workspaceId, createdByUserId, title, description ?? null, JSON.stringify(metadata)]
    );
    const created = rows[0]!;
    await new AuditEventRepository(this.client).create(workspaceId, 'plan.created', 'plan',
      { status: 'draft', version: created.version }, createdByUserId, created.id);
    return created;
  }

  async findById(workspaceId: string, id: string): Promise<PlanRecord | null> {
    const { rows } = await this.client.query<PlanRecord>(
      `SELECT id, workspace_id, created_by_user_id, title, description, status, version, metadata, created_at, updated_at
       FROM plans
       WHERE workspace_id = $1 AND id = $2;`,
      [workspaceId, id]
    );
    return rows[0] ?? null;
  }

  async listByWorkspace(
    workspaceId: string,
    options?: { status?: PlanState; limit?: number; offset?: number }
  ): Promise<PlanRecord[]> {
    const limit = Math.min(options?.limit ?? 50, 100);
    const offset = options?.offset ?? 0;
    let sql = `SELECT id, workspace_id, created_by_user_id, title, description, status, version, metadata, created_at, updated_at
               FROM plans
               WHERE workspace_id = $1`;
    const params: any[] = [workspaceId];

    if (options?.status) {
      params.push(options.status);
      sql += ` AND status = $${params.length}`;
    }

    params.push(limit, offset);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length};`;

    const { rows } = await this.client.query<PlanRecord>(sql, params);
    return rows;
  }

  async transitionStatus(
    workspaceId: string,
    id: string,
    expectedStatus: PlanState | PlanState[],
    nextStatus: PlanState,
    expectedVersion?: number
  ): Promise<PlanRecord | null> {
    const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    let sql = `UPDATE plans
               SET status = $3, version = version + 1, updated_at = NOW()
               WHERE workspace_id = $1 AND id = $2 AND status = ANY($4) AND status <> $3`;
    const params: any[] = [workspaceId, id, nextStatus, expectedStatuses];

    if (typeof expectedVersion === 'number') {
      params.push(expectedVersion);
      sql += ` AND version = $${params.length}`;
    }

    sql += ` RETURNING id, workspace_id, created_by_user_id, title, description, status, version, metadata, created_at, updated_at;`;

    const { rows } = await this.client.query<PlanRecord>(sql, params);
    const updated = rows[0] ?? null;
    if (updated && ['completed', 'cancelled', 'failed'].includes(nextStatus)) {
      await new AuditEventRepository(this.client).create(workspaceId, 'plan.' + nextStatus, 'plan',
        { status: nextStatus, version: updated.version }, undefined, id);
    }
    return updated;
  }
}
