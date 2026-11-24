import { Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { MetaProviderMessageIdSchema, MetaWhatsAppSendInputSchema, MetaWhatsAppAnySendInputSchema, MetaWhatsAppMediaDraftSchema, MetaWhatsAppStoredMediaSchema, MetaWhatsAppTemplateDraftSchema, isValidWhatsAppTemplateParam } from './meta-whatsapp.js';
const Id = Type.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' });
export const N8nWhatsAppConnectionsSchema = Type.Object({ mode: Type.Literal('offline_test'), liveSendingEnabled: Type.Literal(false), connections: Type.Array(Type.Object({ connectionId: Id, revision: Type.Integer({ minimum: 1 }), disconnected: Type.Boolean() }, { additionalProperties: false }), { maxItems: 20 }) }, { additionalProperties: false });
export type N8nWhatsAppConnections = Static<typeof N8nWhatsAppConnectionsSchema>;
export const N8nWhatsAppInboxQuerySchema = Type.Object({ query: Type.Optional(Type.String({ maxLength: 256 })), recipientId: Type.Optional(Id), pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })), pageToken: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}\\.[0-9]{1,4}$', maxLength: 69 })) }, { additionalProperties: false });
export type N8nWhatsAppInboxQuery = Static<typeof N8nWhatsAppInboxQuerySchema>;
const SavedDeliveryEvent = Type.Object({ status: Type.Union([Type.Literal('sent'), Type.Literal('failed'), Type.Literal('delivered'), Type.Literal('read')]), timestamp: Type.String({ minLength: 24, maxLength: 24, pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' }), errorCode: Type.Optional(Type.Integer({ minimum: 1, maximum: 9999999 })), errorTitle: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })), errorDetails: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })) }, { additionalProperties: false });
export const WhatsAppStoredFailureMetadataSchema = Type.Object({ code: Type.Union([Type.Integer({ minimum: 1, maximum: 9999999 }), Type.Null()]), title: Type.String({ maxLength: 160 }), details: Type.String({ maxLength: 160 }) }, { additionalProperties: false });
export type WhatsAppStoredFailureMetadata = Static<typeof WhatsAppStoredFailureMetadataSchema>;
export const isWhatsAppStoredFailureMetadata = (value: unknown): value is WhatsAppStoredFailureMetadata =>
  Value.Check(WhatsAppStoredFailureMetadataSchema, value) &&
  !/[\u0000-\u001f\u007f]|\+?\d{7,}/.test(value.title) &&
  !/[\u0000-\u001f\u007f]|\+?\d{7,}/.test(value.details) &&
  (value.code !== null || value.title.length > 0 || value.details.length > 0);
export const WhatsAppLeadStatusSchema = Type.Union([Type.Literal('Enquired'), Type.Literal('Callback requested'), Type.Literal('Booked appointment'), Type.Literal('Needs review')]);
export const WhatsAppEscalationReasonSchema = Type.Union([Type.Literal('opt_out'), Type.Literal('human_handoff'), Type.Literal('prompt_injection'), Type.Literal('sensitive_request'), Type.Literal('uncertain_query')]);
export const WhatsAppStoredAutoReplyStatusSchema = Type.Union([Type.Literal('disabled'), Type.Literal('pending'), Type.Literal('replied'), Type.Literal('escalated'), Type.Literal('skipped_loop_guard'), Type.Literal('skipped_failure_guard'), Type.Literal('skipped_window_closed')]);
export const WhatsAppAutoReplyStatusSchema = Type.Union([Type.Literal('disabled'), Type.Literal('pending'), Type.Literal('replied'), Type.Literal('escalated'), Type.Literal('expired_reservation'), Type.Literal('recovery_attention_required'), Type.Literal('skipped_loop_guard'), Type.Literal('skipped_failure_guard'), Type.Literal('skipped_window_closed')]);
export const WhatsAppStoredAutoReplyMetadataSchema = Type.Object({ status: WhatsAppStoredAutoReplyStatusSchema, idempotencyKey: Type.String({ pattern: '^auto-reply-[a-zA-Z0-9_-]{1,100}$' }), evaluatedAt: Type.String({ minLength: 24, maxLength: 24, pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' }), reason: Type.Optional(WhatsAppEscalationReasonSchema) }, { additionalProperties: false });
export type WhatsAppStoredAutoReplyMetadata = Static<typeof WhatsAppStoredAutoReplyMetadataSchema>;
export const isWhatsAppStoredAutoReplyMetadata = (value: unknown): value is WhatsAppStoredAutoReplyMetadata =>
  Value.Check(WhatsAppStoredAutoReplyMetadataSchema, value) &&
  Number.isFinite(Date.parse(value.evaluatedAt)) &&
  (value.reason === undefined || value.status === 'escalated');
export const WhatsAppConsentProvenanceSchema = Type.Union([Type.Literal('explicit_message_consent'), Type.Literal('stored_contact_opt_in'), Type.Literal('revoked_opt_out'), Type.Literal('unknown')]);
export const WhatsAppCustomerLanguageSchema = Type.Union([Type.Literal('en'), Type.Literal('kn'), Type.Literal('hi')]);
export const CalendlyBookingEvidenceSchema = Type.Object({
  bookingId: Type.String({ minLength: 6, maxLength: 128 }),
  eventUri: Type.String({ pattern: '^https://api\\.calendly\\.com/scheduled_events/[a-zA-Z0-9_-]+$', maxLength: 256 }),
  inviteeUri: Type.String({ pattern: '^https://api\\.calendly\\.com/scheduled_events/[a-zA-Z0-9_-]+/invitees/[a-zA-Z0-9_-]+$', maxLength: 256 }),
  status: Type.Literal('active')
}, { additionalProperties: false });
export type CalendlyBookingEvidence = Static<typeof CalendlyBookingEvidenceSchema>;
export const WhatsAppConversationEnquirySchema = Type.Object({ leadStatus: WhatsAppLeadStatusSchema, customerName: Type.Optional(Type.String({ maxLength: 80 })), customerEmail: Type.Optional(Type.String({ maxLength: 120 })), emailDeclined: Type.Optional(Type.Boolean()), businessName: Type.Optional(Type.String({ maxLength: 80 })), businessCategory: Type.Optional(Type.String({ maxLength: 80 })), businessType: Type.Optional(Type.String({ maxLength: 80 })), requestedService: Type.Optional(Type.String({ maxLength: 120 })), businessProblem: Type.Optional(Type.String({ maxLength: 180 })), referredWebsite: Type.Optional(Type.String({ maxLength: 200 })), latestCustomerMessage: Type.Optional(Type.String({ maxLength: 240 })), suggestedReply: Type.Optional(Type.String({ maxLength: 1024 })), enquirySummary: Type.String({ maxLength: 240 }), callbackRequested: Type.Boolean(), appointmentInterest: Type.Optional(Type.Boolean()), appointmentStatus: Type.Optional(Type.Union([Type.Literal('REQUESTED'), Type.Literal('CONFIRMED'), Type.Literal('CANCELLED'), Type.Literal('LINK_SENT'), Type.Literal('AWAITING_CUSTOMER_BOOKING')])), calendlyUrl: Type.Optional(Type.String({ maxLength: 200 })), calendlyBookingId: Type.Optional(Type.String({ maxLength: 128 })), calendarEventId: Type.Optional(Type.String({ maxLength: 128 })), calendarConfirmedAt: Type.Optional(Type.String({ maxLength: 40 })), preferredCallbackTime: Type.Optional(Type.String({ maxLength: 80 })), contactOptedIn: Type.Optional(Type.Boolean()), consentProvenance: Type.Optional(WhatsAppConsentProvenanceSchema), consentRecorded: Type.Optional(Type.Boolean()), consentTimestamp: Type.Optional(Type.String({ maxLength: 40 })), detectedLanguage: Type.Optional(WhatsAppCustomerLanguageSchema), optOutRequested: Type.Optional(Type.Literal(true)), humanHandoffRequested: Type.Optional(Type.Literal(true)), injectionDetected: Type.Optional(Type.Literal(true)), sensitiveOrUncertain: Type.Optional(Type.Literal(true)), escalationReason: Type.Optional(WhatsAppEscalationReasonSchema), autoReplyStatus: Type.Optional(WhatsAppAutoReplyStatusSchema) }, { additionalProperties: false });
export const N8nWhatsAppAttachmentSchema = Type.Object({ kind: MetaWhatsAppStoredMediaSchema.properties.kind, mimeType: MetaWhatsAppStoredMediaSchema.properties.mimeType, filename: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })), downloadStatus: Type.Literal('not_downloaded') }, { additionalProperties: false });
const InboxMessage = Type.Object({ attachment: Type.Optional(N8nWhatsAppAttachmentSchema), deliveryEvents: Type.Optional(Type.Array(SavedDeliveryEvent, { minItems: 1, maxItems: 4 })), id: Type.String({ minLength: 1, maxLength: 300 }), providerMessageId: Type.Union([MetaProviderMessageIdSchema, Type.Null()]), recipientId: Id, maskedPhone: Type.String({ maxLength: 32 }), direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]), textPreview: Type.String({ maxLength: 2048 }), timestamp: Type.String(), status: Type.Union([Type.Literal('received'), Type.Literal('reserved'), Type.Literal('unverified'), Type.Literal('sent'), Type.Literal('delivered'), Type.Literal('read'), Type.Literal('failed')]), mode: Type.Literal('offline_test'), verified: Type.Literal(false), untrusted: Type.Literal(true) }, { additionalProperties: false });
const InboxConversation = Type.Object({ recipientId: Id, contactName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })), maskedPhone: Type.String({ maxLength: 32 }), messageCount: Type.Integer({ minimum: 1, maximum: 2000 }), lastMessageAt: Type.String(), lastMessagePreview: Type.String({ maxLength: 2048 }), untrusted: Type.Literal(true), enquiry: Type.Optional(WhatsAppConversationEnquirySchema) }, { additionalProperties: false });
export const N8nWhatsAppInboxSchema = Type.Object({ transport: Type.Literal('n8n'), mode: Type.Literal('offline_test'), liveSendingEnabled: Type.Boolean(), autoReplyEnabled: Type.Optional(Type.Boolean()), startupRecoveryFailed: Type.Optional(Type.Boolean()), verified: Type.Literal(false), connectionId: Id, revision: Type.Integer({ minimum: 1 }), conversations: Type.Array(InboxConversation, { maxItems: 500 }), messages: Type.Array(InboxMessage, { maxItems: 50 }), nextPageToken: Type.Union([Type.String({ maxLength: 69 }), Type.Null()]) }, { additionalProperties: false });
export type N8nWhatsAppInbox = Static<typeof N8nWhatsAppInboxSchema>;
export const isN8nWhatsAppInbox = (value: unknown): value is N8nWhatsAppInbox => Value.Check(N8nWhatsAppInboxSchema, value);
// Step 108.23: authorized contacts for start-chat and eligibility. Masked numbers only; never full addresses.
export const N8nWhatsAppContactsSchema = Type.Object({ connectionId: Id, revision: Type.Integer({ minimum: 1 }), liveSendingEnabled: Type.Boolean(), contacts: Type.Array(Type.Object({
  recipientId: Id, contactName: Type.String({ minLength: 1, maxLength: 80 }), maskedPhone: Type.String({ maxLength: 32 }), optedIn: Type.Boolean(),
  lastInboundAt: Type.Union([Type.String({ minLength: 24, maxLength: 24 }), Type.Null()]),
  eligibility: Type.Union([Type.Literal('eligible'), Type.Literal('window_closed'), Type.Literal('not_opted_in')])
}, { additionalProperties: false }), { maxItems: 500 }) }, { additionalProperties: false });
export type N8nWhatsAppContacts = Static<typeof N8nWhatsAppContactsSchema>;
export const isN8nWhatsAppContacts = (value: unknown): value is N8nWhatsAppContacts => Value.Check(N8nWhatsAppContactsSchema, value);
// Step 108.25: approved-template catalog (sanitized provider data; untrusted text).
export const N8nWhatsAppTemplateButtonSchema = Type.Object({
  type: Type.Union([Type.Literal('QUICK_REPLY'), Type.Literal('URL'), Type.Literal('PHONE_NUMBER'), Type.Literal('OTHER')]),
  text: Type.String({ minLength: 1, maxLength: 60 }),
  dynamic: Type.Optional(Type.Literal(true))
}, { additionalProperties: false });
export const N8nWhatsAppTemplatesSchema = Type.Object({ connectionId: Id, templates: Type.Array(Type.Object({
  name: Type.String({ pattern: '^[a-z0-9_]{1,512}$' }), language: Type.String({ pattern: '^[a-z]{2,3}(?:_[A-Z]{2})?$' }),
  status: Type.Union([Type.Literal('APPROVED'), Type.Literal('PENDING'), Type.Literal('REJECTED'), Type.Literal('PAUSED'), Type.Literal('DISABLED')]),
  category: Type.Union([Type.Literal('MARKETING'), Type.Literal('UTILITY'), Type.Literal('AUTHENTICATION')]),
  bodyText: Type.String({ minLength: 1, maxLength: 1024 }), bodyParams: Type.Integer({ minimum: 0, maximum: 99 }),
  headerText: Type.Optional(Type.String({ maxLength: 60 })), headerParams: Type.Optional(Type.Integer({ minimum: 0, maximum: 1 })), headerMedia: Type.Optional(Type.Literal(true)),
  footerText: Type.Optional(Type.String({ maxLength: 60 })),
  buttons: Type.Optional(Type.Array(N8nWhatsAppTemplateButtonSchema, { minItems: 1, maxItems: 10 })),
  unsupportedButtons: Type.Optional(Type.Literal(true)),
  invalidPlaceholders: Type.Optional(Type.Literal(true))
}, { additionalProperties: false }), { maxItems: 100 }) }, { additionalProperties: false });
export type N8nWhatsAppTemplates = Static<typeof N8nWhatsAppTemplatesSchema>;
export const isN8nWhatsAppTemplates = (value: unknown): value is N8nWhatsAppTemplates => Value.Check(N8nWhatsAppTemplatesSchema, value);
export const isN8nWhatsAppConnections = (value: unknown): value is N8nWhatsAppConnections => Value.Check(N8nWhatsAppConnectionsSchema, value);
export const N8nWhatsAppDispatchAcknowledgementSchema = Type.Object({ dispatchId: Id, status: Type.Union([Type.Literal('not_configured'), Type.Literal('unverified')]), verified: Type.Literal(false) }, { additionalProperties: false });
export type N8nWhatsAppDispatchAcknowledgement = Static<typeof N8nWhatsAppDispatchAcknowledgementSchema>;
export const N8nWhatsAppRelaySchema = Type.Object({ event: Type.Unknown() }, { additionalProperties: false });
export const N8nWhatsAppDispatchSchema = Type.Object({ draft: MetaWhatsAppAnySendInputSchema, approvalId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false });
export const N8nWhatsAppDurableStatusSchema = Type.Object({ transport: Type.Literal('n8n'), mode: Type.Literal('offline_test'), configured: Type.Literal(false), liveSendingEnabled: Type.Literal(false), storage: Type.Literal('postgresql_offline'), revision: Type.Integer({ minimum: 1 }), disconnected: Type.Boolean() }, { additionalProperties: false });
export const N8nWhatsAppDisconnectSchema = Type.Object({ disconnected: Type.Literal(true), revision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
export const N8nWhatsAppClaimSchema = Type.Object({ dispatchId: Id, connectionRevision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
export const N8nWhatsAppProviderReceiptSchema = Type.Object({ dispatchId: Id, providerMessageId: MetaProviderMessageIdSchema, recipientAddress: Type.String({ pattern: '^[1-9][0-9]{7,14}$' }) }, { additionalProperties: false });
export type N8nWhatsAppProviderReceipt = Static<typeof N8nWhatsAppProviderReceiptSchema>;
export const N8nWhatsAppReceiptSchema = Type.Object({ transport: Type.Literal('n8n'), mode: Type.Literal('offline_test'), dispatchId: Type.Union([Id, Type.Null()]), providerMessageId: Type.Union([MetaProviderMessageIdSchema, Type.Null()]), status: Type.Union([Type.Literal('not_configured'), Type.Literal('unverified'), Type.Literal('sent'), Type.Literal('delivered'), Type.Literal('read'), Type.Literal('failed')]), verified: Type.Literal(false) }, { additionalProperties: false });
export type N8nWhatsAppReceipt = Static<typeof N8nWhatsAppReceiptSchema>;
export const N8nWhatsAppStatusSchema = Type.Object({ transport: Type.Literal('n8n'), mode: Type.Union([Type.Literal('disabled'), Type.Literal('offline_test')]), configured: Type.Boolean(), liveSendingEnabled: Type.Literal(false), storage: Type.Union([Type.Literal('not_configured'), Type.Literal('temporary_test_memory')]) }, { additionalProperties: false });
export const N8nWhatsAppClaimResponseSchema = Type.Object({ authorized: Type.Literal(true), dispatchEnabled: Type.Boolean(), dispatchId: Id, phoneNumberId: Type.String(), recipientPhoneNumber: Type.String(), messageType: Type.Optional(Type.Union([Type.Literal('text'), Type.Literal('template'), Type.Literal('media')])), textBody: Type.Optional(Type.String()), template: Type.Optional(MetaWhatsAppTemplateDraftSchema), media: Type.Optional(MetaWhatsAppMediaDraftSchema), replyToProviderMessageId: Type.Optional(MetaProviderMessageIdSchema) }, { additionalProperties: false });
export const N8nWhatsAppRelayResultSchema = Type.Object({ acceptedMessages: Type.Integer({ minimum: 0 }), statusUpdates: Type.Integer({ minimum: 0 }), duplicates: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export const N8nWhatsAppHistorySchema = Type.Array(Type.Object({ providerMessageId: MetaProviderMessageIdSchema, recipientId: Id, senderMaskedPhone: Type.String(), textPreview: Type.String(), timestamp: Type.String(), mode: Type.Literal('offline_test'), untrusted: Type.Literal(true) }, { additionalProperties: false }), { maxItems: 1000 });

// Owner reply preparation: the server builds the draft from the connection binding; the browser never supplies Meta IDs.
export const N8nWhatsAppReplyDraftRequestSchema = Type.Object({ recipientId: Id, bodyText: Type.String({ minLength: 1, maxLength: 4096 }), replyToProviderMessageId: Type.Optional(MetaProviderMessageIdSchema) }, { additionalProperties: false });
export type N8nWhatsAppReplyDraftRequest = Static<typeof N8nWhatsAppReplyDraftRequestSchema>;
export const N8nWhatsAppReplyDraftSchema = Type.Object({ draft: MetaWhatsAppSendInputSchema, actionName: Type.Literal('whatsapp.meta.messages.send'), riskLevel: Type.Literal('high'), liveSendingEnabled: Type.Literal(false) }, { additionalProperties: false });
export type N8nWhatsAppReplyDraft = Static<typeof N8nWhatsAppReplyDraftSchema>;
// Step 108.26: template/media drafts, contact updates and upload results.
export const N8nWhatsAppPreparedDraftSchema = Type.Object({ draft: MetaWhatsAppAnySendInputSchema, actionName: Type.Literal('whatsapp.meta.messages.send'), riskLevel: Type.Literal('high'), liveSendingEnabled: Type.Literal(false) }, { additionalProperties: false });
export type N8nWhatsAppPreparedDraft = Static<typeof N8nWhatsAppPreparedDraftSchema>;
export const isN8nWhatsAppPreparedDraft = (value: unknown): value is N8nWhatsAppPreparedDraft => Value.Check(N8nWhatsAppPreparedDraftSchema, value);
export const N8nWhatsAppTemplateDraftRequestSchema = Type.Object({ recipientId: Id, name: MetaWhatsAppTemplateDraftSchema.properties.name, language: MetaWhatsAppTemplateDraftSchema.properties.language,
  bodyParams: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 20 })), headerParams: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 1 })) }, { additionalProperties: false });
