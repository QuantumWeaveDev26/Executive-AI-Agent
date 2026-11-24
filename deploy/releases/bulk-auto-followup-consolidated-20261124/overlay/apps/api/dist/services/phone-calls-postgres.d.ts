import { type PhoneCallingLanguage } from '@thaara/contracts';
import { type DbClient, type PhoneCallState, type TransactionalDbClient } from '@thaara/db';
import type { PhoneCallLedger, PhoneLiveCallStore } from './phone-calling.js';
/**
 * Durable ledger on the reviewed 110a/110b(/110c) schema (opt-in; the default app never wires it). The database enforces the
 * one-use approval claim, the exact approved draft, legal state transitions, the append-only event log and the live outbox.
 */
export declare function createPostgresPhoneCallLedger(db: TransactionalDbClient): PhoneCallLedger & PhoneLiveCallStore;
/** Session-free callback side: only the two reviewed SECURITY DEFINER functions. */
export declare function createPostgresPhoneCallbackStore(db: DbClient): {
    binding(callId: string): Promise<{
        purpose: string;
        maxDurationSeconds: number;
        state: PhoneCallState;
        onBehalfOf?: string | undefined;
        callId: string;
        providerRequestId: string;
        providerCallId: string | null;
        language: PhoneCallingLanguage;
        aiDisclosure: string;
    } | null>;
    apply: (e: {
        callId: string;
        providerRequestId: string;
        providerCallId: string;
        state: PhoneCallState;
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
//# sourceMappingURL=phone-calls-postgres.d.ts.map