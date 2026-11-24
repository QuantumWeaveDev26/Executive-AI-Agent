import { redactSensitiveData } from '@thaara/observability';
import { DbClient } from '../migrator.js';

export interface AuditEventRecord {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export class AuditEventRepository {
  constructor(private client: DbClient) {}

  async create(
    workspaceId: string,
    action: string,
    targetType: string,
    payload: Record<string, unknown>,
    actorUserId?: string | null,
    targetId?: string | null
  ): Promise<AuditEventRecord> {
    const redactedPayload = redactSensitiveData(payload);
    // Omitted actors use the existing transaction scope, never event payloads.
    // Explicit null remains a system event; a worker's sentinel user has no user row.
    const { rows } = await this.client.query<AuditEventRecord>(
      `INSERT INTO audit_events (workspace_id, actor_user_id, action, target_type, target_id, payload, created_at)
       VALUES ($1, CASE WHEN $7::boolean THEN (
         SELECT u.id FROM public.users u WHERE u.id::text=current_setting('app.user_id',true)
       ) ELSE $2::uuid END, $3, $4, $5, $6, clock_timestamp())
       RETURNING id, workspace_id, actor_user_id, action, target_type, target_id, payload, created_at;`,
      [
        workspaceId,
        actorUserId ?? null,
        action,
        targetType,
        targetId ?? null,
        JSON.stringify(redactedPayload),
        actorUserId === undefined
      ]
    );
    return rows[0]!;
  }

  async listByWorkspace(
    workspaceId: string,
    limit = 50,
    offset = 0
  ): Promise<{ events: AuditEventRecord[]; total: number }> {
    const { rows: countRows } = await this.client.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM audit_events WHERE workspace_id = $1;`,
      [workspaceId]
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const { rows: events } = await this.client.query<AuditEventRecord>(
      `SELECT id, workspace_id, actor_user_id, action, target_type, target_id, payload, created_at
       FROM audit_events
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3;`,
      [workspaceId, limit, offset]
    );

    return { events, total };
  }
}
