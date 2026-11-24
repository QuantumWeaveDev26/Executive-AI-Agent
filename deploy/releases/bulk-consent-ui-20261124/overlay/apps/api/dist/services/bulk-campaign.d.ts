import { type BulkCampaignAiInterpretation, type BulkCampaignCallScript, type BulkCampaignChannel, type BulkCampaignExtractedFacts, type BulkCampaignContactRecord, type BulkCampaignDashboardMetrics, type BulkCampaignEligiblePilotContact, type BulkCampaignMode, type BulkCampaignSheetMonitorConfig, type BulkCampaignStandingAuthorization, type BulkCampaignImportedContact, type BulkCampaignImportResult, type BulkCampaignKnowledgeContext, type BulkCampaignKnowledgeUploadInput, type BulkCampaignLanguage, type BulkCampaignLimits, type BulkCampaignN8nBatchConfig, type BulkCampaignN8nChannel, type BulkCampaignN8nExecutionJob, type BulkCampaignPhoneCallStatus, type BulkCampaignPilotCallState, type BulkCampaignPilotWhatsAppState, type BulkCampaignSimulatedDialogueTurn, type BulkCampaignSourceType, type BulkCampaignStatus, type BulkCampaignWebinarDetails, type BulkCampaignWhatsAppPlan, type BulkCampaignWorkspaceContext, type PhoneBatchIntegrationContract, type PhoneCallingDraft, type PhoneCallingLanguage, type PhoneCallingPrepare, type PhoneCallingPrepared, type PhoneCallingProviderResult, type PhoneCallingRecord, type PhoneCallingRequest, type PhoneCallingState, type PhoneContactView } from '@thaara/contracts';
import { type AuthenticatedScope, type TransactionalDbClient } from '@thaara/db';
import type { ActionAdapter } from '@thaara/policy';
import { type GmailFoundation } from './gmail.js';
import { answerCampaignCustomerQuestion, buildSarvamBoundedFactBrief, enrichOrUpgradeCampaignKnowledgeContext, generateSampleGroundedQa, ingestCampaignKnowledgeFiles, isInternalKnowledgeGovernanceText, retrieveCampaignKnowledgeChunks, SARVAM_OUTBOUND_AGENT_LABEL } from './bulk-campaign-knowledge.js';
export { answerCampaignCustomerQuestion, buildSarvamBoundedFactBrief, enrichOrUpgradeCampaignKnowledgeContext, generateSampleGroundedQa, ingestCampaignKnowledgeFiles, isInternalKnowledgeGovernanceText, retrieveCampaignKnowledgeChunks, SARVAM_OUTBOUND_AGENT_LABEL };
import type { PhoneCallingService, PhoneContactDirectory } from './phone-calling.js';
import type { PhoneContactManagementService } from './phone-contacts.js';
import type { DurableWhatsAppService } from './whatsapp-durable.js';
import type { WhatsAppTemplateService } from './whatsapp-templates.js';
export declare const DEFAULT_DAILY_PHONE_CALL_LIMIT = 5;
export declare const MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT = 10000;
/**
 * 5 saved, owner-authorized contacts in `PhoneContactDirectory` with active calling consent
 * and supported languages (`en-IN`, `kn-IN`, `kn-en`), plus 1 duplicate row and 1 invalid row.
 */
export declare const SYNTHETIC_DEMO_CONTACTS_CSV: string;
export declare const DEFAULT_DEMO_PHONE_DIRECTORY: PhoneContactView[];
export declare const DEFAULT_DEMO_INSTRUCTION = "Thaara, tomorrow we have an AI and Digital Marketing webinar at 7 PM. Send invitations to these contacts, call the eligible contacts, explain the webinar, ask if they will attend, and give me a complete report.";
export declare const COMPANY_INTRODUCTION_SIMULATION_INSTRUCTION = "Thaara, introduce Quantum Weave AI to these contacts. Explain our company and services using our verified uploaded company knowledge. Understand their business requirements, answer relevant questions naturally, identify interested businesses, and offer human follow-up where appropriate. Record the outcomes and provide a final report.";
/**
 * 5 isolated fictional business contacts for safe Company Introduction simulation testing.
 * - Unmistakably marked with `isSyntheticTestFixture: true` and `[SYNTHETIC TEST]` labels.
 * - Contain ZERO dialable E.164 phone numbers (`phoneE164` is omitted; `maskedPhone` is `TEST-FIXTURE-000X`).
 * - Never written into `phone_contacts` or customer lead tables, and unconditionally blocked from `mode: 'live'`.
 */
export declare const SYNTHETIC_COMPANY_SIMULATION_CONTACTS: readonly BulkCampaignImportedContact[];
export declare function buildSyntheticCompanyImportResult(): BulkCampaignImportResult;
export declare function simulateSyntheticCompanyScenario(input: {
    contact: BulkCampaignImportedContact;
    openingLine: string;
    aiDisclosure: string;
    knowledgeContext?: BulkCampaignKnowledgeContext;
    eventDetails?: string;
}): {
    scenarioTitle: string;
    turns: BulkCampaignSimulatedDialogueTurn[];
    rawCustomerResponses: string[];
    reportText: string;
    outcome: 'interested' | 'wants_more_info' | 'declined' | 'callback_requested';
    followUpRequired: boolean;
    followUpReason?: string;
    preferredCallbackTime?: string;
    rationale: string;
};
export declare function normalizeCampaignPhone(raw: string): {
    valid: boolean;
    e164?: string;
    masked?: string;
    isIndianMobile?: boolean;
    reason?: string;
};
export declare function isSupportedPhoneCallingLanguage(lang: string): lang is PhoneCallingLanguage;
/**
 * Converts campaign pitch and questions into a single-line bounded `purpose` (`1..1000` chars)
 * compatible with `PhoneCallingPrepareSchema.properties.purpose`.
 */
export declare function buildBoundedPhonePurpose(input: {
    eventDetails: string;
    eventPitch: string;
    questions: string[];
}): string;
export declare function renderPersonalizedWhatsAppPreview(templatePreview: string, contactName: string): string;
export declare function renderPersonalizedEmailPreview(bodyTemplate: string, contactName: string, company?: string): string;
export declare function extractLinesFromXlsxBuffer(bytes: Buffer): string[];
export declare function extractLinesFromPdfBuffer(bytes: Buffer): string[];
/**
 * Extracts tabular/contact lines from CSV, Excel (OOXML .xlsx binary ZIP / SpreadsheetML XML / TSV / CSV),
 * PDF text streams (compressed FlateDecode or uncompressed), or pasted text.
 */
export declare function extractRawLinesFromSource(sourceType: BulkCampaignSourceType, rawText: string, binaryBytes?: Buffer): string[];
export interface WhatsAppOptedInDirectoryEntry {
    recipientId: string;
    contactName: string;
    maskedPhone: string;
    optedIn: boolean;
}
/**
 * Stage 1: Parse uploaded CSV / Excel (XLSX binary ZIP / TSV / CSV / XML) / PDF (compressed or plain) / pasted contact list,
 * matching saved contacts in `PhoneContactDirectory` and `DurableWhatsAppService` without bypassing consent or phone validation.
 * Newly uploaded numbers are NEVER assumed authorized for calling or messaging.
 */
export declare const MAX_IMPORT_RAW_TEXT_BYTES: number;
export declare function parseBulkCampaignContacts(input: {
    sourceType: BulkCampaignSourceType;
    fileName?: string;
    rawText: string;
    fileBase64?: string;
    phoneDirectory?: PhoneContactView[];
    whatsappDirectory?: WhatsAppOptedInDirectoryEntry[];
}): BulkCampaignImportResult;
/**
 * Builds a BulkCampaignImportResult directly from existing saved Thaara contacts (`PhoneContactDirectory`)
 * without duplicating or mutating any permanent address book entries.
 */