export type N8nWhatsAppTemplateDraftRequest = Static<typeof N8nWhatsAppTemplateDraftRequestSchema>;
export const N8nWhatsAppMediaDraftRequestSchema = Type.Object({ recipientId: Id, media: MetaWhatsAppMediaDraftSchema }, { additionalProperties: false });
// Existing contacts omit phoneE164 (the stored number is kept); only new contacts carry a full number. Numbers never return to browsers.
export const N8nWhatsAppContactsUpdateSchema = Type.Object({ contacts: Type.Array(Type.Object({ id: Id, phoneE164: Type.Optional(Type.String({ pattern: '^\\+[1-9][0-9]{7,14}$' })), optedIn: Type.Boolean(),
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })) }, { additionalProperties: false }), { minItems: 1, maxItems: 500 }) }, { additionalProperties: false });
export const N8nWhatsAppContactsUpdatedSchema = Type.Object({ connectionId: Id, revision: Type.Integer({ minimum: 1 }), contacts: Type.Integer({ minimum: 1, maximum: 500 }) }, { additionalProperties: false });
export const N8nWhatsAppMediaUploadSchema = Type.Object({ media: Type.Object({ kind: MetaWhatsAppMediaDraftSchema.properties.kind, mediaId: MetaWhatsAppMediaDraftSchema.properties.mediaId, mimeType: MetaWhatsAppMediaDraftSchema.properties.mimeType,
  sha256: MetaWhatsAppMediaDraftSchema.properties.sha256, filename: MetaWhatsAppMediaDraftSchema.properties.filename }, { additionalProperties: false }) }, { additionalProperties: false });
