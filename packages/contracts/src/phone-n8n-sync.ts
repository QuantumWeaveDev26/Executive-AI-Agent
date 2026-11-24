import { Type, type Static, FormatRegistry } from '@sinclair/typebox';

if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set('date-time', (value) => typeof value === 'string' && !isNaN(Date.parse(value)));
}

const strict = { additionalProperties: false } as const;

export const PHONE_RECORDING_PLAYBACK_ACTION = 'phone.recordings.read' as const;

export const PhoneRecordingPlaybackInputSchema = Type.Object({
  direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]),
  callId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' })
}, strict);
export type PhoneRecordingPlaybackInput = Static<typeof PhoneRecordingPlaybackInputSchema>;

export const PhoneSyncedTranscriptTurnSchema = Type.Object({
  speaker: Type.Union([Type.Literal('thaara'), Type.Literal('customer')]),
  text: Type.String({ minLength: 1, maxLength: 2000 }),
  languageName: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()]))
}, strict);
export type PhoneSyncedTranscriptTurn = Static<typeof PhoneSyncedTranscriptTurnSchema>;

export const PhoneSyncedCallDetailsSchema = Type.Object({
  interactionId: Type.Union([
    Type.String({ minLength: 1, maxLength: 256 }),
    Type.Null()
  ]),
  attemptId: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Null()])),
  recordingAvailable: Type.Boolean(),
  durationSeconds: Type.Union([Type.Number({ minimum: 0, maximum: 86400 }), Type.Null()]),
  occurredAt: Type.String({ format: 'date-time' }),
  customerName: Type.Union([Type.String({ maxLength: 240 }), Type.Null()]),
  phoneNumber: Type.Union([Type.String({ maxLength: 32 }), Type.Null()]),
  business: Type.Union([Type.String({ maxLength: 400 }), Type.Null()]),
  serviceNeeded: Type.Union([Type.String({ maxLength: 400 }), Type.Null()]),
  requirements: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
  summary: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
  preferredCallbackTime: Type.Optional(Type.Union([Type.String({ maxLength: 400 }), Type.Null()])),
  outcomeLabel: Type.String({ minLength: 1, maxLength: 128 }),
  callbackStatus: Type.Union([
    Type.Literal('confirmed'),
    Type.Literal('needs_review'),
    Type.Literal('declined'),
    Type.Literal('none')
  ]),
  transcript: Type.Array(PhoneSyncedTranscriptTurnSchema, { maxItems: 200 })
}, strict);
export type PhoneSyncedCallDetails = Static<typeof PhoneSyncedCallDetailsSchema>;

export const PhoneN8nSarvamMessageInputSchema = Type.Object({
  role: Type.String({ minLength: 1, maxLength: 32 }),
  content: Type.String({ maxLength: 4000 }),
  english_content: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
  language_name: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  turn_id: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Number(), Type.Null()]))
}, strict);
export type PhoneN8nSarvamMessageInput = Static<typeof PhoneN8nSarvamMessageInputSchema>;