export declare function buildSavedContactsImportResult(input: {
    phoneDirectory: PhoneContactView[];
    whatsappDirectory?: WhatsAppOptedInDirectoryEntry[];
}): BulkCampaignImportResult;
export interface BulkCampaignEmailPlan {
    subject: string;
    bodyPreview: string;
    liveSendingEnabled: false;
}
export interface BulkCampaignState {
    campaignId: string;
    workspaceId: string;
    createdByUserId: string;
    createdAt: string;
    updatedAt: string;
    instruction: string;
    title: string;
    objective: string;
    eventDetails: string;
    webinarDetails?: BulkCampaignWebinarDetails;
    channels: BulkCampaignChannel[];
    whatsappPlan: BulkCampaignWhatsAppPlan;
    callScript: BulkCampaignCallScript;
    emailPlan?: BulkCampaignEmailPlan;
    limits: BulkCampaignLimits;
    scheduledFor?: string;
    emailConnected: boolean;
    importSummary: Omit<BulkCampaignImportResult, 'validContacts'>;
    contacts: BulkCampaignContactRecord[];
    materialHash: string;
    status: BulkCampaignStatus;
    mode?: BulkCampaignMode;
    sheetMonitor?: BulkCampaignSheetMonitorConfig;
    standingAuthorization?: BulkCampaignStandingAuthorization;
    executionMode: 'planned' | 'simulation' | 'live';
    liveCallingEnabled: boolean;
    liveSendingEnabled: boolean;
    approval?: {
        approvalId: string;
        approvedByUserId: string;
        approvedAt: string;
        approvedMaterialHash: string;
        estimatedCostInr: number;
    };
    liveExecutionGrant?: {
        grantId: string;
        workspaceId: string;
        approvedByUserId: string;
        campaignId: string;
        approvedMaterialHash: string;
        authorizedChannels: BulkCampaignChannel[];
        selectedContactIds: string[];
        limits: BulkCampaignLimits;
        grantedAt: string;
        expiresAt: string;
        revoked: boolean;
    };
    governedPlanId?: string;
    governedStepId?: string;
    governedApprovalId?: string;
    knowledgeContext?: BulkCampaignKnowledgeContext;
    pilotCall?: BulkCampaignPilotCallState;
    pilotWhatsApp?: BulkCampaignPilotWhatsAppState;
    n8nJobs?: BulkCampaignN8nExecutionJob[];
    n8nJobTokenHashes?: Record<string, string>;
    dispatchedIdempotencyKeys: string[];
}
export declare function computeCampaignMaterialHash(input: {
    objective: string;
    eventDetails: string;
    channels: BulkCampaignChannel[];
    whatsappPlan: BulkCampaignWhatsAppPlan;
    callScript: BulkCampaignCallScript;
    limits: BulkCampaignLimits;
    contacts: BulkCampaignContactRecord[];
    knowledgeContext?: BulkCampaignKnowledgeContext;
}): string;
export declare function evaluateContactEligibility(contacts: BulkCampaignImportedContact[], selectedIds: Set<string>, channels: BulkCampaignChannel[], limits: BulkCampaignLimits, whatsappTemplatePreview: string, emailConnected: boolean, existingRecords?: Map<string, BulkCampaignContactRecord>, nowIso?: string, emailBodyPreview?: string): BulkCampaignContactRecord[];
/**
 * Separates contacts into clear UX buckets:
 * 1. Eligible (authorized for WhatsApp, Phone, and/or Email)
 * 2. Unauthorized (unconsented unsaved numbers, DND, or opted out)
 * 3. Unsupported (unsupported language like hi-IN, international phone, or over daily quota)
 * 4. Duplicates (from import)
 * 5. Invalid (from import)
 */
