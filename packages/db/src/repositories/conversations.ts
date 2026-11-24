import {
  ConversationRecord,
  CreateConversationInput,
  ConversationStatus
} from '@thaara/contracts';
import { DbClient, TransactionalDbClient, AuthenticatedScope } from '../client.js';
import { sanitizeDatabaseError, NotFoundError } from '../errors.js';

export class ConversationRepository {
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

  async create(scope: AuthenticatedScope, input: CreateConversationInput): Promise<ConversationRecord> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows: createRows } = await client.query<{ id: string }>(
          `SELECT public.create_conversation($1, $2, $3, $4) AS id;`,
          [
            scope.sessionTokenHash,
            input.title.trim(),
            input.channel ?? 'web',
            JSON.stringify(input.metadata ?? {})
          ]
        );

        const convId = createRows[0]?.id;
        if (!convId) {
          throw new NotFoundError('Failed to create conversation');
        }

        const { rows } = await client.query<ConversationRecord>(
          `SELECT id, workspace_id, user_id, title, channel, status, metadata, created_at, updated_at
           FROM public.conversations
           WHERE id = $1 AND workspace_id = $2 AND user_id = $3;`,
          [convId, scope.workspaceId, scope.userId]
        );

        if (!rows[0]) {
          throw new NotFoundError('Created conversation not found or unauthorized');
        }

        return rows[0];
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async findById(scope: AuthenticatedScope, conversationId: string): Promise<ConversationRecord | null> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<ConversationRecord>(
          `SELECT id, workspace_id, user_id, title, channel, status, metadata, created_at, updated_at
           FROM public.conversations
           WHERE id = $1 AND workspace_id = $2 AND user_id = $3;`,
          [conversationId, scope.workspaceId, scope.userId]
        );
        return rows[0] ?? null;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async list(
    scope: AuthenticatedScope,
    options?: { status?: ConversationStatus; limit?: number; offset?: number }
  ): Promise<ConversationRecord[]> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const limit = Math.min(options?.limit ?? 50, 100);
        const offset = options?.offset ?? 0;
        const params: any[] = [scope.workspaceId, scope.userId];

        let sql = `SELECT id, workspace_id, user_id, title, channel, status, metadata, created_at, updated_at
                   FROM public.conversations
                   WHERE workspace_id = $1 AND user_id = $2`;

        if (options?.status) {
          params.push(options.status);
          sql += ` AND status = $${params.length}`;
        }

        params.push(limit, offset);
        sql += ` ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length};`;

        const { rows } = await client.query<ConversationRecord>(sql, params);
        return rows;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async updateStatus(
    scope: AuthenticatedScope,
    conversationId: string,
    status: ConversationStatus
  ): Promise<ConversationRecord> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows: updateRows } = await client.query<{ update_conversation_status: boolean }>(
          `SELECT public.update_conversation_status($1, $2, $3);`,
          [scope.sessionTokenHash, conversationId, status]
        );

        if (!updateRows[0]?.update_conversation_status) {
          throw new NotFoundError('Conversation not found, unauthorized, or invalid status transition');
        }

        const { rows } = await client.query<ConversationRecord>(
          `SELECT id, workspace_id, user_id, title, channel, status, metadata, created_at, updated_at
           FROM public.conversations
           WHERE id = $1 AND workspace_id = $2 AND user_id = $3;`,
          [conversationId, scope.workspaceId, scope.userId]
        );

        if (!rows[0]) {
          throw new NotFoundError('Updated conversation not found or unauthorized');
        }

        return rows[0];
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async updateConversationStatus(
    scope: AuthenticatedScope,
    conversationId: string,
    status: ConversationStatus
  ): Promise<ConversationRecord> {
    return this.updateStatus(scope, conversationId, status);
  }

  async archive(scope: AuthenticatedScope, conversationId: string): Promise<ConversationRecord> {
    return this.updateStatus(scope, conversationId, 'archived');
  }

  async close(scope: AuthenticatedScope, conversationId: string): Promise<ConversationRecord> {
    return this.updateStatus(scope, conversationId, 'closed');
  }
}
