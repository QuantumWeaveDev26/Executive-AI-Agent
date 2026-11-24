import { Static } from '@sinclair/typebox';
export declare const N8nWhatsAppConnectionsSchema: import("@sinclair/typebox").TObject<{
    mode: import("@sinclair/typebox").TLiteral<"offline_test">;
    liveSendingEnabled: import("@sinclair/typebox").TLiteral<false>;
    connections: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        connectionId: import("@sinclair/typebox").TString;
        revision: import("@sinclair/typebox").TInteger;
        disconnected: import("@sinclair/typebox").TBoolean;
    }>>;
}>;
export type N8nWhatsAppConnections = Static<typeof N8nWhatsAppConnectionsSchema>;
export declare const N8nWhatsAppInboxQuerySchema: import("@sinclair/typebox").TObject<{
    query: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    recipientId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    pageSize: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    pageToken: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export type N8nWhatsAppInboxQuery = Static<typeof N8nWhatsAppInboxQuerySchema>;
export declare const WhatsAppStoredFailureMetadataSchema: import("@sinclair/typebox").TObject<{
    code: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TInteger, import("@sinclair/typebox").TNull]>;
    title: import("@sinclair/typebox").TString;
    details: import("@sinclair/typebox").TString;
}>;
export type WhatsAppStoredFailureMetadata = Static<typeof WhatsAppStoredFailureMetadataSchema>;
export declare const isWhatsAppStoredFailureMetadata: (value: unknown) => value is WhatsAppStoredFailureMetadata;
export declare const WhatsAppLeadStatusSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"Enquired">, import("@sinclair/typebox").TLiteral<"Callback requested">, import("@sinclair/typebox").TLiteral<"Booked appointment">, import("@sinclair/typebox").TLiteral<"Needs review">]>;
export declare const WhatsAppEscalationReasonSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"opt_out">, import("@sinclair/typebox").TLiteral<"human_handoff">, import("@sinclair/typebox").TLiteral<"prompt_injection">, import("@sinclair/typebox").TLiteral<"sensitive_request">, import("@sinclair/typebox").TLiteral<"uncertain_query">]>;
export declare const WhatsAppStoredAutoReplyStatusSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"disabled">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"replied">, import("@sinclair/typebox").TLiteral<"escalated">, import("@sinclair/typebox").TLiteral<"skipped_loop_guard">, import("@sinclair/typebox").TLiteral<"skipped_failure_guard">, import("@sinclair/typebox").TLiteral<"skipped_window_closed">]>;
export declare const WhatsAppAutoReplyStatusSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"disabled">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"replied">, import("@sinclair/typebox").TLiteral<"escalated">, import("@sinclair/typebox").TLiteral<"expired_reservation">, import("@sinclair/typebox").TLiteral<"recovery_attention_required">, import("@sinclair/typebox").TLiteral<"skipped_loop_guard">, import("@sinclair/typebox").TLiteral<"skipped_failure_guard">, import("@sinclair/typebox").TLiteral<"skipped_window_closed">]>;
export declare const WhatsAppStoredAutoReplyMetadataSchema: import("@sinclair/typebox").TObject<{
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"disabled">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"replied">, import("@sinclair/typebox").TLiteral<"escalated">, import("@sinclair/typebox").TLiteral<"skipped_loop_guard">, import("@sinclair/typebox").TLiteral<"skipped_failure_guard">, import("@sinclair/typebox").TLiteral<"skipped_window_closed">]>;
    idempotencyKey: import("@sinclair/typebox").TString;
    evaluatedAt: import("@sinclair/typebox").TString;
    reason: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"opt_out">, import("@sinclair/typebox").TLiteral<"human_handoff">, import("@sinclair/typebox").TLiteral<"prompt_injection">, import("@sinclair/typebox").TLiteral<"sensitive_request">, import("@sinclair/typebox").TLiteral<"uncertain_query">]>>;
}>;
export type WhatsAppStoredAutoReplyMetadata = Static<typeof WhatsAppStoredAutoReplyMetadataSchema>;
export declare const isWhatsAppStoredAutoReplyMetadata: (value: unknown) => value is WhatsAppStoredAutoReplyMetadata;
export declare const WhatsAppConsentProvenanceSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"explicit_message_consent">, import("@sinclair/typebox").TLiteral<"stored_contact_opt_in">, import("@sinclair/typebox").TLiteral<"revoked_opt_out">, import("@sinclair/typebox").TLiteral<"unknown">]>;
export declare const WhatsAppCustomerLanguageSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en">, import("@sinclair/typebox").TLiteral<"kn">, import("@sinclair/typebox").TLiteral<"hi">]>;
export declare const CalendlyBookingEvidenceSchema: import("@sinclair/typebox").TObject<{
    bookingId: import("@sinclair/typebox").TString;
    eventUri: import("@sinclair/typebox").TString;
    inviteeUri: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TLiteral<"active">;
}>;
export type CalendlyBookingEvidence = Static<typeof CalendlyBookingEvidenceSchema>;
export declare const WhatsAppConversationEnquirySchema: import("@sinclair/typebox").TObject<{
    leadStatus: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"Enquired">, import("@sinclair/typebox").TLiteral<"Callback requested">, import("@sinclair/typebox").TLiteral<"Booked appointment">, import("@sinclair/typebox").TLiteral<"Needs review">]>;
    customerName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    customerEmail: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    emailDeclined: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    businessName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    businessCategory: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    businessType: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    requestedService: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    businessProblem: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    referredWebsite: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    latestCustomerMessage: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    suggestedReply: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    enquirySummary: import("@sinclair/typebox").TString;
    callbackRequested: import("@sinclair/typebox").TBoolean;
    appointmentInterest: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    appointmentStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"REQUESTED">, import("@sinclair/typebox").TLiteral<"CONFIRMED">, import("@sinclair/typebox").TLiteral<"CANCELLED">, import("@sinclair/typebox").TLiteral<"LINK_SENT">, import("@sinclair/typebox").TLiteral<"AWAITING_CUSTOMER_BOOKING">]>>;
    calendlyUrl: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    calendlyBookingId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    calendarEventId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    calendarConfirmedAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    preferredCallbackTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    contactOptedIn: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    consentProvenance: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"explicit_message_consent">, import("@sinclair/typebox").TLiteral<"stored_contact_opt_in">, import("@sinclair/typebox").TLiteral<"revoked_opt_out">, import("@sinclair/typebox").TLiteral<"unknown">]>>;
    consentRecorded: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    consentTimestamp: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    detectedLanguage: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en">, import("@sinclair/typebox").TLiteral<"kn">, import("@sinclair/typebox").TLiteral<"hi">]>>;
    optOutRequested: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
    humanHandoffRequested: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
    injectionDetected: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
    sensitiveOrUncertain: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
    escalationReason: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"opt_out">, import("@sinclair/typebox").TLiteral<"human_handoff">, import("@sinclair/typebox").TLiteral<"prompt_injection">, import("@sinclair/typebox").TLiteral<"sensitive_request">, import("@sinclair/typebox").TLiteral<"uncertain_query">]>>;
    autoReplyStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"disabled">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"replied">, import("@sinclair/typebox").TLiteral<"escalated">, import("@sinclair/typebox").TLiteral<"expired_reservation">, import("@sinclair/typebox").TLiteral<"recovery_attention_required">, import("@sinclair/typebox").TLiteral<"skipped_loop_guard">, import("@sinclair/typebox").TLiteral<"skipped_failure_guard">, import("@sinclair/typebox").TLiteral<"skipped_window_closed">]>>;
}>;
export declare const N8nWhatsAppAttachmentSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"image">, import("@sinclair/typebox").TLiteral<"document">, import("@sinclair/typebox").TLiteral<"audio">]>;
    mimeType: import("@sinclair/typebox").TString;
    filename: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    downloadStatus: import("@sinclair/typebox").TLiteral<"not_downloaded">;
}>;
export declare const N8nWhatsAppInboxSchema: import("@sinclair/typebox").TObject<{
    transport: import("@sinclair/typebox").TLiteral<"n8n">;
    mode: import("@sinclair/typebox").TLiteral<"offline_test">;
    liveSendingEnabled: import("@sinclair/typebox").TBoolean;
    autoReplyEnabled: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    startupRecoveryFailed: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    verified: import("@sinclair/typebox").TLiteral<false>;
    connectionId: import("@sinclair/typebox").TString;
    revision: import("@sinclair/typebox").TInteger;
    conversations: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        recipientId: import("@sinclair/typebox").TString;
        contactName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        maskedPhone: import("@sinclair/typebox").TString;
        messageCount: import("@sinclair/typebox").TInteger;
        lastMessageAt: import("@sinclair/typebox").TString;
        lastMessagePreview: import("@sinclair/typebox").TString;
        untrusted: import("@sinclair/typebox").TLiteral<true>;
        enquiry: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            leadStatus: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"Enquired">, import("@sinclair/typebox").TLiteral<"Callback requested">, import("@sinclair/typebox").TLiteral<"Booked appointment">, import("@sinclair/typebox").TLiteral<"Needs review">]>;
            customerName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            customerEmail: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            emailDeclined: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
            businessName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            businessCategory: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            businessType: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            requestedService: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            businessProblem: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            referredWebsite: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            latestCustomerMessage: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            suggestedReply: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            enquirySummary: import("@sinclair/typebox").TString;
            callbackRequested: import("@sinclair/typebox").TBoolean;
            appointmentInterest: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
            appointmentStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"REQUESTED">, import("@sinclair/typebox").TLiteral<"CONFIRMED">, import("@sinclair/typebox").TLiteral<"CANCELLED">, import("@sinclair/typebox").TLiteral<"LINK_SENT">, import("@sinclair/typebox").TLiteral<"AWAITING_CUSTOMER_BOOKING">]>>;
            calendlyUrl: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            calendlyBookingId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            calendarEventId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            calendarConfirmedAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            preferredCallbackTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            contactOptedIn: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
            consentProvenance: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"explicit_message_consent">, import("@sinclair/typebox").TLiteral<"stored_contact_opt_in">, import("@sinclair/typebox").TLiteral<"revoked_opt_out">, import("@sinclair/typebox").TLiteral<"unknown">]>>;
            consentRecorded: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
            consentTimestamp: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            detectedLanguage: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en">, import("@sinclair/typebox").TLiteral<"kn">, import("@sinclair/typebox").TLiteral<"hi">]>>;
            optOutRequested: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
            humanHandoffRequested: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
            injectionDetected: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
            sensitiveOrUncertain: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
            escalationReason: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"opt_out">, import("@sinclair/typebox").TLiteral<"human_handoff">, import("@sinclair/typebox").TLiteral<"prompt_injection">, import("@sinclair/typebox").TLiteral<"sensitive_request">, import("@sinclair/typebox").TLiteral<"uncertain_query">]>>;
            autoReplyStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"disabled">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"replied">, import("@sinclair/typebox").TLiteral<"escalated">, import("@sinclair/typebox").TLiteral<"expired_reservation">, import("@sinclair/typebox").TLiteral<"recovery_attention_required">, import("@sinclair/typebox").TLiteral<"skipped_loop_guard">, import("@sinclair/typebox").TLiteral<"skipped_failure_guard">, import("@sinclair/typebox").TLiteral<"skipped_window_closed">]>>;
        }>>;
    }>>;
    messages: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        attachment: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"image">, import("@sinclair/typebox").TLiteral<"document">, import("@sinclair/typebox").TLiteral<"audio">]>;
            mimeType: import("@sinclair/typebox").TString;
            filename: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            downloadStatus: import("@sinclair/typebox").TLiteral<"not_downloaded">;
        }>>;
        deliveryEvents: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"sent">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"delivered">, import("@sinclair/typebox").TLiteral<"read">]>;
            timestamp: import("@sinclair/typebox").TString;
            errorCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
            errorTitle: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            errorDetails: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        }>>>;
        id: import("@sinclair/typebox").TString;
        providerMessageId: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        recipientId: import("@sinclair/typebox").TString;
        maskedPhone: import("@sinclair/typebox").TString;
        direction: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"inbound">, import("@sinclair/typebox").TLiteral<"outbound">]>;
        textPreview: import("@sinclair/typebox").TString;
        timestamp: import("@sinclair/typebox").TString;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"received">, import("@sinclair/typebox").TLiteral<"reserved">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"sent">, import("@sinclair/typebox").TLiteral<"delivered">, import("@sinclair/typebox").TLiteral<"read">, import("@sinclair/typebox").TLiteral<"failed">]>;
        mode: import("@sinclair/typebox").TLiteral<"offline_test">;
        verified: import("@sinclair/typebox").TLiteral<false>;
        untrusted: import("@sinclair/typebox").TLiteral<true>;
    }>>;
    nextPageToken: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
}>;
export type N8nWhatsAppInbox = Static<typeof N8nWhatsAppInboxSchema>;
export declare const isN8nWhatsAppInbox: (value: unknown) => value is N8nWhatsAppInbox;
export declare const N8nWhatsAppContactsSchema: import("@sinclair/typebox").TObject<{
    connectionId: import("@sinclair/typebox").TString;
    revision: import("@sinclair/typebox").TInteger;
    liveSendingEnabled: import("@sinclair/typebox").TBoolean;
    contacts: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        recipientId: import("@sinclair/typebox").TString;
        contactName: import("@sinclair/typebox").TString;
        maskedPhone: import("@sinclair/typebox").TString;
        optedIn: import("@sinclair/typebox").TBoolean;
        lastInboundAt: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        eligibility: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"eligible">, import("@sinclair/typebox").TLiteral<"window_closed">, import("@sinclair/typebox").TLiteral<"not_opted_in">]>;
    }>>;
}>;
export type N8nWhatsAppContacts = Static<typeof N8nWhatsAppContactsSchema>;
export declare const isN8nWhatsAppContacts: (value: unknown) => value is N8nWhatsAppContacts;
export declare const N8nWhatsAppTemplateButtonSchema: import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"QUICK_REPLY">, import("@sinclair/typebox").TLiteral<"URL">, import("@sinclair/typebox").TLiteral<"PHONE_NUMBER">, import("@sinclair/typebox").TLiteral<"OTHER">]>;
    text: import("@sinclair/typebox").TString;
    dynamic: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
}>;
export declare const N8nWhatsAppTemplatesSchema: import("@sinclair/typebox").TObject<{
    connectionId: import("@sinclair/typebox").TString;
    templates: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        name: import("@sinclair/typebox").TString;
        language: import("@sinclair/typebox").TString;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"APPROVED">, import("@sinclair/typebox").TLiteral<"PENDING">, import("@sinclair/typebox").TLiteral<"REJECTED">, import("@sinclair/typebox").TLiteral<"PAUSED">, import("@sinclair/typebox").TLiteral<"DISABLED">]>;
        category: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"MARKETING">, import("@sinclair/typebox").TLiteral<"UTILITY">, import("@sinclair/typebox").TLiteral<"AUTHENTICATION">]>;
        bodyText: import("@sinclair/typebox").TString;
        bodyParams: import("@sinclair/typebox").TInteger;
        headerText: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        headerParams: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        headerMedia: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
        footerText: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        buttons: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            type: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"QUICK_REPLY">, import("@sinclair/typebox").TLiteral<"URL">, import("@sinclair/typebox").TLiteral<"PHONE_NUMBER">, import("@sinclair/typebox").TLiteral<"OTHER">]>;
            text: import("@sinclair/typebox").TString;
            dynamic: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
        }>>>;
        unsupportedButtons: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
        invalidPlaceholders: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
    }>>;
}>;
export type N8nWhatsAppTemplates = Static<typeof N8nWhatsAppTemplatesSchema>;
export declare const isN8nWhatsAppTemplates: (value: unknown) => value is N8nWhatsAppTemplates;
export declare const isN8nWhatsAppConnections: (value: unknown) => value is N8nWhatsAppConnections;
export declare const N8nWhatsAppDispatchAcknowledgementSchema: import("@sinclair/typebox").TObject<{
    dispatchId: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"not_configured">, import("@sinclair/typebox").TLiteral<"unverified">]>;
    verified: import("@sinclair/typebox").TLiteral<false>;
}>;
export type N8nWhatsAppDispatchAcknowledgement = Static<typeof N8nWhatsAppDispatchAcknowledgementSchema>;
export declare const N8nWhatsAppRelaySchema: import("@sinclair/typebox").TObject<{
    event: import("@sinclair/typebox").TUnknown;
}>;
export declare const N8nWhatsAppDispatchSchema: import("@sinclair/typebox").TObject<{
    draft: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        connectionId: import("@sinclair/typebox").TString;
        connectionRevision: import("@sinclair/typebox").TInteger;
        senderPhoneNumberId: import("@sinclair/typebox").TString;
        recipientId: import("@sinclair/typebox").TString;
        bodyText: import("@sinclair/typebox").TString;
        replyToProviderMessageId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        idempotencyKey: import("@sinclair/typebox").TString;
    }>, import("@sinclair/typebox").TObject<{
        template: import("@sinclair/typebox").TObject<{
            name: import("@sinclair/typebox").TString;
            language: import("@sinclair/typebox").TString;
            bodyParams: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
            headerParams: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        }>;
        connectionId: import("@sinclair/typebox").TString;
        connectionRevision: import("@sinclair/typebox").TInteger;
        senderPhoneNumberId: import("@sinclair/typebox").TString;
        recipientId: import("@sinclair/typebox").TString;
        idempotencyKey: import("@sinclair/typebox").TString;
    }>, import("@sinclair/typebox").TObject<{
        media: import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"image">, import("@sinclair/typebox").TLiteral<"document">, import("@sinclair/typebox").TLiteral<"audio">]>;
            mediaId: import("@sinclair/typebox").TString;
            mimeType: import("@sinclair/typebox").TString;
            sha256: import("@sinclair/typebox").TString;
            caption: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            filename: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        }>;
        replyToProviderMessageId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        connectionId: import("@sinclair/typebox").TString;
        connectionRevision: import("@sinclair/typebox").TInteger;
        senderPhoneNumberId: import("@sinclair/typebox").TString;
        recipientId: import("@sinclair/typebox").TString;
        idempotencyKey: import("@sinclair/typebox").TString;
    }>]>;
    approvalId: import("@sinclair/typebox").TString;
}>;
export declare const N8nWhatsAppDurableStatusSchema: import("@sinclair/typebox").TObject<{
    transport: import("@sinclair/typebox").TLiteral<"n8n">;
    mode: import("@sinclair/typebox").TLiteral<"offline_test">;
    configured: import("@sinclair/typebox").TLiteral<false>;
    liveSendingEnabled: import("@sinclair/typebox").TLiteral<false>;
    storage: import("@sinclair/typebox").TLiteral<"postgresql_offline">;
    revision: import("@sinclair/typebox").TInteger;
    disconnected: import("@sinclair/typebox").TBoolean;
}>;
export declare const N8nWhatsAppDisconnectSchema: import("@sinclair/typebox").TObject<{
    disconnected: import("@sinclair/typebox").TLiteral<true>;
    revision: import("@sinclair/typebox").TInteger;
}>;
export declare const N8nWhatsAppClaimSchema: import("@sinclair/typebox").TObject<{
    dispatchId: import("@sinclair/typebox").TString;
    connectionRevision: import("@sinclair/typebox").TInteger;
}>;
export declare const N8nWhatsAppProviderReceiptSchema: import("@sinclair/typebox").TObject<{
    dispatchId: import("@sinclair/typebox").TString;
    providerMessageId: import("@sinclair/typebox").TString;
    recipientAddress: import("@sinclair/typebox").TString;
}>;
export type N8nWhatsAppProviderReceipt = Static<typeof N8nWhatsAppProviderReceiptSchema>;
export declare const N8nWhatsAppReceiptSchema: import("@sinclair/typebox").TObject<{
    transport: import("@sinclair/typebox").TLiteral<"n8n">;
    mode: import("@sinclair/typebox").TLiteral<"offline_test">;
    dispatchId: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    providerMessageId: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"not_configured">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"sent">, import("@sinclair/typebox").TLiteral<"delivered">, import("@sinclair/typebox").TLiteral<"read">, import("@sinclair/typebox").TLiteral<"failed">]>;
    verified: import("@sinclair/typebox").TLiteral<false>;
}>;
export type N8nWhatsAppReceipt = Static<typeof N8nWhatsAppReceiptSchema>;
export declare const N8nWhatsAppStatusSchema: import("@sinclair/typebox").TObject<{
    transport: import("@sinclair/typebox").TLiteral<"n8n">;
    mode: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"disabled">, import("@sinclair/typebox").TLiteral<"offline_test">]>;
    configured: import("@sinclair/typebox").TBoolean;
    liveSendingEnabled: import("@sinclair/typebox").TLiteral<false>;
    storage: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"not_configured">, import("@sinclair/typebox").TLiteral<"temporary_test_memory">]>;
}>;
export declare const N8nWhatsAppClaimResponseSchema: import("@sinclair/typebox").TObject<{
    authorized: import("@sinclair/typebox").TLiteral<true>;
    dispatchEnabled: import("@sinclair/typebox").TBoolean;
    dispatchId: import("@sinclair/typebox").TString;
    phoneNumberId: import("@sinclair/typebox").TString;
    recipientPhoneNumber: import("@sinclair/typebox").TString;
    messageType: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"text">, import("@sinclair/typebox").TLiteral<"template">, import("@sinclair/typebox").TLiteral<"media">]>>;
    textBody: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    template: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        name: import("@sinclair/typebox").TString;
        language: import("@sinclair/typebox").TString;
        bodyParams: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        headerParams: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    }>>;
    media: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"image">, import("@sinclair/typebox").TLiteral<"document">, import("@sinclair/typebox").TLiteral<"audio">]>;
        mediaId: import("@sinclair/typebox").TString;
        mimeType: import("@sinclair/typebox").TString;
        sha256: import("@sinclair/typebox").TString;
        caption: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        filename: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>>;
    replyToProviderMessageId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export declare const N8nWhatsAppRelayResultSchema: import("@sinclair/typebox").TObject<{
    acceptedMessages: import("@sinclair/typebox").TInteger;
    statusUpdates: import("@sinclair/typebox").TInteger;
    duplicates: import("@sinclair/typebox").TInteger;
}>;
export declare const N8nWhatsAppHistorySchema: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
    providerMessageId: import("@sinclair/typebox").TString;
    recipientId: import("@sinclair/typebox").TString;
    senderMaskedPhone: import("@sinclair/typebox").TString;
    textPreview: import("@sinclair/typebox").TString;
    timestamp: import("@sinclair/typebox").TString;
    mode: import("@sinclair/typebox").TLiteral<"offline_test">;
    untrusted: import("@sinclair/typebox").TLiteral<true>;
}>>;
export declare const N8nWhatsAppReplyDraftRequestSchema: import("@sinclair/typebox").TObject<{
    recipientId: import("@sinclair/typebox").TString;
    bodyText: import("@sinclair/typebox").TString;
    replyToProviderMessageId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export type N8nWhatsAppReplyDraftRequest = Static<typeof N8nWhatsAppReplyDraftRequestSchema>;
export declare const N8nWhatsAppReplyDraftSchema: import("@sinclair/typebox").TObject<{
    draft: import("@sinclair/typebox").TObject<{
        connectionId: import("@sinclair/typebox").TString;
        connectionRevision: import("@sinclair/typebox").TInteger;
        senderPhoneNumberId: import("@sinclair/typebox").TString;
        recipientId: import("@sinclair/typebox").TString;
        bodyText: import("@sinclair/typebox").TString;
        replyToProviderMessageId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        idempotencyKey: import("@sinclair/typebox").TString;
    }>;
    actionName: import("@sinclair/typebox").TLiteral<"whatsapp.meta.messages.send">;
    riskLevel: import("@sinclair/typebox").TLiteral<"high">;
    liveSendingEnabled: import("@sinclair/typebox").TLiteral<false>;
}>;
export type N8nWhatsAppReplyDraft = Static<typeof N8nWhatsAppReplyDraftSchema>;
export declare const N8nWhatsAppPreparedDraftSchema: import("@sinclair/typebox").TObject<{
    draft: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        connectionId: import("@sinclair/typebox").TString;
        connectionRevision: import("@sinclair/typebox").TInteger;
        senderPhoneNumberId: import("@sinclair/typebox").TString;
        recipientId: import("@sinclair/typebox").TString;
        bodyText: import("@sinclair/typebox").TString;
        replyToProviderMessageId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        idempotencyKey: import("@sinclair/typebox").TString;
    }>, import("@sinclair/typebox").TObject<{
        template: import("@sinclair/typebox").TObject<{
            name: import("@sinclair/typebox").TString;
            language: import("@sinclair/typebox").TString;
            bodyParams: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
            headerParams: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        }>;
        connectionId: import("@sinclair/typebox").TString;
        connectionRevision: import("@sinclair/typebox").TInteger;
        senderPhoneNumberId: import("@sinclair/typebox").TString;
        recipientId: import("@sinclair/typebox").TString;
        idempotencyKey: import("@sinclair/typebox").TString;
    }>, import("@sinclair/typebox").TObject<{
        media: import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"image">, import("@sinclair/typebox").TLiteral<"document">, import("@sinclair/typebox").TLiteral<"audio">]>;
            mediaId: import("@sinclair/typebox").TString;
            mimeType: import("@sinclair/typebox").TString;
            sha256: import("@sinclair/typebox").TString;
            caption: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            filename: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        }>;
        replyToProviderMessageId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        connectionId: import("@sinclair/typebox").TString;
        connectionRevision: import("@sinclair/typebox").TInteger;
        senderPhoneNumberId: import("@sinclair/typebox").TString;
        recipientId: import("@sinclair/typebox").TString;
        idempotencyKey: import("@sinclair/typebox").TString;
    }>]>;
    actionName: import("@sinclair/typebox").TLiteral<"whatsapp.meta.messages.send">;
    riskLevel: import("@sinclair/typebox").TLiteral<"high">;
    liveSendingEnabled: import("@sinclair/typebox").TLiteral<false>;
}>;
export type N8nWhatsAppPreparedDraft = Static<typeof N8nWhatsAppPreparedDraftSchema>;
export declare const isN8nWhatsAppPreparedDraft: (value: unknown) => value is N8nWhatsAppPreparedDraft;
export declare const N8nWhatsAppTemplateDraftRequestSchema: import("@sinclair/typebox").TObject<{
    recipientId: import("@sinclair/typebox").TString;
    name: import("@sinclair/typebox").TString;
    language: import("@sinclair/typebox").TString;
    bodyParams: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    headerParams: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
}>;
export type N8nWhatsAppTemplateDraftRequest = Static<typeof N8nWhatsAppTemplateDraftRequestSchema>;
export declare const N8nWhatsAppMediaDraftRequestSchema: import("@sinclair/typebox").TObject<{
    recipientId: import("@sinclair/typebox").TString;
    media: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"image">, import("@sinclair/typebox").TLiteral<"document">, import("@sinclair/typebox").TLiteral<"audio">]>;
        mediaId: import("@sinclair/typebox").TString;
        mimeType: import("@sinclair/typebox").TString;
        sha256: import("@sinclair/typebox").TString;
        caption: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        filename: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
}>;
export declare const N8nWhatsAppContactsUpdateSchema: import("@sinclair/typebox").TObject<{
    contacts: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        phoneE164: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        optedIn: import("@sinclair/typebox").TBoolean;
        displayName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>>;
}>;
export declare const N8nWhatsAppContactsUpdatedSchema: import("@sinclair/typebox").TObject<{
    connectionId: import("@sinclair/typebox").TString;
    revision: import("@sinclair/typebox").TInteger;
    contacts: import("@sinclair/typebox").TInteger;
}>;
export declare const N8nWhatsAppMediaUploadSchema: import("@sinclair/typebox").TObject<{
    media: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"image">, import("@sinclair/typebox").TLiteral<"document">, import("@sinclair/typebox").TLiteral<"audio">]>;
        mediaId: import("@sinclair/typebox").TString;
        mimeType: import("@sinclair/typebox").TString;
        sha256: import("@sinclair/typebox").TString;
        filename: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
}>;
export type N8nWhatsAppMediaUpload = Static<typeof N8nWhatsAppMediaUploadSchema>;
export declare const isN8nWhatsAppMediaUpload: (value: unknown) => value is N8nWhatsAppMediaUpload;
export declare const isN8nWhatsAppContactsUpdate: (value: unknown) => value is {
    contacts: {
        phoneE164?: string | undefined;
        displayName?: string | undefined;
        id: string;
        optedIn: boolean;
    }[];
};
export declare const isN8nWhatsAppContactsUpdated: (value: unknown) => value is {
    connectionId: string;
    revision: number;
    contacts: number;
};
export declare const isN8nWhatsAppTemplateDraftRequest: (value: unknown) => value is N8nWhatsAppTemplateDraftRequest;
export declare const isN8nWhatsAppMediaDraftRequest: (value: unknown) => value is {
    recipientId: string;
    media: {
        filename?: string | undefined;
        caption?: string | undefined;
        kind: "image" | "document" | "audio";
        mediaId: string;
        mimeType: string;
        sha256: string;
    };
};
export declare const isN8nWhatsAppReplyDraft: (value: unknown) => value is N8nWhatsAppReplyDraft;
export declare const isN8nWhatsAppReceipt: (value: unknown) => value is N8nWhatsAppReceipt;
//# sourceMappingURL=whatsapp-n8n.d.ts.map