export declare function categorizeBulkCampaignContacts(campaign: BulkCampaignState): {
    eligible: {
        personalizedEmailPreview?: string | undefined;
        whatsappDispatchId?: string | null | undefined;
        whatsappProviderMessageId?: string | null | undefined;
        whatsappCustomerReply?: string | undefined;
        whatsappError?: string | undefined;
        emailStatus?: "queued" | "failed" | "cancelled" | "pending" | "skipped" | "not_applicable" | "sent" | "unsubscribed" | undefined;
        emailMessageId?: string | null | undefined;
        emailError?: string | undefined;
        phoneApprovalId?: string | undefined;
        phoneApprovalStatus?: "approved" | "awaiting_approval" | undefined;
        phoneDraft?: {
            onBehalfOf?: string | undefined;
            newRecipient?: {
                previewApprovalId?: string | undefined;
                phoneE164: string;
                consentConfirmed: boolean;
                eligibility: "unverified" | "eligible";
            } | undefined;
            providerBindingHash?: string | undefined;
            mode: "live" | "simulation";
            idempotencyKey: string;
            contactId: string;
            aiDisclosure: string;
            draftId: string;
            contactRevision: number;
            contactBindingHash: string;
            recipient: {
                displayName: string;
                maskedPhone: string;
            };
            purpose: string;
            language: "en-IN" | "kn-IN" | "kn-en";
            maxDurationSeconds: number;
            consentReference: string;
        } | undefined;
        phoneCallId?: string | null | undefined;
        phoneProviderCallId?: string | null | undefined;
        phoneDurationSeconds?: number | null | undefined;
        phoneRecordState?: "queued" | "ringing" | "answered" | "completed" | "failed" | "cancelled" | "busy" | "no_answer" | undefined;
        phoneLanguageUsed?: "en-IN" | "kn-IN" | "kn-en" | undefined;
        phoneDisclosedAi?: boolean | undefined;
        phoneProviderReportText?: string | undefined;
        simulatedScenarioTitle?: string | undefined;
        simulatedDialogueTurns?: {
            sourceRefs?: string[] | undefined;
            text: string;
            speaker: "thaara" | "customer";
        }[] | undefined;
        aiInterpretation?: {
            preferredCallbackTime?: string | undefined;
            attendanceClassification: "failed" | "busy" | "pending" | "skipped" | "confirmed" | "interested" | "declined" | "not_interested" | "wants_more_info" | "callback_requested" | "opted_out" | "no_response" | "invalid_number";
            rationale: string;
            isAiInterpretation: true;
            confirmedByEvidence: false;
        } | undefined;
        phoneTranscriptSummary?: string | undefined;
        preferredCallbackTime?: string | undefined;
        followUpReason?: string | undefined;
        retryCount?: number | undefined;
        interactionTimestamp?: string | undefined;
        structuredNotes?: string | undefined;
        contact: {
            phoneE164?: string | undefined;
            email?: string | undefined;
            phoneDirectoryContactId?: string | undefined;
            phoneDirectoryRevision?: number | undefined;
            isUnsavedCampaignContact?: boolean | undefined;
            isSyntheticTestFixture?: boolean | undefined;
            syntheticScenarioKey?: string | undefined;
            syntheticScenarioTitle?: string | undefined;
            isInternational?: boolean | undefined;
            company?: string | undefined;
            serviceRequired?: string | undefined;
            customerRequirement?: string | undefined;
            enquiryDate?: string | undefined;
            leadSource?: string | undefined;
            sourceLeadId?: string | undefined;
            sourceRowKey?: string | undefined;
            sheetRowNumber?: number | undefined;
            customFields?: {
                [x: string]: string;
            } | undefined;
            maskedPhone?: string | undefined;
            whatsappE164?: string | undefined;
            dnd?: boolean | undefined;
            dndStatus?: "unknown" | "dnd" | "clear" | undefined;
            consentSourceDetail?: string | undefined;
            consentRecordedAt?: string | undefined;
            optedOutStatus?: "unknown" | "opted_out" | "clear" | undefined;
            name: string;
            contactId: string;
            rowNumber: number;
            preferredLanguage: "en-IN" | "kn-IN" | "kn-en" | "hi-IN";
            optedOut: boolean;
            consent: {
                email: boolean;
                source: "unverified" | "explicit_column" | "owner_verified" | "phone_directory_verified" | "whatsapp_directory_verified";
                whatsapp: boolean;
                phone: boolean;
            };
        };
        updatedAt: string;
        selectedByOwner: boolean;
        category: "eligible" | "unauthorized" | "unsupported" | "deselected";
        categoryReason: string;
        personalizedWhatsappPreview: string;
        whatsappEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        phoneEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        emailEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        whatsappStatus: "queued" | "failed" | "cancelled" | "pending" | "unverified" | "skipped" | "not_applicable" | "sent" | "delivered" | "read";
        phoneStatus: "queued" | "answered" | "failed" | "cancelled" | "pending" | "awaiting_approval" | "skipped" | "not_applicable" | "attempted" | "not_answered";
        phoneRawResponses: string[];
        phoneReportVerified: boolean;
        followUpRequired: boolean;
        attendanceOutcome: "failed" | "busy" | "pending" | "skipped" | "confirmed" | "interested" | "declined" | "not_interested" | "wants_more_info" | "callback_requested" | "opted_out" | "no_response" | "invalid_number";
    }[];
    unauthorized: {
        personalizedEmailPreview?: string | undefined;
        whatsappDispatchId?: string | null | undefined;
        whatsappProviderMessageId?: string | null | undefined;
        whatsappCustomerReply?: string | undefined;
        whatsappError?: string | undefined;
        emailStatus?: "queued" | "failed" | "cancelled" | "pending" | "skipped" | "not_applicable" | "sent" | "unsubscribed" | undefined;
        emailMessageId?: string | null | undefined;
        emailError?: string | undefined;
        phoneApprovalId?: string | undefined;
        phoneApprovalStatus?: "approved" | "awaiting_approval" | undefined;
        phoneDraft?: {
            onBehalfOf?: string | undefined;
            newRecipient?: {
                previewApprovalId?: string | undefined;
                phoneE164: string;
                consentConfirmed: boolean;
                eligibility: "unverified" | "eligible";
            } | undefined;
            providerBindingHash?: string | undefined;
            mode: "live" | "simulation";
            idempotencyKey: string;
            contactId: string;
            aiDisclosure: string;
            draftId: string;
            contactRevision: number;
            contactBindingHash: string;
            recipient: {
                displayName: string;
                maskedPhone: string;
            };
            purpose: string;
            language: "en-IN" | "kn-IN" | "kn-en";
            maxDurationSeconds: number;
            consentReference: string;
        } | undefined;
        phoneCallId?: string | null | undefined;
        phoneProviderCallId?: string | null | undefined;
        phoneDurationSeconds?: number | null | undefined;
        phoneRecordState?: "queued" | "ringing" | "answered" | "completed" | "failed" | "cancelled" | "busy" | "no_answer" | undefined;
        phoneLanguageUsed?: "en-IN" | "kn-IN" | "kn-en" | undefined;
        phoneDisclosedAi?: boolean | undefined;
        phoneProviderReportText?: string | undefined;
        simulatedScenarioTitle?: string | undefined;
        simulatedDialogueTurns?: {
            sourceRefs?: string[] | undefined;
            text: string;
            speaker: "thaara" | "customer";
        }[] | undefined;
        aiInterpretation?: {
            preferredCallbackTime?: string | undefined;
            attendanceClassification: "failed" | "busy" | "pending" | "skipped" | "confirmed" | "interested" | "declined" | "not_interested" | "wants_more_info" | "callback_requested" | "opted_out" | "no_response" | "invalid_number";
            rationale: string;
            isAiInterpretation: true;
            confirmedByEvidence: false;
        } | undefined;
        phoneTranscriptSummary?: string | undefined;
        preferredCallbackTime?: string | undefined;
        followUpReason?: string | undefined;
        retryCount?: number | undefined;
        interactionTimestamp?: string | undefined;
        structuredNotes?: string | undefined;
        contact: {
            phoneE164?: string | undefined;
            email?: string | undefined;
            phoneDirectoryContactId?: string | undefined;
            phoneDirectoryRevision?: number | undefined;
            isUnsavedCampaignContact?: boolean | undefined;
            isSyntheticTestFixture?: boolean | undefined;
            syntheticScenarioKey?: string | undefined;
            syntheticScenarioTitle?: string | undefined;
            isInternational?: boolean | undefined;
            company?: string | undefined;
            serviceRequired?: string | undefined;
            customerRequirement?: string | undefined;
            enquiryDate?: string | undefined;
            leadSource?: string | undefined;
            sourceLeadId?: string | undefined;
            sourceRowKey?: string | undefined;
            sheetRowNumber?: number | undefined;
            customFields?: {
                [x: string]: string;
            } | undefined;
            maskedPhone?: string | undefined;
            whatsappE164?: string | undefined;
            dnd?: boolean | undefined;
            dndStatus?: "unknown" | "dnd" | "clear" | undefined;
            consentSourceDetail?: string | undefined;
            consentRecordedAt?: string | undefined;
            optedOutStatus?: "unknown" | "opted_out" | "clear" | undefined;
            name: string;
            contactId: string;
            rowNumber: number;
            preferredLanguage: "en-IN" | "kn-IN" | "kn-en" | "hi-IN";
            optedOut: boolean;
            consent: {
                email: boolean;
                source: "unverified" | "explicit_column" | "owner_verified" | "phone_directory_verified" | "whatsapp_directory_verified";
                whatsapp: boolean;
                phone: boolean;
            };
        };
        updatedAt: string;
        selectedByOwner: boolean;
        category: "eligible" | "unauthorized" | "unsupported" | "deselected";
        categoryReason: string;
        personalizedWhatsappPreview: string;
        whatsappEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        phoneEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        emailEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        whatsappStatus: "queued" | "failed" | "cancelled" | "pending" | "unverified" | "skipped" | "not_applicable" | "sent" | "delivered" | "read";
        phoneStatus: "queued" | "answered" | "failed" | "cancelled" | "pending" | "awaiting_approval" | "skipped" | "not_applicable" | "attempted" | "not_answered";
        phoneRawResponses: string[];
        phoneReportVerified: boolean;
        followUpRequired: boolean;
        attendanceOutcome: "failed" | "busy" | "pending" | "skipped" | "confirmed" | "interested" | "declined" | "not_interested" | "wants_more_info" | "callback_requested" | "opted_out" | "no_response" | "invalid_number";
    }[];
    unsupported: {
        personalizedEmailPreview?: string | undefined;
        whatsappDispatchId?: string | null | undefined;
        whatsappProviderMessageId?: string | null | undefined;
        whatsappCustomerReply?: string | undefined;
        whatsappError?: string | undefined;
        emailStatus?: "queued" | "failed" | "cancelled" | "pending" | "skipped" | "not_applicable" | "sent" | "unsubscribed" | undefined;
        emailMessageId?: string | null | undefined;
        emailError?: string | undefined;
        phoneApprovalId?: string | undefined;
        phoneApprovalStatus?: "approved" | "awaiting_approval" | undefined;
        phoneDraft?: {
            onBehalfOf?: string | undefined;
            newRecipient?: {
                previewApprovalId?: string | undefined;
                phoneE164: string;
                consentConfirmed: boolean;
                eligibility: "unverified" | "eligible";
            } | undefined;
            providerBindingHash?: string | undefined;
            mode: "live" | "simulation";
            idempotencyKey: string;
            contactId: string;
            aiDisclosure: string;
            draftId: string;
            contactRevision: number;
            contactBindingHash: string;
            recipient: {
                displayName: string;
                maskedPhone: string;
            };
            purpose: string;
            language: "en-IN" | "kn-IN" | "kn-en";
            maxDurationSeconds: number;
            consentReference: string;
        } | undefined;
        phoneCallId?: string | null | undefined;
        phoneProviderCallId?: string | null | undefined;
        phoneDurationSeconds?: number | null | undefined;
        phoneRecordState?: "queued" | "ringing" | "answered" | "completed" | "failed" | "cancelled" | "busy" | "no_answer" | undefined;
        phoneLanguageUsed?: "en-IN" | "kn-IN" | "kn-en" | undefined;
        phoneDisclosedAi?: boolean | undefined;
        phoneProviderReportText?: string | undefined;
        simulatedScenarioTitle?: string | undefined;
        simulatedDialogueTurns?: {
            sourceRefs?: string[] | undefined;
            text: string;
            speaker: "thaara" | "customer";
        }[] | undefined;
        aiInterpretation?: {
            preferredCallbackTime?: string | undefined;
            attendanceClassification: "failed" | "busy" | "pending" | "skipped" | "confirmed" | "interested" | "declined" | "not_interested" | "wants_more_info" | "callback_requested" | "opted_out" | "no_response" | "invalid_number";
            rationale: string;
            isAiInterpretation: true;
            confirmedByEvidence: false;
        } | undefined;
        phoneTranscriptSummary?: string | undefined;
        preferredCallbackTime?: string | undefined;
        followUpReason?: string | undefined;
        retryCount?: number | undefined;
        interactionTimestamp?: string | undefined;
        structuredNotes?: string | undefined;
        contact: {
            phoneE164?: string | undefined;
            email?: string | undefined;
            phoneDirectoryContactId?: string | undefined;
            phoneDirectoryRevision?: number | undefined;
            isUnsavedCampaignContact?: boolean | undefined;
            isSyntheticTestFixture?: boolean | undefined;
            syntheticScenarioKey?: string | undefined;
            syntheticScenarioTitle?: string | undefined;
            isInternational?: boolean | undefined;
            company?: string | undefined;
            serviceRequired?: string | undefined;
            customerRequirement?: string | undefined;
            enquiryDate?: string | undefined;
            leadSource?: string | undefined;
            sourceLeadId?: string | undefined;
            sourceRowKey?: string | undefined;
            sheetRowNumber?: number | undefined;
            customFields?: {
                [x: string]: string;
            } | undefined;
            maskedPhone?: string | undefined;
            whatsappE164?: string | undefined;
            dnd?: boolean | undefined;
            dndStatus?: "unknown" | "dnd" | "clear" | undefined;
            consentSourceDetail?: string | undefined;
            consentRecordedAt?: string | undefined;
            optedOutStatus?: "unknown" | "opted_out" | "clear" | undefined;
            name: string;
            contactId: string;
            rowNumber: number;
            preferredLanguage: "en-IN" | "kn-IN" | "kn-en" | "hi-IN";
            optedOut: boolean;
            consent: {
                email: boolean;
                source: "unverified" | "explicit_column" | "owner_verified" | "phone_directory_verified" | "whatsapp_directory_verified";
                whatsapp: boolean;
                phone: boolean;
            };
        };
        updatedAt: string;
        selectedByOwner: boolean;
        category: "eligible" | "unauthorized" | "unsupported" | "deselected";
        categoryReason: string;
        personalizedWhatsappPreview: string;
        whatsappEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        phoneEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        emailEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        whatsappStatus: "queued" | "failed" | "cancelled" | "pending" | "unverified" | "skipped" | "not_applicable" | "sent" | "delivered" | "read";
        phoneStatus: "queued" | "answered" | "failed" | "cancelled" | "pending" | "awaiting_approval" | "skipped" | "not_applicable" | "attempted" | "not_answered";
        phoneRawResponses: string[];
        phoneReportVerified: boolean;
        followUpRequired: boolean;
        attendanceOutcome: "failed" | "busy" | "pending" | "skipped" | "confirmed" | "interested" | "declined" | "not_interested" | "wants_more_info" | "callback_requested" | "opted_out" | "no_response" | "invalid_number";
    }[];
    deselected: {
        personalizedEmailPreview?: string | undefined;
        whatsappDispatchId?: string | null | undefined;
        whatsappProviderMessageId?: string | null | undefined;
        whatsappCustomerReply?: string | undefined;
        whatsappError?: string | undefined;
        emailStatus?: "queued" | "failed" | "cancelled" | "pending" | "skipped" | "not_applicable" | "sent" | "unsubscribed" | undefined;
        emailMessageId?: string | null | undefined;
        emailError?: string | undefined;
        phoneApprovalId?: string | undefined;
        phoneApprovalStatus?: "approved" | "awaiting_approval" | undefined;
        phoneDraft?: {
            onBehalfOf?: string | undefined;
            newRecipient?: {
                previewApprovalId?: string | undefined;
                phoneE164: string;
                consentConfirmed: boolean;
                eligibility: "unverified" | "eligible";
            } | undefined;
            providerBindingHash?: string | undefined;
            mode: "live" | "simulation";
            idempotencyKey: string;
            contactId: string;
            aiDisclosure: string;
            draftId: string;
            contactRevision: number;
            contactBindingHash: string;
            recipient: {
                displayName: string;
                maskedPhone: string;
            };
            purpose: string;
            language: "en-IN" | "kn-IN" | "kn-en";
            maxDurationSeconds: number;
            consentReference: string;
        } | undefined;
        phoneCallId?: string | null | undefined;
        phoneProviderCallId?: string | null | undefined;
        phoneDurationSeconds?: number | null | undefined;
        phoneRecordState?: "queued" | "ringing" | "answered" | "completed" | "failed" | "cancelled" | "busy" | "no_answer" | undefined;
        phoneLanguageUsed?: "en-IN" | "kn-IN" | "kn-en" | undefined;
        phoneDisclosedAi?: boolean | undefined;
        phoneProviderReportText?: string | undefined;
        simulatedScenarioTitle?: string | undefined;
        simulatedDialogueTurns?: {
            sourceRefs?: string[] | undefined;
            text: string;
            speaker: "thaara" | "customer";
        }[] | undefined;
        aiInterpretation?: {
            preferredCallbackTime?: string | undefined;
            attendanceClassification: "failed" | "busy" | "pending" | "skipped" | "confirmed" | "interested" | "declined" | "not_interested" | "wants_more_info" | "callback_requested" | "opted_out" | "no_response" | "invalid_number";
            rationale: string;
            isAiInterpretation: true;
            confirmedByEvidence: false;
        } | undefined;
        phoneTranscriptSummary?: string | undefined;
        preferredCallbackTime?: string | undefined;
        followUpReason?: string | undefined;
        retryCount?: number | undefined;
        interactionTimestamp?: string | undefined;
        structuredNotes?: string | undefined;
        contact: {
            phoneE164?: string | undefined;
            email?: string | undefined;
            phoneDirectoryContactId?: string | undefined;
            phoneDirectoryRevision?: number | undefined;
            isUnsavedCampaignContact?: boolean | undefined;
            isSyntheticTestFixture?: boolean | undefined;
            syntheticScenarioKey?: string | undefined;
            syntheticScenarioTitle?: string | undefined;
            isInternational?: boolean | undefined;
            company?: string | undefined;
            serviceRequired?: string | undefined;
            customerRequirement?: string | undefined;
            enquiryDate?: string | undefined;
            leadSource?: string | undefined;
            sourceLeadId?: string | undefined;
            sourceRowKey?: string | undefined;
            sheetRowNumber?: number | undefined;
            customFields?: {
                [x: string]: string;
            } | undefined;
            maskedPhone?: string | undefined;
            whatsappE164?: string | undefined;
            dnd?: boolean | undefined;
            dndStatus?: "unknown" | "dnd" | "clear" | undefined;
            consentSourceDetail?: string | undefined;
            consentRecordedAt?: string | undefined;
            optedOutStatus?: "unknown" | "opted_out" | "clear" | undefined;
            name: string;
            contactId: string;
            rowNumber: number;
            preferredLanguage: "en-IN" | "kn-IN" | "kn-en" | "hi-IN";
            optedOut: boolean;
            consent: {
                email: boolean;
                source: "unverified" | "explicit_column" | "owner_verified" | "phone_directory_verified" | "whatsapp_directory_verified";
                whatsapp: boolean;
                phone: boolean;
            };
        };
        updatedAt: string;
        selectedByOwner: boolean;
        category: "eligible" | "unauthorized" | "unsupported" | "deselected";
        categoryReason: string;
        personalizedWhatsappPreview: string;
        whatsappEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        phoneEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        emailEligibility: "eligible" | "queued_not_in_directory" | "queued_unsupported_language" | "queued_unsupported_region" | "queued_daily_quota" | "queued_unapproved" | "skipped_no_consent" | "skipped_dnd" | "skipped_opted_out" | "skipped_missing_address" | "skipped_call_limit" | "skipped_channel_disabled" | "skipped_connector_unconfigured";
        whatsappStatus: "queued" | "failed" | "cancelled" | "pending" | "unverified" | "skipped" | "not_applicable" | "sent" | "delivered" | "read";
        phoneStatus: "queued" | "answered" | "failed" | "cancelled" | "pending" | "awaiting_approval" | "skipped" | "not_applicable" | "attempted" | "not_answered";
        phoneRawResponses: string[];
        phoneReportVerified: boolean;
        followUpRequired: boolean;
        attendanceOutcome: "failed" | "busy" | "pending" | "skipped" | "confirmed" | "interested" | "declined" | "not_interested" | "wants_more_info" | "callback_requested" | "opted_out" | "no_response" | "invalid_number";
    }[];
    duplicates: {
        reason: string;
        rowNumber: number;
        rawLine: string;
    }[];
    invalidEntries: {
        reason: string;
        rowNumber: number;
        rawLine: string;
    }[];
};
/**
 * Extracts structured webinar/campaign details from the owner's natural-language instruction
 * and lists ONLY missing details so Thaara never asks redundant questions for provided details.
 */
