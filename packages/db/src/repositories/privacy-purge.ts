import {
  PurgeOperationRecord,
  InitiatePurgeInput,
  ExportHistoryResult
} from '@thaara/contracts';
import { DbClient, TransactionalDbClient, AuthenticatedScope } from '../client.js';
import { sanitizeDatabaseError, NotFoundError } from '../errors.js';

export class PrivacyPurgeRepository {
  constructor(private db: DbClient | TransactionalDbClient) {}

  private async executeScoped<T>(
    scope: AuthenticatedScope,
    operation: (client: DbClient) => Promise<T>
  ): Promise<T> {
    if (
      'withScopedTransaction' in this.db &&
      typeof (this.db as TransactionalDbClient).withScopedTransaction === 'function'
    ) {
      return (this.db as TransactionalDbClient).withScopedTransaction(scope, operation);
    }
    return operation(this.db);
  }

  async initiatePurge(
    scope: AuthenticatedScope,
    input: InitiatePurgeInput
  ): Promise<string> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<{ operation_id: string }>(
          `SELECT operation_id FROM public.initiate_self_privacy_purge($1, $2);`,
          [scope.sessionTokenHash, input.mode]
        );
        const purgeId = rows[0]?.operation_id;
        if (!purgeId) {
          throw new NotFoundError('Failed to initiate privacy purge');
        }
        return purgeId;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async getPurgeStatus(scope: AuthenticatedScope, purgeId: string): Promise<PurgeOperationRecord | null> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<PurgeOperationRecord>(
          `SELECT id, workspace_id, user_id, generation, cutoff_at, mode, status, attempts, created_at, updated_at
           FROM public.user_purge_operations
           WHERE workspace_id = $1 AND id = $2 AND user_id = $3;`,
          [scope.workspaceId, purgeId, scope.userId]
        );
        return rows[0] ?? null;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async exportHistory(scope: AuthenticatedScope): Promise<ExportHistoryResult> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<{ export_user_conversation_history: any }>(
          `SELECT public.export_user_conversation_history($1);`,
          [scope.sessionTokenHash]
        );
        const result = rows[0]?.export_user_conversation_history;
        if (!result) {
          throw new NotFoundError('No export data found or unauthorized');
        }
        return result as ExportHistoryResult;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }
}
