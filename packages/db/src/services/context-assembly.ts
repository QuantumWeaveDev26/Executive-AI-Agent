import { encode, decode } from 'gpt-tokenizer';
import {
  AssembleContextOptions,
  ContextAssemblyResult,
  ContextItem
} from '@thaara/contracts';
import { AuthenticatedScope, DbClient, TransactionalDbClient } from '../client.js';
import { ConversationRepository } from '../repositories/conversations.js';
import { ConversationMessageRepository } from '../repositories/conversation-messages.js';
import { MemoryItemRepository } from '../repositories/memory-items.js';
import { NotFoundError, sanitizeDatabaseError } from '../errors.js';

export class ContextAssemblyService {
  private dbClient: DbClient | TransactionalDbClient;

  constructor(
    public readonly memoryRepo: MemoryItemRepository,
    public readonly messageRepo: ConversationMessageRepository,
    public readonly conversationRepo: ConversationRepository,
    db?: DbClient | TransactionalDbClient
  ) {
    this.dbClient = db || (memoryRepo as any).db;
  }

  async assembleContext(
    scope: AuthenticatedScope,
    options: AssembleContextOptions
  ): Promise<ContextAssemblyResult> {
    try {
      // 1. Verify parent conversation exists and belongs to authenticated scope
      const conv = await this.conversationRepo.findById(scope, options.conversationId);
      if (!conv) {
        throw new NotFoundError('Conversation not found or unauthorized');
      }

      const MAX_TOTAL = 4096;
      const MAX_SYSTEM = 1024;
      const MAX_MEMORIES = 1024;
      const MAX_HISTORY = 2048;

      let systemRows: { id: string; category: string; key: string; value: string }[] = [];
      let memoryRows: {
        id: string;
        category: string;
        key: string;
        value: string;
        confidence: number;
        updated_at: string;
      }[] = [];

      const runScoped = async (client: DbClient) => {
        // 2. Query System Defaults (provenance = 'system_default', active, consented, not expired)
        // Ordered by category ASC, key ASC, id ASC
        const sysRes = await client.query<{
          id: string;
          category: string;
          key: string;
          value: string;
        }>(
          `SELECT id, category, key, value
           FROM public.memory_items
           WHERE workspace_id = $1
             AND lifecycle_status = 'active'
             AND consent_status = 'consented'
             AND (expires_at IS NULL OR expires_at > pg_catalog.now())
             AND provenance = 'system_default'
           ORDER BY category ASC, key ASC, id ASC;`,
          [scope.workspaceId]
        );
        systemRows = sysRes.rows;

        // 3. Query Memories (provenance <> 'system_default', active, consented, not expired)
        // Strictly disjoint from system defaults
        // Enforces active user privacy cutoff for user-scoped memories; workspace memory is immune
        // Ordered by confidence DESC, updated_at DESC, id ASC
        const memRes = await client.query<{
          id: string;
          category: string;
          key: string;
          value: string;
          confidence: number;
          updated_at: string;
        }>(
          `SELECT id, category, key, value, confidence, updated_at
           FROM public.memory_items
           WHERE workspace_id = $1
             AND lifecycle_status = 'active'
             AND consent_status = 'consented'
             AND (expires_at IS NULL OR expires_at > pg_catalog.now())
             AND provenance <> 'system_default'
             AND (
               (scope = 'user' AND user_id = $2 AND created_at > COALESCE(
                 (SELECT MAX(cutoff_at) FROM public.user_purge_cutoffs WHERE workspace_id = $1 AND user_id = $2),
                 '-infinity'::timestamptz
               ))
               OR (scope = 'workspace')
             )
           ORDER BY confidence DESC, updated_at DESC, id ASC;`,
          [scope.workspaceId, scope.userId]
        );
        memoryRows = memRes.rows;
      };

      if (
        this.dbClient &&
        'withScopedTransaction' in this.dbClient &&
        typeof (this.dbClient as TransactionalDbClient).withScopedTransaction === 'function'
      ) {
        await (this.dbClient as TransactionalDbClient).withScopedTransaction(scope, runScoped);
      } else if (this.dbClient) {
        await runScoped(this.dbClient);
      }

      // 4. Query Conversation Messages via messageRepo (enforcing privacy cutoff and user_id = $3)
      const messages = await this.messageRepo.listByConversation(
        scope,
        options.conversationId,
        { limit: 200, offset: 0 }
      );

      // Assemble System Defaults segment (max 1024 tokens)
      const systemDefaults: ContextItem[] = [];
      let systemTokens = 0;
      let systemTruncated = false;

      for (const item of systemRows) {
        const tokens = encode(item.value).length;
        if (systemTokens + tokens <= MAX_SYSTEM) {
          systemDefaults.push({
            id: item.id,
            type: 'system_default',
            category: item.category,
            key: item.key,
            content: item.value,
            tokenCount: tokens
          });
          systemTokens += tokens;
        } else {
          systemTruncated = true;
        }
      }

      // Assemble Memories segment (max 1024 tokens)
      const memories: ContextItem[] = [];
      let memoryTokens = 0;
      let memoriesTruncated = false;

      for (const item of memoryRows) {
        const tokens = encode(item.value).length;
        if (memoryTokens + tokens <= MAX_MEMORIES) {
          memories.push({
            id: item.id,
            type: 'memory',
            category: item.category,
            key: item.key,
            content: item.value,
            tokenCount: tokens
          });
          memoryTokens += tokens;
        } else {
          memoriesTruncated = true;
        }
      }

      // Assemble Conversation History segment (max 2048 tokens)
      // Reverse-chronological greedy fit, restored to chronological sequence_number ASC
      const conversationHistory: ContextItem[] = [];
      let historyTokens = 0;
      let historyTruncated = false;

      if (messages.length > 0) {
        const latestMsg = messages[messages.length - 1]!;
        const latestTokens = encode(latestMsg.content);

        if (latestTokens.length > MAX_HISTORY) {
          // Deterministically slice latest message at 2048 tokens
          const slicedContent = decode(latestTokens.slice(0, MAX_HISTORY));
          conversationHistory.push({
            id: latestMsg.id,
            type: 'message',
            content: slicedContent,
            sequenceNumber: latestMsg.sequence_number,
            tokenCount: MAX_HISTORY
          });
          historyTokens = MAX_HISTORY;
          historyTruncated = true;
        } else {
          const fitted: ContextItem[] = [];
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]!;
            const tCount = encode(msg.content).length;
            if (historyTokens + tCount <= MAX_HISTORY) {
              fitted.push({
                id: msg.id,
                type: 'message',
                content: msg.content,
                sequenceNumber: msg.sequence_number,
                tokenCount: tCount
              });
              historyTokens += tCount;
            } else {
              historyTruncated = true;
            }
          }
          fitted.reverse();
          conversationHistory.push(...fitted);
        }
      }

      const totalTokens = systemTokens + memoryTokens + historyTokens;

      return {
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        conversationId: options.conversationId,
        totalTokens,
        budget: {
          maxTotal: MAX_TOTAL,
          maxSystem: MAX_SYSTEM,
          maxMemories: MAX_MEMORIES,
          maxHistory: MAX_HISTORY,
          systemTokens,
          memoryTokens,
          historyTokens
        },
        truncation: {
          systemTruncated,
          memoriesTruncated,
          historyTruncated
        },
        systemDefaults,
        memories,
        conversationHistory
      };
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }
}
