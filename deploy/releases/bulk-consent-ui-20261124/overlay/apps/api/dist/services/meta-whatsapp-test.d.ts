import { ApprovalRequest, MetaWhatsAppReceipt, MetaWhatsAppSendInput, MetaWhatsAppTestConfig } from '@thaara/contracts';
import { AuthenticatedScope } from '@thaara/db';
import { PolicyGateway } from '@thaara/policy';
import { WhatsAppVault } from './whatsapp.js';
type Secrets = {
    accessToken: string;
    appSecret: string;
    verifyToken: string;
};
type Audit = (scope: AuthenticatedScope, action: string, details: Record<string, unknown>) => Promise<void>;
interface Options {
    config: MetaWhatsAppTestConfig;
    secrets: Secrets;
    reviewedGraphVersions: readonly string[];
    vault: WhatsAppVault;
    policyGateway: PolicyGateway;
    authorize(scope: AuthenticatedScope): Promise<boolean>;
    resolveApproval(scope: AuthenticatedScope, id: string): Promise<ApprovalRequest | null>;
    audit: Audit;
    now?: () => number;
}
interface InboxMessage {
    providerMessageId: string;
    recipientId: string;
    senderMaskedPhone: string;
    textPreview: string;
    timestamp: string;
    mode: 'offline_test';
    untrusted: true;
}
/** Server-side descriptor only: no fetch, Authorization header, token, or execution capability. */
export declare function buildMetaTextRequest(version: string, phoneNumberId: string, recipient: string, body: string, replyTo?: string): {
    method: "POST";
    url: string;
    body: {
        context?: {
            message_id: string;
        } | undefined;
        messaging_product: string;
        recipient_type: string;
        to: string;
        type: string;
        text: {
            body: string;
        };
    };
};
/** An HTTP acknowledgement alone never establishes sent/delivered/read. This is fixture-only evidence. */
export declare function metaAcknowledgementReceipt(response: unknown): MetaWhatsAppReceipt;
export declare function advanceMetaTestReceipt(current: MetaWhatsAppReceipt, event: {
    providerMessageId: string;
    recipientAddress: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
}, expectedRecipient: string): MetaWhatsAppReceipt;
/** Offline harness only. Not registered in buildApp, no environment loading, no network transport. */
export declare class MetaWhatsAppTestFoundation {
    #private;
    constructor(options?: Options);
    status(scope: AuthenticatedScope): Promise<{
        provider: "meta_cloud_test";
        mode: "disabled" | "offline_test";
        configured: boolean;
        state: string;
        connected: boolean;
        sendEnabled: boolean;
        identityVerified: boolean;
        storage: string;
    }>;
    verifyChallenge(query: Record<string, unknown>): Promise<string>;
    ingestWebhook(rawBody: Buffer, signature: string): Promise<{
        acceptedMessages: number;
        ignoredStatuses: number;
        duplicates: number;
    }>;
    history(scope: AuthenticatedScope): Promise<InboxMessage[]>;
    disconnect(scope: AuthenticatedScope): Promise<void>;
    prepareSend(scope: AuthenticatedScope, input: MetaWhatsAppSendInput, approvalId?: string): Promise<MetaWhatsAppReceipt>;
}
export {};
//# sourceMappingURL=meta-whatsapp-test.d.ts.map