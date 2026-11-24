import { JobStatus } from '@thaara/contracts';
import { DbClient } from '../migrator.js';

export interface JobRunRecord {
  id: string;
  workspace_id: string;
  job_name: string;
  status: JobStatus;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  retries_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export class JobRunRepository {
  constructor(private client: DbClient) {}

  async create(
    workspaceId: string,
    jobName: string,
    payload: Record<string, unknown>,
    idempotencyKey?: string | null
  ): Promise<JobRunRecord> {
    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(workspaceId, idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const { rows } = await this.client.query<JobRunRecord>(
      `INSERT INTO job_runs (workspace_id, job_name, status, payload, idempotency_key)
       VALUES ($1, $2, 'queued', $3, $4)
       RETURNING id, workspace_id, job_name, status, idempotency_key, payload, result, error, retries_count, created_at, updated_at, completed_at;`,
      [workspaceId, jobName, JSON.stringify(payload), idempotencyKey ?? null]
    );
    return rows[0]!;
  }

  async findById(workspaceId: string, id: string): Promise<JobRunRecord | null> {
    const { rows } = await this.client.query<JobRunRecord>(
      `SELECT id, workspace_id, job_name, status, idempotency_key, payload, result, error, retries_count, created_at, updated_at, completed_at
       FROM job_runs
       WHERE workspace_id = $1 AND id = $2;`,
      [workspaceId, id]
    );
    return rows[0] ?? null;
  }

  async findByIdempotencyKey(workspaceId: string, idempotencyKey: string): Promise<JobRunRecord | null> {
    const { rows } = await this.client.query<JobRunRecord>(
      `SELECT id, workspace_id, job_name, status, idempotency_key, payload, result, error, retries_count, created_at, updated_at, completed_at
       FROM job_runs
       WHERE workspace_id = $1 AND idempotency_key = $2;`,
      [workspaceId, idempotencyKey]
    );
    return rows[0] ?? null;
  }

  async updateStatus(
    workspaceId: string,
    id: string,
    status: JobStatus,
    result?: Record<string, unknown> | null,
    error?: string | null
  ): Promise<JobRunRecord | null> {
    const isTerminal = status === 'completed' || status === 'failed';
    const { rows } = await this.client.query<JobRunRecord>(
      `UPDATE job_runs
       SET status = $3,
           result = COALESCE($4, result),
           error = COALESCE($5, error),
           completed_at = CASE WHEN $6 = true THEN NOW() ELSE completed_at END,
           updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2
       RETURNING id, workspace_id, job_name, status, idempotency_key, payload, result, error, retries_count, created_at, updated_at, completed_at;`,
      [
        workspaceId,
        id,
        status,
        result ? JSON.stringify(result) : null,
        error ?? null,
        isTerminal
      ]
    );
    return rows[0] ?? null;
  }

  async incrementRetry(workspaceId: string, id: string, error: string): Promise<void> {
    await this.client.query(
      `UPDATE job_runs
       SET retries_count = retries_count + 1,
           error = $3,
           status = 'retrying',
           updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2;`,
      [workspaceId, id, error]
    );
  }
}
