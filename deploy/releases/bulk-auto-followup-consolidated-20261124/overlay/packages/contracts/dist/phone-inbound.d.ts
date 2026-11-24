import { type Static } from '@sinclair/typebox';
export declare const PhoneInboundOutcomeSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"enquired">, import("@sinclair/typebox").TLiteral<"callback_requested">, import("@sinclair/typebox").TLiteral<"booked_appointment">, import("@sinclair/typebox").TLiteral<"needs_review">]>;
export declare const PhoneInboundAppointmentSchema: import("@sinclair/typebox").TObject<{
    eventId: import("@sinclair/typebox").TString;
    startsAt: import("@sinclair/typebox").TString;
    endsAt: import("@sinclair/typebox").TString;
    timezone: import("@sinclair/typebox").TString;
    verification: import("@sinclair/typebox").TLiteral<"verified">;
}>;
export declare const PhoneInboundReportSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    occurredAt: import("@sinclair/typebox").TString;
    maskedPhone: import("@sinclair/typebox").TString;
    callerPhone: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    customerName: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    business: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    serviceNeeded: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    enquirySummary: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    outcome: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"enquired">, import("@sinclair/typebox").TLiteral<"callback_requested">, import("@sinclair/typebox").TLiteral<"booked_appointment">, import("@sinclair/typebox").TLiteral<"needs_review">]>;
    callbackRequestId: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    providerVerified: import("@sinclair/typebox").TLiteral<false>;
    providerInteractionId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    timestampSource: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_started">, import("@sinclair/typebox").TLiteral<"provider_ended">, import("@sinclair/typebox").TLiteral<"received_at">]>>;
    durationSeconds: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TNumber, import("@sinclair/typebox").TNull]>>;
    callStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ended">, import("@sinclair/typebox").TLiteral<"interrupted">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"unknown">]>>;
    preferredContactTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    callbackConsent: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"confirmed">, import("@sinclair/typebox").TLiteral<"declined">, import("@sinclair/typebox").TLiteral<"unknown">]>>;
    callbackPreference: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"requested">, import("@sinclair/typebox").TLiteral<"declined">, import("@sinclair/typebox").TLiteral<"unknown">]>>;
    appointment: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        eventId: import("@sinclair/typebox").TString;
        startsAt: import("@sinclair/typebox").TString;
        endsAt: import("@sinclair/typebox").TString;
        timezone: import("@sinclair/typebox").TString;
        verification: import("@sinclair/typebox").TLiteral<"verified">;
    }>, import("@sinclair/typebox").TNull]>>;
    transcript: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"agent">, import("@sinclair/typebox").TLiteral<"caller">]>;
        text: import("@sinclair/typebox").TString;
        languageBasis: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_original">, import("@sinclair/typebox").TLiteral<"provider_english">]>;
    }>>>;
    transcriptExpiresAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    recordingReference: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        interactionId: import("@sinclair/typebox").TString;
        expiresAt: import("@sinclair/typebox").TString;
        noticeConfirmed: import("@sinclair/typebox").TLiteral<true>;
    }>, import("@sinclair/typebox").TNull]>>;
}>;
export type PhoneInboundReport = Static<typeof PhoneInboundReportSchema>;
export declare const PhoneInboundSummarySchema: import("@sinclair/typebox").TObject<{
    customerName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    preferredContactTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
    id: import("@sinclair/typebox").TString;
    occurredAt: import("@sinclair/typebox").TString;
    maskedPhone: import("@sinclair/typebox").TString;
    outcome: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"enquired">, import("@sinclair/typebox").TLiteral<"callback_requested">, import("@sinclair/typebox").TLiteral<"booked_appointment">, import("@sinclair/typebox").TLiteral<"needs_review">]>;
    providerVerified: import("@sinclair/typebox").TLiteral<false>;
}>;
export declare const PhoneInboundListSchema: import("@sinclair/typebox").TObject<{
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ready">, import("@sinclair/typebox").TLiteral<"not_configured">]>;
    reports: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        customerName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
        preferredContactTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
        id: import("@sinclair/typebox").TString;
        occurredAt: import("@sinclair/typebox").TString;
        maskedPhone: import("@sinclair/typebox").TString;
        outcome: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"enquired">, import("@sinclair/typebox").TLiteral<"callback_requested">, import("@sinclair/typebox").TLiteral<"booked_appointment">, import("@sinclair/typebox").TLiteral<"needs_review">]>;
        providerVerified: import("@sinclair/typebox").TLiteral<false>;
    }>>;
}>;
export declare const PhoneInboundDetailSchema: import("@sinclair/typebox").TObject<{
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ready">, import("@sinclair/typebox").TLiteral<"not_configured">, import("@sinclair/typebox").TLiteral<"not_found">]>;
    report: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        occurredAt: import("@sinclair/typebox").TString;
        maskedPhone: import("@sinclair/typebox").TString;
        callerPhone: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        customerName: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        business: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        serviceNeeded: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        enquirySummary: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        outcome: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"enquired">, import("@sinclair/typebox").TLiteral<"callback_requested">, import("@sinclair/typebox").TLiteral<"booked_appointment">, import("@sinclair/typebox").TLiteral<"needs_review">]>;
        callbackRequestId: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        providerVerified: import("@sinclair/typebox").TLiteral<false>;
        providerInteractionId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        timestampSource: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_started">, import("@sinclair/typebox").TLiteral<"provider_ended">, import("@sinclair/typebox").TLiteral<"received_at">]>>;
        durationSeconds: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TNumber, import("@sinclair/typebox").TNull]>>;
        callStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ended">, import("@sinclair/typebox").TLiteral<"interrupted">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"unknown">]>>;
        preferredContactTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
        callbackConsent: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"confirmed">, import("@sinclair/typebox").TLiteral<"declined">, import("@sinclair/typebox").TLiteral<"unknown">]>>;
        callbackPreference: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"requested">, import("@sinclair/typebox").TLiteral<"declined">, import("@sinclair/typebox").TLiteral<"unknown">]>>;
        appointment: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
            eventId: import("@sinclair/typebox").TString;
            startsAt: import("@sinclair/typebox").TString;
            endsAt: import("@sinclair/typebox").TString;
            timezone: import("@sinclair/typebox").TString;
            verification: import("@sinclair/typebox").TLiteral<"verified">;
        }>, import("@sinclair/typebox").TNull]>>;
        transcript: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"agent">, import("@sinclair/typebox").TLiteral<"caller">]>;
            text: import("@sinclair/typebox").TString;
            languageBasis: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_original">, import("@sinclair/typebox").TLiteral<"provider_english">]>;
        }>>>;
        transcriptExpiresAt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        recordingReference: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
            interactionId: import("@sinclair/typebox").TString;
            expiresAt: import("@sinclair/typebox").TString;
            noticeConfirmed: import("@sinclair/typebox").TLiteral<true>;
        }>, import("@sinclair/typebox").TNull]>>;
    }>, import("@sinclair/typebox").TNull]>;
}>;
//# sourceMappingURL=phone-inbound.d.ts.map