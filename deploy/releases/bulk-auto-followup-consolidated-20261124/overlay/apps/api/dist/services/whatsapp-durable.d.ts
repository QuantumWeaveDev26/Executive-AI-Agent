import { type MetaWhatsAppAnySendInput, type MetaWhatsAppTestConfig, type MetaWhatsAppSendInput, type N8nWhatsAppProviderReceipt, type N8nWhatsAppReceipt, type N8nWhatsAppReplyDraft } from '@thaara/contracts';
import { type AuthenticatedScope, type WhatsAppExecutionScope, type WhatsAppRelayOperation } from '@thaara/db';
import type { WhatsAppStateStore, WhatsAppStateTransaction } from '@thaara/db';
import type { PolicyGateway } from '@thaara/policy';
import type { N8nWhatsAppInboxQuery } from '@thaara/contracts';
/** Separately approved send profile: one connection, one recipient or '*' (any opted-in contact), an optional daily cap and an expiry. */
export interface WhatsAppSendProfile {
    connectionId: string;
    recipientId: string;
    maxPerDay: number | null;
    expiresAt: number; /** Only true once the outbound workflow handles template/media messages. */
    richMessages?: boolean; /** Explicitly configurable customer-service auto-reply flag (false/absent by default). */
    autoReply?: boolean;
}
/** Ceiling for an explicit Thaara daily cap. null = no Thaara cap (owner choice); per-message approval and Meta's own limits always apply. */
export declare const MAX_SENDS_PER_DAY = 250;
export declare const DEFAULT_MAX_AUTO_REPLIES_PER_RECIPIENT_PER_DAY = 60;
export declare const MAX_AUTO_REPLIES_PER_RECIPIENT_PER_DAY = 100;
export interface WhatsAppDispatcher {
    autoReplyEnabled?: boolean;
    submit(input: {
        connectionId: string;
        revision: number;
        dispatchId: string;
    }): Promise<void>;
}
export interface WhatsAppAutoReplyOptions {
    /** Explicitly disabled by default. Must be true to allow automated customer-service replies. */
    enabled: boolean;
    /** Maximum automated replies per recipient per 24h window to prevent loops (default: 3, max: 10). */
    maxPerRecipientPerDay?: number;
    /** Minimum cooldown between automated replies to the same recipient in ms (default: 0). */
    cooldownMs?: number;
    /** Authenticated owner scope used to reserve the auto-reply after relay ingestion commits. */
    ownerScope?: AuthenticatedScope;
    /** Issues an approved standing ApprovalRequest ID for the exact canonical auto-reply draft. */
    authorizeDraft(scope: AuthenticatedScope, draft: MetaWhatsAppSendInput, tx?: WhatsAppStateTransaction): Promise<string> | string;
}
export interface WhatsAppCampaignContextResolverInput {
    scope: AuthenticatedScope;
    connectionId: string;
    recipientId: string;
    phoneE164: string;
    customerMessage: string;
}
export interface DurableSendOptions {
    profile(): WhatsAppSendProfile | null;
    dispatcher: WhatsAppDispatcher;
    /** Explicitly configurable customer-service auto-reply options (disabled by default). */
    autoReply?: WhatsAppAutoReplyOptions | (() => WhatsAppAutoReplyOptions | null);
    /** Optional ModelGatewayAdapter for unified AI generation. */
    modelGateway?: ModelGatewayAdapter;
    /** Optional campaign knowledge resolver for approved workspace WhatsApp campaigns. */
    resolveCampaignContext?: (input: WhatsAppCampaignContextResolverInput) => Promise<WhatsAppCampaignReplyContext | null>;
    /** When true, runs auto-reply evaluation asynchronously so webhook returns immediately. */
    asyncAutoReply?: boolean;
}
export interface DurableWhatsAppServiceOptions {
    modelGateway?: ModelGatewayAdapter;
    resolveCampaignContext?: (input: WhatsAppCampaignContextResolverInput) => Promise<WhatsAppCampaignReplyContext | null>;
    asyncAutoReply?: boolean;
}
/** Meta's reason for a failed delivery, reduced to safe operator fields (no phone numbers, no message text). */
export interface WhatsAppDeliveryFailure {
    event: 'whatsapp_delivery_failed';
    connectionId: string;
    messageRef: string;
    code: number | null;
    title: string;
    details: string;
}
import { type WhatsAppCampaignReplyContext } from './whatsapp-ai-service.js';
import type { ModelGatewayAdapter } from './model-gateway.js';
export interface WhatsAppAutoReplyRecoveryResult {
    reserved: number;
    submitted: number;
    expired: number;
    skippedUncertain: number;
    failedRecovery: number;
}
export interface WhatsAppRecoveryAttentionEvent {
    event: 'whatsapp_auto_reply_recovery_attention';
    connectionId: string;
    reason: 'expired_reservation' | 'startup_recovery_failed' | 'recovery_failed';
    dispatchId?: string;
    inboundMessageRef?: string;
}
/**
 * Shared per-store submission tracker coordinating concurrent DurableWhatsAppService instances
 * against the same backing store so simultaneous recovery passes never double-submit a dispatch,
 * while ensuring transaction rollbacks and pre-transmission submission failures never suppress recovery.
 */
