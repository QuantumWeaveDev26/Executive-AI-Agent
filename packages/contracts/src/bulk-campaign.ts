import { Static, Type } from '@sinclair/typebox';
import {
  PhoneCallingDraftSchema,
  PhoneCallingLanguageSchema,
  PhoneCallingStateSchema
} from './phone-calling.js';

export const BULK_CAMPAIGN_EXECUTE_ACTION = 'campaign.bulk.execute' as const;

export const BulkCampaignSourceTypeSchema = Type.Union([
  Type.Literal('paste'),
  Type.Literal('txt'),
  Type.Literal('csv'),
  Type.Literal('excel'),
  Type.Literal('pdf'),
  Type.Literal('google_sheets')
]);
export type BulkCampaignSourceType = Static<typeof BulkCampaignSourceTypeSchema>;

export const BulkCampaignChannelSchema = Type.Union([
  Type.Literal('whatsapp'),
  Type.Literal('phone'),
  Type.Literal('email')
]);
export type BulkCampaignChannel = Static<typeof BulkCampaignChannelSchema>;

/**
 * Contact language preference on import.
 * Note: The published Phone API only supports `PhoneCallingLanguageSchema` (`en-IN | kn-IN | kn-en`).
 * Contacts preferring `hi-IN` are classified as unsupported (`queued_unsupported_language`) and never submitted to the Phone API.
 */
export const BulkCampaignLanguageSchema = Type.Union([
  Type.Literal('en-IN'),
  Type.Literal('kn-IN'),
  Type.Literal('kn-en'),
  Type.Literal('hi-IN')
]);
export type BulkCampaignLanguage = Static<typeof BulkCampaignLanguageSchema>;

export const BulkCampaignConsentSourceSchema = Type.Union([
  Type.Literal('explicit_column'),
  Type.Literal('owner_verified'),
  Type.Literal('phone_directory_verified'),
  Type.Literal('whatsapp_directory_verified'),
  Type.Literal('unverified')
]);
export type BulkCampaignConsentSource = Static<typeof BulkCampaignConsentSourceSchema>;

export const BulkCampaignContactConsentSchema = Type.Object(
  {
    whatsapp: Type.Boolean(),
    phone: Type.Boolean(),
    email: Type.Boolean(),
    source: BulkCampaignConsentSourceSchema
  },
  { additionalProperties: false }
);
export type BulkCampaignContactConsent = Static<typeof BulkCampaignContactConsentSchema>;

export const BulkCampaignImportedContactSchema = Type.Object(
  {
    contactId: Type.String({ minLength: 1, maxLength: 64 }),
    phoneDirectoryContactId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    phoneDirectoryRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    isUnsavedCampaignContact: Type.Optional(Type.Boolean()),
    isSyntheticTestFixture: Type.Optional(Type.Boolean()),
    syntheticScenarioKey: Type.Optional(Type.String({ maxLength: 64 })),
    syntheticScenarioTitle: Type.Optional(Type.String({ maxLength: 160 })),
    isInternational: Type.Optional(Type.Boolean()),
    rowNumber: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    company: Type.Optional(Type.String({ maxLength: 160 })),
    serviceRequired: Type.Optional(Type.String({ maxLength: 200 })),
    customerRequirement: Type.Optional(Type.String({ maxLength: 500 })),
    enquiryDate: Type.Optional(Type.String({ maxLength: 80 })),
    leadSource: Type.Optional(Type.String({ maxLength: 120 })),
    sourceLeadId: Type.Optional(Type.String({ maxLength: 128 })),
    sourceRowKey: Type.Optional(Type.String({ maxLength: 128 })),
    sheetRowNumber: Type.Optional(Type.Integer({ minimum: 1 })),
    customFields: Type.Optional(Type.Record(Type.String({ maxLength: 64 }), Type.String({ maxLength: 300 }))),
    phoneE164: Type.Optional(Type.String({ pattern: '^\\+[1-9][0-9]{7,14}$' })),
    maskedPhone: Type.Optional(Type.String({ minLength: 4, maxLength: 32 })),
    whatsappE164: Type.Optional(Type.String({ pattern: '^\\+[1-9][0-9]{7,14}$' })),
    email: Type.Optional(Type.String({ minLength: 3, maxLength: 254 })),
    preferredLanguage: BulkCampaignLanguageSchema,
    dnd: Type.Optional(Type.Boolean()),
    dndStatus: Type.Optional(Type.Union([Type.Literal('unknown'), Type.Literal('clear'), Type.Literal('dnd')])),
    consentSourceDetail: Type.Optional(Type.String({ maxLength: 120 })),
    consentRecordedAt: Type.Optional(Type.String({ maxLength: 80 })),
    optedOut: Type.Boolean(),
    optedOutStatus: Type.Optional(Type.Union([Type.Literal('unknown'), Type.Literal('clear'), Type.Literal('opted_out')])),
    consent: BulkCampaignContactConsentSchema
  },
  { additionalProperties: false }
);
export type BulkCampaignImportedContact = Static<typeof BulkCampaignImportedContactSchema>;

export const BulkCampaignImportIssueSchema = Type.Object(
  {
    rowNumber: Type.Integer({ minimum: 1 }),
    rawLine: Type.String({ maxLength: 500 }),
    reason: Type.String({ minLength: 1, maxLength: 240 })
  },
  { additionalProperties: false }
);
export type BulkCampaignImportIssue = Static<typeof BulkCampaignImportIssueSchema>;

export const BulkCampaignImportResultSchema = Type.Object(
  {
    sourceType: BulkCampaignSourceTypeSchema,
    fileName: Type.Optional(Type.String({ maxLength: 128 })),
    totalRowsParsed: Type.Integer({ minimum: 0 }),
    validContacts: Type.Array(BulkCampaignImportedContactSchema),
    duplicates: Type.Array(BulkCampaignImportIssueSchema),
    invalidEntries: Type.Array(BulkCampaignImportIssueSchema),
    consentNotice: Type.String()
  },
  { additionalProperties: false }
);
export type BulkCampaignImportResult = Static<typeof BulkCampaignImportResultSchema>;

