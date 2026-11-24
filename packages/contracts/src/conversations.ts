import { Type, Static } from '@sinclair/typebox';

export const ConversationStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('archived'),
  Type.Literal('closed'),
  Type.Literal('purged')
]);
export type ConversationStatus = Static<typeof ConversationStatusSchema>;

export const ConversationChannelSchema = Type.Union([
  Type.Literal('web'),
  Type.Literal('api')
]);
export type ConversationChannel = Static<typeof ConversationChannelSchema>;

export const CreateConversationInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 255 }),
  channel: Type.Optional(ConversationChannelSchema),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
});
export type CreateConversationInput = Static<typeof CreateConversationInputSchema>;

export const UpdateConversationStatusInputSchema = Type.Object({
  status: Type.Union([
    Type.Literal('active'),
    Type.Literal('archived'),
    Type.Literal('closed')
  ])
});
export type UpdateConversationStatusInput = Static<typeof UpdateConversationStatusInputSchema>;

export const AppendMessageInputSchema = Type.Object({
  content: Type.String({ minLength: 1, maxLength: 32768 }),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
});
export type AppendMessageInput = Static<typeof AppendMessageInputSchema>;

export const ConversationRecordSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  user_id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  channel: ConversationChannelSchema,
  status: ConversationStatusSchema,
  metadata: Type.Record(Type.String(), Type.Unknown()),
  created_at: Type.String(),
  updated_at: Type.String()
});
export type ConversationRecord = Static<typeof ConversationRecordSchema>;

export const ConversationMessageRecordSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  conversation_id: Type.String({ format: 'uuid' }),
  user_id: Type.String({ format: 'uuid' }),
  sequence_number: Type.Integer({ minimum: 0 }),
  sender_type: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  sender_id: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  assistant_stream_id: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  content: Type.String(),
  token_count: Type.Optional(Type.Integer({ minimum: 0 })),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  created_at: Type.String()
});
export type ConversationMessageRecord = Static<typeof ConversationMessageRecordSchema>;

export const AssistantStreamStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('streaming'),
  Type.Literal('completed'),
  Type.Literal('cancelled'),
  Type.Literal('failed'),
  Type.Literal('not_configured')
]);
export type AssistantStreamStatus = Static<typeof AssistantStreamStatusSchema>;

export const AssistantStreamExecutionRecordSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  conversation_id: Type.String({ format: 'uuid' }),
  user_id: Type.String({ format: 'uuid' }),
  idempotency_key: Type.String(),
  user_message_id: Type.String({ format: 'uuid' }),
  assistant_message_id: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  status: AssistantStreamStatusSchema,
  version: Type.Integer({ minimum: 1 }),
  advisory_token_count: Type.Integer({ minimum: 0 }),
  accumulated_content: Type.String(),
  error_code: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  started_at: Type.String(),
  completed_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  created_at: Type.String(),
  updated_at: Type.String()
});
export type AssistantStreamExecutionRecord = Static<typeof AssistantStreamExecutionRecordSchema>;

export const InitiateAssistantStreamInputSchema = Type.Object({
  content: Type.String({ minLength: 1, maxLength: 32768 }),
  idempotency_key: Type.String({ minLength: 1, maxLength: 255 }),
  attachment_ids: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 5 })),
  voice_mode: Type.Optional(Type.Boolean())
});
export type InitiateAssistantStreamInput = Static<typeof InitiateAssistantStreamInputSchema>;

export const CancelAssistantStreamInputSchema = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 512 })),
  expected_version: Type.Optional(Type.Integer({ minimum: 1 }))
});
export type CancelAssistantStreamInput = Static<typeof CancelAssistantStreamInputSchema>;

export const AssistantStreamEventSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  conversation_id: Type.String({ format: 'uuid' }),
  user_id: Type.String({ format: 'uuid' }),
  stream_id: Type.String({ format: 'uuid' }),
  sequence_number: Type.Integer({ minimum: 0 }),
  event_type: Type.Union([
    Type.Literal('context_ready'),
    Type.Literal('token'),
    Type.Literal('stream_status'),
    Type.Literal('done'),
    Type.Literal('error')
  ]),
  payload: Type.Record(Type.String(), Type.Unknown()),
  created_at: Type.String()
});
export type AssistantStreamEvent = Static<typeof AssistantStreamEventSchema>;