export const PhoneN8nSyncedCallInputSchema = Type.Object({
  attemptId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' }),
  interactionId: Type.Optional(Type.Union([
    Type.String({ minLength: 1, maxLength: 220, pattern: '^([A-Za-z0-9_.:-]{1,128}|[0-9]{8}/[A-Za-z0-9][A-Za-z0-9_.:-]{0,199})$' }),
    Type.Null()
  ])),
  direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]),
  connectivityStatus: Type.Union([
    Type.Literal('connected'),
    Type.Literal('no_answer'),
    Type.Literal('busy'),
    Type.Literal('failed'),
    Type.Literal('unknown')
  ]),
  failureReason: Type.Optional(Type.Union([Type.String({ maxLength: 400 }), Type.Null()])),
  endedBy: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  durationSeconds: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 86400 }), Type.Null()])),
  startDatetime: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  endDatetime: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  attemptedAt: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  userContact: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  userContactMasked: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  recordingAvailable: Type.Boolean(),
  appVersion: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 10000 }), Type.String({ maxLength: 32 }), Type.Null()])),
  languageName: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  agentVariables: Type.Optional(Type.Union([
    Type.Object({
      user_name: Type.Optional(Type.Union([Type.String({ maxLength: 240 }), Type.Null()])),
      call_purpose: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
      call_summary: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
      business_name: Type.Optional(Type.Union([Type.String({ maxLength: 400 }), Type.Null()])),
      service_needed: Type.Optional(Type.Union([Type.String({ maxLength: 400 }), Type.Null()])),
      preferred_callback_time: Type.Optional(Type.Union([Type.String({ maxLength: 400 }), Type.Null()]))
    }, strict),
    Type.Null()
  ])),
  messages: Type.Optional(Type.Array(PhoneN8nSarvamMessageInputSchema, { maxItems: 200 }))
}, strict);
export type PhoneN8nSyncedCallInput = Static<typeof PhoneN8nSyncedCallInputSchema>;

export const PhoneN8nSyncCheckpointResponseSchema = Type.Object({
  status: Type.Literal('ready'),
  cursorStartDatetime: Type.String({ format: 'date-time' }),
  backfillCompleted: Type.Boolean(),
  overlapMinutes: Type.Integer({ minimum: 1, maximum: 120 }),
  callbackCutoffDatetime: Type.String({ format: 'date-time' })
}, strict);
export type PhoneN8nSyncCheckpointResponse = Static<typeof PhoneN8nSyncCheckpointResponseSchema>;

export const PhoneN8nCallSyncBatchRequestSchema = Type.Object({
  calls: Type.Array(PhoneN8nSyncedCallInputSchema, { maxItems: 100 }),
  advanceCursorTo: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  markBackfillCompleted: Type.Optional(Type.Boolean())
}, strict);
export type PhoneN8nCallSyncBatchRequest = Static<typeof PhoneN8nCallSyncBatchRequestSchema>;

export const PhoneN8nCallSyncBatchResponseSchema = Type.Object({
  status: Type.Literal('synced'),
  received: Type.Integer({ minimum: 0 }),
  created: Type.Integer({ minimum: 0 }),
  updated: Type.Integer({ minimum: 0 }),
  unchanged: Type.Integer({ minimum: 0 }),
  inboundCount: Type.Integer({ minimum: 0 }),
  outboundCount: Type.Integer({ minimum: 0 }),
  cursorStartDatetime: Type.String({ format: 'date-time' })
}, strict);
export type PhoneN8nCallSyncBatchResponse = Static<typeof PhoneN8nCallSyncBatchResponseSchema>;

export const PhoneN8nCallbackEvaluateClaimRequestSchema = Type.Object({
  call: PhoneN8nSyncedCallInputSchema,
  allowHistoricalReplay: Type.Optional(Type.Boolean())
}, strict);
export type PhoneN8nCallbackEvaluateClaimRequest = Static<typeof PhoneN8nCallbackEvaluateClaimRequestSchema>;

export const PhoneN8nCallbackEmailPayloadSchema = Type.Object({
  fromEmail: Type.Union([
    Type.Literal('Thaara AI Notifications <team.quantumweaveai@gmail.com>'),
    Type.Literal('Thaara AI <notifications@brandmintai.io>')
  ]),
  toEmail: Type.Literal('connect@brandmintai.io'),
  subject: Type.String({ minLength: 1, maxLength: 240 }),
  textBody: Type.String({ minLength: 1, maxLength: 8000 }),
  htmlBody: Type.String({ minLength: 1, maxLength: 16000 }),
  fields: Type.Object({
    customerName: Type.Union([Type.String({ maxLength: 240 }), Type.Null()]),
    phoneNumber: Type.String({ minLength: 8, maxLength: 32 }),
    businessName: Type.Union([Type.String({ maxLength: 400 }), Type.Null()]),
    requiredService: Type.Union([Type.String({ maxLength: 400 }), Type.Null()]),
    customerRequirement: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    preferredCallbackTime: Type.Union([Type.String({ maxLength: 400 }), Type.Null()]),
    callDateTimeIst: Type.String({ minLength: 1, maxLength: 128 }),
    callId: Type.String({ minLength: 1, maxLength: 220 }),
    conversationSummary: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    callbackStatus: Type.Literal('Confirmed'),
    callStatus: Type.String({ minLength: 1, maxLength: 64 })
  }, strict)
}, strict);
export type PhoneN8nCallbackEmailPayload = Static<typeof PhoneN8nCallbackEmailPayloadSchema>;