export const BulkCampaignStatusSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('draft_requires_reapproval'),
  Type.Literal('approved'),
  Type.Literal('scheduled'),
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('stopped'),
  Type.Literal('completed')
]);
export type BulkCampaignStatus = Static<typeof BulkCampaignStatusSchema>;

export const BulkCampaignWebinarDetailsSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 160 }),
    dateLabel: Type.Optional(Type.String({ maxLength: 80 })),
    startTime: Type.Optional(Type.String({ maxLength: 64 })),
    timeZone: Type.String({ minLength: 2, maxLength: 32 }),
    durationMinutes: Type.Optional(Type.Integer({ minimum: 5, maximum: 480 })),
    language: Type.String({ minLength: 2, maxLength: 64 }),
    platform: Type.Optional(Type.String({ maxLength: 80 })),
    benefits: Type.Optional(Type.String({ maxLength: 400 })),
    registrationProcess: Type.Optional(Type.String({ maxLength: 300 })),
    callingHoursWindow: Type.String({ minLength: 3, maxLength: 64 }),
    missingDetails: Type.Array(Type.String({ maxLength: 120 }), { maxItems: 10 })
  },
  { additionalProperties: false }
);
export type BulkCampaignWebinarDetails = Static<typeof BulkCampaignWebinarDetailsSchema>;

/**
 * Respects existing live Phone calling limit of 5/day by default and configured maximum of 20/day.
 */
export const BulkCampaignLimitsSchema = Type.Object(
  {
    maxCalls: Type.Integer({ minimum: 1, maximum: 10000 }),
    dailyPhoneCallLimit: Type.Integer({ minimum: 1, maximum: 10000 }),
    unlimitedDailyCalls: Type.Optional(Type.Boolean()),
    maxConcurrency: Type.Integer({ minimum: 1, maximum: 5 }),
    rateLimitPerMinute: Type.Integer({ minimum: 1, maximum: 60 }),
    scheduleAt: Type.Optional(Type.String({ minLength: 10, maxLength: 64 }))
  },
  { additionalProperties: false }
);
export type BulkCampaignLimits = Static<typeof BulkCampaignLimitsSchema>;

export const BulkCampaignCallScriptSchema = Type.Object(
  {
    aiDisclosure: Type.String({ minLength: 10, maxLength: 300 }),
    openingLine: Type.String({ minLength: 5, maxLength: 500 }),
    eventPitch: Type.String({ minLength: 5, maxLength: 800 }),
    questions: Type.Array(Type.String({ minLength: 3, maxLength: 240 }), { minItems: 1, maxItems: 10 }),
    boundedPurposePreview: Type.String({ minLength: 1, maxLength: 1000 }),
    supportedLanguages: Type.Array(PhoneCallingLanguageSchema, { minItems: 1, maxItems: 3 })
  },
  { additionalProperties: false }
);
export type BulkCampaignCallScript = Static<typeof BulkCampaignCallScriptSchema>;

export const BulkCampaignWhatsAppPlanSchema = Type.Object(
  {
    connectionId: Type.String({ minLength: 1, maxLength: 64 }),
    businessAccountLabel: Type.String({ minLength: 1, maxLength: 120 }),
    templateName: Type.String({ minLength: 1, maxLength: 64 }),
    language: Type.String({ minLength: 2, maxLength: 16 }),
    messagePreview: Type.String({ minLength: 5, maxLength: 1024 }),
    requiresTemplateOutside24h: Type.Literal(true)
  },
  { additionalProperties: false }
);
export type BulkCampaignWhatsAppPlan = Static<typeof BulkCampaignWhatsAppPlanSchema>;

export const BulkCampaignChannelEligibilityStatusSchema = Type.Union([
  Type.Literal('eligible'),
  Type.Literal('queued_not_in_directory'),
  Type.Literal('queued_unsupported_language'),
  Type.Literal('queued_unsupported_region'),
  Type.Literal('queued_daily_quota'),
  Type.Literal('queued_unapproved'),
  Type.Literal('skipped_no_consent'),
  Type.Literal('skipped_dnd'),
  Type.Literal('skipped_opted_out'),
  Type.Literal('skipped_missing_address'),
  Type.Literal('skipped_call_limit'),
  Type.Literal('skipped_channel_disabled'),
  Type.Literal('skipped_connector_unconfigured')
]);
export type BulkCampaignChannelEligibilityStatus = Static<typeof BulkCampaignChannelEligibilityStatusSchema>;

export const BulkCampaignContactCategorySchema = Type.Union([
  Type.Literal('eligible'),
  Type.Literal('unauthorized'),
  Type.Literal('unsupported'),
  Type.Literal('deselected')
]);
export type BulkCampaignContactCategory = Static<typeof BulkCampaignContactCategorySchema>;

export const BulkCampaignWhatsAppDeliveryStatusSchema = Type.Union([
  Type.Literal('not_applicable'),
  Type.Literal('pending'),
  Type.Literal('queued'),
  Type.Literal('unverified'),
  Type.Literal('sent'),
  Type.Literal('delivered'),
  Type.Literal('read'),
  Type.Literal('failed'),
  Type.Literal('skipped'),
  Type.Literal('cancelled')
]);
export type BulkCampaignWhatsAppDeliveryStatus = Static<typeof BulkCampaignWhatsAppDeliveryStatusSchema>;

export const BulkCampaignPhoneCallStatusSchema = Type.Union([
  Type.Literal('not_applicable'),
  Type.Literal('pending'),
  Type.Literal('queued'),
  Type.Literal('awaiting_approval'),
  Type.Literal('attempted'),
  Type.Literal('answered'),
  Type.Literal('not_answered'),
  Type.Literal('failed'),
  Type.Literal('skipped'),
  Type.Literal('cancelled')
]);
export type BulkCampaignPhoneCallStatus = Static<typeof BulkCampaignPhoneCallStatusSchema>;

