import { GmailStatus, GmailSearch, GmailCallback, GmailMessage, GmailSearchResponse, GmailSendReplyInput, GmailSendReplyReceipt, GmailSendNewInput, GmailSendNewReceipt, ApprovalRequest } from '@thaara/contracts';
import { AuthenticatedScope } from '@thaara/db';
import { PolicyGateway, ActionAdapter } from '@thaara/policy';
import { GmailVault } from './gmail-vault.js';
export declare const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export declare const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
export declare const GMAIL_LIVE_SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
export declare const GMAIL_SEND_REPLY_ACTION = "gmail.messages.send_reply";
export declare const GMAIL_SEND_NEW_ACTION = "gmail.messages.send_new";
export declare const GMAIL_SEND_ACTIONS: readonly ["gmail.messages.send_reply", "gmail.messages.send_new"];
export declare function isGmailSendAction(name: unknown): name is (typeof GMAIL_SEND_ACTIONS)[number];
export type GmailSendReadinessReason = 'ready' | 'not_configured' | 'disconnected' | 'reconnect_required' | 'send_permission_missing' | 'account_unverified';
export interface GmailSendReadiness {
    ready: boolean;
    reason: GmailSendReadinessReason;
    connectedEmail: string | null;
    status: GmailStatus;
}
export interface GmailTokens {
    accessToken: string;
    refreshToken?: string;
    scope: string;
    expiresIn: number;
}
export interface GmailProvider {
    readonly mode: 'mock' | 'live';
    exchange(input: {
        code: string;
        codeVerifier: string;
        clientId: string;
        redirectUri: string;
    }): Promise<GmailTokens>;
    refresh?(input: {
        refreshToken: string;
        clientId: string;
    }): Promise<GmailTokens>;
    revoke?(input: {
        token: string;
    }): Promise<void>;
    getProfile?(input: {
        accessToken: string;
    }): Promise<{
        emailAddress?: string;
    }>;
    search(input: {
        accessToken: string;
        query: string;
        limit: number;
        pageToken?: string;
    }): Promise<unknown>;
    read(input: {
        accessToken: string;
        messageId: string;
    }): Promise<unknown>;
    sendReply?(input: {
        accessToken: string;
        connectedEmail: string;
        to: string;
        cc?: string;
        subject: string;
        threadId: string;
        inReplyTo?: string;
        references?: string;
        bodyText: string;
    }): Promise<{
        id?: string;
        threadId?: string;
    }>;
    sendNew?(input: {
        accessToken: string;
        connectedEmail: string;
        to: string;
        subject?: string;
        bodyText: string;
    }): Promise<{
        id?: string;
        threadId?: string;
    }>;
}
export interface GmailOptions {
    provider?: GmailProvider;
    vault?: GmailVault;
    clientId?: string;
    redirectUri?: string;
    allowLocalhostRedirect?: boolean;
    allowSendScope?: boolean;
    now?: () => number;
}
type Audit = (scope: AuthenticatedScope, action: string, payload: Record<string, unknown>) => Promise<void>;
export declare class GmailFoundation {
    private options;
    private readonly now;
    private readonly ready;
    constructor(options: GmailOptions & {
        policyGateway: PolicyGateway;
        audit: Audit;
    });
    private get activeMode();
    private get supportsSendScope();
    private authorize;
    private configured;
    private epoch;
    private unchanged;
    private resolveProfileEmail;
    private tryRefresh;
    status(scope: AuthenticatedScope): Promise<GmailStatus>;
    start(scope: AuthenticatedScope): Promise<{
        authorizationUrl: string;
        expiresAt: string;
        mode: "live" | "mock";
    }>;
    complete(scope: AuthenticatedScope, input: GmailCallback): Promise<GmailStatus>;
    disconnect(scope: AuthenticatedScope): Promise<GmailStatus>;
    private connection;
    private providerCall;
    search(scope: AuthenticatedScope, input: GmailSearch): Promise<GmailSearchResponse>;
    read(scope: AuthenticatedScope, messageId: string): Promise<GmailMessage>;
    sendReply(scope: AuthenticatedScope, input: GmailSendReplyInput, approvedRequest: ApprovalRequest, idempotencyKey: string): Promise<GmailSendReplyReceipt>;
    /**
     * Reports whether the authenticated user's own Gmail connection can send email right now.
     * Never contacts the provider beyond the normal status/refresh path and never exposes tokens.
     */
    sendReadiness(scope: AuthenticatedScope, kind?: 'new' | 'reply'): Promise<GmailSendReadiness>;
    /**
     * Sends a brand-new standalone email only for an explicitly approved, exactly matching payload.
     * Binding: same workspace, same requesting user, same action, same canonical parameter hash,
     * same connected Gmail account, gmail.send granted, and at most one provider attempt per approval.
     */
    sendNew(scope: AuthenticatedScope, input: GmailSendNewInput, approvedRequest: ApprovalRequest, idempotencyKey: string): Promise<GmailSendNewReceipt>;
    createNewSendAdapter(): ActionAdapter;
    /** Adapters for every governed Gmail send action, for in-process plan execution. */
    createSendAdapters(): Array<[string, ActionAdapter]>;
    createReplySendAdapter(): ActionAdapter;
}
export {};
//# sourceMappingURL=gmail.d.ts.map