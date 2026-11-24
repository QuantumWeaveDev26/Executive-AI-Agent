import { Static } from '@sinclair/typebox';
export declare const BULK_CAMPAIGN_EXECUTE_ACTION: "campaign.bulk.execute";
export declare const BulkCampaignSourceTypeSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"paste">, import("@sinclair/typebox").TLiteral<"txt">, import("@sinclair/typebox").TLiteral<"csv">, import("@sinclair/typebox").TLiteral<"excel">, import("@sinclair/typebox").TLiteral<"pdf">, import("@sinclair/typebox").TLiteral<"google_sheets">]>;
export type BulkCampaignSourceType = Static<typeof BulkCampaignSourceTypeSchema>;
export declare const BulkCampaignChannelSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"whatsapp">, import("@sinclair/typebox").TLiteral<"phone">, import("@sinclair/typebox").TLiteral<"email">]>;
export type BulkCampaignChannel = Static<typeof BulkCampaignChannelSchema>;
/**
 * Contact language preference on import.
 * Note: The published Phone API only supports `PhoneCallingLanguageSchema` (`en-IN | kn-IN | kn-en`).
 * Contacts preferring `hi-IN` are classified as unsupported (`queued_unsupported_language`) and never submitted to the Phone API.
 */
export declare const BulkCampaignLanguageSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">, import("@sinclair/typebox").TLiteral<"hi-IN">]>;
export type BulkCampaignLanguage = Static<typeof BulkCampaignLanguageSchema>;
export declare const BulkCampaignConsentSourceSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"explicit_column">, import("@sinclair/typebox").TLiteral<"owner_verified">, import("@sinclair/typebox").TLiteral<"phone_directory_verified">, import("@sinclair/typebox").TLiteral<"whatsapp_directory_verified">, import("@sinclair/typebox").TLiteral<"unverified">]>;
export type BulkCampaignConsentSource = Static<typeof BulkCampaignConsentSourceSchema>;
export declare const BulkCampaignContactConsentSchema: import("@sinclair/typebox").TObject<{
    whatsapp: import("@sinclair/typebox").TBoolean;
    phone: import("@sinclair/typebox").TBoolean;
    email: import("@sinclair/typebox").TBoolean;
    source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"explicit_column">, import("@sinclair/typebox").TLiteral<"owner_verified">, import("@sinclair/typebox").TLiteral<"phone_directory_verified">, import("@sinclair/typebox").TLiteral<"whatsapp_directory_verified">, import("@sinclair/typebox").TLiteral<"unverified">]>;
}>;
export type BulkCampaignContactConsent = Static<typeof BulkCampaignContactConsentSchema>;
export declare const BulkCampaignImportedContactSchema: import("@sinclair/typebox").TObject<{
    contactId: import("@sinclair/typebox").TString;
    phoneDirectoryContactId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    phoneDirectoryRevision: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    isUnsavedCampaignContact: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    isSyntheticTestFixture: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    syntheticScenarioKey: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    syntheticScenarioTitle: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    isInternational: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    rowNumber: import("@sinclair/typebox").TInteger;
    name: import("@sinclair/typebox").TString;
    company: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    phoneE164: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    maskedPhone: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    whatsappE164: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    email: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    preferredLanguage: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">, import("@sinclair/typebox").TLiteral<"hi-IN">]>;
    dnd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    consentSourceDetail: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    optedOut: import("@sinclair/typebox").TBoolean;
    consent: import("@sinclair/typebox").TObject<{
        whatsapp: import("@sinclair/typebox").TBoolean;
        phone: import("@sinclair/typebox").TBoolean;
        email: import("@sinclair/typebox").TBoolean;
        source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"explicit_column">, import("@sinclair/typebox").TLiteral<"owner_verified">, import("@sinclair/typebox").TLiteral<"phone_directory_verified">, import("@sinclair/typebox").TLiteral<"whatsapp_directory_verified">, import("@sinclair/typebox").TLiteral<"unverified">]>;
    }>;
}>;
export type BulkCampaignImportedContact = Static<typeof BulkCampaignImportedContactSchema>;
export declare const BulkCampaignImportIssueSchema: import("@sinclair/typebox").TObject<{
    rowNumber: import("@sinclair/typebox").TInteger;
    rawLine: import("@sinclair/typebox").TString;
    reason: import("@sinclair/typebox").TString;
}>;
export type BulkCampaignImportIssue = Static<typeof BulkCampaignImportIssueSchema>;
export declare const BulkCampaignImportResultSchema: import("@sinclair/typebox").TObject<{
    sourceType: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"paste">, import("@sinclair/typebox").TLiteral<"txt">, import("@sinclair/typebox").TLiteral<"csv">, import("@sinclair/typebox").TLiteral<"excel">, import("@sinclair/typebox").TLiteral<"pdf">, import("@sinclair/typebox").TLiteral<"google_sheets">]>;
    fileName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    totalRowsParsed: import("@sinclair/typebox").TInteger;
    validContacts: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        contactId: import("@sinclair/typebox").TString;
        phoneDirectoryContactId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        phoneDirectoryRevision: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        isUnsavedCampaignContact: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        isSyntheticTestFixture: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        syntheticScenarioKey: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        syntheticScenarioTitle: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        isInternational: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        rowNumber: import("@sinclair/typebox").TInteger;
        name: import("@sinclair/typebox").TString;
        company: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        phoneE164: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        maskedPhone: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        whatsappE164: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        email: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        preferredLanguage: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">, import("@sinclair/typebox").TLiteral<"hi-IN">]>;
        dnd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        consentSourceDetail: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        optedOut: import("@sinclair/typebox").TBoolean;
        consent: import("@sinclair/typebox").TObject<{
            whatsapp: import("@sinclair/typebox").TBoolean;
            phone: import("@sinclair/typebox").TBoolean;
            email: import("@sinclair/typebox").TBoolean;
            source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"explicit_column">, import("@sinclair/typebox").TLiteral<"owner_verified">, import("@sinclair/typebox").TLiteral<"phone_directory_verified">, import("@sinclair/typebox").TLiteral<"whatsapp_directory_verified">, import("@sinclair/typebox").TLiteral<"unverified">]>;
        }>;
    }>>;
    duplicates: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        rowNumber: import("@sinclair/typebox").TInteger;
        rawLine: import("@sinclair/typebox").TString;
        reason: import("@sinclair/typebox").TString;
    }>>;
    invalidEntries: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        rowNumber: import("@sinclair/typebox").TInteger;
        rawLine: import("@sinclair/typebox").TString;
        reason: import("@sinclair/typebox").TString;
    }>>;
    consentNotice: import("@sinclair/typebox").TString;
}>;
export type BulkCampaignImportResult = Static<typeof BulkCampaignImportResultSchema>;
export declare const BulkCampaignStatusSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"draft_requires_reapproval">, import("@sinclair/typebox").TLiteral<"approved">, import("@sinclair/typebox").TLiteral<"scheduled">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"stopped">, import("@sinclair/typebox").TLiteral<"completed">]>;
export type BulkCampaignStatus = Static<typeof BulkCampaignStatusSchema>;
export declare const BulkCampaignWebinarDetailsSchema: import("@sinclair/typebox").TObject<{
    title: import("@sinclair/typebox").TString;
    dateLabel: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    startTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    timeZone: import("@sinclair/typebox").TString;
    durationMinutes: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    language: import("@sinclair/typebox").TString;
    platform: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    benefits: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    registrationProcess: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    callingHoursWindow: import("@sinclair/typebox").TString;
    missingDetails: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
}>;
export type BulkCampaignWebinarDetails = Static<typeof BulkCampaignWebinarDetailsSchema>;
/**
 * Respects existing live Phone calling limit of 5/day by default and configured maximum of 20/day.
 */