export const BulkCampaignEmailDeliveryStatusSchema = Type.Union([
  Type.Literal('not_applicable'),
  Type.Literal('pending'),
  Type.Literal('queued'),
  Type.Literal('sent'),
  Type.Literal('failed'),
  Type.Literal('skipped'),
  Type.Literal('cancelled'),
  Type.Literal('unsubscribed')
]);
export type BulkCampaignEmailDeliveryStatus = Static<typeof BulkCampaignEmailDeliveryStatusSchema>;

export const BulkCampaignAttendanceOutcomeSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('confirmed'),
  Type.Literal('interested'),
  Type.Literal('declined'),
  Type.Literal('not_interested'),
  Type.Literal('wants_more_info'),
  Type.Literal('callback_requested'),
  Type.Literal('opted_out'),
  Type.Literal('no_response'),
  Type.Literal('busy'),
  Type.Literal('invalid_number'),
  Type.Literal('failed'),
  Type.Literal('skipped')
]);
export type BulkCampaignAttendanceOutcome = Static<typeof BulkCampaignAttendanceOutcomeSchema>;

/**
 * Any classification of webinar attendance or callback preference derived from raw transcript responses
 * is explicitly marked as an unverified AI interpretation until confirmed by evidence.
 */
export const BulkCampaignAiInterpretationSchema = Type.Object(
  {
    attendanceClassification: BulkCampaignAttendanceOutcomeSchema,
    preferredCallbackTime: Type.Optional(Type.String()),
    rationale: Type.String({ maxLength: 500 }),
    isAiInterpretation: Type.Literal(true),
    confirmedByEvidence: Type.Literal(false)
  },
  { additionalProperties: false }
);
export type BulkCampaignAiInterpretation = Static<typeof BulkCampaignAiInterpretationSchema>;

export const BulkCampaignSimulatedDialogueTurnSchema = Type.Object(
  {
    speaker: Type.Union([Type.Literal('thaara'), Type.Literal('customer')]),
    text: Type.String({ minLength: 1, maxLength: 1200 }),
    sourceRefs: Type.Optional(Type.Array(Type.String({ maxLength: 180 }), { maxItems: 8 }))
  },
  { additionalProperties: false }
);
export type BulkCampaignSimulatedDialogueTurn = Static<typeof BulkCampaignSimulatedDialogueTurnSchema>;

export const BulkCampaignContactRecordSchema = Type.Object(
  {
    contact: BulkCampaignImportedContactSchema,
    selectedByOwner: Type.Boolean(),
    category: BulkCampaignContactCategorySchema,
    categoryReason: Type.String({ maxLength: 300 }),
    personalizedWhatsappPreview: Type.String({ maxLength: 1024 }),
    personalizedEmailPreview: Type.Optional(Type.String({ maxLength: 2048 })),
    whatsappEligibility: BulkCampaignChannelEligibilityStatusSchema,
    phoneEligibility: BulkCampaignChannelEligibilityStatusSchema,
    emailEligibility: BulkCampaignChannelEligibilityStatusSchema,
    whatsappStatus: BulkCampaignWhatsAppDeliveryStatusSchema,
    whatsappDispatchId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    whatsappProviderMessageId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    whatsappCustomerReply: Type.Optional(Type.String({ maxLength: 1000 })),
    whatsappError: Type.Optional(Type.String()),
    emailStatus: Type.Optional(BulkCampaignEmailDeliveryStatusSchema),
    emailMessageId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    emailError: Type.Optional(Type.String()),
    phoneStatus: BulkCampaignPhoneCallStatusSchema,
    phoneApprovalId: Type.Optional(Type.String({ format: 'uuid' })),
    phoneApprovalStatus: Type.Optional(
      Type.Union([Type.Literal('awaiting_approval'), Type.Literal('approved')])
    ),
    phoneDraft: Type.Optional(PhoneCallingDraftSchema),
    phoneCallId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    phoneProviderCallId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    phoneDurationSeconds: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
    phoneRecordingUrl: Type.Optional(Type.Union([Type.String({ maxLength: 512 }), Type.Null()])),
    phoneRecordState: Type.Optional(PhoneCallingStateSchema),
    phoneLanguageUsed: Type.Optional(PhoneCallingLanguageSchema),
    phoneDisclosedAi: Type.Optional(Type.Boolean()),
    phoneRawResponses: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 12 }),
    phoneProviderReportText: Type.Optional(Type.String()),
    phoneReportVerified: Type.Boolean(),
    simulatedScenarioTitle: Type.Optional(Type.String({ maxLength: 160 })),
    simulatedDialogueTurns: Type.Optional(
      Type.Array(BulkCampaignSimulatedDialogueTurnSchema, { maxItems: 20 })
    ),
    aiInterpretation: Type.Optional(BulkCampaignAiInterpretationSchema),
    phoneTranscriptSummary: Type.Optional(Type.String()),
    preferredCallbackTime: Type.Optional(Type.String()),
    followUpRequired: Type.Boolean(),
    followUpReason: Type.Optional(Type.String({ maxLength: 300 })),
    attendanceOutcome: BulkCampaignAttendanceOutcomeSchema,
    retryCount: Type.Optional(Type.Integer({ minimum: 0 })),
    interactionTimestamp: Type.Optional(Type.String()),
    structuredNotes: Type.Optional(Type.String({ maxLength: 500 })),
    updatedAt: Type.String()
  },
  { additionalProperties: false }
);
export type BulkCampaignContactRecord = Static<typeof BulkCampaignContactRecordSchema>;

