import { Type, Static } from '@sinclair/typebox';
import { N8nWorkflowBlueprintSchema } from './automation.js';

export const WhatsAppEmptySchema = Type.Object({}, { additionalProperties: false });
export const WhatsAppThreadIdSchema = Type.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' });
export const WhatsAppMessageIdSchema = Type.String({ pattern: '^[a-zA-Z0-9_.-]{1,128}$' });

export const WhatsAppConnectInputSchema = Type.Object(
  {
    phoneNumberId: Type.String({ pattern: '^[0-9]{6,24}$' }),
    businessAccountId: Type.String({ pattern: '^[0-9]{6,24}$' }),
    displayPhoneMasked: Type.Optional(Type.String({ minLength: 4, maxLength: 32 }))
  },
  { additionalProperties: false }
);
export type WhatsAppConnectInput = Static<typeof WhatsAppConnectInputSchema>;

export const WhatsAppStatusSchema = Type.Object(
  {
    connectorName: Type.Literal('whatsapp_business'),
    status: Type.Union([
      Type.Literal('not_configured'),
      Type.Literal('disconnected'),
      Type.Literal('connected'),
      Type.Literal('reconnect_required')
    ]),
    configured: Type.Boolean(),
    connected: Type.Boolean(),
    mode: Type.Union([Type.Literal('disabled'), Type.Literal('mock')]),
    capabilities: Type.Array(Type.String()),
    maskedBusinessPhone: Type.Union([Type.String(), Type.Null()]),
    lastVerifiedAt: Type.Union([Type.String(), Type.Null()])
  },
  { additionalProperties: false }
);
export type WhatsAppStatus = Static<typeof WhatsAppStatusSchema>;

export const WhatsAppContactSummarySchema = Type.Object(
  {
    contactHash: Type.String({ minLength: 8, maxLength: 128 }),
    maskedPhone: Type.String({ minLength: 4, maxLength: 32 }),
    displayName: Type.String({ minLength: 1, maxLength: 128 })
  },
  { additionalProperties: false }
);
export type WhatsAppContactSummary = Static<typeof WhatsAppContactSummarySchema>;

export const WhatsAppMessageSchema = Type.Object(
  {
    id: WhatsAppMessageIdSchema,
    threadId: WhatsAppThreadIdSchema,
    direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound_draft')]),
    sender: WhatsAppContactSummarySchema,
    textPreview: Type.String({ maxLength: 2048 }),
    timestamp: Type.String({ minLength: 10, maxLength: 64 }),
    deliveryStatus: Type.Union([
      Type.Literal('received'),
      Type.Literal('read'),
      Type.Literal('draft_awaiting_approval')
    ]),
    untrusted: Type.Literal(true),
    mode: Type.Literal('mock')
  },
  { additionalProperties: false }
);
export type WhatsAppMessage = Static<typeof WhatsAppMessageSchema>;

export const WhatsAppThreadSummarySchema = Type.Object(
  {
    threadId: WhatsAppThreadIdSchema,
    participant: WhatsAppContactSummarySchema,
    lastMessageAt: Type.String({ minLength: 10, maxLength: 64 }),
    lastMessagePreview: Type.String({ maxLength: 512 }),
    unreadCount: Type.Integer({ minimum: 0, maximum: 1000 }),
    untrusted: Type.Literal(true),
    mode: Type.Literal('mock')
  },
  { additionalProperties: false }
);
export type WhatsAppThreadSummary = Static<typeof WhatsAppThreadSummarySchema>;

export const WhatsAppListMessagesSchema = Type.Object(
  {
    threadId: Type.Optional(WhatsAppThreadIdSchema),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    pageToken: Type.Optional(Type.String({ minLength: 1, maxLength: 512 }))
  },
  { additionalProperties: false }
);
export type WhatsAppListMessages = Static<typeof WhatsAppListMessagesSchema>;

export const WhatsAppListMessagesResponseSchema = Type.Object(
  {
    messages: Type.Array(WhatsAppMessageSchema, { maxItems: 50 }),
    threads: Type.Array(WhatsAppThreadSummarySchema, { maxItems: 50 }),
    nextPageToken: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    untrusted: Type.Literal(true),
    mode: Type.Literal('mock')
  },
  { additionalProperties: false }
);
export type WhatsAppListMessagesResponse = Static<typeof WhatsAppListMessagesResponseSchema>;

export const WhatsAppSendMessageDraftSchema = Type.Object(
  {
    threadId: WhatsAppThreadIdSchema,
    recipientMaskedPhone: Type.String({ minLength: 4, maxLength: 32 }),
    bodyText: Type.String({ minLength: 1, maxLength: 1024 }),
    idempotencyKey: Type.String({ minLength: 8, maxLength: 128 })
  },
  { additionalProperties: false }
);
export type WhatsAppSendMessageDraft = Static<typeof WhatsAppSendMessageDraftSchema>;

