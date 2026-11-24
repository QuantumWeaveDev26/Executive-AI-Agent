import { DbClient } from '../migrator.js';
import { AuditEventRepository } from './audit.js';

export interface StepExecutionRecord {
  id: string;
  workspace_id: string;
  plan_id: string;
  step_id: string;
  idempotency_key: string;
  worker_id: string;
  lease_token: string;
  attempt_number: number;
  status: 'started' | 'completed' | 'failed';
  started_at: string;
  lease_expires_at: string;
  completed_at: string | null;
}

export class StepExecutionRepository {
  constructor(private client: DbClient) {}

  /**
   * Attempts to acquire an execution lease atomically.
   * - If no execution exists: inserts a new lease record with attempt_number = 1.
   * - If an expired lease exists (lease_expires_at <= NOW() AND status = 'started'):
   *   takes over the lease, increments attempt_number, updates worker_id and lease_token.
   * - If an active unexpired lease exists, or execution has completed/failed:
   *   returns null (0 rows updated), preventing lease theft or duplicate execution.
   */
  async acquireLease(
    workspaceId: string,
    planId: string,
    stepId: string,
    idempotencyKey: string,
    workerId: string,
    leaseToken: string,
    leaseDurationMs: number = 60000
  ): Promise<StepExecutionRecord | null> {
    const { rows } = await this.client.query<StepExecutionRecord>(
      `INSERT INTO step_executions (
         workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token,
         attempt_number, status, started_at, lease_expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 1, 'started', NOW(), NOW() + ($7 || ' milliseconds')::interval)
       ON CONFLICT (workspace_id, idempotency_key) DO UPDATE
         SET worker_id = EXCLUDED.worker_id,
             lease_token = EXCLUDED.lease_token,
             attempt_number = step_executions.attempt_number + 1,
             status = 'started',
             started_at = NOW(),
             lease_expires_at = EXCLUDED.lease_expires_at,
             completed_at = NULL
         WHERE step_executions.status = 'started' AND step_executions.lease_expires_at <= NOW()
       RETURNING id, workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token,
                 attempt_number, status, started_at, lease_expires_at, completed_at;`,
      [workspaceId, planId, stepId, idempotencyKey, workerId, leaseToken, leaseDurationMs.toString()]
    );
    const acquired = rows[0] ?? null;
    if (acquired) {
      // Retain each attempt before the lease row can be overwritten by a takeover.
      // A started attempt does not assert that a connector was dispatched.
      await new AuditEventRepository(this.client).create(workspaceId, 'step.started', 'plan_step',
        { executionId: acquired.id, attemptNumber: acquired.attempt_number }, undefined, acquired.step_id);
    }
    return acquired;
  }

  async findByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<StepExecutionRecord | null> {
    const { rows } = await this.client.query<StepExecutionRecord>(
      `SELECT id, workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token,
              attempt_number, status, started_at, lease_expires_at, completed_at
       FROM step_executions
       WHERE workspace_id = $1 AND idempotency_key = $2;`,
      [workspaceId, idempotencyKey]
    );
    return rows[0] ?? null;
  }

  async completeLease(
    workspaceId: string,
    id: string,
    leaseToken: string
  ): Promise<StepExecutionRecord | null> {
    const { rows } = await this.client.query<StepExecutionRecord>(
      `UPDATE step_executions
       SET status = 'completed', completed_at = NOW()
       WHERE workspace_id = $1 AND id = $2 AND lease_token = $3 AND status = 'started'
       RETURNING id, workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token,
                 attempt_number, status, started_at, lease_expires_at, completed_at;`,
      [workspaceId, id, leaseToken]
    );
    return rows[0] ?? null;
  }

  async failLease(
    workspaceId: string,
    id: string,
    leaseToken: string
  ): Promise<StepExecutionRecord | null> {
    const { rows } = await this.client.query<StepExecutionRecord>(
      `UPDATE step_executions
       SET status = 'failed', completed_at = NOW()
       WHERE workspace_id = $1 AND id = $2 AND lease_token = $3 AND status = 'started'
       RETURNING id, workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token,
                 attempt_number, status, started_at, lease_expires_at, completed_at;`,
      [workspaceId, id, leaseToken]
    );
    return rows[0] ?? null;
  }

  async releaseLease(
    workspaceId: string,
    id: string,
    leaseToken: string
  ): Promise<StepExecutionRecord | null> {
    const { rows } = await this.client.query<StepExecutionRecord>(
      `UPDATE step_executions
       SET lease_expires_at = NOW()
       WHERE workspace_id = $1 AND id = $2 AND lease_token = $3 AND status = 'started'
       RETURNING id, workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token,
                 attempt_number, status, started_at, lease_expires_at, completed_at;`,
      [workspaceId, id, leaseToken]
    );
    return rows[0] ?? null;
  }
}