export const BulkCampaignDashboardMetricsSchema = Type.Object(
  {
    totalContacts: Type.Integer({ minimum: 0 }),
    eligibleContacts: Type.Integer({ minimum: 0 }),
    unauthorizedContacts: Type.Integer({ minimum: 0 }),
    unsupportedContacts: Type.Integer({ minimum: 0 }),
    duplicateEntries: Type.Integer({ minimum: 0 }),
    invalidEntries: Type.Integer({ minimum: 0 }),
    eligibleWhatsappContacts: Type.Integer({ minimum: 0 }),
    eligiblePhoneContacts: Type.Integer({ minimum: 0 }),
    eligibleEmailContacts: Type.Optional(Type.Integer({ minimum: 0 })),
    whatsappDelivered: Type.Integer({ minimum: 0 }),
    whatsappFailed: Type.Integer({ minimum: 0 }),
    whatsappPending: Type.Integer({ minimum: 0 }),
    whatsappSkipped: Type.Integer({ minimum: 0 }),
    emailSent: Type.Optional(Type.Integer({ minimum: 0 })),
    emailFailed: Type.Optional(Type.Integer({ minimum: 0 })),
    emailPending: Type.Optional(Type.Integer({ minimum: 0 })),
    emailUnsubscribed: Type.Optional(Type.Integer({ minimum: 0 })),
    phoneDraftsPrepared: Type.Integer({ minimum: 0 }),
    phoneAwaitingApproval: Type.Integer({ minimum: 0 }),
    phoneApproved: Type.Integer({ minimum: 0 }),
    phoneQueued: Type.Integer({ minimum: 0 }),
    callsAttempted: Type.Integer({ minimum: 0 }),
    callsCompleted: Type.Optional(Type.Integer({ minimum: 0 })),
    callsAnswered: Type.Integer({ minimum: 0 }),
    callsNotAnswered: Type.Integer({ minimum: 0 }),
    callsPending: Type.Integer({ minimum: 0 }),
    callsSkipped: Type.Integer({ minimum: 0 }),
    confirmed: Type.Integer({ minimum: 0 }),
    declined: Type.Integer({ minimum: 0 }),
    wantsMoreInfo: Type.Optional(Type.Integer({ minimum: 0 })),
    busyCount: Type.Optional(Type.Integer({ minimum: 0 })),
    callbackRequested: Type.Integer({ minimum: 0 }),
    followUpRequiredCount: Type.Integer({ minimum: 0 }),
    optedOut: Type.Integer({ minimum: 0 }),
    pending: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
    skipped: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);
export type BulkCampaignDashboardMetrics = Static<typeof BulkCampaignDashboardMetricsSchema>;

/**
 * Verified published Phone API contract (`packages/contracts/src/phone-calling.ts` & `apps/api/src/routes/phone-calling.ts`).
 * Uses the real per-call draft + explicit approval + call/simulation + provider result endpoints.
 */
export const PhoneBatchIntegrationContractSchema = Type.Object(
  {
    contactsDirectoryEndpoint: Type.Literal('GET /api/v1/connectors/phone/ai/contacts'),
    prepareDraftEndpoint: Type.Literal('POST /api/v1/connectors/phone/ai/drafts'),
    openRequestsEndpoint: Type.Literal('GET /api/v1/connectors/phone/ai/requests'),
    confirmLiveCallEndpoint: Type.Literal('POST /api/v1/connectors/phone/ai/calls/confirm'),
    placeApprovedCallEndpoint: Type.Literal('POST /api/v1/connectors/phone/ai/calls'),
    simulateCallEndpoint: Type.Literal('POST /api/v1/connectors/phone/ai/simulations'),
    callHistoryEndpoint: Type.Literal('GET /api/v1/connectors/phone/ai/calls'),
    providerResultEndpoint: Type.Literal('POST /api/v1/connectors/phone/ai/calls/:callId/result'),
    supportedLanguages: Type.Array(PhoneCallingLanguageSchema),
    maxPurposeLength: Type.Literal(1000),
    defaultDailyLiveCallLimit: Type.Literal(5),
    maxConfiguredDailyLiveCallLimit: Type.Integer({ minimum: 1 })
  },
  { additionalProperties: false }
);
export type PhoneBatchIntegrationContract = Static<typeof PhoneBatchIntegrationContractSchema>;

export const BulkCampaignTemplateSummarySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 512 }),
    language: Type.String({ minLength: 2, maxLength: 16 }),
    status: Type.Union([
      Type.Literal('APPROVED'),
      Type.Literal('PENDING'),
      Type.Literal('REJECTED'),
      Type.Literal('PAUSED'),
      Type.Literal('DISABLED')
    ]),
    category: Type.Union([
      Type.Literal('MARKETING'),
      Type.Literal('UTILITY'),
      Type.Literal('AUTHENTICATION')
    ]),
    bodyText: Type.String({ maxLength: 1024 }),
    bodyParams: Type.Integer({ minimum: 0 }),
    usableForCampaign: Type.Boolean()
  },
  { additionalProperties: false }
);
export type BulkCampaignTemplateSummary = Static<typeof BulkCampaignTemplateSummarySchema>;