export declare function extractWebinarCampaignDetails(instruction: string): BulkCampaignWebinarDetails;
/**
 * Stage 2: AI Campaign Planning from natural-language instruction + imported contacts.
 */
export interface UniversalCampaignAnalysis {
    kind: 'webinar' | 'services' | 'universal';
    title: string;
    topic: string;
    eventDetails: string;
    objective: string;
    openingLine: string;
    aiDisclosure: string;
    eventPitch: string;
    questions: string[];
    whatsappMessagePreview: string;
    emailSubject: string;
    emailBodyPreview: string;
    webinarDetails?: BulkCampaignWebinarDetails;
}
export declare function extractInstructionQuestions(instruction: string): string[];
export declare function analyzeCampaignInstruction(instruction: string, kbFacts?: BulkCampaignExtractedFacts): UniversalCampaignAnalysis;
export declare function createBulkCampaignPlan(input: {
    workspaceId: string;
    userId: string;
    instruction: string;
    importResult: BulkCampaignImportResult;
    channels?: BulkCampaignChannel[];
    knowledgeFiles?: BulkCampaignKnowledgeUploadInput[];
    whatsappConnectionId?: string;
    whatsappBusinessLabel?: string;
    whatsappTemplateName?: string;
    whatsappTemplateLanguage?: string;
    whatsappTemplatePreview?: string;
    emailConnected?: boolean;
    liveCallingEnabled?: boolean;
    liveSendingEnabled?: boolean;
    limits?: Partial<BulkCampaignLimits>;
    phoneDirectory?: PhoneContactView[];
    now?: Date;
}): BulkCampaignState;
/**
 * Stage 2b: Edit campaign details, contact selection, contact names/languages, WhatsApp message text,
 * email draft, calling questions, schedule, or call limits.
 * Any material change after approval automatically invalidates the approval and requires renewed owner approval.
 */
export declare function updateBulkCampaignPlan(campaign: BulkCampaignState, patch: {
    objective?: string;
    eventDetails?: string;
    channels?: BulkCampaignChannel[];
    whatsappTemplateName?: string;
    whatsappTemplateLanguage?: string;
    whatsappMessagePreview?: string;
    emailSubject?: string;
    emailBodyPreview?: string;
    callScript?: Partial<BulkCampaignCallScript>;
    limits?: Partial<BulkCampaignLimits>;
    maxCalls?: number;
    scheduleAt?: string;
    selectedContactIds?: string[];
    contactEdits?: Record<string, {
        name?: string;
        preferredLanguage?: BulkCampaignLanguage;
    }>;
    ownerVerifiedConsent?: Record<string, {
        whatsapp?: boolean;
        phone?: boolean;
        email?: boolean;
        source?: 'written_consent' | 'inbound_enquiry' | 'verbal_recorded' | 'owner_verified';
        recordedAt?: string;
        campaignScope?: string;
    }>;
    knowledgeFiles?: BulkCampaignKnowledgeUploadInput[];
    removeKnowledgeFileIds?: string[];
}, now?: Date): BulkCampaignState;
/**
 * Stage 3: Owner Approval for the campaign plan.
 * Note: Phone calls STILL require individual per-call draft creation (`POST /api/v1/connectors/phone/ai/drafts`)
 * and per-call owner approval of each `approvalId` — there is no batch token bypassing per-call Phone approval.
 */