export declare const BulkCampaignLimitsSchema: import("@sinclair/typebox").TObject<{
    maxCalls: import("@sinclair/typebox").TInteger;
    dailyPhoneCallLimit: import("@sinclair/typebox").TInteger;
    unlimitedDailyCalls: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    maxConcurrency: import("@sinclair/typebox").TInteger;
    rateLimitPerMinute: import("@sinclair/typebox").TInteger;
    scheduleAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export type BulkCampaignLimits = Static<typeof BulkCampaignLimitsSchema>;
export declare const BulkCampaignCallScriptSchema: import("@sinclair/typebox").TObject<{
    aiDisclosure: import("@sinclair/typebox").TString;
    openingLine: import("@sinclair/typebox").TString;
    eventPitch: import("@sinclair/typebox").TString;
    questions: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    boundedPurposePreview: import("@sinclair/typebox").TString;
    supportedLanguages: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">]>>;
}>;
export type BulkCampaignCallScript = Static<typeof BulkCampaignCallScriptSchema>;
export declare const BulkCampaignWhatsAppPlanSchema: import("@sinclair/typebox").TObject<{
    connectionId: import("@sinclair/typebox").TString;
    businessAccountLabel: import("@sinclair/typebox").TString;
    templateName: import("@sinclair/typebox").TString;
    language: import("@sinclair/typebox").TString;
    messagePreview: import("@sinclair/typebox").TString;
    requiresTemplateOutside24h: import("@sinclair/typebox").TLiteral<true>;
}>;
export type BulkCampaignWhatsAppPlan = Static<typeof BulkCampaignWhatsAppPlanSchema>;
export declare const BulkCampaignChannelEligibilityStatusSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"eligible">, import("@sinclair/typebox").TLiteral<"queued_not_in_directory">, import("@sinclair/typebox").TLiteral<"queued_unsupported_language">, import("@sinclair/typebox").TLiteral<"queued_unsupported_region">, import("@sinclair/typebox").TLiteral<"queued_daily_quota">, import("@sinclair/typebox").TLiteral<"queued_unapproved">, import("@sinclair/typebox").TLiteral<"skipped_no_consent">, import("@sinclair/typebox").TLiteral<"skipped_dnd">, import("@sinclair/typebox").TLiteral<"skipped_opted_out">, import("@sinclair/typebox").TLiteral<"skipped_missing_address">, import("@sinclair/typebox").TLiteral<"skipped_call_limit">, import("@sinclair/typebox").TLiteral<"skipped_channel_disabled">, import("@sinclair/typebox").TLiteral<"skipped_connector_unconfigured">]>;
export type BulkCampaignChannelEligibilityStatus = Static<typeof BulkCampaignChannelEligibilityStatusSchema>;
export declare const BulkCampaignContactCategorySchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"eligible">, import("@sinclair/typebox").TLiteral<"unauthorized">, import("@sinclair/typebox").TLiteral<"unsupported">, import("@sinclair/typebox").TLiteral<"deselected">]>;
export type BulkCampaignContactCategory = Static<typeof BulkCampaignContactCategorySchema>;
export declare const BulkCampaignWhatsAppDeliveryStatusSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"not_applicable">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"sent">, import("@sinclair/typebox").TLiteral<"delivered">, import("@sinclair/typebox").TLiteral<"read">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
export type BulkCampaignWhatsAppDeliveryStatus = Static<typeof BulkCampaignWhatsAppDeliveryStatusSchema>;
export declare const BulkCampaignPhoneCallStatusSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"not_applicable">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"attempted">, import("@sinclair/typebox").TLiteral<"answered">, import("@sinclair/typebox").TLiteral<"not_answered">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
export type BulkCampaignPhoneCallStatus = Static<typeof BulkCampaignPhoneCallStatusSchema>;
export declare const BulkCampaignEmailDeliveryStatusSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"not_applicable">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"sent">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">, import("@sinclair/typebox").TLiteral<"unsubscribed">]>;
export type BulkCampaignEmailDeliveryStatus = Static<typeof BulkCampaignEmailDeliveryStatusSchema>;
export declare const BulkCampaignAttendanceOutcomeSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"confirmed">, import("@sinclair/typebox").TLiteral<"interested">, import("@sinclair/typebox").TLiteral<"declined">, import("@sinclair/typebox").TLiteral<"not_interested">, import("@sinclair/typebox").TLiteral<"wants_more_info">, import("@sinclair/typebox").TLiteral<"callback_requested">, import("@sinclair/typebox").TLiteral<"opted_out">, import("@sinclair/typebox").TLiteral<"no_response">, import("@sinclair/typebox").TLiteral<"busy">, import("@sinclair/typebox").TLiteral<"invalid_number">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">]>;
export type BulkCampaignAttendanceOutcome = Static<typeof BulkCampaignAttendanceOutcomeSchema>;
/**
 * Any classification of webinar attendance or callback preference derived from raw transcript responses
 * is explicitly marked as an unverified AI interpretation until confirmed by evidence.
 */