export const BulkCampaignWorkspaceContextSchema = Type.Object(
  {
    whatsappConnected: Type.Boolean(),
    whatsappConnectionId: Type.Union([Type.String(), Type.Null()]),
    whatsappBusinessLabel: Type.String(),
    liveSendingEnabled: Type.Boolean(),
    optedInWhatsappContactsCount: Type.Integer({ minimum: 0 }),
    availableTemplates: Type.Array(BulkCampaignTemplateSummarySchema),
    phoneContactsConfigured: Type.Boolean(),
    savedPhoneContactsCount: Type.Integer({ minimum: 0 }),
    liveCallingEnabled: Type.Boolean(),
    dailyPhoneCallLimit: Type.Integer({ minimum: 1, maximum: 10000 }),
    unlimitedDailyCalls: Type.Optional(Type.Boolean()),
    emailConnected: Type.Boolean(),
    connectedEmail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    emailSendReady: Type.Optional(Type.Boolean()),
    sarvamOutboundAgentLabel: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);
export type BulkCampaignWorkspaceContext = Static<typeof BulkCampaignWorkspaceContextSchema>;

export const BulkCampaignKnowledgeFileFormatSchema = Type.Union([
  Type.Literal('pdf'),
  Type.Literal('docx'),
  Type.Literal('txt'),
  Type.Literal('csv'),
  Type.Literal('xlsx')
]);
export type BulkCampaignKnowledgeFileFormat = Static<typeof BulkCampaignKnowledgeFileFormatSchema>;

export const BulkCampaignKnowledgeUploadInputSchema = Type.Object(
  {
    fileName: Type.String({ minLength: 1, maxLength: 180 }),
    mimeType: Type.Optional(Type.String({ maxLength: 160 })),
    rawText: Type.Optional(Type.String({ maxLength: 200000 })),
    fileBase64: Type.Optional(Type.String({ maxLength: 7500000 }))
  },
  { additionalProperties: false }
);
export type BulkCampaignKnowledgeUploadInput = Static<typeof BulkCampaignKnowledgeUploadInputSchema>;

export const BulkCampaignKnowledgeFileRecordSchema = Type.Object(
  {
    fileId: Type.String({ minLength: 1, maxLength: 64 }),
    fileName: Type.String({ minLength: 1, maxLength: 180 }),
    format: BulkCampaignKnowledgeFileFormatSchema,
    sizeBytes: Type.Integer({ minimum: 0 }),
    sha256: Type.String({ minLength: 8, maxLength: 64 }),
    status: Type.Union([Type.Literal('processed'), Type.Literal('rejected')]),
    statusMessage: Type.String({ maxLength: 300 }),
    extractedCharCount: Type.Integer({ minimum: 0 }),
    chunkCount: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);
export type BulkCampaignKnowledgeFileRecord = Static<typeof BulkCampaignKnowledgeFileRecordSchema>;

export const BulkCampaignKnowledgeChunkSchema = Type.Object(
  {
    chunkId: Type.String({ minLength: 1, maxLength: 64 }),
    fileId: Type.String({ minLength: 1, maxLength: 64 }),
    fileName: Type.String({ minLength: 1, maxLength: 180 }),
    heading: Type.Optional(Type.String({ maxLength: 160 })),
    text: Type.String({ minLength: 1, maxLength: 1200 }),
    keywords: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 40 })
  },
  { additionalProperties: false }
);
export type BulkCampaignKnowledgeChunk = Static<typeof BulkCampaignKnowledgeChunkSchema>;

export const BulkCampaignGroundedQaItemSchema = Type.Object(
  {
    question: Type.String({ minLength: 3, maxLength: 240 }),
    answer: Type.String({ minLength: 3, maxLength: 1000 }),
    sourceRefs: Type.Array(Type.String({ maxLength: 180 }), { maxItems: 8 }),
    grounded: Type.Boolean(),
    requiresHumanFollowUp: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);
export type BulkCampaignGroundedQaItem = Static<typeof BulkCampaignGroundedQaItemSchema>;

export const BulkCampaignExtractedFactsSchema = Type.Object(
  {
    campaignType: Type.Union([
      Type.Literal('webinar'),
      Type.Literal('services'),
      Type.Literal('general')
    ]),
    title: Type.Optional(Type.String({ maxLength: 160 })),
    agendaTopics: Type.Array(Type.String({ maxLength: 240 }), { maxItems: 12 }),
    speakers: Type.Array(Type.String({ maxLength: 160 }), { maxItems: 8 }),
    dateAndTime: Type.Optional(Type.String({ maxLength: 160 })),
    registrationInfo: Type.Optional(Type.String({ maxLength: 300 })),
    targetAudience: Type.Optional(Type.String({ maxLength: 240 })),
    servicesOffered: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 12 }),
    pricingSummary: Type.Optional(Type.String({ maxLength: 360 })),
    pricingExplicitlyProvided: Type.Boolean(),
    implementationTimeline: Type.Optional(Type.String({ maxLength: 240 })),
    faqs: Type.Array(
      Type.Object(
        {
          question: Type.String({ maxLength: 240 }),
          answer: Type.String({ maxLength: 600 }),
          sourceFile: Type.String({ maxLength: 180 })
        },
        { additionalProperties: false }
      ),
      { maxItems: 16 }
    )
  },
  { additionalProperties: false }
);
export type BulkCampaignExtractedFacts = Static<typeof BulkCampaignExtractedFactsSchema>;

export const BulkCampaignKnowledgeContextSchema = Type.Object(
  {
    files: Type.Array(BulkCampaignKnowledgeFileRecordSchema, { maxItems: 10 }),
    chunks: Type.Array(BulkCampaignKnowledgeChunkSchema, { maxItems: 120 }),
    extractedFacts: BulkCampaignExtractedFactsSchema,
    conflicts: Type.Array(Type.String({ maxLength: 300 }), { maxItems: 10 }),
    missingDetails: Type.Array(Type.String({ maxLength: 160 }), { maxItems: 10 }),
    sarvamBoundedFactBrief: Type.String({ maxLength: 1000 }),
    sampleGroundedQa: Type.Array(BulkCampaignGroundedQaItemSchema, { maxItems: 12 })
  },
  { additionalProperties: false }
);
export type BulkCampaignKnowledgeContext = Static<typeof BulkCampaignKnowledgeContextSchema>;

export const BulkCampaignEligiblePilotContactSchema = Type.Object(
  {
    contactId: Type.String({ minLength: 1, maxLength: 128 }),
    displayName: Type.String({ minLength: 1, maxLength: 128 }),
    maskedPhone: Type.String({ minLength: 4, maxLength: 40 }),
    consentExpiresAt: Type.String(),
    source: Type.Union([Type.Literal('phone_directory'), Type.Literal('campaign_eligible')])
  },
  { additionalProperties: false }
);
export type BulkCampaignEligiblePilotContact = Static<typeof BulkCampaignEligiblePilotContactSchema>;

