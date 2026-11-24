import { RoleAwarePool, DbClient, TransactionalDbClient } from '../../client.js';
import { sanitizeDatabaseError } from '../../errors.js';

export interface OutboxDispatchRecord {
  id: string;
  workspace_id: string;
  topic: string;
  dedup_key: string;
  payload: Record<string, unknown>;
  claim_token: string;
  attempts: number;
  lease_expires_at: string;
}

export class WorkerOutboxRepository {
  constructor(private pool: RoleAwarePool | DbClient | TransactionalDbClient) {}

  private async withClient<T>(op: (client: DbClient) => Promise<T>): Promise<T> {
    if (this.pool && 'withRoleClient' in this.pool && typeof (this.pool as any).withRoleClient === 'function') {
      return await (this.pool as any).withRoleClient(op);
    }
    return await op(this.pool as DbClient);
  }

  async claimDispatches(
    workerNodeId: string,
    batchSize = 50,
    leaseSeconds = 60
  ): Promise<OutboxDispatchRecord[]> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<OutboxDispatchRecord>(
          `SELECT * FROM public.claim_outbox_dispatches($1, $2, $3);`,
          [workerNodeId, batchSize, leaseSeconds]
        );
        return rows;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async markDispatched(outboxId: string, claimToken: string): Promise<boolean> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<{ mark_outbox_dispatched: boolean }>(
          `SELECT public.mark_outbox_dispatched($1, $2);`,
          [outboxId, claimToken]
        );
        return Boolean(rows[0]?.mark_outbox_dispatched);
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async markFailed(
    outboxId: string,
    claimToken: string,
    errorCode: string,
    errorCategory: string,
    isTerminal = false
  ): Promise<boolean> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<{ mark_outbox_failed: boolean }>(
          `SELECT public.mark_outbox_failed($1, $2, $3, $4, $5);`,
          [outboxId, claimToken, errorCode, errorCategory, isTerminal]
        );
        return rows[0]?.mark_outbox_failed ?? true;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }
}
