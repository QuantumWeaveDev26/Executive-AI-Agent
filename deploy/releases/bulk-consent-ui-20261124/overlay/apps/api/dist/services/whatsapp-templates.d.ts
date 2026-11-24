import type { AuthenticatedScope } from '@thaara/db';
import { type N8nWhatsAppTemplates, type N8nWhatsAppTemplateDraftRequest } from '@thaara/contracts';
import type { DurableWhatsAppService } from './whatsapp-durable.js';
type Template = N8nWhatsAppTemplates['templates'][number];
export declare class WhatsAppTemplateError extends Error {
    readonly reason: 'not_configured' | 'unavailable' | 'rejected';
    constructor(reason: 'not_configured' | 'unavailable' | 'rejected');
}
/** Lists templates of the WhatsApp Business Account. Receives only the stored numeric account ID; token stays server-side. */
export interface WhatsAppTemplateProvider {
    list(businessAccountId: string, signal: AbortSignal): Promise<unknown[]>;
}
export declare function createMetaWhatsAppTemplateProvider(options: {
    accessToken(): string | null;
    fetch?: typeof fetch;
}): WhatsAppTemplateProvider;
/** Provider data is untrusted: keep only bounded, sanitized fields; drop anything malformed. */
export declare function normalizeWhatsAppTemplates(raw: unknown[]): Template[];
/** Owner-scoped template catalog for the connection's own business account. Read-only; sending is a separate approved draft. */
export declare class WhatsAppTemplateService {
    private readonly durable;
    private readonly provider?;
    constructor(durable: DurableWhatsAppService, provider?: WhatsAppTemplateProvider | undefined);
    /** Prepares an approval-ready template draft only for an APPROVED catalog template with the exact variable counts. */
    prepare(scope: AuthenticatedScope, connectionId: string, request: N8nWhatsAppTemplateDraftRequest): Promise<{
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
            template: Extract<import("@thaara/contracts").MetaWhatsAppAnySendInput, {
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
    list(scope: AuthenticatedScope, connectionId: string): Promise<N8nWhatsAppTemplates>;
}
export {};
//# sourceMappingURL=whatsapp-templates.d.ts.map