export const BulkCampaignPilotCallStateSchema = Type.Object(
  {
    pilotId: Type.String({ minLength: 1, maxLength: 128 }),
    campaignId: Type.String({ minLength: 1, maxLength: 128 }),
    contactId: Type.String({ minLength: 1, maxLength: 128 }),
    displayName: Type.String({ minLength: 1, maxLength: 128 }),
    maskedPhone: Type.String({ minLength: 4, maxLength: 40 }),
    language: PhoneCallingLanguageSchema,
    callPurpose: Type.String({ minLength: 1, maxLength: 1000 }),
    approvalId: Type.String({ format: 'uuid' }),
    preparedAt: Type.String(),
    expiresAt: Type.String(),
    approvedAt: Type.Optional(Type.String()),
    approvedByUserId: Type.Optional(Type.String()),
    status: Type.Union([
      Type.Literal('prepared'),
      Type.Literal('placing'),
      Type.Literal('queued'),
      Type.Literal('ringing'),
      Type.Literal('answered'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
      Type.Literal('busy'),
      Type.Literal('no_answer'),
      Type.Literal('unverified')
    ]),
    callId: Type.Optional(Type.String()),
    providerCallId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    startedAt: Type.Optional(Type.String()),
    endedAt: Type.Optional(Type.String()),
    durationSeconds: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
    recordingAvailable: Type.Optional(Type.Boolean()),
    transcript: Type.Optional(
      Type.Array(
        Type.Object(
          {
            speaker: Type.Union([Type.Literal('thaara'), Type.Literal('customer')]),
            text: Type.String({ maxLength: 2000 })
          },
          { additionalProperties: false }
        ),
        { maxItems: 100 }
      )
    ),
    summary: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
    outcomeLabel: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Null()])),
    callbackStatus: Type.Optional(
      Type.Union([
        Type.Literal('none'),
        Type.Literal('declined'),
        Type.Literal('confirmed'),
        Type.Literal('needs_review')
      ])
    ),
    requirements: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
    error: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    isRealCall: Type.Literal(true)
  },
  { additionalProperties: false }
);
export type BulkCampaignPilotCallState = Static<typeof BulkCampaignPilotCallStateSchema>;

export const BulkCampaignN8nChannelSchema = Type.Union([
  Type.Literal('phone_call'),
  Type.Literal('whatsapp')
]);
export type BulkCampaignN8nChannel = Static<typeof BulkCampaignN8nChannelSchema>;

export const BulkCampaignN8nJobStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('stopped')
]);
export type BulkCampaignN8nJobStatus = Static<typeof BulkCampaignN8nJobStatusSchema>;

export const BulkCampaignN8nBatchRecipientSchema = Type.Object(
  {
    contactId: Type.String({ minLength: 1, maxLength: 128 }),
    displayName: Type.String({ minLength: 1, maxLength: 128 }),
    maskedPhone: Type.String({ minLength: 4, maxLength: 40 }),
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('claimed'),
      Type.Literal('dispatched'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('skipped'),
      Type.Literal('cancelled')
    ]),
    attempts: Type.Integer({ minimum: 0, maximum: 5 }),
    idempotencyKey: Type.String({ minLength: 1, maxLength: 128 }),
    providerId: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Null()])),
    outcome: Type.Optional(Type.Union([Type.String({ maxLength: 400 }), Type.Null()])),
    failureReason: Type.Optional(Type.Union([Type.String({ maxLength: 300 }), Type.Null()])),
    updatedAt: Type.String()
  },
  { additionalProperties: false }
);
export type BulkCampaignN8nBatchRecipient = Static<typeof BulkCampaignN8nBatchRecipientSchema>;

export const BulkCampaignN8nBatchConfigSchema = Type.Object(
  {
    batchSize: Type.Integer({ minimum: 1, maximum: 100 }),
    maxConcurrency: Type.Integer({ minimum: 1, maximum: 5 }),
    rateLimitPerMinute: Type.Integer({ minimum: 1, maximum: 30 }),
    maxRetries: Type.Integer({ minimum: 0, maximum: 2 })
  },
  { additionalProperties: false }
);
export type BulkCampaignN8nBatchConfig = Static<typeof BulkCampaignN8nBatchConfigSchema>;

export const BulkCampaignN8nExecutionJobSchema = Type.Object(
  {
    jobId: Type.String({ minLength: 1, maxLength: 128 }),
    campaignId: Type.String({ minLength: 1, maxLength: 128 }),
    channel: BulkCampaignN8nChannelSchema,
    mode: Type.Union([Type.Literal('one_contact_pilot'), Type.Literal('multi_contact_batch')]),
    workflowId: Type.String({ minLength: 1, maxLength: 128 }),
    webhookPath: Type.String({ minLength: 1, maxLength: 160 }),
    targetContactId: Type.String({ minLength: 1, maxLength: 128 }),
    targetDisplayName: Type.String({ minLength: 1, maxLength: 128 }),
    targetMaskedPhone: Type.String({ minLength: 4, maxLength: 40 }),
    batchConfig: Type.Optional(BulkCampaignN8nBatchConfigSchema),
    recipientQueue: Type.Optional(Type.Array(BulkCampaignN8nBatchRecipientSchema, { maxItems: 100 })),
    totalContacts: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    processedCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    succeededCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    failedCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    skippedCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    emergencyStopped: Type.Optional(Type.Boolean()),
    status: BulkCampaignN8nJobStatusSchema,
    createdAt: Type.String(),
    createdByUserId: Type.String(),
    claimedAt: Type.Optional(Type.String()),
    dispatchedAt: Type.Optional(Type.String()),
    completedAt: Type.Optional(Type.String()),
    pausedAt: Type.Optional(Type.String()),
    resumedAt: Type.Optional(Type.String()),
    cancelledAt: Type.Optional(Type.String()),
    n8nExecutionId: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Null()])),
    webhookDispatched: Type.Boolean(),
    approvalId: Type.Optional(Type.String()),
    providerCallId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    providerMessageId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    dispatchId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    deliveryStatus: Type.Optional(Type.Union([Type.String({ maxLength: 80 }), Type.Null()])),
    replyReceived: Type.Optional(Type.Boolean()),
    latestReplyPreview: Type.Optional(Type.Union([Type.String({ maxLength: 400 }), Type.Null()])),
    optOutDetected: Type.Optional(Type.Boolean()),
    outcomeSummary: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
    failureReason: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    isSimulated: Type.Literal(false)
  },
  { additionalProperties: false }
);
export type BulkCampaignN8nExecutionJob = Static<typeof BulkCampaignN8nExecutionJobSchema>;