type DurableRecipient = MetaWhatsAppTestConfig['recipients'][number];
/**
 * WA-01 Hardening (Concern 1): Positive allowlist for pre-transmission submission failures.
 * Only retry when there is reliable evidence that the request failed BEFORE network transmission
 * (e.g. ECONNREFUSED, DNS lookup failure, or explicit `preTransmissionFailure: true`).
 * Any unknown error, HTTP response error (e.g. 500/502/504), ECONNRESET, EPIPE, or timeout
 * returns `false` and MUST be classified as uncertain rather than automatically retryable.
 */
export declare function isReliablePreTransmissionSubmitError(error: unknown): boolean;
/** Durable domain wired to owner/callback routes. Without approved send options it never fetches, sends or auto-replies. */
export declare class DurableWhatsAppService {
    private readonly store;
    private readonly policy;
    private readonly now;
    private readonly send?;
    private readonly serviceOptions?;
    /** Operator log sink for Meta delivery failures (server log only). Overridable in tests. */
    static deliveryFailureSink: (failure: WhatsAppDeliveryFailure) => void;
    /** Operator log sink for WA-01 auto-reply recovery attention events. Overridable in tests. */
    static recoveryAttentionSink: (event: WhatsAppRecoveryAttentionEvent) => void;
    private readonly failureDetails;
    private readonly submittedAutoReplyDispatches;
    private readonly inFlightAutoReplySubmissions;
    private readonly startupFailedConnections;
    private readonly failedRecoveryMessagesByConn;
    private readonly whatsAppAIService?;
    private startupRecoveryPromise;
    constructor(store: WhatsAppStateStore, policy: PolicyGateway, now?: () => number, send?: DurableSendOptions | undefined, serviceOptions?: DurableWhatsAppServiceOptions | undefined);
    private getStoreTracker;
    getDynamicRecipient(connectionId: string, recipientId: string): DurableRecipient | undefined;
    getDynamicRecipientByPhone(connectionId: string, phone: string): DurableRecipient | undefined;
    findRecipient(b: MetaWhatsAppTestConfig, recipientId: string): DurableRecipient | undefined;
    setDynamicRecipient(connectionId: string, recipientId: string, recipient: DurableRecipient): void;
    hasDynamicRecipientPhone(connectionId: string, phoneWithoutPlus: string): boolean;
    getAppointment(workspaceId: string, connectionId: string, recipientId: string): any;
    setAppointment(workspaceId: string, connectionId: string, recipientId: string, appointment: any): void;
    private emitRecoveryAttention;
    private recordStartupRecoveryFailure;
    private recordMessageRecoveryFailure;
    private clearMessageRecoveryFailure;
    private getRecoveryAttentionState;
    private isDispatchSubmittedOrInFlight;
    /**
     * Synchronously claims an uncommitted submission slot AFTER the database reservation transaction has committed.
     * Never called inside `this.run()`, so a transaction rollback can never pollute in-memory tracking.
     */
    private claimAutoReplySubmission;
    private completeAutoReplySubmission;
    private releaseFailedAutoReplySubmission;
    /** Awaits automatic startup recovery (and runs a pass if auto-reply was enabled dynamically). */
    waitForStartupRecovery(): Promise<WhatsAppAutoReplyRecoveryResult>;
    /**
     * WA-01 (Issue 1): Discovers configured/owned connections and recovers pending automatic replies
     * without requiring a new incoming WhatsApp webhook.
     */
    recoverConfiguredAutoReplies(isStartup?: boolean): Promise<WhatsAppAutoReplyRecoveryResult>;
    /** Live sending is on for this connection only while an approved, unexpired profile names it. */
    private liveFor;
    private resolveAutoReplyConfig;
    /** Customer-service auto-reply is disabled by default; active only when live sending AND explicit auto-reply are both enabled. */
    autoReplyFor(connectionId: string): boolean;
    /** Latest valid inbound timestamp (ms) for a recipient, or null if none. */
    private latestInboundTime;
    /** WA-05: Canonical 24-hour customer-service window gate. Rejects missing, future-dated (latest > now), and expired (>=24h) timestamps. */
    private isCustomerServiceWindowOpen;
    /** True only for the profiled connection and recipient (or any opted-in contact for '*'), inside Meta's 24 h window, under the cap and before expiry. */
    private sendAllowed;
    resolveRelay(tokenHash: string, id: string, operation: WhatsAppRelayOperation): Promise<import("@thaara/db").WhatsAppRelayScope>;
    private run;
    private approved;
    private eventTime;
    private reconcile;
    status(scope: AuthenticatedScope, id: string): Promise<{
        transport: "n8n";
        mode: "offline_test";
        configured: boolean;
        liveSendingEnabled: false;
        storage: "postgresql_offline";
        revision: number;
        disconnected: boolean;
    }>;
    history(scope: AuthenticatedScope, id: string): Promise<{
        providerMessageId: string;
        recipientId: string;
        senderMaskedPhone: string;
        textPreview: string;
        timestamp: string;
        mode: "offline_test";
        untrusted: true;
        media?: import("@thaara/contracts").MetaWhatsAppStoredMedia;
    }[]>;
    inbox(scope: AuthenticatedScope, id: string, query?: N8nWhatsAppInboxQuery): Promise<{
        liveSendingEnabled: boolean;
        autoReplyEnabled?: boolean | undefined;
        startupRecoveryFailed?: boolean | undefined;
        connectionId: string;
        revision: number;
        mode: "offline_test";
        verified: false;
        messages: {
            attachment?: {
                filename?: string | undefined;
                mimeType: string;
                kind: "image" | "document" | "audio";
                downloadStatus: "not_downloaded";
            } | undefined;
            deliveryEvents?: {
                errorCode?: number | undefined;
                errorTitle?: string | undefined;
                errorDetails?: string | undefined;
                status: "sent" | "delivered" | "read" | "failed";
                timestamp: string;
            }[] | undefined;
            maskedPhone: string;
            status: "unverified" | "sent" | "delivered" | "read" | "failed" | "received" | "reserved";
            mode: "offline_test";
            providerMessageId: string | null;
            id: string;
            verified: false;
            timestamp: string;
            direction: "outbound" | "inbound";
            textPreview: string;
            untrusted: true;
            recipientId: string;
        }[];
        nextPageToken: string | null;
        transport: "n8n";
        conversations: {
            enquiry?: {
                preferredCallbackTime?: string | undefined;
                calendarEventId?: string | undefined;
                customerName?: string | undefined;
                consentTimestamp?: string | undefined;
                appointmentStatus?: "REQUESTED" | "CONFIRMED" | "CANCELLED" | "LINK_SENT" | "AWAITING_CUSTOMER_BOOKING" | undefined;
                businessName?: string | undefined;
                businessCategory?: string | undefined;
                businessType?: string | undefined;
                customerEmail?: string | undefined;
                emailDeclined?: boolean | undefined;
                requestedService?: string | undefined;
                businessProblem?: string | undefined;
                referredWebsite?: string | undefined;
                latestCustomerMessage?: string | undefined;
                suggestedReply?: string | undefined;
                appointmentInterest?: boolean | undefined;
                calendlyUrl?: string | undefined;
                calendlyBookingId?: string | undefined;
                calendarConfirmedAt?: string | undefined;
                contactOptedIn?: boolean | undefined;
                consentProvenance?: "unknown" | "explicit_message_consent" | "stored_contact_opt_in" | "revoked_opt_out" | undefined;
                consentRecorded?: boolean | undefined;
                detectedLanguage?: "en" | "kn" | "hi" | undefined;
                optOutRequested?: true | undefined;
                humanHandoffRequested?: true | undefined;
                injectionDetected?: true | undefined;
                sensitiveOrUncertain?: true | undefined;
                escalationReason?: "opt_out" | "human_handoff" | "prompt_injection" | "sensitive_request" | "uncertain_query" | undefined;
                autoReplyStatus?: "pending" | "replied" | "disabled" | "escalated" | "expired_reservation" | "recovery_attention_required" | "skipped_loop_guard" | "skipped_failure_guard" | "skipped_window_closed" | undefined;
                callbackRequested: boolean;
                leadStatus: "Enquired" | "Callback requested" | "Booked appointment" | "Needs review";
                enquirySummary: string;
            } | undefined;
            contactName?: string | undefined;
            maskedPhone: string;
            untrusted: true;
            lastMessageAt: string;
            lastMessagePreview: string;
            messageCount: number;
            recipientId: string;
        }[];
    }>;
    /** Authorized contacts with masked numbers and truthful eligibility (opt-in and Meta's 24 h customer-service window). Read-only. */
    contacts(scope: AuthenticatedScope, id: string): Promise<{
        connectionId: string;
        revision: number;
        liveSendingEnabled: boolean;
        contacts: {
            recipientId: string;
            contactName: string;
            maskedPhone: string;
            optedIn: boolean;
            lastInboundAt: string | null;
            eligibility: "eligible" | "not_opted_in" | "window_closed";
        }[];
    }>;
    /** Server-built template or media draft for approval (never sent here). Media must be inside the 24 h window; templates need not. */
    contentDraft(scope: AuthenticatedScope, id: string, recipientId: string, content: {
        template: Extract<MetaWhatsAppAnySendInput, {
            template: unknown;
        }>['template'];
    } | {
        media: Extract<MetaWhatsAppAnySendInput, {
            media: unknown;
        }>['media'];
    }): Promise<{
        draft: {
            replyToProviderMessageId?: string | undefined;
            connectionId: string;
            idempotencyKey: string;
            connectionRevision: number;
            senderPhoneNumberId: string;
            recipientId: string;
            media: {
                filename?: string | undefined;
                caption?: string | undefined;
                sha256: string;
                mimeType: string;
                kind: "image" | "document" | "audio";
                mediaId: string;
            };
        } | {
            template: Extract<MetaWhatsAppAnySendInput, {
                template: unknown;
            }>["template"];
            connectionId: string;
            connectionRevision: number;
            senderPhoneNumberId: string;
            recipientId: string;
            idempotencyKey: string;
        };
        actionName: "whatsapp.meta.messages.send";
        riskLevel: "high";
        liveSendingEnabled: false;
    }>;
    /** Owner-only contact management: replaces the recipient list (1–5, unique IDs/numbers, explicit opt-in), revision +1, audited. */
    updateContacts(scope: AuthenticatedScope, id: string, input: unknown): Promise<{
        connectionId: string;
        revision: number;
        contacts: number;
    }>;
    /** Idempotently registers a newly messaged recipient into the connection binding so dispatch triggers succeed. */
    ensureRecipientRegistered(scope: AuthenticatedScope, id: string, recipientId: string, details?: {
        phoneE164?: string;
        displayName?: string;
    }): Promise<boolean>;
    updateRecipientAppointment(scope: AuthenticatedScope, id: string, recipientId: string, appointment: any, auditAction?: 'appointment_confirmed' | 'appointment_rescheduled' | 'appointment_cancelled'): Promise<{
        recipientId: string;
        revision: number;
        appointment: any;
    }>;
    dispatchAppointmentApproval(scope: AuthenticatedScope, id: string, recipientId: string, appointment: any, bodyText: string): Promise<{
        status: 'AWAITING_CUSTOMER_BOOKING';
        calendlyUrl: string;
        bookingLinkSent: true;
        preparedConfirmationReply: string;
        receipt?: N8nWhatsAppReceipt;
        alreadySent?: boolean;
    }>;
    getRecipient(scope: AuthenticatedScope, id: string, recipientId: string): Promise<{
        recipient: {
            appointment: any;
            displayName?: string | undefined;
            phoneE164: string;
            id: string;
            optedIn: boolean;
        } | {
            displayName?: string | undefined;
            appointment?: {
                timeZone?: string | undefined;
                date?: string | undefined;
                time?: string | undefined;
                startAt?: string | undefined;
                endAt?: string | undefined;
                calendarEventId?: string | undefined;
                confirmedAt?: string | undefined;
                service?: string | undefined;
                business?: string | undefined;
                customerName?: string | undefined;
                status: "REQUESTED" | "CONFIRMED" | "CANCELLED";
            } | undefined;
            phoneE164: string;
            id: string;
            optedIn: boolean;
        };
        messages: import("@thaara/db").WhatsAppMessageRecord[];
    } | null>;
    /** Owner-scoped business account and phone IDs of the connection (server-side use only; never sent to browsers). */
    authorizePersonalApproval(scope: AuthenticatedScope, connectionId: string, approvalId: string): Promise<void>;
    accountIds(scope: AuthenticatedScope, id: string): Promise<{
        businessAccountId: string;
        phoneNumberId: string;
        revision: number;
    }>;
    /** Owner-scoped lookup of a saved incoming attachment reference. Never returned to browsers; no provider I/O here. */
    mediaReference(scope: AuthenticatedScope, id: string, providerMessageId: string): Promise<{
        filename?: string | undefined;
        kind: "image" | "document" | "audio";
        mediaId: string;
        mimeType: string;
        sha256: string;
    }>;
    connections(scope: AuthenticatedScope): Promise<{
        mode: "offline_test";
        liveSendingEnabled: false;
        connections: {
            connectionId: string;
            revision: number;
            disconnected: boolean;
        }[];
    }>;
    /**
     * WA-03: Distinguishes recipient-specific failures from genuine connection-wide failures (such as Meta 131042).
     * A failed dispatch halts auto-replies for `recipientId` if:
     *  1. The failed dispatch was addressed to `recipientId`, OR
     *  2. The failed dispatch was on the same connection AND its correlated failure metadata is a connection-wide failure.
     */
    private hasBlockingDeliveryFailure;
    private getAutoReplyLimits;
    /**
     * WA-02: Evaluates per-recipient 24h auto-reply cap, cooldown, and identical-text ping-pong loop guard
     * against the current locked transaction state.
     */
    private isBlockedByAutoReplyLoopOrRateGuard;
    /**
     * WA-01: Computes the durable per-inbound-message auto-reply metadata at ingestion time when auto-reply is enabled.
     */
    private computeInitialMessageAutoReply;
    ingest(scope: WhatsAppExecutionScope, id: string, input: unknown): Promise<{
        acceptedMessages: number;
        statusUpdates: number;
        duplicates: number;
    }>;
    /**
     * WA-01: Safe recovery entry point for previously accepted inbound messages with `autoReply.status === 'pending'`.
     * Preserves idempotency, avoids duplicate sends, defines safe behavior for 60s expired reservations,
     * and never resends uncertain provider deliveries.
     */
    recoverAutoReplies(scope: AuthenticatedScope, id: string): Promise<WhatsAppAutoReplyRecoveryResult>;
    private processCustomerAutoReplies;
    /** Builds an unsent reply draft from the owner's own binding for approval. No state change, no audit, no transport. */
    replyDraft(scope: AuthenticatedScope, id: string, input: unknown): Promise<N8nWhatsAppReplyDraft>;
    reserve(scope: AuthenticatedScope, id: string, input: MetaWhatsAppAnySendInput, approvalId: string): Promise<N8nWhatsAppReceipt>;
    claim(scope: WhatsAppExecutionScope, id: string, dispatchId: string, revision: number): Promise<{
        replyToProviderMessageId?: string | undefined;
        messageType: "text";
        textBody: string;
        authorized: true;
        dispatchEnabled: boolean;
        dispatchId: string;
        phoneNumberId: string;
        recipientPhoneNumber: string;
    } | {
        replyToProviderMessageId?: string | undefined;
        messageType: "template";
        template: {
            bodyParams?: string[] | undefined;
            headerParams?: string[] | undefined;
            name: string;
            language: string;
        };
        authorized: true;
        dispatchEnabled: boolean;
        dispatchId: string;
        phoneNumberId: string;
        recipientPhoneNumber: string;
    } | {
        replyToProviderMessageId?: string | undefined;
        messageType: "media";
        media: {
            filename?: string | undefined;
            caption?: string | undefined;
            sha256: string;
            mimeType: string;
            kind: "image" | "document" | "audio";
            mediaId: string;
        };
        authorized: true;
        dispatchEnabled: boolean;
        dispatchId: string;
        phoneNumberId: string;
        recipientPhoneNumber: string;
    }>;
    receipt(scope: WhatsAppExecutionScope, id: string, input: N8nWhatsAppProviderReceipt): Promise<N8nWhatsAppReceipt>;
    unknown(scope: AuthenticatedScope, id: string, dispatchId: string): Promise<N8nWhatsAppReceipt>;
    disconnect(scope: AuthenticatedScope, id: string): Promise<{
        disconnected: true;
        revision: number;
    }>;
}
export {};
//# sourceMappingURL=whatsapp-durable.d.ts.map