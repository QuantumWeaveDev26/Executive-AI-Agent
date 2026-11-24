import { ConversationMessageRecord, AppendMessageInput } from '@thaara/contracts';
import { DbClient, TransactionalDbClient, AuthenticatedScope } from '../client.js';
import { sanitizeDatabaseError, NotFoundError } from '../errors.js';

export class ConversationMessageRepository {
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

  async append(
    scope: AuthenticatedScope,
    conversationId: string,
    input: AppendMessageInput
  ): Promise<ConversationMessageRecord> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<{
          message_id: string;
          sequence_number: number;
          created_at: string;
        }>(
          `SELECT message_id, sequence_number, created_at
           FROM public.append_conversation_message($1, $2, $3, $4);`,
          [
            scope.sessionTokenHash,
            conversationId,
            input.content,
            JSON.stringify(input.metadata ?? {})
          ]
        );

        const appended = rows[0];
        if (!appended) {
          throw new NotFoundError('Failed to append conversation message');
        }

        return {
          id: appended.message_id,
          workspace_id: scope.workspaceId,
          conversation_id: conversationId,
          user_id: scope.userId,
          sequence_number: appended.sequence_number,
          sender_type: 'user',
          sender_id: scope.userId,
          content: input.content,
          metadata: (input.metadata as Record<string, unknown>) ?? {},
          created_at: appended.created_at
        };
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async listByConversation(
    scope: AuthenticatedScope,
    conversationId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<ConversationMessageRecord[]> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const limit = Math.min(options?.limit ?? 100, 200);
        const offset = options?.offset ?? 0;

        // Binds $1: workspaceId, $2: conversationId, $3: userId for privacy cutoff subquery & foreign-user exclusion
        const sql = `SELECT id, workspace_id, conversation_id, user_id, sequence_number, sender_type, sender_id, assistant_stream_id, content, advisory_token_count AS token_count, metadata, created_at
                     FROM public.conversation_messages
                     WHERE workspace_id = $1
                       AND conversation_id = $2
                       AND user_id = $3
                       AND created_at > COALESCE(
                         (SELECT MAX(cutoff_at) FROM public.user_purge_cutoffs WHERE workspace_id = $1 AND user_id = $3),
                         '-infinity'::timestamptz
                       )
                     ORDER BY sequence_number ASC
                     LIMIT $4 OFFSET $5;`;

        const { rows } = await client.query<ConversationMessageRecord>(sql, [
          scope.workspaceId,
          conversationId,
          scope.userId,
          limit,
          offset
        ]);

        return rows;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }
}