export const BulkCampaignPilotWhatsAppStateSchema = Type.Object(
  {
    pilotId: Type.String({ minLength: 1, maxLength: 128 }),
    campaignId: Type.String({ minLength: 1, maxLength: 128 }),
    contactId: Type.String({ minLength: 1, maxLength: 128 }),
    displayName: Type.String({ minLength: 1, maxLength: 128 }),
    maskedPhone: Type.String({ minLength: 4, maxLength: 40 }),
    connectionId: Type.String({ minLength: 1, maxLength: 128 }),
    mode: Type.Union([Type.Literal('template'), Type.Literal('window_text')]),
    templateName: Type.String({ minLength: 1, maxLength: 128 }),
    language: Type.String({ minLength: 2, maxLength: 20 }),
    messagePreview: Type.String({ minLength: 1, maxLength: 1000 }),
    status: Type.Union([
      Type.Literal('prepared'),
      Type.Literal('queued'),
      Type.Literal('sent'),
      Type.Literal('delivered'),
      Type.Literal('read'),
      Type.Literal('replied'),
      Type.Literal('failed'),
      Type.Literal('cancelled')
    ]),
    dispatchId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    providerMessageId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    replyReceived: Type.Optional(Type.Boolean()),
    latestReplyPreview: Type.Optional(Type.Union([Type.String({ maxLength: 400 }), Type.Null()])),
    optOutDetected: Type.Optional(Type.Boolean()),
    error: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    updatedAt: Type.String(),
    isRealMessage: Type.Literal(true)
  },
  { additionalProperties: false }
);
export type BulkCampaignPilotWhatsAppState = Static<typeof BulkCampaignPilotWhatsAppStateSchema>;

export const BULK_CAMPAIGN_OUTCOME_COLORS = {
  engaged: '#16A34A',
  notAligned: '#64748B',
  furtherDiscussion: '#2563EB'
} as const;

export function formatBulkCampaignOutcomeDisplay(
  outcome: string,
  isSimulation = false
): { label: string; color: string; bg: string; fg: string } {
  if (outcome === 'confirmed' || outcome === 'interested') {
    return {
      label: isSimulation ? 'Simulated: Engaged' : 'Engaged',
      color: BULK_CAMPAIGN_OUTCOME_COLORS.engaged,
      bg: '#dcfce7',
      fg: BULK_CAMPAIGN_OUTCOME_COLORS.engaged
    };
  }
  if (outcome === 'declined' || outcome === 'not_interested') {
    return {
      label: isSimulation ? 'Simulated: Not Aligned' : 'Not Aligned',
      color: BULK_CAMPAIGN_OUTCOME_COLORS.notAligned,
      bg: '#f1f5f9',
      fg: BULK_CAMPAIGN_OUTCOME_COLORS.notAligned
    };
  }
  if (outcome === 'callback_requested') {
    return {
      label: isSimulation ? 'Simulated: Further Discussion' : 'Further Discussion',
      color: BULK_CAMPAIGN_OUTCOME_COLORS.furtherDiscussion,
      bg: '#dbeafe',
      fg: BULK_CAMPAIGN_OUTCOME_COLORS.furtherDiscussion
    };
  }
  if (outcome === 'wants_more_info') {
    return {
      label: isSimulation ? 'Simulated: More info' : 'Needs more info',
      color: '#1d4ed8',
      bg: '#eff6ff',
      fg: '#1d4ed8'
    };
  }
  if (outcome === 'opted_out') {
    return { label: 'Opted out', color: '#991b1b', bg: '#fee2e2', fg: '#991b1b' };
  }
  if (outcome === 'no_response') {
    return { label: 'No answer', color: '#475569', bg: '#f1f5f9', fg: '#475569' };
  }
  if (outcome === 'busy') {
    return { label: 'Busy', color: '#475569', bg: '#f1f5f9', fg: '#475569' };
  }
  if (outcome === 'failed' || outcome === 'invalid_number') {
    return { label: 'Failed', color: '#b91c1c', bg: '#fee2e2', fg: '#b91c1c' };
  }
  if (outcome === 'pending') {
    return {
      label: isSimulation ? 'Simulated: Pending' : 'Pending',
      color: '#64748b',
      bg: '#f8fafc',
      fg: '#64748b'
    };
  }
  return { label: outcome.replace(/_/g, ' '), color: '#475569', bg: '#f8fafc', fg: '#475569' };
}

export const BulkCampaignModeSchema = Type.Union([
  Type.Literal('one_time'),
  Type.Literal('automatic_lead_followup')
]);
export type BulkCampaignMode = Static<typeof BulkCampaignModeSchema>;

export const BulkCampaignAutoFollowupStatusSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('active_monitoring'),
  Type.Literal('processing_leads'),
  Type.Literal('paused'),
  Type.Literal('attention_required'),
  Type.Literal('stopped')
]);
export type BulkCampaignAutoFollowupStatus = Static<typeof BulkCampaignAutoFollowupStatusSchema>;

