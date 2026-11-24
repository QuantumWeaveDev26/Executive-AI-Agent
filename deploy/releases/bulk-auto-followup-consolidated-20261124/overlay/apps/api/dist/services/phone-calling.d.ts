import { type PhoneCallingProviderResult } from '@thaara/contracts';
import { type ApprovalRequest, type PhoneCallingDraft, type PhoneCallingLanguage, type PhoneCallingPrepare, type PhoneCallingPrepared, type PhoneCallingRecord, type PhoneCallingState } from '@thaara/contracts';
import type { AuthenticatedScope } from '@thaara/db';
import { type PolicyGateway } from '@thaara/policy';
import type { PhoneCallProvider } from './phone-plivo.js';
export interface PhoneContact {
    workspaceId: string;
    userId: string;
    id: string;
    revision: number;
    displayName: string;
    aliases?: string[];
    phoneE164: string;
    consent: {
        reference: string;
        expiresAt: string;
        callingAllowed: boolean;
    };
}
/** Implementations must use tenant-scoped storage and receive scope explicitly; client payload is never a directory. */
export interface PhoneContactDirectory {
    list(scope: AuthenticatedScope): Promise<PhoneContact[]>;
}
export interface PhoneCallingStore {
    assertScope(scope: AuthenticatedScope): Promise<void>;
    createPrepared(scope: AuthenticatedScope, draft: PhoneCallingDraft, chatContext?: {
        conversationId: string;
    }): Promise<{
        approvalId: string;
        planId: string;
        stepId: string;
    }>;
    approval(scope: AuthenticatedScope, id: string): Promise<ApprovalRequest | null>;
    audit(scope: AuthenticatedScope, action: string, metadata: Record<string, unknown>): Promise<void>;
    /** The signed-in user's display name, for "calling on behalf of". */
    ownerName?(scope: AuthenticatedScope): Promise<string | null>;
    /** Marks the requester's own pending phone approval as approved (one-tap "Call now"). */
    confirmOwnRequest?(scope: AuthenticatedScope, approvalId: string): Promise<void>;
    /** The caller's own pending/approved, unexpired phone call approvals (newest first). */
    openRequests?(scope: AuthenticatedScope): Promise<{
        approvalId: string;
        status: 'pending' | 'approved';
        expiresAt: string;
        draft: unknown;
    }[]>;
}
export type PhoneSimulationEvent = {
    eventId: string;
    sequence: number;
    kind: 'state' | 'recipient_final' | 'interruption';
    state?: PhoneCallingState;
    text?: string;
};
export interface PhoneCallLedgerEntry {
    record: PhoneCallingRecord;
    providerRequestId?: string | null;
    events: Map<string, string>;
    sequence: number;
    turns: {
        id: string;
        text: string;
    }[];
}
/** Call history storage. Implementations audit their own writes and must reject a replayed approval whose draft differs. */
export interface PhoneCallLedger {
    readonly durable: boolean;
    claim(scope: AuthenticatedScope, record: PhoneCallingRecord, draftHash: string, options?: {
        dailyLiveLimit?: number;
    }): Promise<PhoneCallingRecord>;
    list(scope: AuthenticatedScope): Promise<PhoneCallingRecord[]>;
    load(scope: AuthenticatedScope, callId: string): Promise<PhoneCallLedgerEntry | null>;
    append(scope: AuthenticatedScope, entry: PhoneCallLedgerEntry, event: PhoneSimulationEvent, eventHash: string, next: PhoneCallingRecord): Promise<PhoneCallingRecord>;
}
/** Live outbox operations (durable ledger only). */
export interface PhoneLiveCallStore {
    bindCallbackNumber?(scope: AuthenticatedScope, callId: string, phoneE164: string, draftHash: string): Promise<void>;
    claimDispatch(scope: AuthenticatedScope, callId: string): Promise<PhoneCallingRecord | null>;
    recordDispatch(scope: AuthenticatedScope, callId: string, result: {
        status: 'unverified';
        providerRequestId: string;
    } | {
        status: 'failed' | 'unknown';
        code: string;
    }): Promise<PhoneCallingRecord>;
}
/** Live calling: a provider that is itself switched on, plus the durable outbox. Never configured by default. */
/** dailyCallLimit: hard cap on new live calls per owner per rolling 24 h, enforced in the claim transaction (default 5 by owner decision 31 Oct 2026, max 20). */
export interface PhoneLiveCallingOptions {
    provider: PhoneCallProvider;
    store: PhoneLiveCallStore;
    dailyCallLimit?: number;
    unlimitedDailyCalls?: boolean;
}
export declare const DEFAULT_DAILY_CALL_LIMIT = 5;
/** Reads a call report aloud to the owner in Thaara's voice (e.g. Sarvam Bulbul); returns WAV bytes. */
export interface PhoneReportVoice {
    speak(text: string, language: PhoneCallingLanguage, signal: AbortSignal): Promise<Uint8Array>;
}
export interface PhoneCallingOptions {
    recipientEligibility?: (scope: AuthenticatedScope, recipient: {
        phoneE164: string;
        purpose: string;
    }) => Promise<boolean>;
    contacts?: PhoneContactDirectory;
    simulation?: boolean;
    calls?: PhoneCallLedger;
    live?: PhoneLiveCallingOptions;
    reportVoice?: PhoneReportVoice;
}
export declare const liveCallReport: (state: PhoneCallingState, detail?: string) => {
    text: string;
    spokenText: string;
    quotedResponses: never[];
    evidenceIds: never[];
    verified: false;
    simulated: boolean;
};
/** Bounded, process-local ledger (default). Not durable: history is lost on restart. */
export declare class MemoryPhoneCallLedger implements PhoneCallLedger {
    private readonly store;
    readonly durable = false;
    private entries;
    constructor(store: Pick<PhoneCallingStore, 'audit' | 'assertScope'>);
    claim(scope: AuthenticatedScope, record: PhoneCallingRecord, draftHash: string): Promise<{
        dispatchStatus?: "pending" | "unverified" | "failed" | "unknown" | "claimed" | undefined;
        syncedDetails?: {
            preferredCallbackTime?: string | null | undefined;
            attemptId?: string | null | undefined;
            summary: string | null;
            durationSeconds: number | null;
            recordingAvailable: boolean;
            transcript: {
                languageName?: string | null | undefined;
                speaker: "thaara" | "customer";
                text: string;
            }[];
            outcomeLabel: string;
            callbackStatus: "confirmed" | "declined" | "none" | "needs_review";
            requirements: string | null;
            business: string | null;
            customerName: string | null;
            interactionId: string | null;
            occurredAt: string;
            phoneNumber: string | null;
            serviceNeeded: string | null;
        } | undefined;
        draft: {
            newRecipient?: {
                previewApprovalId?: string | undefined;
                phoneE164: string;
                consentConfirmed: boolean;
                eligibility: "eligible" | "unverified";
            } | undefined;
            providerBindingHash?: string | undefined;
            onBehalfOf?: string | undefined;
            contactId: string;
            language: "en-IN" | "kn-IN" | "kn-en";
            aiDisclosure: string;
            draftId: string;
            contactRevision: number;
            contactBindingHash: string;
            recipient: {
                maskedPhone: string;
                displayName: string;
            };
            purpose: string;
            maxDurationSeconds: number;
            consentReference: string;
            idempotencyKey: string;
            mode: "live" | "simulation";
        };
        updatedAt: string;
        approvalId: string;
        createdAt: string;
        providerCallId: string | null;
        report: {
            conversation?: {
                version: 1;
                verified: false;
                turns: {
                    speaker: "thaara" | "customer" | "unknown";
                    text: string;
                    source: "provider_transcript" | "provider_english_translation";
                    sequence: number;
                    attribution: "provider_labelled" | "uncertain";
                }[];
                truncated: boolean;
                taskOutcome: "not_independently_verified";
            } | undefined;
            text: string;
            verified: false;
            simulated: boolean;
            spokenText: string;
            quotedResponses: string[];
            evidenceIds: string[];
        };
        id: string;
        state: "queued" | "failed" | "cancelled" | "answered" | "completed" | "busy" | "ringing" | "no_answer";
        verified: false;
        simulated: boolean;
    }>;
    list(scope: AuthenticatedScope): Promise<{
        dispatchStatus?: "pending" | "unverified" | "failed" | "unknown" | "claimed" | undefined;
        syncedDetails?: {
            preferredCallbackTime?: string | null | undefined;
            attemptId?: string | null | undefined;
            summary: string | null;
            durationSeconds: number | null;
            recordingAvailable: boolean;
            transcript: {
                languageName?: string | null | undefined;
                speaker: "thaara" | "customer";
                text: string;
            }[];
            outcomeLabel: string;
            callbackStatus: "confirmed" | "declined" | "none" | "needs_review";
            requirements: string | null;
            business: string | null;
            customerName: string | null;
            interactionId: string | null;
            occurredAt: string;
            phoneNumber: string | null;
            serviceNeeded: string | null;
        } | undefined;
        draft: {
            newRecipient?: {
                previewApprovalId?: string | undefined;
                phoneE164: string;
                consentConfirmed: boolean;
                eligibility: "eligible" | "unverified";
            } | undefined;
            providerBindingHash?: string | undefined;
            onBehalfOf?: string | undefined;
            contactId: string;
            language: "en-IN" | "kn-IN" | "kn-en";
            aiDisclosure: string;
            draftId: string;
            contactRevision: number;
            contactBindingHash: string;
            recipient: {
                maskedPhone: string;
                displayName: string;
            };
            purpose: string;
            maxDurationSeconds: number;
            consentReference: string;
            idempotencyKey: string;
            mode: "live" | "simulation";
        };
        updatedAt: string;
        approvalId: string;
        createdAt: string;
        providerCallId: string | null;
        report: {
            conversation?: {
                version: 1;
                verified: false;
                turns: {
                    speaker: "thaara" | "customer" | "unknown";
                    text: string;
                    source: "provider_transcript" | "provider_english_translation";
                    sequence: number;
                    attribution: "provider_labelled" | "uncertain";
                }[];
                truncated: boolean;
                taskOutcome: "not_independently_verified";
            } | undefined;
            text: string;
            verified: false;
            simulated: boolean;
            spokenText: string;
            quotedResponses: string[];
            evidenceIds: string[];
        };
        id: string;
        state: "queued" | "failed" | "cancelled" | "answered" | "completed" | "busy" | "ringing" | "no_answer";
        verified: false;
        simulated: boolean;
    }[]>;
    load(scope: AuthenticatedScope, callId: string): Promise<PhoneCallLedgerEntry | null>;
    append(scope: AuthenticatedScope, entry: PhoneCallLedgerEntry, event: PhoneSimulationEvent, eventHash: string, next: PhoneCallingRecord): Promise<{
        dispatchStatus?: "pending" | "unverified" | "failed" | "unknown" | "claimed" | undefined;
        syncedDetails?: {
            preferredCallbackTime?: string | null | undefined;
            attemptId?: string | null | undefined;
            summary: string | null;
            durationSeconds: number | null;
            recordingAvailable: boolean;
            transcript: {
                languageName?: string | null | undefined;
                speaker: "thaara" | "customer";
                text: string;
            }[];
            outcomeLabel: string;
            callbackStatus: "confirmed" | "declined" | "none" | "needs_review";
            requirements: string | null;
            business: string | null;
            customerName: string | null;
            interactionId: string | null;
            occurredAt: string;
            phoneNumber: string | null;
            serviceNeeded: string | null;
        } | undefined;
        draft: {
            newRecipient?: {
                previewApprovalId?: string | undefined;
                phoneE164: string;
                consentConfirmed: boolean;
                eligibility: "eligible" | "unverified";
            } | undefined;
            providerBindingHash?: string | undefined;
            onBehalfOf?: string | undefined;
            contactId: string;
            language: "en-IN" | "kn-IN" | "kn-en";
            aiDisclosure: string;
            draftId: string;
            contactRevision: number;
            contactBindingHash: string;
            recipient: {
                maskedPhone: string;
                displayName: string;
            };
            purpose: string;
            maxDurationSeconds: number;
            consentReference: string;
            idempotencyKey: string;
            mode: "live" | "simulation";
        };
        updatedAt: string;
        approvalId: string;
        createdAt: string;
        providerCallId: string | null;
        report: {
            conversation?: {
                version: 1;
                verified: false;
                turns: {
                    speaker: "thaara" | "customer" | "unknown";
                    text: string;
                    source: "provider_transcript" | "provider_english_translation";
                    sequence: number;
                    attribution: "provider_labelled" | "uncertain";
                }[];
                truncated: boolean;
                taskOutcome: "not_independently_verified";
            } | undefined;
            text: string;
            verified: false;
            simulated: boolean;
            spokenText: string;
            quotedResponses: string[];
            evidenceIds: string[];
        };
        id: string;
        state: "queued" | "failed" | "cancelled" | "answered" | "completed" | "busy" | "ringing" | "no_answer";
        verified: false;
        simulated: boolean;
    }>;
}
/** Preparation is durable through existing approval/plan storage. Call history uses the configured ledger (in-memory by default). */
export declare class PhoneCallingService {
    private readonly options;
    private locks;
    private readonly now;
    private readonly policy;
    private readonly calls;
    private readonly campaignAuthorizedRecipients;
    constructor(options: PhoneCallingOptions & {
        store: PhoneCallingStore;
        now?: () => number;
        policy?: PolicyGateway;
    });
    private get live();
    private key;
    private scope;
    private locked;
    private contacts;
    status(scope: AuthenticatedScope): Promise<{
        status: "not_configured" | "live_enabled" | "simulation_only";
        liveCallingEnabled: boolean;
        contactDirectoryConfigured: boolean;
        simulationEnabled: boolean;
        durableCallHistory: boolean;
        recordingEnabled: false;
        dailyCallLimit: number | null;
        unlimitedDailyCalls: boolean;
        languages: readonly ["en-IN", "kn-IN", "kn-en"];
        speechVerified: false;
    }>;
    resolve(scope: AuthenticatedScope, query: string): Promise<{
        status: string;
        candidates: {
            id: string;
            displayName: string;
            maskedPhone: string;
        }[];
    }>;
    prepare(scope: AuthenticatedScope, input: PhoneCallingPrepare, chatContext?: {
        conversationId: string;
    }): Promise<PhoneCallingPrepared>;
    /** Server-internal only: grants a short-lived eligibility lease for a consented unsaved bulk-campaign recipient. */
    authorizeCampaignRecipient(scope: AuthenticatedScope, phoneE164: string, ttlMs?: number): () => void;
    private newRecipientEligible;
    private draftContact;
    private draftBinding;
    private consent;
    private approved;
    /**
     * One-tap "Call now" from Chat. The owner's click on a card showing the exact person, masked number, purpose and AI
     * introduction is the approval for that one call. Before approving, the pending request is re-checked against the current
     * contact and consent; placeCall then re-runs the full policy check and still dials at most once.
     */
    confirmAndPlaceCall(scope: AuthenticatedScope, approvalId: string): Promise<PhoneCallingRecord>;
    simulate(scope: AuthenticatedScope, approvalId: string): Promise<PhoneCallingRecord>;
    /**
     * Places ONE real call for an approved live draft. Claim (one per approval) -> outbox claim (once) -> single provider request.
     * A replay returns the existing call and never dials again. `unknown` provider outcomes are recorded, never retried.
     */
    placeCall(scope: AuthenticatedScope, approvalId: string): Promise<PhoneCallingRecord>;
    /** Open requests not yet used for a call. Drafts are re-validated; anything malformed is left out, never repaired. */
    requests(scope: AuthenticatedScope): Promise<{
        requests: {
            approvalId: string;
            status: "pending" | "approved";
            expiresAt: string;
            draft: PhoneCallingDraft;
        }[];
    }>;
    /** Owner-only: the spoken report for one of their calls, in Thaara's voice. 503 when no voice is configured. */
    reportSpeech(scope: AuthenticatedScope, callId: string): Promise<Uint8Array>;
    history(scope: AuthenticatedScope): Promise<{
        calls: {
            dispatchStatus?: "pending" | "unverified" | "failed" | "unknown" | "claimed" | undefined;
            syncedDetails?: {
                preferredCallbackTime?: string | null | undefined;
                attemptId?: string | null | undefined;
                summary: string | null;
                durationSeconds: number | null;
                recordingAvailable: boolean;
                transcript: {
                    languageName?: string | null | undefined;
                    speaker: "thaara" | "customer";
                    text: string;
                }[];
                outcomeLabel: string;
                callbackStatus: "confirmed" | "declined" | "none" | "needs_review";
                requirements: string | null;
                business: string | null;
                customerName: string | null;
                interactionId: string | null;
                occurredAt: string;
                phoneNumber: string | null;
                serviceNeeded: string | null;
            } | undefined;
            draft: {
                newRecipient?: {
                    previewApprovalId?: string | undefined;
                    phoneE164: string;
                    consentConfirmed: boolean;
                    eligibility: "eligible" | "unverified";
                } | undefined;
                providerBindingHash?: string | undefined;
                onBehalfOf?: string | undefined;
                contactId: string;
                language: "en-IN" | "kn-IN" | "kn-en";
                aiDisclosure: string;
                draftId: string;
                contactRevision: number;
                contactBindingHash: string;
                recipient: {
                    maskedPhone: string;
                    displayName: string;
                };
                purpose: string;
                maxDurationSeconds: number;
                consentReference: string;
                idempotencyKey: string;
                mode: "live" | "simulation";
            };
            updatedAt: string;
            approvalId: string;
            createdAt: string;
            providerCallId: string | null;
            report: {
                conversation?: {
                    version: 1;
                    verified: false;
                    turns: {
                        speaker: "thaara" | "customer" | "unknown";
                        text: string;
                        source: "provider_transcript" | "provider_english_translation";
                        sequence: number;
                        attribution: "provider_labelled" | "uncertain";
                    }[];
                    truncated: boolean;
                    taskOutcome: "not_independently_verified";
                } | undefined;
                text: string;
                verified: false;
                simulated: boolean;
                spokenText: string;
                quotedResponses: string[];
                evidenceIds: string[];
            };
            id: string;
            state: "queued" | "failed" | "cancelled" | "answered" | "completed" | "busy" | "ringing" | "no_answer";
            verified: false;
            simulated: boolean;
        }[];
        durable: boolean;
        liveCallingEnabled: boolean;
    }>;
    /** Explicit owner readback of the stored attempt. Never dials or overwrites the callback ledger. */
    providerResult(scope: AuthenticatedScope, callId: string): Promise<PhoneCallingProviderResult>;
    simulationEvent(scope: AuthenticatedScope, callId: string, event: PhoneSimulationEvent): Promise<PhoneCallingRecord>;
}
/**
 * The sentence Thaara speaks to the owner about a call, built only from the stored report: the person's quoted words, or the
 * plain outcome. Never an interpretation or an inferred agreement.
 */
export declare function spokenCallReport(record: PhoneCallingRecord): string;
//# sourceMappingURL=phone-calling.d.ts.map