export declare function approveBulkCampaign(campaign: BulkCampaignState, input: {
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    expectedMaterialHash: string;
    now?: Date;
}): BulkCampaignState;
export interface BulkCampaignWhatsAppDispatchResult {
    status: 'delivered' | 'read' | 'sent' | 'queued' | 'unverified' | 'failed';
    providerMessageId: string | null;
    dispatchId?: string | null;
    error?: string;
}
export interface BulkCampaignWhatsAppAdapter {
    readonly mode: 'mock' | 'live_durable';
    readonly liveSendingEnabled?: boolean;
    sendTemplateInvitation(input: {
        campaignId: string;
        connectionId: string;
        contact: BulkCampaignImportedContact;
        templateName: string;
        language: string;
        messagePreview: string;
        eventDetails?: string;
        executionMode?: 'simulation' | 'live';
        idempotencyKey: string;
    }): Promise<BulkCampaignWhatsAppDispatchResult>;
}
export interface BulkCampaignEmailDispatchResult {
    status: 'sent' | 'queued' | 'failed';
    messageId: string | null;
    error?: string;
}
/**
 * Isolated Promotional/Campaign Email Adapter — logically separated from Phone Step 115
 * operational callback notification emails (`phone-callback-mail.ts`).
 */
export interface BulkCampaignEmailAdapter {
    readonly mode: 'test_transport' | 'governed_email';
    readonly liveSendingEnabled?: boolean;
    sendCampaignEmail(input: {
        campaignId: string;
        contact: BulkCampaignImportedContact;
        subject: string;
        bodyText: string;
        executionMode?: 'simulation' | 'live';
        idempotencyKey: string;
    }): Promise<BulkCampaignEmailDispatchResult>;
}
export declare class MockBulkCampaignEmailAdapter implements BulkCampaignEmailAdapter {
    readonly mode: "test_transport";
    readonly liveSendingEnabled = false;
    sendCampaignEmail(input: {
        campaignId: string;
        contact: BulkCampaignImportedContact;
        subject: string;
        bodyText: string;
        executionMode?: 'simulation' | 'live';
        idempotencyKey: string;
    }): Promise<BulkCampaignEmailDispatchResult>;
}
/**
 * Contract-compatible Phone adapter matching the real published endpoints in `apps/api/src/routes/phone-calling.ts`
 * and schemas in `packages/contracts/src/phone-calling.ts`.
 */
export interface BulkCampaignPhoneAdapter {
    readonly mode: 'mock' | 'published_phone_api';
    readonly liveCallingEnabled?: boolean;
    readonly integrationContract: PhoneBatchIntegrationContract;
    readonly dailyCallLimit: number;
    /** `GET /api/v1/connectors/phone/ai/contacts` */
    listDirectoryContacts(): Promise<{
        contacts: PhoneContactView[];
    }>;
    /** `POST /api/v1/connectors/phone/ai/drafts` */
    prepareDraft(payload: PhoneCallingPrepare): Promise<PhoneCallingPrepared>;
    /** `GET /api/v1/connectors/phone/ai/requests` (open pending/approved drafts only) */
    listOpenRequests(): Promise<{
        requests: PhoneCallingRequest[];
    }>;
    /** Per-call owner approval of a specific `approvalId` */
    approveCallDraft(input: {
        approvalId: string;
        approverUserId: string;
        persistedDraft?: PhoneCallingDraft;
    }): Promise<{
        approvalId: string;
        status: 'approved';
    }>;
    /** `POST /api/v1/connectors/phone/ai/simulations` or `POST /api/v1/connectors/phone/ai/calls/confirm` */
    placeOrSimulateApprovedCall(input: {
        approvalId: string;
        mode: 'simulation' | 'live';
        persistedDraft?: PhoneCallingDraft;
        persistedApproverUserId?: string;
        knowledgeContext?: BulkCampaignKnowledgeContext;
    }): Promise<PhoneCallingRecord>;
    /** Narrowly scoped single-call pilot execution through the existing Phone Calling Agent (bulk live remains disabled). */
    placeSinglePilotCall?(input: {
        approvalId: string;
        campaignId: string;
        contactId: string;
    }): Promise<PhoneCallingRecord>;
    /** `GET /api/v1/connectors/phone/ai/calls` */
    listCallHistory(): Promise<{
        calls: PhoneCallingRecord[];
        durable: boolean;
        liveCallingEnabled: boolean;
    }>;
    /** `POST /api/v1/connectors/phone/ai/calls/:callId/result` */
    readProviderResult(callId: string): Promise<PhoneCallingProviderResult>;
}
export declare const CODEX_PHONE_BATCH_INTEGRATION_CONTRACT: PhoneBatchIntegrationContract;
/**
 * Deterministic local Mock WhatsApp Adapter for First & Next Milestone demonstration and tests.
 */
export declare class MockBulkCampaignWhatsAppAdapter implements BulkCampaignWhatsAppAdapter {
    readonly mode: "mock";
    readonly liveSendingEnabled = false;
    sendTemplateInvitation(input: {
        campaignId: string;
        connectionId: string;
        contact: BulkCampaignImportedContact;
        templateName: string;
        language: string;
        messagePreview: string;
        idempotencyKey: string;
    }): Promise<BulkCampaignWhatsAppDispatchResult>;
}
/**
 * Contract-compatible Mock Phone Adapter that strictly validates every request and response
 * against the published TypeBox schemas in `packages/contracts/src/phone-calling.ts`.
 */
export declare class MockBulkCampaignPhoneAdapter implements BulkCampaignPhoneAdapter {
    readonly mode: "mock";
    readonly liveCallingEnabled = false;
    readonly integrationContract: {
        supportedLanguages: ("en-IN" | "kn-IN" | "kn-en")[];
        contactsDirectoryEndpoint: "GET /api/v1/connectors/phone/ai/contacts";
        prepareDraftEndpoint: "POST /api/v1/connectors/phone/ai/drafts";
        openRequestsEndpoint: "GET /api/v1/connectors/phone/ai/requests";
        confirmLiveCallEndpoint: "POST /api/v1/connectors/phone/ai/calls/confirm";
        placeApprovedCallEndpoint: "POST /api/v1/connectors/phone/ai/calls";
        simulateCallEndpoint: "POST /api/v1/connectors/phone/ai/simulations";
        callHistoryEndpoint: "GET /api/v1/connectors/phone/ai/calls";
        providerResultEndpoint: "POST /api/v1/connectors/phone/ai/calls/:callId/result";
        maxPurposeLength: 1000;
        defaultDailyLiveCallLimit: 5;
        maxConfiguredDailyLiveCallLimit: number;
    };
    readonly dailyCallLimit: number;
    private readonly directory;
    private readonly openRequests;
    private readonly callsByApproval;
    private readonly callsById;
    constructor(options?: {
        dailyCallLimit?: number;
        directory?: PhoneContactView[];
    });
    listDirectoryContacts(): Promise<{
        contacts: PhoneContactView[];
    }>;
    prepareDraft(payload: PhoneCallingPrepare): Promise<PhoneCallingPrepared>;
    listOpenRequests(): Promise<{
        requests: PhoneCallingRequest[];
    }>;
    approveCallDraft(input: {
        approvalId: string;
        approverUserId: string;
        persistedDraft?: PhoneCallingDraft;
    }): Promise<{
        approvalId: string;
        status: 'approved';
    }>;
    placeOrSimulateApprovedCall(input: {
        approvalId: string;
        mode: 'simulation' | 'live';
        persistedDraft?: PhoneCallingDraft;
        persistedApproverUserId?: string;
        knowledgeContext?: BulkCampaignKnowledgeContext;
    }): Promise<PhoneCallingRecord>;
    listCallHistory(): Promise<{
        calls: PhoneCallingRecord[];
        durable: boolean;
        liveCallingEnabled: boolean;
    }>;
    readProviderResult(callId: string): Promise<PhoneCallingProviderResult>;
    private buildSimulatedCallOutcome;
}
/**
 * Derives an explicitly labelled AI interpretation from the verified call state and raw transcript responses.
 * Never marks a contact confirmed/interested without an affirmative response, and `confirmedByEvidence` is always `false`.
 */
export declare function deriveCampaignCallAiInterpretation(state: PhoneCallingState, rawResponses: string[]): BulkCampaignAiInterpretation;
/**
 * Derives campaign-specific structured outcome notes dynamically from the campaign's approved
 * questions/objective and the recipient's actual transcript responses. Missing items are marked "Not provided".
 */
export declare function extractStructuredCampaignCallOutcome(input: {
    campaign: BulkCampaignState;
    rawResponses: string[];
    aiInterpretation?: BulkCampaignAiInterpretation;
    summaryText?: string;
}): string;
export declare function mapPhoneStateToCampaignCallStatus(state: PhoneCallingState): BulkCampaignPhoneCallStatus;
/**
 * Step A: Prepare individual per-call drafts (`POST /api/v1/connectors/phone/ai/drafts`)
 * for eligible contacts — supporting BOTH saved `PhoneContactDirectory` contacts AND consented unsaved
 * campaign contacts (`PhoneCallingPrepare.newRecipient` -> `onecall_`) within the daily quota (`5/day` default, `20/day` max)
 * without altering the permanent address book.
 */
