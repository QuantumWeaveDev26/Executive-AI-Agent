import { ApprovalState, RiskLevel } from '@thaara/contracts';
import { DbClient } from '../migrator.js';
import { AuditEventRepository } from './audit.js';

export interface ApprovalRecord {
  id: string;
  workspace_id: string;
  action_name: string;
  action_params: Record<string, unknown>;
  requester_user_id: string;
  approver_user_id: string | null;
  status: ApprovalState;
  risk_level: RiskLevel;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export class ApprovalRepository {
  constructor(private client: DbClient) {}

  async create(
    workspaceId: string,
    actionName: string,
    actionParams: Record<string, unknown>,
    requesterUserId: string,
    riskLevel: RiskLevel,
    ttlSeconds = 86400
  ): Promise<ApprovalRecord> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const { rows } = await this.client.query<ApprovalRecord>(
      `INSERT INTO approval_requests (workspace_id, action_name, action_params, requester_user_id, status, risk_level, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)
       RETURNING id, workspace_id, action_name, action_params, requester_user_id, approver_user_id, status, risk_level, expires_at, created_at, updated_at;`,
      [workspaceId, actionName, JSON.stringify(actionParams), requesterUserId, riskLevel, expiresAt]
    );
    const created = rows[0]!;
    await new AuditEventRepository(this.client).create(workspaceId, 'approval.created', 'approval_request',
      { status: 'pending' }, requesterUserId, created.id);
    return created;
  }

  async findById(workspaceId: string, id: string): Promise<ApprovalRecord | null> {
    const { rows } = await this.client.query<ApprovalRecord>(
      `SELECT id, workspace_id, action_name, action_params, requester_user_id, approver_user_id, status, risk_level, expires_at, created_at, updated_at
       FROM approval_requests
       WHERE workspace_id = $1 AND id = $2;`,
      [workspaceId, id]
    );
    return rows[0] ?? null;
  }

  async transitionStatus(
    workspaceId: string,
    id: string,
    expectedStatus: ApprovalState | ApprovalState[],
    nextStatus: ApprovalState,
    approverUserId?: string
  ): Promise<ApprovalRecord | null> {
    const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    const { rows } = await this.client.query<ApprovalRecord>(
      `UPDATE approval_requests
       SET status = $3, approver_user_id = COALESCE($4, approver_user_id), updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2 AND status = ANY($5) AND status <> $3
       RETURNING id, workspace_id, action_name, action_params, requester_user_id, approver_user_id, status, risk_level, expires_at, created_at, updated_at;`,
      [workspaceId, id, nextStatus, approverUserId ?? null, expectedStatuses]
    );
    const updated = rows[0] ?? null;
    if (updated) {
      await new AuditEventRepository(this.client).create(workspaceId, 'approval.' + nextStatus, 'approval_request',
        { status: nextStatus }, approverUserId, id);
    }
    return updated;
  }

  async updateStatus(
    workspaceId: string,
    id: string,
    status: ApprovalState,
    approverUserId?: string
  ): Promise<ApprovalRecord | null> {
    const { rows } = await this.client.query<ApprovalRecord>(
      `UPDATE approval_requests
       SET status = $3, approver_user_id = COALESCE($4, approver_user_id), updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2
       RETURNING id, workspace_id, action_name, action_params, requester_user_id, approver_user_id, status, risk_level, expires_at, created_at, updated_at;`,
      [workspaceId, id, status, approverUserId ?? null]
    );
    return rows[0] ?? null;
  }

  async listByWorkspace(workspaceId: string, limit = 50): Promise<ApprovalRecord[]> {
    const { rows } = await this.client.query<ApprovalRecord>(
      `SELECT id, workspace_id, action_name, action_params, requester_user_id, approver_user_id, status, risk_level, expires_at, created_at, updated_at
       FROM approval_requests
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2;`,
      [workspaceId, limit]
    );
    return rows;
  }
}