export const BulkCampaignStandingAuthorizationSchema = Type.Object(
  {
    grantId: Type.String({ minLength: 4, maxLength: 128 }),
    approvedByUserId: Type.String({ minLength: 1, maxLength: 128 }),
    approvedAt: Type.String(),
    expiresAt: Type.String(),
    revoked: Type.Boolean(),
    approvedMaterialHash: Type.String({ minLength: 16, maxLength: 128 }),
    spreadsheetId: Type.String({ minLength: 1, maxLength: 256 }),
    tabName: Type.String({ minLength: 1, maxLength: 128 }),
    authorizedChannels: Type.Array(BulkCampaignChannelSchema, { minItems: 1, maxItems: 3 }),
    allowedLeadSources: Type.Array(Type.String({ maxLength: 120 }), { maxItems: 16 }),
    callingHoursIst: Type.Object({
      startHour: Type.Integer({ minimum: 0, maximum: 23 }),
      endHour: Type.Integer({ minimum: 1, maximum: 24 })
    }),
    maxAttemptsPerLead: Type.Integer({ minimum: 1, maximum: 5 }),
    retryOnNoAnswer: Type.Boolean(),
    retryDelayMinutes: Type.Integer({ minimum: 5, maximum: 1440 }),
    maxConcurrency: Type.Integer({ minimum: 1, maximum: 5 }),
    rateLimitPerMinute: Type.Integer({ minimum: 1, maximum: 60 }),
    maxLeadsPerDay: Type.Integer({ minimum: 1, maximum: 1000 })
  },
  { additionalProperties: false }
);
export type BulkCampaignStandingAuthorization = Static<typeof BulkCampaignStandingAuthorizationSchema>;

export const BulkCampaignSheetConsentAttestationSchema = Type.Object(
  {
    confirmed: Type.Boolean(),
    consentSource: Type.Union([
      Type.Literal('lead_form_disclosure'),
      Type.Literal('inbound_enquiry'),
      Type.Literal('written_consent'),
      Type.Literal('verbal_recorded')
    ]),
    evidenceReference: Type.String({ minLength: 3, maxLength: 160 }),
    attestedByUserId: Type.String({ minLength: 1, maxLength: 128 }),
    attestedAt: Type.String({ minLength: 8, maxLength: 80 })
  },
  { additionalProperties: false }
);
export type BulkCampaignSheetConsentAttestation = Static<typeof BulkCampaignSheetConsentAttestationSchema>;

export const BulkCampaignSheetMonitorConfigSchema = Type.Object(
  {
    spreadsheetId: Type.String({ minLength: 1, maxLength: 256 }),
    spreadsheetName: Type.String({ minLength: 1, maxLength: 256 }),
    spreadsheetUrl: Type.Optional(Type.String({ maxLength: 1024 })),
    tabName: Type.String({ minLength: 1, maxLength: 128 }),
    tabId: Type.Optional(Type.String({ maxLength: 64 })),
    googleConnectionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    googleAccountEmail: Type.Optional(Type.String({ maxLength: 256 })),
    metaCampaignRef: Type.Optional(Type.String({ maxLength: 160 })),
    metaFormId: Type.Optional(Type.String({ maxLength: 160 })),
    pollIntervalSeconds: Type.Integer({ minimum: 15, maximum: 3600 }),
    processExistingBacklog: Type.Boolean(),
    existingBacklogProcessed: Type.Optional(Type.Boolean()),
    existingBacklogApprovedAt: Type.Optional(Type.String()),
    backlogSkippedReason: Type.Optional(Type.Union([Type.String({ maxLength: 240 }), Type.Null()])),
    pendingDispatchContactIds: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 5000 })),
    status: BulkCampaignAutoFollowupStatusSchema,
    lastSyncAt: Type.Optional(Type.String()),
    lastSyncError: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    lastCheckpointRowNumber: Type.Integer({ minimum: 0 }),
    baselineRowCount: Type.Integer({ minimum: 0 }),
    knownRowKeys: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 5000 }),
    consecutiveErrors: Type.Integer({ minimum: 0 }),
    existingLeadsDiscoveredCount: Type.Optional(Type.Integer({ minimum: 0 })),
    newLeadsReceivedCount: Type.Optional(Type.Integer({ minimum: 0 })),
    leadsReceivedCount: Type.Integer({ minimum: 0 }),
    leadsEligibleCount: Type.Integer({ minimum: 0 }),
    leadsConsentBlockedCount: Type.Integer({ minimum: 0 }),
    leadsQueuedCount: Type.Integer({ minimum: 0 }),
    followUpsScheduledCount: Type.Integer({ minimum: 0 }),
    sheetConsentAttestation: Type.Optional(BulkCampaignSheetConsentAttestationSchema)
  },
  { additionalProperties: false }
);
export type BulkCampaignSheetMonitorConfig = Static<typeof BulkCampaignSheetMonitorConfigSchema>;

export const GoogleSheetsConnectionStatusSchema = Type.Union([
  Type.Literal('connected'),
  Type.Literal('expired'),
  Type.Literal('missing_scopes'),
  Type.Literal('disconnected')
]);
export type GoogleSheetsConnectionStatus = Static<typeof GoogleSheetsConnectionStatusSchema>;

export const GoogleSheetsConnectionViewSchema = Type.Object(
  {
    connectionId: Type.String({ minLength: 1, maxLength: 128 }),
    workspaceId: Type.String({ minLength: 1, maxLength: 128 }),
    accountEmail: Type.String({ minLength: 1, maxLength: 256 }),
    label: Type.Optional(Type.String({ maxLength: 120 })),
    status: GoogleSheetsConnectionStatusSchema,
    scopes: Type.Array(Type.String({ maxLength: 256 })),
    connectedAt: Type.String(),
    lastVerifiedAt: Type.Optional(Type.String()),
    lastError: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()]))
  },
  { additionalProperties: false }
);
export type GoogleSheetsConnectionView = Static<typeof GoogleSheetsConnectionViewSchema>;