/**
 * Builds a strictly bounded (<=1,000 chars) call_purpose for Sarvam combining:
 * 1) Owner-approved campaign instructions & verified PDF knowledge brief
 * 2) This specific recipient's untrusted lead context (never mixed across rows)
 */
export declare function buildPersonalizedLeadCallPurpose(campaign: BulkCampaignState, contact?: BulkCampaignImportedContact): string;
export declare function prepareCampaignPhoneDrafts(campaign: BulkCampaignState, phoneAdapter: BulkCampaignPhoneAdapter, now?: Date): Promise<BulkCampaignState>;
/**
 * Step B: Explicit per-call owner approval of a single `approvalId` (`PhoneCallingPrepared.approvalId`).
 * Never uses or invents a batch approval token.
 */
export declare function approveSingleCampaignPhoneDraft(campaign: BulkCampaignState, phoneAdapter: BulkCampaignPhoneAdapter, input: {
    approvalId: string;
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    now?: Date;
}): Promise<BulkCampaignState>;
/**
 * Stage 4 & 5: Multichannel Execution (WhatsApp, Phone, Email) with per-call approval verification,
 * quota enforcement, controlled batch sizing, Indian telemarketing calling hours check in live mode,
 * verbatim transcript preservation, and unverified AI interpretation labelling.
 */
export declare function executeBulkCampaign(campaign: BulkCampaignState, adapters: {
    whatsapp: BulkCampaignWhatsAppAdapter;
    phone: BulkCampaignPhoneAdapter;
    email?: BulkCampaignEmailAdapter;
    mode?: 'simulation' | 'live';
    batchSize?: number;
    enforceLiveCallingHours?: boolean;
    shouldStop?: () => boolean;
    now?: Date;
}): Promise<BulkCampaignState>;
/**
 * Prepares an isolated 5-contact synthetic test simulation from an existing campaign (such as `company Campaign`)
 * WITHOUT modifying the original campaign's real uploaded contacts or authorization status,
 * and WITHOUT requiring the user to re-upload an already-processed DOCX knowledge base.
 */
export declare function prepareSyntheticSimulationFromCampaign(sourceCampaign: BulkCampaignState, options?: {
    userId?: string;
    instruction?: string;
    now?: Date;
}): Promise<BulkCampaignState>;
export declare function scheduleBulkCampaign(campaign: BulkCampaignState, input: {
    scheduleAt: string;
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    now?: Date;
}): BulkCampaignState;
export declare function pauseBulkCampaign(campaign: BulkCampaignState, now?: Date): BulkCampaignState;
export declare function resumeBulkCampaign(campaign: BulkCampaignState, now?: Date): BulkCampaignState;
export declare function unsubscribeCampaignContact(campaign: BulkCampaignState, contactId: string, now?: Date): BulkCampaignState;
/**
 * Retries ONLY transient `failed` channel attempts (up to 3 retries per contact) using retry-scoped
 * idempotency keys, strictly preserving already-succeeded (`delivered`, `sent`, `answered`, `unverified`)
 * and opted-out contacts so duplicate messages or calls NEVER happen.
 */
export declare function retryFailedBulkCampaignContacts(campaign: BulkCampaignState, adapters: {
    whatsapp: BulkCampaignWhatsAppAdapter;
    phone: BulkCampaignPhoneAdapter;
    email?: BulkCampaignEmailAdapter;
    mode?: 'simulation' | 'live';
    now?: Date;
}): Promise<BulkCampaignState>;
export declare function stopBulkCampaign(campaign: BulkCampaignState, now?: Date): BulkCampaignState;
export declare function rejectOrCancelBulkCampaign(campaign: BulkCampaignState, now?: Date): BulkCampaignState;
/**
 * Shared tenant-scoped store so Bulk Campaigns created in Thaara Chat and the Bulk Campaign UI panel
 * operate on the exact same workspace state and survive API restarts, user logout/login, browser refreshes,
 * and software deployments via PostgreSQL RLS-scoped persistence (`public.plans` metadata).
 */
export declare class BulkCampaignWorkspaceStore {
    private readonly campaignsByWorkspace;
    private readonly approvalToCampaign;
    private db;
    constructor(db?: TransactionalDbClient);
    bindDb(db?: TransactionalDbClient): void;
    listAllInMemory(): BulkCampaignState[];
    getWorkspaceMap(workspaceId: string): Map<string, BulkCampaignState>;
    save(workspaceId: string, campaign: BulkCampaignState): BulkCampaignState;
    get(workspaceId: string, campaignId: string): BulkCampaignState | null;
    getLatest(workspaceId: string): BulkCampaignState | null;
    list(workspaceId: string): BulkCampaignState[];
    findByGovernedApproval(approvalId: string): BulkCampaignState | null;
    findByN8nJobId(jobId: string): BulkCampaignState | null;
    findByN8nJobIdScoped(jobId: string, opts?: {
        workspaceId?: string;
        campaignId?: string;
        db?: TransactionalDbClient;
    }): Promise<BulkCampaignState | null>;
    saveScoped(scope: AuthenticatedScope, campaign: BulkCampaignState, dbOverride?: TransactionalDbClient): Promise<BulkCampaignState>;
    getScoped(scope: AuthenticatedScope, campaignId: string, dbOverride?: TransactionalDbClient): Promise<BulkCampaignState | null>;
    listScoped(scope: AuthenticatedScope, dbOverride?: TransactionalDbClient): Promise<BulkCampaignState[]>;
    getLatestScoped(scope: AuthenticatedScope, dbOverride?: TransactionalDbClient): Promise<BulkCampaignState | null>;
    findByGovernedApprovalScoped(scope: AuthenticatedScope, approvalId: string, dbOverride?: TransactionalDbClient): Promise<BulkCampaignState | null>;
}
export declare const defaultBulkCampaignStore: BulkCampaignWorkspaceStore;
/**
 * Stage 6: Live Campaign Dashboard Metrics & CSV Report Generator.
 */
export declare function computeBulkCampaignMetrics(campaign: BulkCampaignState): BulkCampaignDashboardMetrics;
export declare function exportBulkCampaignCsv(campaign: BulkCampaignState): string;
/**
 * Builds a complete, human-readable Chat Summary covering:
 * - Imported contact breakdown (Eligible, Unauthorized, Unsupported, Duplicates, Invalid)
 * - Event campaign plan + missing webinar details prompt (only when missing)
 * - Approval status & per-call approvals
 * - Combined delivery/call/email outcomes & follow-up requirements
 */
export declare function buildBulkCampaignChatSummary(campaign: BulkCampaignState): string;
/**
 * Detects when a Thaara Chat message contains both an event campaign instruction
 * AND pasted contacts (or an uploaded file), creating the campaign directly from Chat!
 */
export declare function createBulkCampaignFromChatInput(input: {
    workspaceId: string;
    userId: string;
    chatMessage: string;
    channels?: BulkCampaignChannel[];
    knowledgeFiles?: BulkCampaignKnowledgeUploadInput[];
    uploadedFile?: {
        sourceType: BulkCampaignSourceType;
        fileName?: string;
        rawText: string;
        fileBase64?: string;
    };
    phoneDirectory?: PhoneContactView[];
    whatsappDirectory?: WhatsAppOptedInDirectoryEntry[];
    whatsappConnectionId?: string;
    whatsappBusinessLabel?: string;
    whatsappTemplateName?: string;
    whatsappTemplateLanguage?: string;
    whatsappTemplatePreview?: string;
    emailConnected?: boolean;
    liveCallingEnabled?: boolean;
    liveSendingEnabled?: boolean;
    dailyPhoneCallLimit?: number;
    existingCampaign?: BulkCampaignState | null;
    fallbackToDemoContactsWhenEmpty?: boolean;
}): {
    campaign: BulkCampaignState;
    summaryText: string;
};
/**
 * Stage 7: Thaara Chat Follow-Up Commands for the Bulk Campaign Agent.
 */
export type BulkCampaignChatCommandMode = 'results_summary' | 'campaign_preview' | 'who_confirmed' | 'who_did_not_answer' | 'callbacks_needed' | 'who_is_eligible' | 'prepare_script_only' | 'pause_campaign' | 'resume_campaign' | 'cancel_campaign' | 'stop_campaign';
export declare function detectBulkCampaignChatCommand(message: string): BulkCampaignChatCommandMode | null;
export declare function executeBulkCampaignChatCommand(mode: BulkCampaignChatCommandMode, campaign: BulkCampaignState | null): {
    assistantResponseText: string;
    updatedCampaign?: BulkCampaignState;
};
export type BulkCampaignChatIntent = {
    kind: 'command';
    mode: BulkCampaignChatCommandMode;
    rawMessage: string;
} | {
    kind: 'create_campaign';
    rawMessage: string;
};
/**
 * Detects natural-language Bulk Campaign creation and follow-up commands in Thaara Chat
 * while leaving single-recipient WhatsApp, Phone, and Gmail commands untouched.
 */
