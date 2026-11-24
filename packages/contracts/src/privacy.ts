import { Type, Static } from '@sinclair/typebox';

export const PurgeModeSchema = Type.Union([
  Type.Literal('history_and_memory'),
  Type.Literal('account_closure')
]);
export type PurgeMode = Static<typeof PurgeModeSchema>;

export const InitiatePurgeInputSchema = Type.Object({
  mode: PurgeModeSchema
});
export type InitiatePurgeInput = Static<typeof InitiatePurgeInputSchema>;

export const PurgeOperationStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('partially_failed'),
  Type.Literal('failed')
]);
export type PurgeOperationStatus = Static<typeof PurgeOperationStatusSchema>;

export const PurgeOperationRecordSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  user_id: Type.String({ format: 'uuid' }),
  generation: Type.Integer({ minimum: 1 }),
  cutoff_at: Type.String(),
  mode: PurgeModeSchema,
  status: PurgeOperationStatusSchema,
  attempts: Type.Integer({ minimum: 0 }),
  created_at: Type.String(),
  updated_at: Type.String()
});
export type PurgeOperationRecord = Static<typeof PurgeOperationRecordSchema>;

export const ExportHistoryResultSchema = Type.Object({
  workspace_id: Type.String({ format: 'uuid' }),
  user_id: Type.String({ format: 'uuid' }),
  exported_at: Type.String(),
  conversations: Type.Array(Type.Any()),
  memories: Type.Array(Type.Any())
});
export type ExportHistoryResult = Static<typeof ExportHistoryResultSchema>;

export const PrivacyPurgeOutboxPayloadSchema = Type.Object({
  operation_id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  user_id: Type.String({ format: 'uuid' }),
  generation: Type.Integer({ minimum: 1 }),
  mode: PurgeModeSchema,
  cutoff_at: Type.String()
}, { additionalProperties: false });
export type PrivacyPurgeOutboxPayload = Static<typeof PrivacyPurgeOutboxPayloadSchema>;

