import { type PhoneCallEvidence } from '@thaara/contracts';
import type { DbClient } from '@thaara/db';
export interface PhoneStructuredCompletion {
    callId: string;
    providerRequestId: string;
    providerCallId: string;
    eventId: string;
    conversation: PhoneCallEvidence;
}
/** Review-only implementation for new 114 SQL. Never wired to startup or permitted in production.
 * One transaction stores the ordered evidence and completion; no terminal-row repair or automatic retry.
 */
export declare function createPhoneStructuredCallbackStoreForReview(db: DbClient): {
    completeReport(input: PhoneStructuredCompletion): Promise<"applied" | "duplicate" | "ignored">;
    binding(callId: string): Promise<{
        purpose: string;
        maxDurationSeconds: number;
        state: import("@thaara/db").PhoneCallState;
        onBehalfOf?: string | undefined;
        callId: string;
        providerRequestId: string;
        providerCallId: string | null;
        language: import("@thaara/contracts").PhoneCallingLanguage;
        aiDisclosure: string;
    } | null>;
    apply: (e: {
        callId: string;
        providerRequestId: string;
        providerCallId: string;
        state: import("@thaara/db").PhoneCallState;
        eventId: string;
        eventHash: string;
    }) => Promise<"applied" | "duplicate" | "ignored">;
    transcript: (e: {
        callId: string;
        providerCallId: string;
        eventId: string;
        text: string;
        eventHash: string;
        source: "verbatim" | "provider_english";
    }) => Promise<"applied" | "duplicate" | "ignored">;
};
//# sourceMappingURL=phone-structured-callback-store.d.ts.map