import type { PhoneInboundReport } from '@thaara/contracts';
export interface InboundOwnerScope {
    workspaceId: string;
    userId: string;
    role: string;
}
export type StoredInboundReport = PhoneInboundReport & {
    workspaceId: string;
    ownerUserId: string;
};
export interface InboundReportInput {
    id: string;
    occurredAt: string;
    callerPhone: string | null;
    customerName: string | null;
    business: string | null;
    serviceNeeded: string | null;
    enquirySummary: string | null;
    callbackInterest: 'yes' | 'no' | 'unknown';
}
/** Internal adapter input only: not a webhook body and not authorization asserted by the provider/model. */
interface InboundSource extends InboundOwnerScope {
    direction: 'inbound';
    authenticatedRoute: true;
}
/** Only a future policy-gated persistence adapter may supply its transactionally saved receipt. */
interface SavedCallbackReceipt {
    callId: string;
    workspaceId: string;
    ownerUserId: string;
    callbackPhone: string;
    requestId: string;
    durable: true;
    callerConfirmed: true;
    policyApproved: true;
}
/** Pure normalization; no call, booking, persistence or authorization side effect. Live import remains unwired. */
export declare function makeInboundReport(input: InboundReportInput, source: InboundSource, saved?: SavedCallbackReceipt): StoredInboundReport;
/** Reader must perform active-session membership validation and audited reads in its scoped transaction. */
export type PhoneInboundReportReader = (scope: InboundOwnerScope) => Promise<StoredInboundReport[]>;
export declare function readInboundReports(scope: InboundOwnerScope, reader?: PhoneInboundReportReader, id?: string): Promise<{
    status: "not_configured";
    report: null;
    reports?: undefined;
} | {
    status: "not_configured";
    reports: never[];
    report?: undefined;
} | {
    status: "not_found";
    report: null;
    reports?: undefined;
} | {
    status: "ready";
    report: {
        durationSeconds?: number | null | undefined;
        transcript?: {
            speaker: "agent" | "caller";
            text: string;
            languageBasis: "provider_english" | "provider_original";
        }[] | undefined;
        appointment?: {
            eventId: string;
            startsAt: string;
            endsAt: string;
            timezone: string;
            verification: "verified";
        } | null | undefined;
        callStatus?: "failed" | "unknown" | "ended" | "interrupted" | undefined;
        timestampSource?: "provider_started" | "provider_ended" | "received_at" | undefined;
        preferredContactTime?: string | null | undefined;
        providerInteractionId?: string | undefined;
        callbackConsent?: "confirmed" | "declined" | "unknown" | undefined;
        callbackPreference?: "declined" | "unknown" | "requested" | undefined;
        transcriptExpiresAt?: string | undefined;
        recordingReference?: {
            expiresAt: string;
            interactionId: string;
            noticeConfirmed: true;
        } | null | undefined;
        maskedPhone: string;
        id: string;
        outcome: "callback_requested" | "needs_review" | "enquired" | "booked_appointment";
        business: string | null;
        customerName: string | null;
        enquirySummary: string | null;
        callerPhone: string | null;
        occurredAt: string;
        serviceNeeded: string | null;
        callbackRequestId: string | null;
        providerVerified: false;
    };
    reports?: undefined;
} | {
    status: "ready";
    reports: {
        customerName?: string | null | undefined;
        preferredContactTime?: string | null | undefined;
        id: string;
        occurredAt: string;
        maskedPhone: string;
        outcome: "callback_requested" | "needs_review" | "enquired" | "booked_appointment";
        providerVerified: false;
    }[];
    report?: undefined;
}>;
export {};
//# sourceMappingURL=phone-inbound-reports.d.ts.map