export type N8nWhatsAppMediaUpload = Static<typeof N8nWhatsAppMediaUploadSchema>;
export const isN8nWhatsAppMediaUpload = (value: unknown): value is N8nWhatsAppMediaUpload => Value.Check(N8nWhatsAppMediaUploadSchema, value);
export const isN8nWhatsAppContactsUpdate = (value: unknown) => Value.Check(N8nWhatsAppContactsUpdateSchema, value);
export const isN8nWhatsAppContactsUpdated = (value: unknown) => Value.Check(N8nWhatsAppContactsUpdatedSchema, value);
export const isN8nWhatsAppTemplateDraftRequest = (value: unknown): value is N8nWhatsAppTemplateDraftRequest =>
  Value.Check(N8nWhatsAppTemplateDraftRequestSchema, value)
  && [...(value.headerParams ?? []), ...(value.bodyParams ?? [])].every(p => isValidWhatsAppTemplateParam(p));
export const isN8nWhatsAppMediaDraftRequest = (value: unknown) => Value.Check(N8nWhatsAppMediaDraftRequestSchema, value);
export const isN8nWhatsAppReplyDraft = (value: unknown): value is N8nWhatsAppReplyDraft => Value.Check(N8nWhatsAppReplyDraftSchema, value);
export const isN8nWhatsAppReceipt = (value: unknown): value is N8nWhatsAppReceipt => Value.Check(N8nWhatsAppReceiptSchema, value);