export declare const BulkCampaignAiInterpretationSchema: import("@sinclair/typebox").TObject<{
    attendanceClassification: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"confirmed">, import("@sinclair/typebox").TLiteral<"interested">, import("@sinclair/typebox").TLiteral<"declined">, import("@sinclair/typebox").TLiteral<"not_interested">, import("@sinclair/typebox").TLiteral<"wants_more_info">, import("@sinclair/typebox").TLiteral<"callback_requested">, import("@sinclair/typebox").TLiteral<"opted_out">, import("@sinclair/typebox").TLiteral<"no_response">, import("@sinclair/typebox").TLiteral<"busy">, import("@sinclair/typebox").TLiteral<"invalid_number">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">]>;
    preferredCallbackTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    rationale: import("@sinclair/typebox").TString;
    isAiInterpretation: import("@sinclair/typebox").TLiteral<true>;
    confirmedByEvidence: import("@sinclair/typebox").TLiteral<false>;
}>;
export type BulkCampaignAiInterpretation = Static<typeof BulkCampaignAiInterpretationSchema>;
export declare const BulkCampaignSimulatedDialogueTurnSchema: import("@sinclair/typebox").TObject<{
    speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"thaara">, import("@sinclair/typebox").TLiteral<"customer">]>;
    text: import("@sinclair/typebox").TString;
    sourceRefs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
}>;
export type BulkCampaignSimulatedDialogueTurn = Static<typeof BulkCampaignSimulatedDialogueTurnSchema>;
export declare const BulkCampaignContactRecordSchema: import("@sinclair/typebox").TObject<{
    contact: import("@sinclair/typebox").TObject<{
        contactId: import("@sinclair/typebox").TString;
        phoneDirectoryContactId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        phoneDirectoryRevision: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        isUnsavedCampaignContact: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        isSyntheticTestFixture: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        syntheticScenarioKey: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        syntheticScenarioTitle: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        isInternational: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        rowNumber: import("@sinclair/typebox").TInteger;
        name: import("@sinclair/typebox").TString;
        company: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        phoneE164: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        maskedPhone: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        whatsappE164: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        email: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        preferredLanguage: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">, import("@sinclair/typebox").TLiteral<"hi-IN">]>;
        dnd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        consentSourceDetail: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        optedOut: import("@sinclair/typebox").TBoolean;
        consent: import("@sinclair/typebox").TObject<{
            whatsapp: import("@sinclair/typebox").TBoolean;
            phone: import("@sinclair/typebox").TBoolean;
            email: import("@sinclair/typebox").TBoolean;
            source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"explicit_column">, import("@sinclair/typebox").TLiteral<"owner_verified">, import("@sinclair/typebox").TLiteral<"phone_directory_verified">, import("@sinclair/typebox").TLiteral<"whatsapp_directory_verified">, import("@sinclair/typebox").TLiteral<"unverified">]>;
        }>;
    }>;
    selectedByOwner: import("@sinclair/typebox").TBoolean;
    category: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"eligible">, import("@sinclair/typebox").TLiteral<"unauthorized">, import("@sinclair/typebox").TLiteral<"unsupported">, import("@sinclair/typebox").TLiteral<"deselected">]>;
    categoryReason: import("@sinclair/typebox").TString;
    personalizedWhatsappPreview: import("@sinclair/typebox").TString;
    personalizedEmailPreview: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    whatsappEligibility: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"eligible">, import("@sinclair/typebox").TLiteral<"queued_not_in_directory">, import("@sinclair/typebox").TLiteral<"queued_unsupported_language">, import("@sinclair/typebox").TLiteral<"queued_unsupported_region">, import("@sinclair/typebox").TLiteral<"queued_daily_quota">, import("@sinclair/typebox").TLiteral<"queued_unapproved">, import("@sinclair/typebox").TLiteral<"skipped_no_consent">, import("@sinclair/typebox").TLiteral<"skipped_dnd">, import("@sinclair/typebox").TLiteral<"skipped_opted_out">, import("@sinclair/typebox").TLiteral<"skipped_missing_address">, import("@sinclair/typebox").TLiteral<"skipped_call_limit">, import("@sinclair/typebox").TLiteral<"skipped_channel_disabled">, import("@sinclair/typebox").TLiteral<"skipped_connector_unconfigured">]>;
    phoneEligibility: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"eligible">, import("@sinclair/typebox").TLiteral<"queued_not_in_directory">, import("@sinclair/typebox").TLiteral<"queued_unsupported_language">, import("@sinclair/typebox").TLiteral<"queued_unsupported_region">, import("@sinclair/typebox").TLiteral<"queued_daily_quota">, import("@sinclair/typebox").TLiteral<"queued_unapproved">, import("@sinclair/typebox").TLiteral<"skipped_no_consent">, import("@sinclair/typebox").TLiteral<"skipped_dnd">, import("@sinclair/typebox").TLiteral<"skipped_opted_out">, import("@sinclair/typebox").TLiteral<"skipped_missing_address">, import("@sinclair/typebox").TLiteral<"skipped_call_limit">, import("@sinclair/typebox").TLiteral<"skipped_channel_disabled">, import("@sinclair/typebox").TLiteral<"skipped_connector_unconfigured">]>;
    emailEligibility: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"eligible">, import("@sinclair/typebox").TLiteral<"queued_not_in_directory">, import("@sinclair/typebox").TLiteral<"queued_unsupported_language">, import("@sinclair/typebox").TLiteral<"queued_unsupported_region">, import("@sinclair/typebox").TLiteral<"queued_daily_quota">, import("@sinclair/typebox").TLiteral<"queued_unapproved">, import("@sinclair/typebox").TLiteral<"skipped_no_consent">, import("@sinclair/typebox").TLiteral<"skipped_dnd">, import("@sinclair/typebox").TLiteral<"skipped_opted_out">, import("@sinclair/typebox").TLiteral<"skipped_missing_address">, import("@sinclair/typebox").TLiteral<"skipped_call_limit">, import("@sinclair/typebox").TLiteral<"skipped_channel_disabled">, import("@sinclair/typebox").TLiteral<"skipped_connector_unconfigured">]>;
    whatsappStatus: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"not_applicable">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"sent">, import("@sinclair/typebox").TLiteral<"delivered">, import("@sinclair/typebox").TLiteral<"read">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    whatsappDispatchId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    whatsappProviderMessageId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    whatsappCustomerReply: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    whatsappError: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    emailStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"not_applicable">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"sent">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">, import("@sinclair/typebox").TLiteral<"unsubscribed">]>>;
    emailMessageId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    emailError: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    phoneStatus: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"not_applicable">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"attempted">, import("@sinclair/typebox").TLiteral<"answered">, import("@sinclair/typebox").TLiteral<"not_answered">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    phoneApprovalId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    phoneApprovalStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"approved">]>>;
    phoneDraft: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        draftId: import("@sinclair/typebox").TString;
        newRecipient: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            previewApprovalId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            phoneE164: import("@sinclair/typebox").TString;
            consentConfirmed: import("@sinclair/typebox").TBoolean;
            eligibility: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"eligible">]>;
        }>>;
        contactId: import("@sinclair/typebox").TString;
        contactRevision: import("@sinclair/typebox").TInteger;
        contactBindingHash: import("@sinclair/typebox").TString;
        recipient: import("@sinclair/typebox").TObject<{
            displayName: import("@sinclair/typebox").TString;
            maskedPhone: import("@sinclair/typebox").TString;
        }>;
        purpose: import("@sinclair/typebox").TString;
        language: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">]>;
        maxDurationSeconds: import("@sinclair/typebox").TInteger;
        aiDisclosure: import("@sinclair/typebox").TString;
        consentReference: import("@sinclair/typebox").TString;
        idempotencyKey: import("@sinclair/typebox").TString;
        mode: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"simulation">, import("@sinclair/typebox").TLiteral<"live">]>;
        providerBindingHash: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        onBehalfOf: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>>;
    phoneCallId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    phoneProviderCallId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    phoneDurationSeconds: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TInteger, import("@sinclair/typebox").TNull]>>;
    phoneRecordState: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"completed" | "queued" | "failed" | "cancelled" | "answered" | "busy" | "ringing" | "no_answer">[]>>;
    phoneLanguageUsed: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">]>>;
    phoneDisclosedAi: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    phoneRawResponses: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    phoneProviderReportText: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    phoneReportVerified: import("@sinclair/typebox").TBoolean;
    simulatedScenarioTitle: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    simulatedDialogueTurns: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"thaara">, import("@sinclair/typebox").TLiteral<"customer">]>;
        text: import("@sinclair/typebox").TString;
        sourceRefs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    }>>>;
    aiInterpretation: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        attendanceClassification: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"confirmed">, import("@sinclair/typebox").TLiteral<"interested">, import("@sinclair/typebox").TLiteral<"declined">, import("@sinclair/typebox").TLiteral<"not_interested">, import("@sinclair/typebox").TLiteral<"wants_more_info">, import("@sinclair/typebox").TLiteral<"callback_requested">, import("@sinclair/typebox").TLiteral<"opted_out">, import("@sinclair/typebox").TLiteral<"no_response">, import("@sinclair/typebox").TLiteral<"busy">, import("@sinclair/typebox").TLiteral<"invalid_number">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">]>;
        preferredCallbackTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        rationale: import("@sinclair/typebox").TString;
        isAiInterpretation: import("@sinclair/typebox").TLiteral<true>;
        confirmedByEvidence: import("@sinclair/typebox").TLiteral<false>;
    }>>;
    phoneTranscriptSummary: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    preferredCallbackTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    followUpRequired: import("@sinclair/typebox").TBoolean;
    followUpReason: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    attendanceOutcome: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"confirmed">, import("@sinclair/typebox").TLiteral<"interested">, import("@sinclair/typebox").TLiteral<"declined">, import("@sinclair/typebox").TLiteral<"not_interested">, import("@sinclair/typebox").TLiteral<"wants_more_info">, import("@sinclair/typebox").TLiteral<"callback_requested">, import("@sinclair/typebox").TLiteral<"opted_out">, import("@sinclair/typebox").TLiteral<"no_response">, import("@sinclair/typebox").TLiteral<"busy">, import("@sinclair/typebox").TLiteral<"invalid_number">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">]>;
    retryCount: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    interactionTimestamp: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    structuredNotes: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    updatedAt: import("@sinclair/typebox").TString;
}>;
export type BulkCampaignContactRecord = Static<typeof BulkCampaignContactRecordSchema>;
export declare const BulkCampaignDashboardMetricsSchema: import("@sinclair/typebox").TObject<{
    totalContacts: import("@sinclair/typebox").TInteger;
    eligibleContacts: import("@sinclair/typebox").TInteger;
    unauthorizedContacts: import("@sinclair/typebox").TInteger;
    unsupportedContacts: import("@sinclair/typebox").TInteger;
    duplicateEntries: import("@sinclair/typebox").TInteger;
    invalidEntries: import("@sinclair/typebox").TInteger;
    eligibleWhatsappContacts: import("@sinclair/typebox").TInteger;
    eligiblePhoneContacts: import("@sinclair/typebox").TInteger;
    eligibleEmailContacts: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    whatsappDelivered: import("@sinclair/typebox").TInteger;
    whatsappFailed: import("@sinclair/typebox").TInteger;
    whatsappPending: import("@sinclair/typebox").TInteger;
    whatsappSkipped: import("@sinclair/typebox").TInteger;
    emailSent: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    emailFailed: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    emailPending: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    emailUnsubscribed: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    phoneDraftsPrepared: import("@sinclair/typebox").TInteger;
    phoneAwaitingApproval: import("@sinclair/typebox").TInteger;
    phoneApproved: import("@sinclair/typebox").TInteger;
    phoneQueued: import("@sinclair/typebox").TInteger;
    callsAttempted: import("@sinclair/typebox").TInteger;
    callsCompleted: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    callsAnswered: import("@sinclair/typebox").TInteger;
    callsNotAnswered: import("@sinclair/typebox").TInteger;
    callsPending: import("@sinclair/typebox").TInteger;
    callsSkipped: import("@sinclair/typebox").TInteger;
    confirmed: import("@sinclair/typebox").TInteger;
    declined: import("@sinclair/typebox").TInteger;
    wantsMoreInfo: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    busyCount: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    callbackRequested: import("@sinclair/typebox").TInteger;
    followUpRequiredCount: import("@sinclair/typebox").TInteger;
    optedOut: import("@sinclair/typebox").TInteger;
    pending: import("@sinclair/typebox").TInteger;
    failed: import("@sinclair/typebox").TInteger;
    skipped: import("@sinclair/typebox").TInteger;
}>;
export type BulkCampaignDashboardMetrics = Static<typeof BulkCampaignDashboardMetricsSchema>;
/**
 * Verified published Phone API contract (`packages/contracts/src/phone-calling.ts` & `apps/api/src/routes/phone-calling.ts`).
 * Uses the real per-call draft + explicit approval + call/simulation + provider result endpoints.
 */
