import { type Static } from '@sinclair/typebox';
export declare const PHONE_AI_CALL_ACTION = "phone.ai.calls.request";
export declare const PhoneCallingLanguageSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">]>;
export type PhoneCallingLanguage = Static<typeof PhoneCallingLanguageSchema>;
export declare const PhoneCallingPrepareSchema: import("@sinclair/typebox").TObject<{
    contactQuery: import("@sinclair/typebox").TString;
    selectedContactId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    newRecipient: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        previewApprovalId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        displayName: import("@sinclair/typebox").TString;
        consentConfirmed: import("@sinclair/typebox").TBoolean;
    }>>;
    purpose: import("@sinclair/typebox").TString;
    language: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">]>;
    maxDurationSeconds: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
}>;
export type PhoneCallingPrepare = Static<typeof PhoneCallingPrepareSchema>;
export declare const PhoneCallingModeSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"simulation">, import("@sinclair/typebox").TLiteral<"live">]>;
export declare const PhoneCallingDraftSchema: import("@sinclair/typebox").TObject<{
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
}>;
export type PhoneCallingDraft = Static<typeof PhoneCallingDraftSchema>;
export declare const PhoneCallingPreparedSchema: import("@sinclair/typebox").TObject<{
    draft: import("@sinclair/typebox").TObject<{
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
    }>;
    approvalId: import("@sinclair/typebox").TString;
    planId: import("@sinclair/typebox").TString;
    stepId: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TLiteral<"awaiting_approval">;
    liveCallingEnabled: import("@sinclair/typebox").TBoolean;
}>;
export type PhoneCallingPrepared = Static<typeof PhoneCallingPreparedSchema>;
export declare const PhoneCallingStatusSchema: import("@sinclair/typebox").TObject<{
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"not_configured">, import("@sinclair/typebox").TLiteral<"simulation_only">, import("@sinclair/typebox").TLiteral<"live_enabled">]>;
    liveCallingEnabled: import("@sinclair/typebox").TBoolean;
    contactDirectoryConfigured: import("@sinclair/typebox").TBoolean;
    simulationEnabled: import("@sinclair/typebox").TBoolean;
    durableCallHistory: import("@sinclair/typebox").TBoolean;
    recordingEnabled: import("@sinclair/typebox").TLiteral<false>;
    languages: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"en-IN">, import("@sinclair/typebox").TLiteral<"kn-IN">, import("@sinclair/typebox").TLiteral<"kn-en">]>>;
    speechVerified: import("@sinclair/typebox").TLiteral<false>;
}>;
export declare const PhoneCallingStateSchema: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"no_answer" | "busy" | "failed" | "queued" | "ringing" | "answered" | "completed" | "cancelled">[]>;
export type PhoneCallingState = Static<typeof PhoneCallingStateSchema>;
export declare const PhoneCallingReportSchema: import("@sinclair/typebox").TObject<{
    conversation: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        version: import("@sinclair/typebox").TLiteral<1>;
        turns: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            sequence: import("@sinclair/typebox").TInteger;
            speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"thaara">, import("@sinclair/typebox").TLiteral<"customer">, import("@sinclair/typebox").TLiteral<"unknown">]>;
            text: import("@sinclair/typebox").TString;
            source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_transcript">, import("@sinclair/typebox").TLiteral<"provider_english_translation">]>;
            attribution: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_labelled">, import("@sinclair/typebox").TLiteral<"uncertain">]>;
        }>>;
        truncated: import("@sinclair/typebox").TBoolean;
        verified: import("@sinclair/typebox").TLiteral<false>;
        taskOutcome: import("@sinclair/typebox").TLiteral<"not_independently_verified">;
    }>>;
    text: import("@sinclair/typebox").TString;
    spokenText: import("@sinclair/typebox").TString;
    quotedResponses: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    evidenceIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    verified: import("@sinclair/typebox").TLiteral<false>;
    simulated: import("@sinclair/typebox").TBoolean;
}>;
export type PhoneCallingReport = Static<typeof PhoneCallingReportSchema>;
export declare const PhoneCallingDispatchStatusSchema: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"failed" | "unknown" | "pending" | "unverified" | "claimed">[]>;
export declare const PhoneCallingRecordSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    approvalId: import("@sinclair/typebox").TString;
    draft: import("@sinclair/typebox").TObject<{
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
    }>;
    state: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"no_answer" | "busy" | "failed" | "queued" | "ringing" | "answered" | "completed" | "cancelled">[]>;
    createdAt: import("@sinclair/typebox").TString;
    updatedAt: import("@sinclair/typebox").TString;
    providerCallId: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TNull, import("@sinclair/typebox").TString]>;
    verified: import("@sinclair/typebox").TLiteral<false>;
    simulated: import("@sinclair/typebox").TBoolean;
    dispatchStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"failed" | "unknown" | "pending" | "unverified" | "claimed">[]>>;
    report: import("@sinclair/typebox").TObject<{
        conversation: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            version: import("@sinclair/typebox").TLiteral<1>;
            turns: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
                sequence: import("@sinclair/typebox").TInteger;
                speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"thaara">, import("@sinclair/typebox").TLiteral<"customer">, import("@sinclair/typebox").TLiteral<"unknown">]>;
                text: import("@sinclair/typebox").TString;
                source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_transcript">, import("@sinclair/typebox").TLiteral<"provider_english_translation">]>;
                attribution: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_labelled">, import("@sinclair/typebox").TLiteral<"uncertain">]>;
            }>>;
            truncated: import("@sinclair/typebox").TBoolean;
            verified: import("@sinclair/typebox").TLiteral<false>;
            taskOutcome: import("@sinclair/typebox").TLiteral<"not_independently_verified">;
        }>>;
        text: import("@sinclair/typebox").TString;
        spokenText: import("@sinclair/typebox").TString;
        quotedResponses: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        evidenceIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        verified: import("@sinclair/typebox").TLiteral<false>;
        simulated: import("@sinclair/typebox").TBoolean;
    }>;
    syncedDetails: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        interactionId: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        attemptId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
        recordingAvailable: import("@sinclair/typebox").TBoolean;
        durationSeconds: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TNumber, import("@sinclair/typebox").TNull]>;
        occurredAt: import("@sinclair/typebox").TString;
        customerName: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        phoneNumber: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        business: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        serviceNeeded: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        requirements: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        summary: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        preferredCallbackTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
        outcomeLabel: import("@sinclair/typebox").TString;
        callbackStatus: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"confirmed">, import("@sinclair/typebox").TLiteral<"needs_review">, import("@sinclair/typebox").TLiteral<"declined">, import("@sinclair/typebox").TLiteral<"none">]>;
        transcript: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"thaara">, import("@sinclair/typebox").TLiteral<"customer">]>;
            text: import("@sinclair/typebox").TString;
            languageName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
        }>>;
    }>>;
}>;
export type PhoneCallingRecord = Static<typeof PhoneCallingRecordSchema>;
export declare const PhoneCallingHistorySchema: import("@sinclair/typebox").TObject<{
    calls: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        approvalId: import("@sinclair/typebox").TString;
        draft: import("@sinclair/typebox").TObject<{
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
        }>;
        state: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"no_answer" | "busy" | "failed" | "queued" | "ringing" | "answered" | "completed" | "cancelled">[]>;
        createdAt: import("@sinclair/typebox").TString;
        updatedAt: import("@sinclair/typebox").TString;
        providerCallId: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TNull, import("@sinclair/typebox").TString]>;
        verified: import("@sinclair/typebox").TLiteral<false>;
        simulated: import("@sinclair/typebox").TBoolean;
        dispatchStatus: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"failed" | "unknown" | "pending" | "unverified" | "claimed">[]>>;
        report: import("@sinclair/typebox").TObject<{
            conversation: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
                version: import("@sinclair/typebox").TLiteral<1>;
                turns: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
                    sequence: import("@sinclair/typebox").TInteger;
                    speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"thaara">, import("@sinclair/typebox").TLiteral<"customer">, import("@sinclair/typebox").TLiteral<"unknown">]>;
                    text: import("@sinclair/typebox").TString;
                    source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_transcript">, import("@sinclair/typebox").TLiteral<"provider_english_translation">]>;
                    attribution: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_labelled">, import("@sinclair/typebox").TLiteral<"uncertain">]>;
                }>>;
                truncated: import("@sinclair/typebox").TBoolean;
                verified: import("@sinclair/typebox").TLiteral<false>;
                taskOutcome: import("@sinclair/typebox").TLiteral<"not_independently_verified">;
            }>>;
            text: import("@sinclair/typebox").TString;
            spokenText: import("@sinclair/typebox").TString;
            quotedResponses: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
            evidenceIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
            verified: import("@sinclair/typebox").TLiteral<false>;
            simulated: import("@sinclair/typebox").TBoolean;
        }>;
        syncedDetails: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            interactionId: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
            attemptId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
            recordingAvailable: import("@sinclair/typebox").TBoolean;
            durationSeconds: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TNumber, import("@sinclair/typebox").TNull]>;
            occurredAt: import("@sinclair/typebox").TString;
            customerName: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
            phoneNumber: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
            business: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
            serviceNeeded: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
            requirements: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
            summary: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
            preferredCallbackTime: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
            outcomeLabel: import("@sinclair/typebox").TString;
            callbackStatus: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"confirmed">, import("@sinclair/typebox").TLiteral<"needs_review">, import("@sinclair/typebox").TLiteral<"declined">, import("@sinclair/typebox").TLiteral<"none">]>;
            transcript: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
                speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"thaara">, import("@sinclair/typebox").TLiteral<"customer">]>;
                text: import("@sinclair/typebox").TString;
                languageName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>>;
            }>>;
        }>>;
    }>>;
    durable: import("@sinclair/typebox").TBoolean;
    liveCallingEnabled: import("@sinclair/typebox").TBoolean;
}>;
export declare const PhoneCallingSimulationSchema: import("@sinclair/typebox").TObject<{
    approvalId: import("@sinclair/typebox").TString;
}>;
/** Owner-initiated rendering of an existing report; never accepts text, a phone number or a provider target. */
export declare const PHONE_REPORT_SPEECH_ACTION: "phone.ai.calls.report_speech";
export declare const PhoneCallingSpeechRequestSchema: import("@sinclair/typebox").TObject<{
    callId: import("@sinclair/typebox").TString;
}>;
export declare const PhoneContactConsentSourceSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"recipient_verbal">, import("@sinclair/typebox").TLiteral<"recipient_written">, import("@sinclair/typebox").TLiteral<"recipient_message">]>;
export declare const PhoneContactCreateSchema: import("@sinclair/typebox").TObject<{
    displayName: import("@sinclair/typebox").TString;
    aliases: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    phoneE164: import("@sinclair/typebox").TString;
    consent: import("@sinclair/typebox").TObject<{
        callingAllowed: import("@sinclair/typebox").TBoolean;
        source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"recipient_verbal">, import("@sinclair/typebox").TLiteral<"recipient_written">, import("@sinclair/typebox").TLiteral<"recipient_message">]>;
        validDays: import("@sinclair/typebox").TInteger;
    }>;
}>;
export type PhoneContactCreate = Static<typeof PhoneContactCreateSchema>;
export declare const PhoneContactUpdateSchema: import("@sinclair/typebox").TObject<{
    expectedRevision: import("@sinclair/typebox").TInteger;
    displayName: import("@sinclair/typebox").TString;
    aliases: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    phoneE164: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    consent: import("@sinclair/typebox").TObject<{
        callingAllowed: import("@sinclair/typebox").TBoolean;
        source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"recipient_verbal">, import("@sinclair/typebox").TLiteral<"recipient_written">, import("@sinclair/typebox").TLiteral<"recipient_message">]>;
        validDays: import("@sinclair/typebox").TInteger;
    }>;
}>;
export type PhoneContactUpdate = Static<typeof PhoneContactUpdateSchema>;
export declare const PhoneContactArchiveSchema: import("@sinclair/typebox").TObject<{
    expectedRevision: import("@sinclair/typebox").TInteger;
}>;
export declare const PhoneContactViewSchema: import("@sinclair/typebox").TObject<{
    contactId: import("@sinclair/typebox").TString;
    revision: import("@sinclair/typebox").TInteger;
    displayName: import("@sinclair/typebox").TString;
    aliases: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    maskedPhone: import("@sinclair/typebox").TString;
    archived: import("@sinclair/typebox").TBoolean;
    consent: import("@sinclair/typebox").TObject<{
        callingAllowed: import("@sinclair/typebox").TBoolean;
        source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"recipient_verbal">, import("@sinclair/typebox").TLiteral<"recipient_written">, import("@sinclair/typebox").TLiteral<"recipient_message">]>;
        recordedAt: import("@sinclair/typebox").TString;
        expiresAt: import("@sinclair/typebox").TString;
        expired: import("@sinclair/typebox").TBoolean;
    }>;
}>;
export type PhoneContactView = Static<typeof PhoneContactViewSchema>;
export declare const PhoneContactListSchema: import("@sinclair/typebox").TObject<{
    contacts: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        contactId: import("@sinclair/typebox").TString;
        revision: import("@sinclair/typebox").TInteger;
        displayName: import("@sinclair/typebox").TString;
        aliases: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        maskedPhone: import("@sinclair/typebox").TString;
        archived: import("@sinclair/typebox").TBoolean;
        consent: import("@sinclair/typebox").TObject<{
            callingAllowed: import("@sinclair/typebox").TBoolean;
            source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"recipient_verbal">, import("@sinclair/typebox").TLiteral<"recipient_written">, import("@sinclair/typebox").TLiteral<"recipient_message">]>;
            recordedAt: import("@sinclair/typebox").TString;
            expiresAt: import("@sinclair/typebox").TString;
            expired: import("@sinclair/typebox").TBoolean;
        }>;
    }>>;
}>;
export declare const PhoneCallingRequestSchema: import("@sinclair/typebox").TObject<{
    approvalId: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"approved">]>;
    expiresAt: import("@sinclair/typebox").TString;
    draft: import("@sinclair/typebox").TObject<{
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
    }>;
}>;
export type PhoneCallingRequest = Static<typeof PhoneCallingRequestSchema>;
export declare const PhoneCallingRequestListSchema: import("@sinclair/typebox").TObject<{
    requests: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        approvalId: import("@sinclair/typebox").TString;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"approved">]>;
        expiresAt: import("@sinclair/typebox").TString;
        draft: import("@sinclair/typebox").TObject<{
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
        }>;
    }>>;
}>;
/** Bounded opaque provider ID; escape before constructing any URL. */
export declare const PHONE_PROVIDER_CALL_ID_PATTERN = "^([A-Za-z0-9_.:-]{1,128}|[0-9]{8}/[A-Za-z0-9][A-Za-z0-9_.:-]{0,99})$";
export declare const isPhoneProviderCallId: (value: unknown) => value is string;
export declare const PHONE_CALL_RESULT_READ_ACTION: "phone.ai.calls.result_read";
export declare const PhoneCallingProviderResultSchema: import("@sinclair/typebox").TObject<{
    callId: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"available">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"unavailable">]>;
    outcome: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"busy">, import("@sinclair/typebox").TLiteral<"no_answer">, import("@sinclair/typebox").TLiteral<"failed">]>>;
    conversation: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        version: import("@sinclair/typebox").TLiteral<1>;
        turns: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            sequence: import("@sinclair/typebox").TInteger;
            speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"thaara">, import("@sinclair/typebox").TLiteral<"customer">, import("@sinclair/typebox").TLiteral<"unknown">]>;
            text: import("@sinclair/typebox").TString;
            source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_transcript">, import("@sinclair/typebox").TLiteral<"provider_english_translation">]>;
            attribution: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_labelled">, import("@sinclair/typebox").TLiteral<"uncertain">]>;
        }>>;
        truncated: import("@sinclair/typebox").TBoolean;
        verified: import("@sinclair/typebox").TLiteral<false>;
        taskOutcome: import("@sinclair/typebox").TLiteral<"not_independently_verified">;
    }>>;
    responses: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    verified: import("@sinclair/typebox").TLiteral<false>;
    source: import("@sinclair/typebox").TLiteral<"provider_api">;
}>;
export type PhoneCallingProviderResult = Static<typeof PhoneCallingProviderResultSchema>;
//# sourceMappingURL=phone-calling.d.ts.map