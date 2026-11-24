import type { AuthenticatedScope } from '@thaara/db';
import type { DurableWhatsAppService } from './whatsapp-durable.js';
import { type WhatsAppMediaKind, type WhatsAppMediaPreviewAudit } from './whatsapp-media-preview.js';
import { type WhatsAppUploadDescription, type WhatsAppUploadAuthorizationDraft } from '@thaara/contracts';
import type { WhatsAppUploadAdmission } from './whatsapp-upload-admission.js';
/** Outbound limits (Meta: image 5 MB, audio 16 MB; documents bounded lower here). */
export declare const WHATSAPP_UPLOAD_MAX_BYTES: Record<WhatsAppMediaKind, number>;
export declare class WhatsAppUploadError extends Error {
    readonly reason: 'not_configured' | 'unavailable' | 'rejected';
    constructor(reason: 'not_configured' | 'unavailable' | 'rejected');
}
/** Uploads verified bytes to the connection's own phone number. Returns Meta's media ID only; nothing is stored here. */
export interface WhatsAppMediaUploader {
    upload(phoneNumberId: string, file: {
        bytes: Buffer;
        mimeType: string;
        filename?: string;
    }, signal: AbortSignal): Promise<string>;
}
export declare function createMetaWhatsAppMediaUploader(options: {
    accessToken(): string | null;
    fetch?: typeof fetch;
}): WhatsAppMediaUploader;
/**
 * Owner-only outbound attachment upload. Bytes are verified (type, magic bytes, size), fingerprinted, uploaded to the
 * connection's own number and audited. The result feeds a media draft that still needs per-message approval to send.
 */
export declare class WhatsAppMediaUploadService {
    private readonly durable;
    private readonly audit;
    private readonly uploader?;
    private readonly now;
    private readonly admission?;
    private readonly recent;
    constructor(durable: DurableWhatsAppService, audit: WhatsAppMediaPreviewAudit, uploader?: WhatsAppMediaUploader | undefined, now?: () => number, admission?: WhatsAppUploadAdmission | undefined);
    prepare(scope: AuthenticatedScope, connectionId: string, description: WhatsAppUploadDescription): Promise<WhatsAppUploadAuthorizationDraft>;
    upload(scope: AuthenticatedScope, connectionId: string, file: {
        bytes: Buffer;
        mimeType: string;
        filename?: string;
    }, authorization?: {
        approvalId: string;
        idempotencyKey: string;
    }): Promise<{
        media: {
            filename?: string | undefined;
            sha256: string;
            mimeType: string;
            kind: "image" | "document" | "audio";
            mediaId: string;
        };
    }>;
}
//# sourceMappingURL=whatsapp-media-upload.d.ts.map