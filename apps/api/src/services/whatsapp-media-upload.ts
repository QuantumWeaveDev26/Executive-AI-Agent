import { createHash } from 'node:crypto';
import type { AuthenticatedScope } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import type { DurableWhatsAppService } from './whatsapp-durable.js';
import { detectWhatsAppMedia, type WhatsAppMediaKind, type WhatsAppMediaPreviewAudit } from './whatsapp-media-preview.js';
import { WHATSAPP_MEDIA_UPLOAD_ACTION, isWhatsAppUploadDescription, type WhatsAppUploadDescription, type WhatsAppUploadAuthorizationDraft, type WhatsAppUploadIntent } from '@thaara/contracts';
import type { WhatsAppUploadAdmission } from './whatsapp-upload-admission.js';

/** Outbound limits (Meta: image 5 MB, audio 16 MB; documents bounded lower here). */
export const WHATSAPP_UPLOAD_MAX_BYTES: Record<WhatsAppMediaKind, number> = { image: 5 * 1024 * 1024, audio: 16 * 1024 * 1024, document: 20 * 1024 * 1024 };
export class WhatsAppUploadError extends Error { constructor(readonly reason: 'not_configured' | 'unavailable' | 'rejected') { super('WhatsApp upload ' + reason); } }
/** Uploads verified bytes to the connection's own phone number. Returns Meta's media ID only; nothing is stored here. */
export interface WhatsAppMediaUploader { upload(phoneNumberId: string, file: { bytes: Buffer; mimeType: string; filename?: string }, signal: AbortSignal): Promise<string> }

export function createMetaWhatsAppMediaUploader(options: { accessToken(): string | null; fetch?: typeof fetch }): WhatsAppMediaUploader {
  const call = options.fetch ?? fetch;
  return {
    async upload(phoneNumberId, file, signal) {
      if (!/^[0-9]{6,24}$/.test(phoneNumberId)) throw new WhatsAppUploadError('rejected');
      const token = options.accessToken();
      if (!token) throw new WhatsAppUploadError('not_configured');
      const form = new FormData();
      form.set('messaging_product', 'whatsapp'); form.set('type', file.mimeType);
      form.set('file', new Blob([file.bytes], { type: file.mimeType }), file.filename ?? 'upload');
      let res: Response;
      try { res = await call(`https://graph.facebook.com/v21.0/${phoneNumberId}/media`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form, redirect: 'error', signal }); }
      catch { throw new WhatsAppUploadError('unavailable'); }
      if (res.status === 401 || res.status === 403) throw new WhatsAppUploadError('not_configured');
      if (res.status !== 200) throw new WhatsAppUploadError('unavailable');
      let body: { id?: unknown };
      try {
        if (!res.body) throw new Error(); const reader = res.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4096) { await reader.cancel(); throw new Error(); } chunks.push(part.value); }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch { throw new WhatsAppUploadError('unavailable'); }
      if (typeof body?.id !== 'string' || !/^[0-9]{1,64}$/.test(body.id)) throw new WhatsAppUploadError('rejected');
      return body.id;
    }
  };
}

const kindOf = (mime: string): WhatsAppMediaKind => mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'document';

/**
 * Owner-only outbound attachment upload. Bytes are verified (type, magic bytes, size), fingerprinted, uploaded to the
 * connection's own number and audited. The result feeds a media draft that still needs per-message approval to send.
 */
