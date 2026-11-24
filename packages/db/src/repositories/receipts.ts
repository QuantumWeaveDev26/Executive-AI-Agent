import { ReceiptState } from '@thaara/contracts';
import { DbClient } from '../migrator.js';
import { AuditEventRepository } from './audit.js';

export interface ReceiptRecord {
  id: string;
  workspace_id: string;
  plan_id: string;
  plan_step_id: string;
  action_name: string;
  status: ReceiptState;
  proof: Record<string, unknown>;
  verification_method: string;
  issued_at: string;
  verified_at: string | null;
}

export class ReceiptRepository {
  constructor(private client: DbClient) {}

  async create(
    workspaceId: string,
    planId: string,
    planStepId: string,
    actionName: string,
    status: ReceiptState,
    proof: Record<string, unknown>,
    verificationMethod: string,
    verifiedAt?: string | null
  ): Promise<ReceiptRecord> {
    const { rows } = await this.client.query<ReceiptRecord>(
      `INSERT INTO receipts (
        workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, verified_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, issued_at, verified_at;`,
      [
        workspaceId,
        planId,
        planStepId,
        actionName,
        status,
        JSON.stringify(proof),
        verificationMethod,
        verifiedAt !== undefined ? verifiedAt : (status === 'verified' ? new Date().toISOString() : null)
      ]
    );
    const receipt = rows[0]!;
    // Receipt uniqueness and integrity constraints are the source of truth. Never copy proof.
    await new AuditEventRepository(this.client).create(workspaceId, 'step.' + receipt.status, 'plan_step',
      { receiptId: receipt.id, receiptStatus: receipt.status }, undefined, receipt.plan_step_id);
    return receipt;
  }

  async findByStepId(workspaceId: string, planStepId: string): Promise<ReceiptRecord | null> {
    const { rows } = await this.client.query<ReceiptRecord>(
      `SELECT id, workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, issued_at, verified_at
       FROM receipts
       WHERE workspace_id = $1 AND plan_step_id = $2;`,
      [workspaceId, planStepId]
    );
    return rows[0] ?? null;
  }

  async listByPlanId(workspaceId: string, planId: string): Promise<ReceiptRecord[]> {
    const { rows } = await this.client.query<ReceiptRecord>(
      `SELECT id, workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, issued_at, verified_at
       FROM receipts
       WHERE workspace_id = $1 AND plan_id = $2
       ORDER BY issued_at ASC;`,
      [workspaceId, planId]
    );
    return rows;
  }
}
