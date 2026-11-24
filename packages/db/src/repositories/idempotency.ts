import { DbClient } from '../migrator.js';

export interface IdempotencyRecord {
  key: string;
  workspace_id: string;
  user_id: string;
  request_path: string;
  status: 'in_progress' | 'completed' | 'failed';
  response_status: number | null;
  response_body: Record<string, unknown> | null;
  created_at: string;
  expires_at: string;
}

export class IdempotencyRepository {
  constructor(private client: DbClient) {}

  async get(workspaceId: string, key: string): Promise<IdempotencyRecord | null> {
    const { rows } = await this.client.query<IdempotencyRecord>(
      `SELECT key, workspace_id, user_id, request_path, status, response_status, response_body, created_at, expires_at
       FROM idempotency_keys
       WHERE workspace_id = $1 AND key = $2 AND expires_at > NOW();`,
      [workspaceId, key]
    );
    return rows[0] ?? null;
  }

  async claim(
    workspaceId: string,
    key: string,
    userId: string,
    requestPath: string,
    ttlSeconds = 86400
  ): Promise<{ claimed: boolean; record: IdempotencyRecord }> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    // Check if exists
    const existing = await this.get(workspaceId, key);
    if (existing) {
      return { claimed: false, record: existing };
    }

    // Try to insert
    try {
      const { rows } = await this.client.query<IdempotencyRecord>(
        `INSERT INTO idempotency_keys (key, workspace_id, user_id, request_path, status, expires_at)
         VALUES ($1, $2, $3, $4, 'in_progress', $5)
         RETURNING key, workspace_id, user_id, request_path, status, response_status, response_body, created_at, expires_at;`,
        [key, workspaceId, userId, requestPath, expiresAt]
      );
      return { claimed: true, record: rows[0]! };
    } catch {
      // Conflict on concurrent insert
      const current = await this.get(workspaceId, key);
      return { claimed: false, record: current! };
    }
  }

  async complete(
    workspaceId: string,
    key: string,
    responseStatus: number,
    responseBody: Record<string, unknown>
  ): Promise<void> {
    await this.client.query(
      `UPDATE idempotency_keys
       SET status = 'completed', response_status = $3, response_body = $4
       WHERE workspace_id = $1 AND key = $2;`,
      [workspaceId, key, responseStatus, JSON.stringify(responseBody)]
    );
  }

  async fail(workspaceId: string, key: string): Promise<void> {
    await this.client.query(
      `UPDATE idempotency_keys
       SET status = 'failed'
       WHERE workspace_id = $1 AND key = $2;`,
      [workspaceId, key]
    );
  }
}
