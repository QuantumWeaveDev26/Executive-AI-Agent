import {
  AssistantStreamExecutionRecord,
  AssistantStreamEvent,
  AssistantStreamStatus
} from '@thaara/contracts';
import { DbClient, TransactionalDbClient, AuthenticatedScope } from '../client.js';
import { sanitizeDatabaseError, NotFoundError } from '../errors.js';

export interface InitiateStreamResult {
  stream_id: string;
  status: AssistantStreamStatus;
  user_message_id: string;
  assistant_message_id: string | null;
  version: number;
  idempotent_replay: boolean;
}

export interface AppendStreamEventResult {
  stream_id: string;
  sequence_number: number;
  version: number;
  status: AssistantStreamStatus;
}

export interface FinalizeStreamResult {
  stream_id: string;
  status: 'completed';
  assistant_message_id: string;
  sequence_number: number;
  version: number;
}

export interface CancelStreamResult {
  stream_id: string;
  status: 'cancelled';
  version: number;
  idempotent: boolean;
}

export interface StreamEventsAfterResult {
  stream_id: string;
  status: AssistantStreamStatus;
  version: number;
  events: AssistantStreamEvent[];
}

export interface ReconcileStaleStreamsResult {
  recovered_count: number;
  stream_ids: string[];
}

export class AssistantStreamRepository {
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

  async initiateStream(
    scope: AuthenticatedScope,
    conversationId: string,
    idempotencyKey: string,
    content: string
  ): Promise<InitiateStreamResult> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<{
          initiate_assistant_stream: InitiateStreamResult;
        }>(
          `SELECT public.initiate_assistant_stream($1, $2, $3, $4);`,
          [scope.sessionTokenHash, conversationId, idempotencyKey, content]
        );
        const result = rows[0]?.initiate_assistant_stream;
        if (!result) {
          throw new NotFoundError('Failed to initiate assistant stream');
        }
        return result;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async appendEvent(
    scope: AuthenticatedScope,
    streamId: string,
    expectedVersion: number,
    eventType: string,
    payload: Record<string, unknown>,
    contentDelta?: string
  ): Promise<AppendStreamEventResult> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<{
          append_assistant_stream_event: AppendStreamEventResult;
        }>(
          `SELECT public.append_assistant_stream_event($1, $2, $3, $4, $5, $6);`,
          [
            scope.sessionTokenHash,
            streamId,
            expectedVersion,
            eventType,
            JSON.stringify(payload),
            contentDelta ?? null
          ]
        );
        const result = rows[0]?.append_assistant_stream_event;
        if (!result) {
          throw new NotFoundError('Failed to append assistant stream event');
        }
        return result;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async finalizeStream(
    scope: AuthenticatedScope,
    streamId: string,
    expectedVersion: number,
    durationMs: number
  ): Promise<FinalizeStreamResult> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<{
          finalize_assistant_stream: FinalizeStreamResult;
        }>(
          `SELECT public.finalize_assistant_stream($1, $2, $3, $4);`,
          [scope.sessionTokenHash, streamId, expectedVersion, durationMs]
        );
        const result = rows[0]?.finalize_assistant_stream;
        if (!result) {
          throw new NotFoundError('Failed to finalize assistant stream');
        }
        return result;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async cancelStream(
    scope: AuthenticatedScope,
    streamId: string,
    expectedVersion: number,
    reason?: string
  ): Promise<CancelStreamResult> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<{
          cancel_assistant_stream: CancelStreamResult;
        }>(
          `SELECT public.cancel_assistant_stream($1, $2, $3, $4);`,
          [scope.sessionTokenHash, streamId, expectedVersion, reason ?? null]
        );
        const result = rows[0]?.cancel_assistant_stream;
        if (!result) {
          throw new NotFoundError('Failed to cancel assistant stream');
        }
        return result;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async getEventsAfter(
    scope: AuthenticatedScope,
    streamId: string,
    afterSequence: number
  ): Promise<StreamEventsAfterResult> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<{
          get_assistant_stream_events_after: StreamEventsAfterResult;
        }>(
          `SELECT public.get_assistant_stream_events_after($1, $2, $3);`,
          [scope.sessionTokenHash, streamId, afterSequence]
        );
        const result = rows[0]?.get_assistant_stream_events_after;
        if (!result) {
          throw new NotFoundError('Assistant stream events not found');
        }
        return result;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async findById(
    scope: AuthenticatedScope,
    streamId: string
  ): Promise<AssistantStreamExecutionRecord | null> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<AssistantStreamExecutionRecord>(
          `SELECT id, workspace_id, conversation_id, user_id, idempotency_key, user_message_id,
                  assistant_message_id, status, version, advisory_token_count, accumulated_content,
                  error_code, started_at, completed_at, created_at, updated_at
           FROM public.assistant_stream_executions
           WHERE id = $1 AND workspace_id = $2 AND user_id = $3;`,
          [streamId, scope.workspaceId, scope.userId]
        );
        return rows[0] ?? null;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  // Worker-only methods
  async recoverStaleStream(
    clientOrStreamId: DbClient | string,
    maybeStreamId?: string
  ): Promise<{ stream_id: string; recovered: boolean; status: string; version?: number }> {
    let client: DbClient;
    let streamId: string;
    if (typeof clientOrStreamId === 'string') {
      client = this.db as DbClient;
      streamId = clientOrStreamId;
    } else {
      client = clientOrStreamId;
      streamId = maybeStreamId!;
    }
    try {
      const { rows } = await client.query<{
        recover_stale_assistant_stream: {
          stream_id: string;
          recovered: boolean;
          status: string;
          version?: number;
        };
      }>(
        `SELECT public.recover_stale_assistant_stream($1);`,
        [streamId]
      );
      const result = rows[0]?.recover_stale_assistant_stream;
      if (!result) {
        throw new NotFoundError(`Failed to recover stream ${streamId}`);
      }
      return result;
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async reconcileStaleStreams(
    clientOrBatchSize?: DbClient | number,
    maybeBatchSize?: number
  ): Promise<ReconcileStaleStreamsResult> {
    let client: DbClient;
    let batchSize = 50;
    if (clientOrBatchSize && typeof clientOrBatchSize === 'object' && 'query' in clientOrBatchSize) {
      client = clientOrBatchSize as DbClient;
      batchSize = maybeBatchSize ?? 50;
    } else {
      client = this.db as DbClient;
      batchSize = typeof clientOrBatchSize === 'number' ? clientOrBatchSize : 50;
    }
    try {
      const { rows } = await client.query<{
        reconcile_stale_assistant_streams: ReconcileStaleStreamsResult;
      }>(
        `SELECT public.reconcile_stale_assistant_streams($1);`,
        [batchSize]
      );
      return rows[0]?.reconcile_stale_assistant_streams ?? { recovered_count: 0, stream_ids: [] };
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }
}
