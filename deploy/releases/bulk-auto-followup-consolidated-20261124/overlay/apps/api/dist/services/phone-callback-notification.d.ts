import { type PhoneCallbackNotificationStatus } from '@thaara/contracts';
export type CallbackScope = {
    workspaceId: string;
    userId: string;
};
type Direction = 'inbound' | 'outbound';
type Turn = {
    speaker: 'agent' | 'caller';
    text: string;
    englishText?: string;
};
export interface AdmittedCallbackCall extends CallbackScope {
    callId: string;
    direction: Direction;
    /** Verified inbound metadata or owner-approved dispatch. */
    verifiedNumber: string | null;
    occurredAt: string;
    known?: {
        name?: string;
        business?: string;
        service?: string;
    };
    turns: readonly Turn[];
}
export interface CallbackRequest extends CallbackScope {
    id: string;
    callId: string;
    direction: Direction;
    name: string | null;
    business: string | null;
    service: string | null;
    phoneNumber: string | null;
    numberSource: 'call_metadata' | 'caller_confirmed' | null;
    occurredAt: string;
    status: 'requested' | 'contacted' | 'completed' | 'cancelled';
    notificationStatus: PhoneCallbackNotificationStatus;
    notificationAttemptId: string | null;
    providerMessageId: string | null;
    attempts: number;
}
export type NotificationResult = 'submitted' | 'failed' | 'unverified' | 'pending';
export interface CallbackRepository {
    save(request: CallbackRequest): Promise<CallbackRequest>;
    read(scope: CallbackScope, id: string): Promise<CallbackRequest | null>;
    claim(scope: CallbackScope, id: string, attempt: string, approvalId?: string): Promise<number | null>;
    finish(scope: CallbackScope, id: string, attempt: string, result: NotificationResult, providerMessageId?: string): Promise<void>;
}
/** Project structured details after the backend admits and binds the call. */
export declare function projectCallbackRequest(call: AdmittedCallbackCall, raw: unknown): CallbackRequest | null;
export declare function callbackMissingFields(request: Pick<CallbackRequest, 'name' | 'business' | 'service' | 'phoneNumber'>): ("name" | "service" | "business" | "phoneNumber")[];
export declare function formatCallbackEmail(request: Pick<CallbackRequest, 'name' | 'business' | 'service' | 'phoneNumber'>): {
    subject: string;
    bodyText: string;
};
/** Call identity and scope come from the server-bound resolver. */
export declare function createCallbackCapture<Input>(options: {
    admit(input: Input): Promise<AdmittedCallbackCall | null>;
    repository: Pick<CallbackRepository, 'save'>;
}): (input: Input, structuredDetails: unknown) => Promise<{
    saved: false;
    requestId?: undefined;
    notificationStatus?: undefined;
    missingFields?: undefined;
} | {
    saved: true;
    requestId: string;
    notificationStatus: "pending" | "unverified" | "failed" | "needs_review" | "submitted" | "sending";
    missingFields: ("name" | "service" | "business" | "phoneNumber")[];
}>;
export interface CallbackNotificationGrant extends CallbackScope {
    enabled: true;
    approvedByUserId: string;
    recipient: string;
    sender: string;
    expiresAt: string;
    approvalId?: string;
}
export type CallbackMail = ReturnType<typeof formatCallbackEmail> & {
    to: string;
    from: string;
    idempotencyKey: string;
};
export type CallbackMailOutcome = {
    acceptedId: string;
} | 'rejected' | 'not_submitted' | 'unknown';
export interface CallbackMailTransport {
    sender: string;
    ready?(): Promise<boolean>;
    send(mail: CallbackMail): Promise<CallbackMailOutcome>;
}
/** Server-only dispatcher. Its dependencies must come from the admitted Phone worker. */
export declare function createCallbackNotificationDispatcher(options: {
    repository: Pick<CallbackRepository, 'read' | 'claim' | 'finish'>;
    currentOwnerGrant(scope: CallbackScope): Promise<CallbackNotificationGrant | null>;
    transport: CallbackMailTransport;
    now?: () => number;
}): (scope: CallbackScope, requestId: string) => Promise<"not_configured" | NotificationResult | "not_eligible" | "awaiting_owner_authorization">;
export {};
//# sourceMappingURL=phone-callback-notification.d.ts.map