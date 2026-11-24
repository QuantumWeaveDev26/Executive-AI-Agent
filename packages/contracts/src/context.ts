import { Type, Static } from '@sinclair/typebox';

export const AssembleContextOptionsSchema = Type.Object({
  conversationId: Type.String({ format: 'uuid' })
});
export type AssembleContextOptions = Static<typeof AssembleContextOptionsSchema>;

export const ContextItemSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  type: Type.Union([Type.Literal('system_default'), Type.Literal('memory'), Type.Literal('message')]),
  category: Type.Optional(Type.String()),
  key: Type.Optional(Type.String()),
  content: Type.String(),
  tokenCount: Type.Integer({ minimum: 0 }),
  sequenceNumber: Type.Optional(Type.Integer({ minimum: 0 }))
});
export type ContextItem = Static<typeof ContextItemSchema>;

export const ContextAssemblyResultSchema = Type.Object({
  workspaceId: Type.String({ format: 'uuid' }),
  userId: Type.String({ format: 'uuid' }),
  conversationId: Type.String({ format: 'uuid' }),
  totalTokens: Type.Integer({ minimum: 0, maximum: 4096 }),
  budget: Type.Object({
    maxTotal: Type.Literal(4096),
    maxSystem: Type.Literal(1024),
    maxMemories: Type.Literal(1024),
    maxHistory: Type.Literal(2048),
    systemTokens: Type.Integer({ minimum: 0 }),
    memoryTokens: Type.Integer({ minimum: 0 }),
    historyTokens: Type.Integer({ minimum: 0 })
  }),
  truncation: Type.Object({
    systemTruncated: Type.Boolean(),
    memoriesTruncated: Type.Boolean(),
    historyTruncated: Type.Boolean()
  }),
  systemDefaults: Type.Array(ContextItemSchema),
  memories: Type.Array(ContextItemSchema),
  conversationHistory: Type.Array(ContextItemSchema)
});
export type ContextAssemblyResult = Static<typeof ContextAssemblyResultSchema>;

export const ContextPreviewResponseSchema = Type.Object({
  token_budget: Type.Object({
    maxTotal: Type.Literal(4096),
    maxSystem: Type.Literal(1024),
    maxMemories: Type.Literal(1024),
    maxHistory: Type.Literal(2048)
  }),
  user_message_count: Type.Integer({ minimum: 0 }),
  assistant_message_count: Type.Integer({ minimum: 0 }),
  memory_count: Type.Integer({ minimum: 0 })
});
export type ContextPreviewResponse = Static<typeof ContextPreviewResponseSchema>;