export class WhatsAppMediaUploadService {
  private readonly recent = new Map<string, number[]>();
  constructor(private readonly durable: DurableWhatsAppService, private readonly audit: WhatsAppMediaPreviewAudit, private readonly uploader?: WhatsAppMediaUploader, private readonly now = Date.now, private readonly admission?: WhatsAppUploadAdmission) {}
  async prepare(scope: AuthenticatedScope, connectionId: string, description: WhatsAppUploadDescription): Promise<WhatsAppUploadAuthorizationDraft> {
    if (!isWhatsAppUploadDescription(description)) throw new AppError('Invalid upload description.', 'WHATSAPP_UPLOAD_REJECTED', 400);
    const account = await this.durable.accountIds(scope, connectionId);
    if (!this.uploader || !this.admission) throw new AppError('File upload is not set up.', 'WHATSAPP_UPLOAD_NOT_CONFIGURED', 503);
    return { draft: { ...description, connectionId, connectionRevision: account.revision, senderPhoneNumberId: account.phoneNumberId }, actionName: WHATSAPP_MEDIA_UPLOAD_ACTION, riskLevel: 'high', liveSendingEnabled: false };
  }
  async upload(scope: AuthenticatedScope, connectionId: string, file: { bytes: Buffer; mimeType: string; filename?: string }, authorization?: { approvalId: string; idempotencyKey: string }) {
    file = { ...file, bytes: Buffer.from(file.bytes) };
    const caller = { ...scope };
    if (!caller.sessionTokenHash || caller.role === 'viewer') throw new ForbiddenError('WhatsApp upload denied.');
    const account = await this.durable.accountIds(caller, connectionId).catch(error => { throw error instanceof AppError ? error : new ForbiddenError('WhatsApp upload denied.'); });
    const mimeType = file.mimeType.split(';')[0]!.trim().toLowerCase(), kind = kindOf(mimeType);
    const filename = kind === 'document' && file.filename ? file.filename.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 160) : undefined;
    if (file.bytes.length < 1 || file.bytes.length > WHATSAPP_UPLOAD_MAX_BYTES[kind] || detectWhatsAppMedia(kind, file.bytes, mimeType) !== mimeType)
      throw new AppError('This file type or size cannot be sent.', 'WHATSAPP_UPLOAD_REJECTED', 400);
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');
    const details = { connectionId, providerMessageId: 'upload', kind, bytes: file.bytes.length, mimeType };
    if (!this.uploader) { await this.audit(caller, 'whatsapp.media.preview_refused', { ...details, outcome: 'upload_not_configured' }); throw new AppError('WhatsApp file sending is not set up.', 'WHATSAPP_UPLOAD_NOT_CONFIGURED', 503); }
    if (!this.admission || !authorization || !/^[a-f0-9-]{36}$/i.test(authorization.approvalId) || !/^[a-zA-Z0-9_-]{8,128}$/.test(authorization.idempotencyKey)) throw new ForbiddenError('Explicit file upload approval is required.');
    const intent: WhatsAppUploadIntent = { connectionId, connectionRevision: account.revision, senderPhoneNumberId: account.phoneNumberId, filename: file.filename ?? 'upload', mimeType, bytes: file.bytes.length, sha256, idempotencyKey: authorization.idempotencyKey };
    const admitted = await this.admission.begin(caller, intent, authorization.approvalId);
    const recheck = async () => { const fresh = await this.durable.accountIds(caller, connectionId); if (fresh.revision !== account.revision || fresh.phoneNumberId !== account.phoneNumberId) throw new ForbiddenError('WhatsApp upload connection changed.'); };
    if (!admitted.fresh) { await recheck(); return admitted.result; }
    const key = caller.workspaceId + ':' + caller.userId, at = this.now(), window = (this.recent.get(key) ?? []).filter(t => at - t < 600000);
    if (window.length >= 20) throw new AppError('Too many uploads. Try again later.', 'WHATSAPP_UPLOAD_RATE_LIMITED', 429);
    this.recent.set(key, [...window, at]);
    let mediaId: string;
    try {
      await recheck();
      mediaId = await this.uploader.upload(account.phoneNumberId, { bytes: file.bytes, mimeType, ...(filename ? { filename } : {}) }, AbortSignal.timeout(30000));
      if (!/^[0-9]{1,64}$/.test(mediaId)) throw new WhatsAppUploadError('rejected');
      await recheck();
      const result = { media: { kind, mediaId, mimeType, sha256, ...(filename ? { filename } : {}) } };
      await this.admission.complete(caller, intent, authorization.approvalId, result);
      await recheck();
      return result;
    }
    catch (error) {
      await this.admission.fail(caller, intent, authorization.approvalId).catch(() => undefined);
      const reason = error instanceof WhatsAppUploadError ? error.reason : 'unavailable';
      await this.audit(caller, 'whatsapp.media.preview_refused', { ...details, outcome: 'upload_' + reason });
      if (reason === 'not_configured') throw new AppError('WhatsApp file sending is not set up.', 'WHATSAPP_UPLOAD_NOT_CONFIGURED', 503);
      throw new AppError('The file could not be uploaded to WhatsApp.', 'WHATSAPP_UPLOAD_FAILED', 502);
    }
  }
}