export declare const PhoneBatchIntegrationContractSchema: import("@sinclair/typebox").TObject<{
    contactsDirectoryEndpoint: import("@sinclair/typebox").TLiteral<"GET /api/v1/connectors/phone/ai/contacts">;
    prepareDraftEndpoint: import("@sinclair/typebox").TLiteral<"POST /api/v1/connectors/phone/ai/drafts">;
    openRequestsEndpoint: import("@sinclair/typebox").TLiteral<"GET /api/v1/connectors/phone/ai/requests">;
    confirmLiveCallEndpoint: import("@sinclair/typebox").TLiteral<"POST /api/v1/connectors/phone/ai/calls/confirm">;
    placeApprovedCallEndpoint: import("@sinclair/typebox").TLiteral<"POST /api/v1/connectors/phone/ai/calls">;
    simulateCallEndpoint: import("@sinclair/typebox").TLiteral<"POST /api/v1/connectors/phone/ai/simulations">;
    callHistoryEndpoint: import("@sinclair/typebox").TLiteral<"GET /api/v1/connectors/phone/ai/calls">;
    providerResultEndpoint: import("@sinclair/typebox").TLiteral<"POST /api/v1/connectors/phone/ai/calls/:callId/result">;
    supportedLanguages: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">]>>;
    maxPurposeLength: import("@sinclair/typebox").TLiteral<1000>;
    defaultDailyLiveCallLimit: import("@sinclair/typebox").TLiteral<5>;
    maxConfiguredDailyLiveCallLimit: import("@sinclair/typebox").TInteger;
}>;
export type PhoneBatchIntegrationContract = Static<typeof PhoneBatchIntegrationContractSchema>;
export declare const BulkCampaignTemplateSummarySchema: import("@sinclair/typebox").TObject<{
    name: import("@sinclair/typebox").TString;
    language: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"APPROVED">, import("@sinclair/typebox").TLiteral<"PENDING">, import("@sinclair/typebox").TLiteral<"REJECTED">, import("@sinclair/typebox").TLiteral<"PAUSED">, import("@sinclair/typebox").TLiteral<"DISABLED">]>;
    category: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"MARKETING">, import("@sinclair/typebox").TLiteral<"UTILITY">, import("@sinclair/typebox").TLiteral<"AUTHENTICATION">]>;
    bodyText: import("@sinclair/typebox").TString;
    bodyParams: import("@sinclair/typebox").TInteger;
    usableForCampaign: import("@sinclair/typebox").TBoolean;
}>;
export type BulkCampaignTemplateSummary = Static<typeof BulkCampaignTemplateSummarySchema>;
export declare const BulkCampaignWorkspaceContextSchema: import("@sinclair/typebox").TObject<{
    whatsappConnected: import("@sinclair/typebox").TBoolean;
    whatsappConnectionId: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    whatsappBusinessLabel: import("@sinclair/typebox").TString;
    liveSendingEnabled: import("@sinclair/typebox").TBoolean;
    optedInWhatsappContactsCount: import("@sinclair/typebox").TInteger;
    availableTemplates: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        name: import("@sinclair/typebox").TString;
        language: import("@sinclair/typebox").TString;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"APPROVED">, import("@sinclair/typebox").TLiteral<"PENDING">, import("@sinclair/typebox").TLiteral<"REJECTED">, import("@sinclair/typebox").TLiteral<"PAUSED">, import("@sinclair/typebox").TLiteral<"DISABLED">]>;
        category: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"MARKETING">, import("@sinclair/typebox").TLiteral<"UTILITY">, import("@sinclair/typebox").TLiteral<"AUTHENTICATION">]>;
        bodyText: import("@sinclair/typebox").TString;
        bodyParams: import("@sinclair/typebox").TInteger;
        usableForCampaign: import("@sinclair/typebox").TBoolean;
    }>>;
    phoneContactsConfigured: import("@sinclair/typebox").TBoolean;
    savedPhoneContactsCount: import("@sinclair/typebox").TInteger;
    liveCallingEnabled: import("@sinclair/typebox").TBoolean;
    dailyPhoneCallLimit: import("@sinclair/typebox").TInteger;
    unlimitedDailyCalls: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    emailConnected: import("@sinclair/typebox").TBoolean;
    connectedEmail: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    emailSendReady: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    sarvamOutboundAgentLabel: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export type BulkCampaignWorkspaceContext = Static<typeof BulkCampaignWorkspaceContextSchema>;
