import { ApprovalRequest, MetaWhatsAppSendInput, MetaWhatsAppTestConfig, N8nWhatsAppProviderReceipt, N8nWhatsAppReceipt } from '@thaara/contracts';
import { AuthenticatedScope } from '@thaara/db';
import { PolicyGateway } from '@thaara/policy';
import { WhatsAppVault } from './whatsapp.js';
export interface N8nWhatsAppSubmitTransport {
    readonly mode: 'mock';
    submit(dispatchId: string, revision: number): Promise<{
        dispatchId: string;
        status: 'not_configured' | 'unverified';
    }>;
}
/** Explicit mock fetch required; the production HTTP transport is deliberately not configured. */
export declare class N8nWhatsAppMockHttpTransport implements N8nWhatsAppSubmitTransport {
    #private;
    readonly mode: "mock";
    constructor(options: {
        url: string;
        resolveToken(): Promise<string>;
        fetch: typeof fetch;
    });
    submit(dispatchId: string, revision: number): Promise<{
        dispatchId: string;
        status: "not_configured" | "unverified";
    }>;
}
interface Options {
    binding: MetaWhatsAppTestConfig;
    vault: WhatsAppVault;
    relayToken: string;
    dispatchToken: string;
    policyGateway: PolicyGateway;
    authorize(scope: AuthenticatedScope): Promise<boolean>;
    resolveApproval(scope: AuthenticatedScope, id: string): Promise<ApprovalRequest | null>;
    audit(scope: AuthenticatedScope, action: string, details: Record<string, unknown>): Promise<void>;
    transport?: N8nWhatsAppSubmitTransport;
}
/** Dependency-injected, memory-only test bridge; no real credentials or live provider calls. */
export declare class N8nWhatsAppBridge {
    #private;
    constructor(options?: Options);
    status(scope: AuthenticatedScope): Promise<{
        transport: "n8n";
        mode: "disabled" | "offline_test";
        configured: boolean;
        liveSendingEnabled: false;
        storage: "not_configured" | "temporary_test_memory";
    }>;
    history(scope: AuthenticatedScope): Promise<{
        providerMessageId: string;
        recipientId: string;
        senderMaskedPhone: string;
        textPreview: string;
        timestamp: string;
        mode: "offline_test";
        untrusted: true;
    }[]>;
    ingest(connection: string, header: string, input: unknown): Promise<{
        acceptedMessages: number;
        statusUpdates: number;
        duplicates: number;
    }>;
    dispatch(scope: AuthenticatedScope, input: MetaWhatsAppSendInput, approvalId?: string): Promise<N8nWhatsAppReceipt>;
    claim(connection: string, header: string, dispatchId: string, revision?: number): Promise<{
        authorized: true;
        dispatchEnabled: false;
        dispatchId: string;
        phoneNumberId: string;
        recipientPhoneNumber: string;
        textBody: string;
    }>;
    receipt(connection: string, header: string, input: N8nWhatsAppProviderReceipt): Promise<{
        status: "unverified" | "sent" | "delivered" | "read" | "failed" | "not_configured";
        mode: "offline_test";
        providerMessageId: string | null;
        dispatchId: string | null;
        verified: false;
        transport: "n8n";
    }>;
    disconnect(scope: AuthenticatedScope): Promise<void>;
}
export {};
//# sourceMappingURL=whatsapp-n8n.d.ts.map