export const PhoneN8nCallbackEvaluateClaimResponseSchema = Type.Object({
  sendAllowed: Type.Boolean(),
  eligibility: Type.Union([
    Type.Literal('confirmed'),
    Type.Literal('needs_review'),
    Type.Literal('declined'),
    Type.Literal('not_requested'),
    Type.Literal('historical_skipped'),
    Type.Literal('already_sent'),
    Type.Literal('already_claimed')
  ]),
  reason: Type.String({ minLength: 1, maxLength: 240 }),
  callId: Type.String({ minLength: 1, maxLength: 128 }),
  callbackRequestId: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
  claimAttemptId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  email: Type.Union([PhoneN8nCallbackEmailPayloadSchema, Type.Null()])
}, strict);
export type PhoneN8nCallbackEvaluateClaimResponse = Static<typeof PhoneN8nCallbackEvaluateClaimResponseSchema>;

export const PhoneN8nCallbackReceiptRequestSchema = Type.Object({
  callId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
  claimAttemptId: Type.String({ format: 'uuid' }),
  outcome: Type.Union([
    Type.Literal('submitted'),
    Type.Literal('failed'),
    Type.Literal('pending')
  ]),
  providerMessageId: Type.Optional(Type.Union([Type.String({ maxLength: 256 }), Type.Null()])),
  errorSummary: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()]))
}, strict);
export type PhoneN8nCallbackReceiptRequest = Static<typeof PhoneN8nCallbackReceiptRequestSchema>;

export const PhoneN8nCallbackReceiptResponseSchema = Type.Object({
  recorded: Type.Boolean(),
  status: Type.Union([
    Type.Literal('submitted'),
    Type.Literal('failed'),
    Type.Literal('pending'),
    Type.Literal('duplicate')
  ]),
  sanitizedProviderMessageId: Type.Union([Type.String({ maxLength: 128 }), Type.Null()])
}, strict);
export type PhoneN8nCallbackReceiptResponse = Static<typeof PhoneN8nCallbackReceiptResponseSchema>;

const nullableText = (max = 2000) => Type.Union([Type.String({ maxLength: max }), Type.Null()]);

export const PhoneInboundHistoryCallStatusSchema = Type.Union([
  Type.Literal('ended'),
  Type.Literal('interrupted'),
  Type.Literal('failed'),
  Type.Literal('no_answer'),
  Type.Literal('busy'),
  Type.Literal('unknown')
]);

export const PhoneInboundHistorySummarySchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
  occurredAt: Type.String({ format: 'date-time' }),
  maskedPhone: Type.String({ maxLength: 32 }),
  outcome: Type.Union([
    Type.Literal('enquired'),
    Type.Literal('callback_requested'),
    Type.Literal('booked_appointment'),
    Type.Literal('needs_review')
  ]),
  providerVerified: Type.Literal(false),
  customerName: Type.Optional(nullableText(2000)),
  preferredContactTime: Type.Optional(nullableText(2000)),
  direction: Type.Optional(Type.Literal('inbound')),
  durationSeconds: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 86400 }), Type.Null()])),
  callStatus: Type.Optional(PhoneInboundHistoryCallStatusSchema),
  enquirySummary: Type.Optional(nullableText(2000)),
  recordingAvailable: Type.Optional(Type.Boolean()),
  transcriptAvailable: Type.Optional(Type.Boolean())
}, strict);
export type PhoneInboundHistorySummary = Static<typeof PhoneInboundHistorySummarySchema>;

export const PhoneInboundHistoryDetailRecordSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
  occurredAt: Type.String({ format: 'date-time' }),
  maskedPhone: Type.String({ maxLength: 32 }),
  callerPhone: Type.Union([Type.String({ pattern: '^\\+[1-9][0-9]{7,14}$' }), Type.Null()]),
  customerName: nullableText(2000),
  business: nullableText(2000),
  serviceNeeded: nullableText(2000),
  enquirySummary: nullableText(2000),
  outcome: Type.Union([
    Type.Literal('enquired'),
    Type.Literal('callback_requested'),
    Type.Literal('booked_appointment'),
    Type.Literal('needs_review')
  ]),
  callbackRequestId: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
  providerVerified: Type.Literal(false),
  providerInteractionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  timestampSource: Type.Optional(Type.Union([
    Type.Literal('provider_started'),
    Type.Literal('provider_ended'),
    Type.Literal('received_at')
  ])),
  durationSeconds: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 86400 }), Type.Null()])),
  callStatus: Type.Optional(PhoneInboundHistoryCallStatusSchema),
  preferredContactTime: Type.Optional(nullableText(2000)),
  callbackConsent: Type.Optional(Type.Union([
    Type.Literal('confirmed'),
    Type.Literal('declined'),
    Type.Literal('unknown')
  ])),
  callbackPreference: Type.Optional(Type.Union([
    Type.Literal('requested'),
    Type.Literal('declined'),
    Type.Literal('unknown')
  ])),
  appointment: Type.Optional(Type.Union([
    Type.Object({
      eventId: Type.String({ minLength: 1, maxLength: 256 }),
      startsAt: Type.String({ format: 'date-time' }),
      endsAt: Type.String({ format: 'date-time' }),
      timezone: Type.String({ maxLength: 64 }),
      verification: Type.Literal('verified')
    }, strict),
    Type.Null()
  ])),
  transcript: Type.Optional(Type.Array(Type.Object({
    speaker: Type.Union([Type.Literal('agent'), Type.Literal('caller')]),
    text: Type.String({ maxLength: 2000 }),
    languageBasis: Type.Union([Type.Literal('provider_original'), Type.Literal('provider_english')])
  }, strict), { maxItems: 200 })),
  transcriptExpiresAt: Type.Optional(Type.String({ format: 'date-time' })),
  recordingReference: Type.Optional(Type.Union([
    Type.Object({
      interactionId: Type.String({ maxLength: 256 }),
      expiresAt: Type.String({ format: 'date-time' }),
      noticeConfirmed: Type.Literal(true)
    }, strict),
    Type.Null()
  ])),
  recordingAvailable: Type.Optional(Type.Boolean()),
  callbackNotificationStatus: Type.Optional(Type.Union([
    Type.Literal('pending'),
    Type.Literal('sending'),
    Type.Literal('submitted'),
    Type.Literal('failed'),
    Type.Literal('unverified'),
    Type.Literal('needs_review'),
    Type.Null()
  ]))
}, strict);
export type PhoneInboundHistoryDetailRecord = Static<typeof PhoneInboundHistoryDetailRecordSchema>;

export const PhoneInboundHistoryListSchema = Type.Object({
  status: Type.Union([Type.Literal('ready'), Type.Literal('not_configured')]),
  reports: Type.Array(PhoneInboundHistorySummarySchema, { maxItems: 100 })
}, strict);

export const PhoneInboundHistoryDetailSchema = Type.Object({
  status: Type.Union([Type.Literal('ready'), Type.Literal('not_configured'), Type.Literal('not_found')]),
  report: Type.Union([PhoneInboundHistoryDetailRecordSchema, Type.Null()])
}, strict);