export declare function detectBulkCampaignChatIntent(message: string, options?: {
    hasContactAttachment?: boolean;
}): BulkCampaignChatIntent | null;
export interface ChatBulkCampaignStepStatus {
    stepId: string;
    stepOrder: number;
    actionName: string;
    status: string;
    receiptId: string | null;
    receiptStatus: string | null;
    verificationMethod: string | null;
    proof: Record<string, unknown> | null;
    error: string | null;
}
export interface ChatBulkCampaignOutcome {
    handled: boolean;
    status: 'awaiting_approval' | 'completed' | 'stopped' | 'cancelled' | 'draft';
    campaignId?: string;
    planId?: string;
    planStatus?: string;
    approvalId?: string | null;
    steps?: ChatBulkCampaignStepStatus[];
    assistantResponseText: string;
}
export declare function buildBulkCampaignPlanStepPayload(campaign: BulkCampaignState): Record<string, unknown>;
export declare function executeChatBulkCampaign(scope: AuthenticatedScope, intent: BulkCampaignChatIntent, deps?: {
    store?: BulkCampaignWorkspaceStore;
    db?: TransactionalDbClient;
    conversationId?: string;
    uploadedFile?: {
        sourceType: BulkCampaignSourceType;
        fileName?: string;
        rawText: string;
        fileBase64?: string;
    };
    phoneCalling?: PhoneCallingService;
    phoneContacts?: PhoneContactManagementService;
    phoneFallbackDirectory?: PhoneContactDirectory;
    whatsappDurable?: DurableWhatsAppService;
    whatsappTemplates?: WhatsAppTemplateService;
    gmail?: GmailFoundation;
}): Promise<ChatBulkCampaignOutcome>;
/**
 * Policy Gateway ActionAdapter for `campaign.bulk.execute` so approving a Bulk Campaign
 * via `/api/v1/approvals/:id/decide` enforces materialHash integrity and approves the campaign.
 */
export declare function createBulkCampaignActionAdapter(store?: BulkCampaignWorkspaceStore, db?: TransactionalDbClient): ActionAdapter;
/**
 * Approves every prepared `awaiting_approval` Phone call draft in the campaign ONE BY ONE
 * through the governed per-call approval path so every single `approvalId` gets its own
 * fresh authorization check and audit event (zero batch-token bypass).
 */
export declare function approveAllCampaignPhoneDrafts(campaign: BulkCampaignState, phoneAdapter: BulkCampaignPhoneAdapter, input: {
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    now?: Date;
}): Promise<BulkCampaignState>;
export interface BulkCampaignWorkspaceConnectorDeps {
    db?: TransactionalDbClient;
    phoneCalling?: PhoneCallingService;
    phoneContacts?: PhoneContactManagementService;
    phoneFallbackDirectory?: PhoneContactDirectory;
    dailyPhoneCallLimit?: number;
    whatsappDurable?: DurableWhatsAppService;
    whatsappTemplates?: WhatsAppTemplateService;
    gmail?: GmailFoundation;
}
export declare function getBulkCampaignWorkspaceContext(scope: AuthenticatedScope, deps: BulkCampaignWorkspaceConnectorDeps): Promise<{
    context: BulkCampaignWorkspaceContext;
    phoneDirectory: PhoneContactView[];
    phoneContactsConfigured: boolean;
    whatsappDirectory: WhatsAppOptedInDirectoryEntry[];
}>;
/**
 * Governed tenant-scoped Phone Adapter backed by the real `PhoneCallingService` and `PhoneContactManagementService`.
 * Falls back cleanly to simulation records during simulation runs so live calls are NEVER dialed unless `mode === 'live'`.
 */
export declare function createScopedPhoneCampaignAdapter(options: {
    scope: AuthenticatedScope;
    phoneCalling: PhoneCallingService;
    phoneContacts?: PhoneContactManagementService;
    phoneFallbackDirectory?: PhoneContactDirectory;
    db?: TransactionalDbClient;
    dailyCallLimit?: number;
    liveCallingEnabled?: boolean;
    useDemoFallbackWhenEmpty?: boolean;
}): BulkCampaignPhoneAdapter;
/**
 * Governed tenant-scoped WhatsApp Adapter backed by `DurableWhatsAppService` and `WhatsAppTemplateService`.
 * - Simulation mode: zero external calls, returns deterministic simulated status.
 * - Live mode: requires `liveSendingEnabled === true`, enforces Meta 24h window / APPROVED template rules,
 *   creates an audited `ApprovalRequest` (`whatsapp.meta.messages.send`), calls `durableWhatsApp.reserve()`,
 *   and returns truthful `queued` / `unverified` / `sent` / `delivered` / `failed` status.
 */
export declare function createScopedWhatsAppCampaignAdapter(options: {
    scope: AuthenticatedScope;
    durableWhatsApp?: DurableWhatsAppService;
    whatsappTemplates?: WhatsAppTemplateService;
    db?: TransactionalDbClient;
    liveSendingEnabled?: boolean;
}): BulkCampaignWhatsAppAdapter;
/**
 * Reconciles live Phone call history/provider results AND DurableWhatsApp delivery receipts + customer replies
 * into the stored campaign state so the Unified Campaign Dashboard and CSV/Chat reports reflect real progress!
 */
export declare function reconcileBulkCampaignOutcomes(campaign: BulkCampaignState, deps: {
    scope: AuthenticatedScope;
    phoneCalling?: PhoneCallingService;
    phoneAdapter?: BulkCampaignPhoneAdapter;
    whatsappDurable?: DurableWhatsAppService;
    refreshProviderResults?: boolean;
    now?: Date;
}): Promise<BulkCampaignState>;
/**
 * Governed tenant-scoped Email Adapter backed by the existing `GmailFoundation` (`gmail.messages.send_new`).
 * - Simulation mode: zero external emails sent, delegates to `MockBulkCampaignEmailAdapter`.
 * - Live mode: strictly requires `liveSendingEnabled === true`, verified `gmail.send` scope + connected account,
 *   creates an audited `ApprovalRequest` (`gmail.messages.send_new`) in PostgreSQL, and invokes `gmail.sendNew(...)`.
 *   Remains completely isolated from Phone Step 115 operational callback notifications.
 */
export declare function createScopedEmailCampaignAdapter(options: {
    scope: AuthenticatedScope;
    gmail?: GmailFoundation;
    db?: TransactionalDbClient;
    liveSendingEnabled?: boolean;
}): BulkCampaignEmailAdapter;
export interface ActiveWhatsAppCampaignReplyContext {
    campaignId: string;
    title: string;
    relevantFacts: string;
    groundedAnswer: string;
    grounded: boolean;
    pricingExplicitlyProvided: boolean;
    sourceRefs: string[];
}
/**
 * Resolves workspace-scoped and campaign-scoped verified knowledge when an inbound WhatsApp customer
 * replies to an approved/active/completed Bulk Campaign in the same workspace.
 * Never leaks contacts or uploaded documents across campaigns or across workspaces.
 */
export declare function resolveCampaignReplyContextForWhatsApp(input: {
    scope: AuthenticatedScope;
    phoneE164: string;
    customerMessage: string;
    store?: BulkCampaignWorkspaceStore;
    db?: TransactionalDbClient;
}): Promise<ActiveWhatsAppCampaignReplyContext | null>;
/**
 * Lists strictly eligible non-synthetic contacts authorized for a single-call pilot.
 * Never promotes unverified uploaded numbers or synthetic demo fixtures.
 */
export declare function listEligiblePilotContacts(campaign: BulkCampaignState, phoneDirectory: PhoneContactView[]): BulkCampaignEligiblePilotContact[];
/**
 * Prepares ONE owner-authorized pilot call using the existing PhoneCallingService.prepare() path
 * and the campaign's grounded <= 1,000-char Sarvam call purpose. Does not place any call.
 */
export declare function prepareBulkCampaignPilotCall(campaign: BulkCampaignState, phoneAdapter: BulkCampaignPhoneAdapter, input: {
    userId: string;
    role: string;
    phoneDirectory: PhoneContactView[];
    contactId: string;
    language?: BulkCampaignLanguage;
}): Promise<BulkCampaignState>;
/**
 * Executes AT MOST ONE owner-approved pilot call through the existing PhoneCallingService.placeCall() path.
 * Idempotent on duplicate clicks for the same approvalId; never auto-redials on failure.
 */
export declare function executeBulkCampaignPilotCall(campaign: BulkCampaignState, phoneAdapter: BulkCampaignPhoneAdapter, input: {
    userId: string;
    role: string;
    approvalId: string;
}): Promise<BulkCampaignState>;
/**
 * Refreshes actual pilot call status, timestamps, transcript, and recording availability
 * from the existing Phone Integration call history without fabricating missing fields.
 */
