import { Type, Static } from '@sinclair/typebox';
import { N8nWorkflowBlueprintSchema } from './automation.js';

export const PhoneEmptySchema = Type.Object({}, { additionalProperties: false });
export const PhoneCallIdSchema = Type.String({ pattern: '^[a-zA-Z0-9_.-]{1,128}$' });

export const PhoneCallLifecycleStateSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('ringing'),
  Type.Literal('answered'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled')
]);
export type PhoneCallLifecycleState = Static<typeof PhoneCallLifecycleStateSchema>;

export const PhoneConnectInputSchema = Type.Object(
  {
    lineId: Type.String({ pattern: '^[a-zA-Z0-9_-]{4,32}$' }),
    accountId: Type.String({ pattern: '^[a-zA-Z0-9_-]{4,32}$' }),
    displayLineMasked: Type.Optional(Type.String({ minLength: 4, maxLength: 32 }))
  },
  { additionalProperties: false }
);
export type PhoneConnectInput = Static<typeof PhoneConnectInputSchema>;

export const PhoneStatusSchema = Type.Object(
  {
    connectorName: Type.Literal('phone_telephony'),
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
    maskedLineNumber: Type.Union([Type.String(), Type.Null()]),
    recordingEnabled: Type.Literal(false),
    transcriptionEnabled: Type.Literal(false),
    lastVerifiedAt: Type.Union([Type.String(), Type.Null()])
  },
  { additionalProperties: false }
);
export type PhoneStatus = Static<typeof PhoneStatusSchema>;

export const PhoneParticipantSummarySchema = Type.Object(
  {
    contactHash: Type.String({ minLength: 8, maxLength: 128 }),
    maskedPhone: Type.String({ minLength: 4, maxLength: 32 }),
    displayName: Type.String({ minLength: 1, maxLength: 128 })
  },
  { additionalProperties: false }
);
export type PhoneParticipantSummary = Static<typeof PhoneParticipantSummarySchema>;

export const PhoneCallRecordSchema = Type.Object(
  {
    id: PhoneCallIdSchema,
    direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound_simulated')]),
    lifecycleState: PhoneCallLifecycleStateSchema,
    participant: PhoneParticipantSummarySchema,
    purposeSummary: Type.String({ maxLength: 512 }),
    startedAt: Type.String({ minLength: 10, maxLength: 64 }),
    endedAt: Type.Union([Type.String({ minLength: 10, maxLength: 64 }), Type.Null()]),
    durationSeconds: Type.Union([Type.Integer({ minimum: 0, maximum: 86400 }), Type.Null()]),
    recordingEnabled: Type.Literal(false),
    transcriptionEnabled: Type.Literal(false),
    consentVerified: Type.Boolean(),
    approvalId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    receiptStatus: Type.Union([
      Type.Literal('verified_mock'),
      Type.Literal('awaiting_approval'),
      Type.Literal('failed'),
      Type.Literal('cancelled')
    ]),
    untrusted: Type.Literal(true),
    mode: Type.Literal('mock')
  },
  { additionalProperties: false }
);
export type PhoneCallRecord = Static<typeof PhoneCallRecordSchema>;

export const PhoneListCallsSchema = Type.Object(
  {
    direction: Type.Optional(
      Type.Union([Type.Literal('inbound'), Type.Literal('outbound_simulated')])
    ),
    lifecycleState: Type.Optional(PhoneCallLifecycleStateSchema),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    pageToken: Type.Optional(Type.String({ minLength: 1, maxLength: 512 }))
  },
  { additionalProperties: false }
);
export type PhoneListCalls = Static<typeof PhoneListCallsSchema>;

export const PhoneListCallsResponseSchema = Type.Object(
  {
    calls: Type.Array(PhoneCallRecordSchema, { maxItems: 50 }),
    totalCount: Type.Integer({ minimum: 0, maximum: 500 }),
    nextPageToken: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    recordingEnabled: Type.Literal(false),
    transcriptionEnabled: Type.Literal(false),
    untrusted: Type.Literal(true),
    mode: Type.Literal('mock')
  },
  { additionalProperties: false }
);
export type PhoneListCallsResponse = Static<typeof PhoneListCallsResponseSchema>;

export const PhoneOutboundCallRequestSchema = Type.Object(
  {
    recipientMaskedPhone: Type.String({ minLength: 4, maxLength: 32 }),
    recipientDisplayName: Type.String({ minLength: 1, maxLength: 128 }),
    purposeSummary: Type.String({ minLength: 1, maxLength: 512 }),
    explicitConsentGranted: Type.Boolean(),
    recordingRequested: Type.Optional(Type.Boolean()),
    transcriptionRequested: Type.Optional(Type.Boolean()),
    idempotencyKey: Type.String({ minLength: 8, maxLength: 128 })
  },
  { additionalProperties: false }
);
export type PhoneOutboundCallRequest = Static<typeof PhoneOutboundCallRequestSchema>;

export const PhoneWebhookEventEnvelopeSchema = Type.Object(
  {
    eventId: Type.String({ pattern: '^[a-zA-Z0-9_.-]{1,128}$' }),
    timestampSeconds: Type.Integer({ minimum: 1 }),
    workspaceId: Type.String({ pattern: '^[0-9a-fA-F-]{36}$' }),
    userId: Type.String({ pattern: '^[0-9a-fA-F-]{36}$' }),
    callId: PhoneCallIdSchema,
    direction: Type.Optional(
      Type.Union([Type.Literal('inbound'), Type.Literal('outbound_simulated')])
    ),
    lifecycleState: PhoneCallLifecycleStateSchema,
    callerPhone: Type.String({ minLength: 6, maxLength: 32 }),
    callerDisplayName: Type.String({ minLength: 1, maxLength: 128 }),
    purposeSummary: Type.String({ minLength: 1, maxLength: 512 }),
    durationSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 86400 }))
  },
  { additionalProperties: false }
);
export type PhoneWebhookEventEnvelope = Static<typeof PhoneWebhookEventEnvelopeSchema>;

