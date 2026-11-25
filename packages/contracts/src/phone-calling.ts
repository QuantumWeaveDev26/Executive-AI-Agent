import {Type,type Static} from '@sinclair/typebox';
import {PhoneCallEvidenceSchema} from './phone-call-evidence.js';
import {PhoneSyncedCallDetailsSchema} from './phone-n8n-sync.js';
export const PHONE_AI_CALL_ACTION='phone.ai.calls.request';
const strict={additionalProperties:false};
const Id=Type.String({pattern:'^[a-zA-Z0-9_-]{1,128}$'});
export const PhoneCallingLanguageSchema=Type.Union([Type.Literal('en-IN'),Type.Literal('kn-IN'),Type.Literal('kn-en')]);
export type PhoneCallingLanguage=Static<typeof PhoneCallingLanguageSchema>;
export const PhoneCallingPrepareSchema=Type.Object({contactQuery:Type.String({minLength:1,maxLength:128}),selectedContactId:Type.Optional(Id),newRecipient:Type.Optional(Type.Object({previewApprovalId:Type.Optional(Type.String({pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'})),displayName:Type.String({minLength:1,maxLength:128}),consentConfirmed:Type.Boolean()},strict)),purpose:Type.String({minLength:1,maxLength:10000}),language:PhoneCallingLanguageSchema,maxDurationSeconds:Type.Optional(Type.Integer({minimum:30,maximum:300}))},strict);
export type PhoneCallingPrepare=Static<typeof PhoneCallingPrepareSchema>;
// 'live' drafts exist only when the server was explicitly configured for live calling (never by default).
export const PhoneCallingModeSchema=Type.Union([Type.Literal('simulation'),Type.Literal('live')]);
export const PhoneCallingDraftSchema=Type.Object({draftId:Id,newRecipient:Type.Optional(Type.Object({previewApprovalId:Type.Optional(Type.String({pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'})),phoneE164:Type.String({pattern:'^\\+91[6-9][0-9]{9}$'}),consentConfirmed:Type.Boolean(),eligibility:Type.Union([Type.Literal('unverified'),Type.Literal('eligible')])},strict)),contactId:Id,contactRevision:Type.Integer({minimum:1}),contactBindingHash:Type.String({pattern:'^[a-f0-9]{64}$'}),recipient:Type.Object({displayName:Type.String({minLength:1,maxLength:128}),maskedPhone:Type.String({maxLength:32})},strict),purpose:Type.String({minLength:1,maxLength:10000}),language:PhoneCallingLanguageSchema,maxDurationSeconds:Type.Integer({minimum:30,maximum:300}),aiDisclosure:Type.String({minLength:1,maxLength:300}),consentReference:Id,idempotencyKey:Id,mode:PhoneCallingModeSchema,providerBindingHash:Type.Optional(Type.String({pattern:'^[a-f0-9]{64}$'})),onBehalfOf:Type.Optional(Type.String({minLength:1,maxLength:40}))},strict);
export type PhoneCallingDraft=Static<typeof PhoneCallingDraftSchema>;
export const PhoneCallingPreparedSchema=Type.Object({draft:PhoneCallingDraftSchema,approvalId:Type.String({format:'uuid'}),planId:Type.String({format:'uuid'}),stepId:Type.String({format:'uuid'}),status:Type.Literal('awaiting_approval'),liveCallingEnabled:Type.Boolean()},strict);
export type PhoneCallingPrepared=Static<typeof PhoneCallingPreparedSchema>;
export const PhoneCallingStatusSchema=Type.Object({status:Type.Union([Type.Literal('not_configured'),Type.Literal('simulation_only'),Type.Literal('live_enabled')]),liveCallingEnabled:Type.Boolean(),contactDirectoryConfigured:Type.Boolean(),simulationEnabled:Type.Boolean(),durableCallHistory:Type.Boolean(),recordingEnabled:Type.Literal(false),languages:Type.Array(PhoneCallingLanguageSchema),speechVerified:Type.Literal(false)},strict);
export const PhoneCallingStateSchema=Type.Union(['queued','ringing','answered','completed','failed','cancelled','busy','no_answer'].map(v=>Type.Literal(v as 'queued'|'ringing'|'answered'|'completed'|'failed'|'cancelled'|'busy'|'no_answer')));
export type PhoneCallingState=Static<typeof PhoneCallingStateSchema>;
export const PhoneCallingReportSchema=Type.Object({conversation:Type.Optional(PhoneCallEvidenceSchema),text:Type.String({maxLength:16000}),spokenText:Type.String({maxLength:16000}),quotedResponses:Type.Array(Type.String({maxLength:1000}),{maxItems:12}),evidenceIds:Type.Array(Id,{maxItems:12}),verified:Type.Literal(false),simulated:Type.Boolean()},strict);
export type PhoneCallingReport=Static<typeof PhoneCallingReportSchema>;
// Live outbox state. 'unverified' = provider accepted the request (not a call outcome); 'unknown' = outcome unknown, never auto-retried.
export const PhoneCallingDispatchStatusSchema=Type.Union(['pending','claimed','unverified','failed','unknown'].map(v=>Type.Literal(v as 'pending'|'claimed'|'unverified'|'failed'|'unknown')));
export const PhoneCallingRecordSchema=Type.Object({id:Id,approvalId:Type.String({format:'uuid'}),draft:PhoneCallingDraftSchema,state:PhoneCallingStateSchema,createdAt:Type.String(),updatedAt:Type.String(),providerCallId:Type.Union([Type.Null(),Type.String({pattern:"^([A-Za-z0-9_.:-]{1,128}|[0-9]{8}/[A-Za-z0-9][A-Za-z0-9_.:-]{0,99})$"})]),verified:Type.Literal(false),simulated:Type.Boolean(),dispatchStatus:Type.Optional(PhoneCallingDispatchStatusSchema),report:PhoneCallingReportSchema,syncedDetails:Type.Optional(PhoneSyncedCallDetailsSchema)},strict);
export type PhoneCallingRecord=Static<typeof PhoneCallingRecordSchema>;
export const PhoneCallingHistorySchema=Type.Object({calls:Type.Array(PhoneCallingRecordSchema,{maxItems:100}),durable:Type.Boolean(),liveCallingEnabled:Type.Boolean()},strict);
export const PhoneCallingSimulationSchema=Type.Object({approvalId:Type.String({format:'uuid'})},strict);
/** Owner-initiated rendering of an existing report; never accepts text, a phone number or a provider target. */
export const PHONE_REPORT_SPEECH_ACTION='phone.ai.calls.report_speech' as const;
export const PhoneCallingSpeechRequestSchema=Type.Object({callId:Type.String({pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'})},strict);
// Step 110 A2: owner-managed contacts. Raw numbers are accepted on write but never returned to the browser.
export const PhoneContactConsentSourceSchema=Type.Union([Type.Literal('recipient_verbal'),Type.Literal('recipient_written'),Type.Literal('recipient_message')]);
const ContactName=Type.String({minLength:1,maxLength:128,pattern:'^[^<>\\u0000-\\u001f\\u007f]+$'});
const IndianMobile=Type.String({pattern:'^\\+91[6-9][0-9]{9}$'});
const ContactConsentInput=Type.Object({callingAllowed:Type.Boolean(),source:PhoneContactConsentSourceSchema,validDays:Type.Integer({minimum:1,maximum:365})},strict);
export const PhoneContactCreateSchema=Type.Object({displayName:ContactName,aliases:Type.Optional(Type.Array(ContactName,{maxItems:20})),phoneE164:IndianMobile,consent:ContactConsentInput},strict);
export type PhoneContactCreate=Static<typeof PhoneContactCreateSchema>;
export const PhoneContactUpdateSchema=Type.Object({expectedRevision:Type.Integer({minimum:1}),displayName:ContactName,aliases:Type.Optional(Type.Array(ContactName,{maxItems:20})),phoneE164:Type.Optional(IndianMobile),consent:ContactConsentInput},strict);
export type PhoneContactUpdate=Static<typeof PhoneContactUpdateSchema>;
export const PhoneContactArchiveSchema=Type.Object({expectedRevision:Type.Integer({minimum:1})},strict);
export const PhoneContactViewSchema=Type.Object({contactId:Id,revision:Type.Integer({minimum:1}),displayName:Type.String({minLength:1,maxLength:128}),aliases:Type.Array(Type.String({maxLength:128}),{maxItems:20}),maskedPhone:Type.String({pattern:'^\\+\\d{1,3} \\*{6}\\d{4}$'}),archived:Type.Boolean(),consent:Type.Object({callingAllowed:Type.Boolean(),source:PhoneContactConsentSourceSchema,recordedAt:Type.String(),expiresAt:Type.String(),expired:Type.Boolean()},strict)},strict);
export type PhoneContactView=Static<typeof PhoneContactViewSchema>;
export const PhoneContactListSchema=Type.Object({contacts:Type.Array(PhoneContactViewSchema,{maxItems:1000})},strict);
// Owner's own open call requests (pending or approved, unexpired, not yet started), so an approved live request survives a reload.
export const PhoneCallingRequestSchema=Type.Object({approvalId:Type.String({format:'uuid'}),status:Type.Union([Type.Literal('pending'),Type.Literal('approved')]),expiresAt:Type.String(),draft:PhoneCallingDraftSchema},strict);
export type PhoneCallingRequest=Static<typeof PhoneCallingRequestSchema>;
export const PhoneCallingRequestListSchema=Type.Object({requests:Type.Array(PhoneCallingRequestSchema,{maxItems:20})},strict);

/** Bounded opaque provider ID; escape before constructing any URL. */
export const PHONE_PROVIDER_CALL_ID_PATTERN="^([A-Za-z0-9_.:-]{1,128}|[0-9]{8}/[A-Za-z0-9][A-Za-z0-9_.:-]{0,99})$";
export const isPhoneProviderCallId=(value:unknown):value is string=>typeof value==='string'&&new RegExp(PHONE_PROVIDER_CALL_ID_PATTERN).test(value);
export const PHONE_CALL_RESULT_READ_ACTION='phone.ai.calls.result_read' as const;
export const PhoneCallingProviderResultSchema=Type.Object({callId:Id,status:Type.Union([Type.Literal('available'),Type.Literal('pending'),Type.Literal('unavailable')]),outcome:Type.Optional(Type.Union([Type.Literal('completed'),Type.Literal('busy'),Type.Literal('no_answer'),Type.Literal('failed')])),conversation:Type.Optional(PhoneCallEvidenceSchema),responses:Type.Array(Type.String({maxLength:1000}),{maxItems:12}),verified:Type.Literal(false),source:Type.Literal('provider_api')},strict);
export type PhoneCallingProviderResult=Static<typeof PhoneCallingProviderResultSchema>;
