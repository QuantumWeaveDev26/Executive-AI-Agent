import { Type, Static } from '@sinclair/typebox';

export const MemoryCategorySchema = Type.Union([
  Type.Literal('preference'),
  Type.Literal('fact'),
  Type.Literal('guideline'),
  Type.Literal('decision')
]);
export type MemoryCategory = Static<typeof MemoryCategorySchema>;

export const MemoryScopeSchema = Type.Union([
  Type.Literal('user'),
  Type.Literal('workspace')
]);
export type MemoryScope = Static<typeof MemoryScopeSchema>;

export const ConsentStatusSchema = Type.Union([
  Type.Literal('pending_consent'),
  Type.Literal('consented'),
  Type.Literal('revoked')
]);
export type ConsentStatus = Static<typeof ConsentStatusSchema>;

export const MemoryProvenanceSchema = Type.Union([
  Type.Literal('explicit_user_input'),
  Type.Literal('conversation_message'),
  Type.Literal('system_default')
]);
export type MemoryProvenance = Static<typeof MemoryProvenanceSchema>;

export const MemoryLifecycleStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('superseded'),
  Type.Literal('archived'),
  Type.Literal('deleted'),
  Type.Literal('expired')
]);
export type MemoryLifecycleStatus = Static<typeof MemoryLifecycleStatusSchema>;

export const CreateMemoryInputSchema = Type.Object({
  scope: MemoryScopeSchema,
  category: MemoryCategorySchema,
  key: Type.String({ minLength: 1, maxLength: 255 }),
  value: Type.String({ minLength: 1, maxLength: 16384 }),
  confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  provenance: Type.Union([Type.Literal('explicit_user_input'), Type.Literal('conversation_message')]),
  provenanceConversationId: Type.Optional(Type.String({ format: 'uuid' })),
  provenanceMessageId: Type.Optional(Type.String({ format: 'uuid' })),
  expiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()]))
});
export type CreateMemoryInput = Static<typeof CreateMemoryInputSchema>;

// Note: expiresAt is strictly omitted. Successor inherits predecessor expires_at in DB procedure.
export const SupersedeMemoryInputSchema = Type.Object({
  value: Type.String({ minLength: 1, maxLength: 16384 }),
  confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  provenance: Type.Optional(Type.Union([Type.Literal('explicit_user_input'), Type.Literal('conversation_message')])),
  provenanceConversationId: Type.Optional(Type.String({ format: 'uuid' })),
  provenanceMessageId: Type.Optional(Type.String({ format: 'uuid' }))
});
export type SupersedeMemoryInput = Static<typeof SupersedeMemoryInputSchema>;

export const MemoryItemRecordSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  scope: MemoryScopeSchema,
  user_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  category: MemoryCategorySchema,
  key: Type.String(),
  value: Type.String(),
  confidence: Type.Number(),
  consent_status: ConsentStatusSchema,
  provenance: MemoryProvenanceSchema,
  provenance_conversation_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  provenance_message_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  provenance_user_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  lifecycle_status: MemoryLifecycleStatusSchema,
  version: Type.Integer({ minimum: 1 }),
  superseded_by_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  expires_at: Type.Union([Type.String(), Type.Null()]),
  consented_at: Type.Union([Type.String(), Type.Null()]),
  consent_actor_user_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  revoked_at: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String()
});
export type MemoryItemRecord = Static<typeof MemoryItemRecordSchema>;