export const PhoneN8nContextSchema = Type.Object(
  {
    connectorName: Type.Literal('phone_telephony'),
    mode: Type.Literal('mock'),
    untrusted: Type.Literal(true),
    active: Type.Literal(false),
    recordingEnabled: Type.Literal(false),
    transcriptionEnabled: Type.Literal(false),
    callCount: Type.Integer({ minimum: 0 }),
    calls: Type.Array(PhoneCallRecordSchema, { maxItems: 50 })
  },
  { additionalProperties: false }
);
export type PhoneN8nContext = Static<typeof PhoneN8nContextSchema>;

export const PhoneBriefingQuerySchema = Type.Object(
  {
    direction: Type.Optional(
      Type.Union([Type.Literal('inbound'), Type.Literal('outbound_simulated')])
    ),
    lifecycleState: Type.Optional(PhoneCallLifecycleStateSchema),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    generateWorkflowBlueprint: Type.Optional(Type.Boolean()),
    workflowName: Type.Optional(Type.String({ minLength: 3, maxLength: 120 }))
  },
  { additionalProperties: false }
);
export type PhoneBriefingQuery = Static<typeof PhoneBriefingQuerySchema>;

export const PhoneBriefingActivityItemSchema = Type.Object(
  {
    callId: PhoneCallIdSchema,
    direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound_simulated')]),
    lifecycleState: PhoneCallLifecycleStateSchema,
    participant: PhoneParticipantSummarySchema,
    startedAt: Type.String({ minLength: 10, maxLength: 64 }),
    durationSeconds: Type.Union([Type.Integer({ minimum: 0, maximum: 86400 }), Type.Null()]),
    summarySnippet: Type.String({ maxLength: 280 }),
    needsFollowUp: Type.Boolean(),
    untrusted: Type.Literal(true)
  },
  { additionalProperties: false }
);
export type PhoneBriefingActivityItem = Static<typeof PhoneBriefingActivityItemSchema>;

export const PhoneBriefingFollowUpItemSchema = Type.Object(
  {
    callId: PhoneCallIdSchema,
    direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound_simulated')]),
    lifecycleState: PhoneCallLifecycleStateSchema,
    participant: PhoneParticipantSummarySchema,
    startedAt: Type.String({ minLength: 10, maxLength: 64 }),
    reason: Type.String({ minLength: 1, maxLength: 128 }),
    snippet: Type.String({ maxLength: 280 }),
    untrusted: Type.Literal(true)
  },
  { additionalProperties: false }
);
export type PhoneBriefingFollowUpItem = Static<typeof PhoneBriefingFollowUpItemSchema>;

export const PhoneBriefingN8nContextSchema = Type.Object(
  {
    connector: Type.Literal('phone_telephony'),
    operation: Type.Literal('read_call_history_briefing_metadata'),
    readOnly: Type.Literal(true),
    active: Type.Literal(false),
    recordingEnabled: Type.Literal(false),
    transcriptionEnabled: Type.Literal(false),
    callIds: Type.Array(PhoneCallIdSchema, { maxItems: 50 }),
    missedOrFailedCallIds: Type.Array(PhoneCallIdSchema, { maxItems: 50 }),
    followUpCallIds: Type.Array(PhoneCallIdSchema, { maxItems: 50 }),
    totalCalls: Type.Integer({ minimum: 0, maximum: 50 }),
    inboundCount: Type.Integer({ minimum: 0, maximum: 50 }),
    outboundSimulatedCount: Type.Integer({ minimum: 0, maximum: 50 }),
    missedOrFailedCount: Type.Integer({ minimum: 0, maximum: 50 })
  },
  { additionalProperties: false }
);
export type PhoneBriefingN8nContext = Static<typeof PhoneBriefingN8nContextSchema>;

export const PhoneBriefingResponseSchema = Type.Object(
  {
    headline: Type.String({ minLength: 1, maxLength: 1024 }),
    totalCalls: Type.Integer({ minimum: 0, maximum: 50 }),
    inboundCount: Type.Integer({ minimum: 0, maximum: 50 }),
    outboundSimulatedCount: Type.Integer({ minimum: 0, maximum: 50 }),
    missedOrFailedCount: Type.Integer({ minimum: 0, maximum: 50 }),
    followUpCount: Type.Integer({ minimum: 0, maximum: 50 }),
    missedOrFailedCalls: Type.Array(PhoneBriefingActivityItemSchema, { maxItems: 50 }),
    recentCalls: Type.Array(PhoneBriefingActivityItemSchema, { maxItems: 50 }),
    followUpItems: Type.Array(PhoneBriefingFollowUpItemSchema, { maxItems: 50 }),
    n8nContext: PhoneBriefingN8nContextSchema,
    n8nBlueprint: Type.Optional(N8nWorkflowBlueprintSchema),
    workflowHash: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
    recordingEnabled: Type.Literal(false),
    transcriptionEnabled: Type.Literal(false),
    untrusted: Type.Literal(true),
    mode: Type.Literal('mock')
  },
  { additionalProperties: false }
);
export type PhoneBriefingResponse = Static<typeof PhoneBriefingResponseSchema>;
