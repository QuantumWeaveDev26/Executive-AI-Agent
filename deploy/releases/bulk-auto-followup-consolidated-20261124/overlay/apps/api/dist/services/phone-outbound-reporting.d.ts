import type { PhoneCallingRecord } from '@thaara/contracts';
/** Unwired reporting projection of an already owner-scoped ledger row. No dispatch, provider lookup or new success claim. */
export declare function projectOutboundCallReport(call: PhoneCallingRecord): Readonly<{
    id: string;
    direction: "outbound";
    providerInteractionId: string | null;
    maskedPhone: string;
    customerName: string;
    occurredAt: string;
    callStatus: "queued" | "failed" | "cancelled" | "answered" | "completed" | "busy" | "ringing" | "no_answer";
    durationSeconds: null;
    enquirySummary: string;
    simulated: boolean;
    providerVerified: false;
    transcriptReference: null;
    recordingReference: null;
}>;
//# sourceMappingURL=phone-outbound-reporting.d.ts.map