export declare const BulkCampaignKnowledgeFileFormatSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pdf">, import("@sinclair/typebox").TLiteral<"docx">, import("@sinclair/typebox").TLiteral<"txt">, import("@sinclair/typebox").TLiteral<"csv">, import("@sinclair/typebox").TLiteral<"xlsx">]>;
export type BulkCampaignKnowledgeFileFormat = Static<typeof BulkCampaignKnowledgeFileFormatSchema>;
export declare const BulkCampaignKnowledgeUploadInputSchema: import("@sinclair/typebox").TObject<{
    fileName: import("@sinclair/typebox").TString;
    mimeType: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    rawText: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    fileBase64: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export type BulkCampaignKnowledgeUploadInput = Static<typeof BulkCampaignKnowledgeUploadInputSchema>;
export declare const BulkCampaignKnowledgeFileRecordSchema: import("@sinclair/typebox").TObject<{
    fileId: import("@sinclair/typebox").TString;
    fileName: import("@sinclair/typebox").TString;
    format: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pdf">, import("@sinclair/typebox").TLiteral<"docx">, import("@sinclair/typebox").TLiteral<"txt">, import("@sinclair/typebox").TLiteral<"csv">, import("@sinclair/typebox").TLiteral<"xlsx">]>;
    sizeBytes: import("@sinclair/typebox").TInteger;
    sha256: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"processed">, import("@sinclair/typebox").TLiteral<"rejected">]>;
    statusMessage: import("@sinclair/typebox").TString;
    extractedCharCount: import("@sinclair/typebox").TInteger;
    chunkCount: import("@sinclair/typebox").TInteger;
}>;
export type BulkCampaignKnowledgeFileRecord = Static<typeof BulkCampaignKnowledgeFileRecordSchema>;
export declare const BulkCampaignKnowledgeChunkSchema: import("@sinclair/typebox").TObject<{
    chunkId: import("@sinclair/typebox").TString;
    fileId: import("@sinclair/typebox").TString;
    fileName: import("@sinclair/typebox").TString;
    heading: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    text: import("@sinclair/typebox").TString;
    keywords: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
}>;
export type BulkCampaignKnowledgeChunk = Static<typeof BulkCampaignKnowledgeChunkSchema>;
export declare const BulkCampaignGroundedQaItemSchema: import("@sinclair/typebox").TObject<{
    question: import("@sinclair/typebox").TString;
    answer: import("@sinclair/typebox").TString;
    sourceRefs: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    grounded: import("@sinclair/typebox").TBoolean;
    requiresHumanFollowUp: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
}>;
export type BulkCampaignGroundedQaItem = Static<typeof BulkCampaignGroundedQaItemSchema>;
export declare const BulkCampaignExtractedFactsSchema: import("@sinclair/typebox").TObject<{
    campaignType: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"webinar">, import("@sinclair/typebox").TLiteral<"services">, import("@sinclair/typebox").TLiteral<"general">]>;
    title: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    agendaTopics: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    speakers: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    dateAndTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    registrationInfo: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    targetAudience: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    servicesOffered: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    pricingSummary: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    pricingExplicitlyProvided: import("@sinclair/typebox").TBoolean;
    implementationTimeline: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    faqs: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        question: import("@sinclair/typebox").TString;
        answer: import("@sinclair/typebox").TString;
        sourceFile: import("@sinclair/typebox").TString;
    }>>;
}>;
export type BulkCampaignExtractedFacts = Static<typeof BulkCampaignExtractedFactsSchema>;
export declare const BulkCampaignKnowledgeContextSchema: import("@sinclair/typebox").TObject<{
    files: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        fileId: import("@sinclair/typebox").TString;
        fileName: import("@sinclair/typebox").TString;
        format: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pdf">, import("@sinclair/typebox").TLiteral<"docx">, import("@sinclair/typebox").TLiteral<"txt">, import("@sinclair/typebox").TLiteral<"csv">, import("@sinclair/typebox").TLiteral<"xlsx">]>;
        sizeBytes: import("@sinclair/typebox").TInteger;
        sha256: import("@sinclair/typebox").TString;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"processed">, import("@sinclair/typebox").TLiteral<"rejected">]>;
        statusMessage: import("@sinclair/typebox").TString;
        extractedCharCount: import("@sinclair/typebox").TInteger;
        chunkCount: import("@sinclair/typebox").TInteger;
    }>>;
    chunks: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        chunkId: import("@sinclair/typebox").TString;
        fileId: import("@sinclair/typebox").TString;
        fileName: import("@sinclair/typebox").TString;
        heading: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        text: import("@sinclair/typebox").TString;
        keywords: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    }>>;
    extractedFacts: import("@sinclair/typebox").TObject<{
        campaignType: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"webinar">, import("@sinclair/typebox").TLiteral<"services">, import("@sinclair/typebox").TLiteral<"general">]>;
        title: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        agendaTopics: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        speakers: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        dateAndTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        registrationInfo: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        targetAudience: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        servicesOffered: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        pricingSummary: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        pricingExplicitlyProvided: import("@sinclair/typebox").TBoolean;
        implementationTimeline: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        faqs: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            question: import("@sinclair/typebox").TString;
            answer: import("@sinclair/typebox").TString;
            sourceFile: import("@sinclair/typebox").TString;
        }>>;
    }>;
    conflicts: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    missingDetails: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    sarvamBoundedFactBrief: import("@sinclair/typebox").TString;
    sampleGroundedQa: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        question: import("@sinclair/typebox").TString;
        answer: import("@sinclair/typebox").TString;
        sourceRefs: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        grounded: import("@sinclair/typebox").TBoolean;
        requiresHumanFollowUp: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    }>>;
}>;
export type BulkCampaignKnowledgeContext = Static<typeof BulkCampaignKnowledgeContextSchema>;
export declare const BulkCampaignEligiblePilotContactSchema: import("@sinclair/typebox").TObject<{
    contactId: import("@sinclair/typebox").TString;
    displayName: import("@sinclair/typebox").TString;
    maskedPhone: import("@sinclair/typebox").TString;
    consentExpiresAt: import("@sinclair/typebox").TString;
    source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"phone_directory">, import("@sinclair/typebox").TLiteral<"campaign_eligible">]>;
}>;
export type BulkCampaignEligiblePilotContact = Static<typeof BulkCampaignEligiblePilotContactSchema>;
export declare const BulkCampaignPilotCallStateSchema: import("@sinclair/typebox").TObject<{
    pilotId: import("@sinclair/typebox").TString;
    campaignId: import("@sinclair/typebox").TString;
    contactId: import("@sinclair/typebox").TString;
    displayName: import("@sinclair/typebox").TString;
    maskedPhone: import("@sinclair/typebox").TString;
    language: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">]>;
    callPurpose: import("@sinclair/typebox").TString;
    approvalId: import("@sinclair/typebox").TString;
    preparedAt: import("@sinclair/typebox").TString;
    expiresAt: import("@sinclair/typebox").TString;
    approvedAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    approvedByUserId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"prepared">, import("@sinclair/typebox").TLiteral<"placing">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"ringing">, import("@sinclair/typebox").TLiteral<"answered">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">, import("@sinclair/typebox").TLiteral<"busy">, import("@sinclair/typebox").TLiteral<"no_answer">, import("@sinclair/typebox").TLiteral<"unverified">]>;
    callId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    providerCallId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    startedAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    endedAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    durationSeconds: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TInteger, import("@sinclair/typebox").TNull]>>;
    recordingAvailable: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    transcript: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"thaara">, import("@sinclair/typebox").TLiteral<"customer">]>;
        text: import("@sinclair/typebox").TString;
    }>>>;
    summary: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    outcomeLabel: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    callbackStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"none">, import("@sinclair/typebox").TLiteral<"declined">, import("@sinclair/typebox").TLiteral<"confirmed">, import("@sinclair/typebox").TLiteral<"needs_review">]>>;
    requirements: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    error: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    isRealCall: import("@sinclair/typebox").TLiteral<true>;
}>;
export type BulkCampaignPilotCallState = Static<typeof BulkCampaignPilotCallStateSchema>;
export declare const BulkCampaignN8nChannelSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"phone_call">, import("@sinclair/typebox").TLiteral<"whatsapp">]>;
export type BulkCampaignN8nChannel = Static<typeof BulkCampaignN8nChannelSchema>;
export declare const BulkCampaignN8nJobStatusSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">, import("@sinclair/typebox").TLiteral<"stopped">]>;
export type BulkCampaignN8nJobStatus = Static<typeof BulkCampaignN8nJobStatusSchema>;
export declare const BulkCampaignN8nBatchRecipientSchema: import("@sinclair/typebox").TObject<{
    contactId: import("@sinclair/typebox").TString;
    displayName: import("@sinclair/typebox").TString;
    maskedPhone: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"claimed">, import("@sinclair/typebox").TLiteral<"dispatched">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    attempts: import("@sinclair/typebox").TInteger;
    idempotencyKey: import("@sinclair/typebox").TString;
    providerId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    outcome: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    failureReason: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    updatedAt: import("@sinclair/typebox").TString;
}>;
export type BulkCampaignN8nBatchRecipient = Static<typeof BulkCampaignN8nBatchRecipientSchema>;
export declare const BulkCampaignN8nBatchConfigSchema: import("@sinclair/typebox").TObject<{
    batchSize: import("@sinclair/typebox").TInteger;
    maxConcurrency: import("@sinclair/typebox").TInteger;
    rateLimitPerMinute: import("@sinclair/typebox").TInteger;
    maxRetries: import("@sinclair/typebox").TInteger;
}>;
export type BulkCampaignN8nBatchConfig = Static<typeof BulkCampaignN8nBatchConfigSchema>;
export declare const BulkCampaignN8nExecutionJobSchema: import("@sinclair/typebox").TObject<{
    jobId: import("@sinclair/typebox").TString;
    campaignId: import("@sinclair/typebox").TString;
    channel: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"phone_call">, import("@sinclair/typebox").TLiteral<"whatsapp">]>;
    mode: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"one_contact_pilot">, import("@sinclair/typebox").TLiteral<"multi_contact_batch">]>;
    workflowId: import("@sinclair/typebox").TString;
    webhookPath: import("@sinclair/typebox").TString;
    targetContactId: import("@sinclair/typebox").TString;
    targetDisplayName: import("@sinclair/typebox").TString;
    targetMaskedPhone: import("@sinclair/typebox").TString;
    batchConfig: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        batchSize: import("@sinclair/typebox").TInteger;
        maxConcurrency: import("@sinclair/typebox").TInteger;
        rateLimitPerMinute: import("@sinclair/typebox").TInteger;
        maxRetries: import("@sinclair/typebox").TInteger;
    }>>;
    recipientQueue: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        contactId: import("@sinclair/typebox").TString;
        displayName: import("@sinclair/typebox").TString;
        maskedPhone: import("@sinclair/typebox").TString;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"claimed">, import("@sinclair/typebox").TLiteral<"dispatched">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
        attempts: import("@sinclair/typebox").TInteger;
        idempotencyKey: import("@sinclair/typebox").TString;
        providerId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
        outcome: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
        failureReason: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
        updatedAt: import("@sinclair/typebox").TString;
    }>>>;
    totalContacts: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    processedCount: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    succeededCount: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    failedCount: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    skippedCount: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    emergencyStopped: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">, import("@sinclair/typebox").TLiteral<"stopped">]>;
    createdAt: import("@sinclair/typebox").TString;
    createdByUserId: import("@sinclair/typebox").TString;
    claimedAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    dispatchedAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    completedAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    pausedAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    resumedAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    cancelledAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    n8nExecutionId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    webhookDispatched: import("@sinclair/typebox").TBoolean;
    approvalId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    providerCallId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    providerMessageId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    dispatchId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    deliveryStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    replyReceived: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    latestReplyPreview: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    optOutDetected: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    outcomeSummary: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    failureReason: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    isSimulated: import("@sinclair/typebox").TLiteral<false>;
}>;
export type BulkCampaignN8nExecutionJob = Static<typeof BulkCampaignN8nExecutionJobSchema>;
export declare const BulkCampaignPilotWhatsAppStateSchema: import("@sinclair/typebox").TObject<{
    pilotId: import("@sinclair/typebox").TString;
    campaignId: import("@sinclair/typebox").TString;
    contactId: import("@sinclair/typebox").TString;
    displayName: import("@sinclair/typebox").TString;
    maskedPhone: import("@sinclair/typebox").TString;
    connectionId: import("@sinclair/typebox").TString;
    mode: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"template">, import("@sinclair/typebox").TLiteral<"window_text">]>;
    templateName: import("@sinclair/typebox").TString;
    language: import("@sinclair/typebox").TString;
    messagePreview: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"prepared">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"sent">, import("@sinclair/typebox").TLiteral<"delivered">, import("@sinclair/typebox").TLiteral<"read">, import("@sinclair/typebox").TLiteral<"replied">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    dispatchId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    providerMessageId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    replyReceived: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    latestReplyPreview: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    optOutDetected: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    error: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    updatedAt: import("@sinclair/typebox").TString;
    isRealMessage: import("@sinclair/typebox").TLiteral<true>;
}>;
export type BulkCampaignPilotWhatsAppState = Static<typeof BulkCampaignPilotWhatsAppStateSchema>;
export declare const BULK_CAMPAIGN_OUTCOME_COLORS: {
    readonly engaged: "#16A34A";
    readonly notAligned: "#64748B";
    readonly furtherDiscussion: "#2563EB";
};
export declare function formatBulkCampaignOutcomeDisplay(outcome: string, isSimulation?: boolean): {
    label: string;
    color: string;
    bg: string;
    fg: string;
};
//# sourceMappingURL=bulk-campaign.d.ts.map