export declare function refreshBulkCampaignPilotResult(campaign: BulkCampaignState, phoneAdapter: BulkCampaignPhoneAdapter): Promise<BulkCampaignState>;
export declare const BULK_CAMPAIGN_N8N_CALLING_WORKFLOW_ID = "ThaaraBulkCall01";
export declare const BULK_CAMPAIGN_N8N_WHATSAPP_WORKFLOW_ID = "ThaaraBulkWa0001";
export declare const BULK_CAMPAIGN_N8N_CALLING_WEBHOOK_PATH = "/webhook/thaara-bulk-campaign-calling-v1";
export declare const BULK_CAMPAIGN_N8N_WHATSAPP_WEBHOOK_PATH = "/webhook/thaara-bulk-campaign-whatsapp-v1";
export declare const PILOT_N8N_INTERNAL_ORIGIN = "http://n8n-n8n-1:5678";
export interface BulkCampaignN8nTrigger {
    triggerWorkflow(input: {
        webhookPath: string;
        payload: {
            jobId: string;
            campaignId: string;
            workspaceId?: string;
            executionToken: string;
            channel: BulkCampaignN8nChannel;
            mode?: 'one_contact_pilot' | 'multi_contact_batch';
            maxContacts: number;
            rateLimitPerMinute?: number;
        };
    }): Promise<{
        accepted: boolean;
        reason?: string;
        n8nExecutionId?: string | null;
    }>;
}
export declare function createDefaultBulkCampaignN8nTrigger(options?: {
    liveEnabled?: boolean;
    webhookSecret?: string | null;
    origin?: string;
    fetchImpl?: typeof fetch;
}): BulkCampaignN8nTrigger;
export declare function verifyBulkCampaignN8nToken(providedHeader: string | undefined, expectedToken: string | undefined): boolean;
export declare function listEligibleWhatsAppPilotContacts(campaign: BulkCampaignState): BulkCampaignEligiblePilotContact[];
export declare function submitBulkCampaignN8nJob(campaign: BulkCampaignState, input: {
    scope: AuthenticatedScope;
    channel: BulkCampaignN8nChannel;
    contactId: string;
    language?: BulkCampaignLanguage;
    connectionId?: string;
    templateName?: string;
    phoneDirectory?: PhoneContactView[];
    phoneAdapter?: BulkCampaignPhoneAdapter;
    n8nTrigger?: BulkCampaignN8nTrigger;
}): Promise<{
    campaign: BulkCampaignState;
    job: BulkCampaignN8nExecutionJob;
    executionToken: string;
    webhookDispatched: boolean;
    webhookReason?: string;
}>;
export declare function cancelBulkCampaignN8nJob(campaign: BulkCampaignState, scope: AuthenticatedScope, jobId: string, reason?: string): BulkCampaignState;
export declare function claimNextBulkCampaignN8nJob(campaign: BulkCampaignState, input: {
    jobId: string;
    executionToken: string;
    channel: BulkCampaignN8nChannel;
    phoneDirectory?: PhoneContactView[];
}): {
    campaign: BulkCampaignState;
    proceed: boolean;
    reason?: string;
    contactId?: string;
    displayName?: string;
    channel?: BulkCampaignN8nChannel;
    approvalId?: string;
    callPurpose?: string;
    language?: string;
    templateName?: string;
    templateLanguage?: string;
    messagePreview?: string;
    connectionId?: string;
};
export declare function executeBulkCampaignN8nPhoneJob(campaign: BulkCampaignState, input: {
    jobId: string;
    scope: AuthenticatedScope;
    phoneAdapter: BulkCampaignPhoneAdapter;
    phoneDirectory?: PhoneContactView[];
    contactId?: string;
}): Promise<{
    campaign: BulkCampaignState;
    ok: boolean;
    callId?: string;
    providerCallId?: string | null;
    status?: string;
    failureReason?: string;
}>;
export declare function pollBulkCampaignN8nPhoneJob(campaign: BulkCampaignState, input: {
    jobId: string;
    phoneAdapter: BulkCampaignPhoneAdapter;
    contactId?: string;
}): Promise<{
    campaign: BulkCampaignState;
    status: string;
    durationSeconds: number | null;
    summary: string | null;
}>;
export declare function executeBulkCampaignN8nWhatsAppJob(campaign: BulkCampaignState, input: {
    jobId: string;
    whatsappAdapter: BulkCampaignWhatsAppAdapter;
    contactId?: string;
}): Promise<{
    campaign: BulkCampaignState;
    ok: boolean;
    dispatchId?: string | null;
    providerMessageId?: string | null;
    status?: string;
    failureReason?: string;
}>;
export declare function pollBulkCampaignN8nWhatsAppJob(campaign: BulkCampaignState, input: {
    jobId: string;
    scope: AuthenticatedScope;
    durableWhatsApp?: Pick<DurableWhatsAppService, 'inbox'>;
    contactId?: string;
}): Promise<{
    campaign: BulkCampaignState;
    deliveryStatus: string;
    replyReceived: boolean;
    latestReplyPreview: string | null;
    optOutDetected: boolean;
}>;
export declare function completeBulkCampaignN8nJob(campaign: BulkCampaignState, input: {
    jobId: string;
    status: 'completed' | 'failed' | 'stopped';
    outcomeSummary?: string;
    failureReason?: string;
    n8nExecutionId?: string;
}): BulkCampaignState;
export declare function submitBulkCampaignMultiContactN8nJob(campaign: BulkCampaignState, input: {
    scope: AuthenticatedScope;
    channel: BulkCampaignN8nChannel;
    batchConfig?: Partial<BulkCampaignN8nBatchConfig>;
    liveMultiContactEnabled?: boolean;
    phoneDirectory?: PhoneContactView[];
    n8nTrigger?: BulkCampaignN8nTrigger;
    onlyContactIds?: string[];
}): Promise<{
    campaign: BulkCampaignState;
    job: BulkCampaignN8nExecutionJob;
    executionToken: string;
    webhookDispatched: boolean;
}>;
export declare function claimNextBatchContactForN8nJob(campaign: BulkCampaignState, input: {
    jobId: string;
    executionToken: string;
    channel: BulkCampaignN8nChannel;
    phoneDirectory?: PhoneContactView[];
    staleClaimTimeoutMs?: number;
}): {
    campaign: BulkCampaignState;
    proceed: boolean;
    hasMore: boolean;
    reason?: string;
    contactId?: string;
    displayName?: string;
    idempotencyKey?: string;
    callPurpose?: string;
    rateLimitDelaySeconds?: number;
    language?: string;
    templateName?: string;
    templateLanguage?: string;
    messagePreview?: string;
    connectionId?: string;
};
export declare function recordBatchContactOutcomeForN8nJob(campaign: BulkCampaignState, input: {
    jobId: string;
    contactId: string;
    status: 'completed' | 'failed' | 'skipped';
    providerId?: string | null;
    thaaraCallId?: string | null;
    durationSeconds?: number | null;
    callOutcome?: 'interested' | 'not_interested' | 'callback_requested' | 'no_answer' | 'busy' | 'failed' | 'opted_out' | null;
    outcome?: string | null;
    failureReason?: string | null;
    optOutDetected?: boolean;
}): BulkCampaignState;
export declare function pauseBulkCampaignN8nJob(campaign: BulkCampaignState, scope: AuthenticatedScope, jobId: string, reason?: string): BulkCampaignState;
export declare function resumeBulkCampaignN8nJob(campaign: BulkCampaignState, scope: AuthenticatedScope, jobId: string, input?: {
    n8nTrigger?: BulkCampaignN8nTrigger;
}): Promise<{
    campaign: BulkCampaignState;
    job: BulkCampaignN8nExecutionJob;
    executionToken: string;
    webhookDispatched: boolean;
}>;
export declare function isCampaignAllowlistedForLive(campaignId: string, envValue?: string | undefined): boolean;
export declare function createBulkCampaignLiveExecutionGrant(campaign: BulkCampaignState, scope: AuthenticatedScope, options?: {
    now?: Date;
    ttlHours?: number;
}): NonNullable<BulkCampaignState['liveExecutionGrant']>;
export declare function isCampaignAuthorizedForLiveExecution(campaign: BulkCampaignState, scope: AuthenticatedScope, options?: {
    allowCampaignIdsEnv?: string;
    allowOwnerApprovedEnv?: string;
    now?: Date;
}): {
    authorized: boolean;
    reason?: string;
};
export declare function isChannelAllowlistedForLive(channel: 'phone' | 'phone_call' | 'whatsapp' | 'email', envValue?: string | undefined): boolean;
export declare function emergencyStopAllBulkCampaignN8nJobs(campaign: BulkCampaignState, scope: AuthenticatedScope, reason?: string): BulkCampaignState;
export interface BulkCampaignWhatsAppTranscriptMessage {
    id: string;
    speaker: 'thaara' | 'customer';
    text: string;
    timestamp: string;
    status?: string;
    providerMessageId?: string | null;
    deliveryEvents?: Array<{
        status: string;
        timestamp: string;
    }>;
}
export interface BulkCampaignWhatsAppTranscriptResult {
    campaignId: string;
    contactId: string;
    contactName: string;
    maskedPhone: string | null;
    attributionStatus: 'attributed' | 'simulated' | 'unassigned' | 'ambiguous' | 'unavailable';
    attributionNote?: string;
    isSimulated: boolean;
    language: string;
    conversationRecipientId: string | null;
    messages: BulkCampaignWhatsAppTranscriptMessage[];
}
export declare function getBulkCampaignContactWhatsAppTranscript(campaign: BulkCampaignState, contactId: string, deps: {
    scope: AuthenticatedScope;
    whatsappDurable?: DurableWhatsAppService;
}): Promise<BulkCampaignWhatsAppTranscriptResult>;
//# sourceMappingURL=bulk-campaign.d.ts.map