export const WhatsAppWebhookEventEnvelopeSchema = Type.Object(
  {
    eventId: Type.String({ pattern: '^[a-zA-Z0-9_.-]{1,128}$' }),
    timestampSeconds: Type.Integer({ minimum: 1 }),
    workspaceId: Type.String({ pattern: '^[0-9a-fA-F-]{36}$' }),
    userId: Type.String({ pattern: '^[0-9a-fA-F-]{36}$' }),
    threadId: WhatsAppThreadIdSchema,
    messageId: WhatsAppMessageIdSchema,
    senderPhone: Type.String({ minLength: 6, maxLength: 32 }),
    senderDisplayName: Type.String({ minLength: 1, maxLength: 128 }),
    text: Type.String({ minLength: 1, maxLength: 2048 })
  },
  { additionalProperties: false }
);
export type WhatsAppWebhookEventEnvelope = Static<typeof WhatsAppWebhookEventEnvelopeSchema>;

export const WhatsAppN8nContextSchema = Type.Object(
  {
    connectorName: Type.Literal('whatsapp_business'),
    mode: Type.Literal('mock'),
    untrusted: Type.Literal(true),
    active: Type.Literal(false),
    threadCount: Type.Integer({ minimum: 0 }),
    messageCount: Type.Integer({ minimum: 0 }),
    messages: Type.Array(WhatsAppMessageSchema, { maxItems: 50 })
  },
  { additionalProperties: false }
);
export type WhatsAppN8nContext = Static<typeof WhatsAppN8nContextSchema>;

export const WhatsAppBriefingQuerySchema = Type.Object(
  {
    threadId: Type.Optional(WhatsAppThreadIdSchema),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    generateWorkflowBlueprint: Type.Optional(Type.Boolean()),
    workflowName: Type.Optional(Type.String({ minLength: 3, maxLength: 120 }))
  },
  { additionalProperties: false }
);
export type WhatsAppBriefingQuery = Static<typeof WhatsAppBriefingQuerySchema>;

export const WhatsAppBriefingThreadSummarySchema = Type.Object(
  {
    threadId: WhatsAppThreadIdSchema,
    participant: WhatsAppContactSummarySchema,
    unreadCount: Type.Integer({ minimum: 0, maximum: 1000 }),
    messageCount: Type.Integer({ minimum: 0, maximum: 50 }),
    lastMessageAt: Type.String({ minLength: 10, maxLength: 64 }),
    summarySnippet: Type.String({ maxLength: 280 }),
    needsAttention: Type.Boolean(),
    attentionReason: Type.Optional(Type.String({ maxLength: 256 })),
    untrusted: Type.Literal(true)
  },
  { additionalProperties: false }
);
export type WhatsAppBriefingThreadSummary = Static<typeof WhatsAppBriefingThreadSummarySchema>;

export const WhatsAppBriefingAttentionItemSchema = Type.Object(
  {
    messageId: WhatsAppMessageIdSchema,
    threadId: WhatsAppThreadIdSchema,
    sender: WhatsAppContactSummarySchema,
    timestamp: Type.String({ minLength: 10, maxLength: 64 }),
    reason: Type.String({ minLength: 1, maxLength: 128 }),
    snippet: Type.String({ maxLength: 280 }),
    untrusted: Type.Literal(true)
  },
  { additionalProperties: false }
);
export type WhatsAppBriefingAttentionItem = Static<typeof WhatsAppBriefingAttentionItemSchema>;

export const WhatsAppBriefingN8nContextSchema = Type.Object(
  {
    connector: Type.Literal('whatsapp_business'),
    operation: Type.Literal('read_conversation_briefing_metadata'),
    readOnly: Type.Literal(true),
    active: Type.Literal(false),
    threadIds: Type.Array(WhatsAppThreadIdSchema, { maxItems: 50 }),
    attentionMessageIds: Type.Array(WhatsAppMessageIdSchema, { maxItems: 50 }),
    unreadTotal: Type.Integer({ minimum: 0, maximum: 1000 })
  },
  { additionalProperties: false }
);
export type WhatsAppBriefingN8nContext = Static<typeof WhatsAppBriefingN8nContextSchema>;

export const WhatsAppBriefingResponseSchema = Type.Object(
  {
    headline: Type.String({ minLength: 1, maxLength: 1024 }),
    totalMessages: Type.Integer({ minimum: 0, maximum: 50 }),
    totalThreads: Type.Integer({ minimum: 0, maximum: 50 }),
    unreadCount: Type.Integer({ minimum: 0, maximum: 1000 }),
    attentionCount: Type.Integer({ minimum: 0, maximum: 50 }),
    conversationSummaries: Type.Array(WhatsAppBriefingThreadSummarySchema, { maxItems: 50 }),
    attentionItems: Type.Array(WhatsAppBriefingAttentionItemSchema, { maxItems: 50 }),
    n8nContext: WhatsAppBriefingN8nContextSchema,
    n8nBlueprint: Type.Optional(N8nWorkflowBlueprintSchema),
    workflowHash: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
    untrusted: Type.Literal(true),
    mode: Type.Literal('mock')
  },
  { additionalProperties: false }
);
export type WhatsAppBriefingResponse = Static<typeof WhatsAppBriefingResponseSchema>;
