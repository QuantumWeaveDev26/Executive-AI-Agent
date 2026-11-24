import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { AuditEventRepository, type AuthenticatedScope, type TransactionalDbClient } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import type { PolicyGateway } from '@thaara/policy';
import type { DurableWhatsAppService } from './whatsapp-durable.js';

/** Meta's documented image ceiling. Larger files are refused before and while reading. */
export const WHATSAPP_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const GRAPH_ORIGIN = 'https://graph.facebook.com';
const GRAPH_VERSION = 'v21.0';
// Only Meta's media CDN may serve bytes. Any other host, scheme, port, credentials or redirect is refused.
const MEDIA_HOSTS = new Set(['lookaside.fbsbx.com']);
const IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
export type WhatsAppPreviewImageType = typeof IMAGE_TYPES[number];

export type WhatsAppMediaFailure = 'not_configured' | 'unavailable' | 'rejected';
export class WhatsAppMediaError extends Error {
  constructor(readonly reason: WhatsAppMediaFailure) { super('WhatsApp media ' + reason); this.name = 'WhatsAppMediaError'; }
}
export interface WhatsAppMediaDownload { bytes: Buffer; mimeType: string; sha256?: string }
/** Provider adapter. Receives only a stored numeric media ID, never a URL from a browser or webhook. */
export interface WhatsAppMediaProvider { download(mediaId: string, signal: AbortSignal, maxBytes?: number): Promise<WhatsAppMediaDownload> }
export type WhatsAppMediaKind = 'image' | 'document' | 'audio';
/** Per-kind byte ceilings (Meta: images 5 MB, audio 16 MB; documents bounded lower here to keep memory use safe). */
export const WHATSAPP_MEDIA_MAX_BYTES: Record<WhatsAppMediaKind, number> = { image: 5 * 1024 * 1024, audio: 16 * 1024 * 1024, document: 20 * 1024 * 1024 };

async function readCapped(response: Response, max: number): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d{1,12}$/.test(declared) || Number(declared) > max)) throw new WhatsAppMediaError('rejected');
  if (!response.body) throw new WhatsAppMediaError('unavailable');
  const reader = response.body.getReader(), chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => undefined); throw new WhatsAppMediaError('rejected'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export function isAllowedWhatsAppMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && url.port === '' && isIP(url.hostname) === 0 && MEDIA_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Meta Cloud API media adapter: GET /{media-id} for a short-lived CDN URL, then GET that URL.
 * The access token comes from a server-side provider only; it is never logged, returned or stored here.
 */
export function createMetaWhatsAppMediaProvider(options: { accessToken(): string | null; fetch?: typeof fetch }): WhatsAppMediaProvider {
  const call = options.fetch ?? fetch;
  return {
    async download(mediaId, signal, maxBytes = WHATSAPP_PREVIEW_MAX_BYTES) {
      if (!/^[0-9]{1,64}$/.test(mediaId)) throw new WhatsAppMediaError('rejected');
      const token = options.accessToken();
      if (!token) throw new WhatsAppMediaError('not_configured');
      const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
      let lookup: Response;
      try { lookup = await call(`${GRAPH_ORIGIN}/${GRAPH_VERSION}/${mediaId}`, { headers, redirect: 'error', signal }); }
      catch { throw new WhatsAppMediaError('unavailable'); }
      if (lookup.status !== 200) throw new WhatsAppMediaError(lookup.status === 401 || lookup.status === 403 ? 'not_configured' : 'unavailable');
      let info: { id?: unknown; url?: unknown; mime_type?: unknown; sha256?: unknown; file_size?: unknown };
      try { info = JSON.parse((await readCapped(lookup, 16384)).toString('utf8')); } catch (error) { throw error instanceof WhatsAppMediaError ? error : new WhatsAppMediaError('unavailable'); }
      if (!info || typeof info !== 'object' || info.id !== mediaId || typeof info.mime_type !== 'string' || !isAllowedWhatsAppMediaUrl(info.url)) throw new WhatsAppMediaError('rejected');
      if (info.file_size !== undefined && (typeof info.file_size !== 'number' || !Number.isSafeInteger(info.file_size) || info.file_size < 1 || info.file_size > maxBytes)) throw new WhatsAppMediaError('rejected');
      let file: Response;
      try { file = await call(info.url, { headers: { Authorization: headers.Authorization }, redirect: 'error', signal }); }
      catch { throw new WhatsAppMediaError('unavailable'); }
      if (file.status !== 200) throw new WhatsAppMediaError('unavailable');
      const bytes = await readCapped(file, maxBytes);
      return { bytes, mimeType: info.mime_type, ...(typeof info.sha256 === 'string' ? { sha256: info.sha256 } : {}) };
    }
  };
}

/** Magic-byte detection for the only previewable formats. SVG, GIF, WebP, HTML and everything else is refused. */
export function detectWhatsAppPreviewImage(bytes: Uint8Array): WhatsAppPreviewImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'image/png';
  return null;
}
const baseType = (mime: string) => mime.split(';')[0]!.trim().toLowerCase();
function digestMatches(bytes: Buffer, expected: string) {
  const digest = createHash('sha256').update(bytes).digest();
  return /^[a-fA-F0-9]{64}$/.test(expected) ? digest.toString('hex') === expected.toLowerCase() : digest.toString('base64') === expected;
}
/** All checks must pass: size, magic bytes, saved type, provider type and the fingerprint saved from the webhook. */
export function verifyWhatsAppPreviewImage(download: WhatsAppMediaDownload, saved: { mimeType: string; sha256: string }): WhatsAppPreviewImageType {
  const { bytes } = download, type = detectWhatsAppPreviewImage(bytes);
  if (!type || bytes.length < 1 || bytes.length > WHATSAPP_PREVIEW_MAX_BYTES || baseType(saved.mimeType) !== type || baseType(download.mimeType) !== type
    || !digestMatches(bytes, saved.sha256) || (download.sha256 !== undefined && !digestMatches(bytes, download.sha256))) throw new WhatsAppMediaError('rejected');
  return type;
}

const AUDIO_TYPES = ['audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/amr', 'audio/mp4'];
const OLE_TYPES = ['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'];
const OOXML_TYPES = ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
const starts = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (t: string) => [...t].map(c => c.charCodeAt(0));
/** Magic-byte detection per kind. Returns the verified type, or null when the bytes do not prove a permitted format. */
export function detectWhatsAppMedia(kind: WhatsAppMediaKind, bytes: Uint8Array, savedMime: string): string | null {
  const saved = baseType(savedMime);
  if (kind === 'image') return detectWhatsAppPreviewImage(bytes);
  if (kind === 'audio') {
    if (starts(bytes, ascii('OggS'))) return 'audio/ogg';
    if (starts(bytes, ascii('#!AMR'))) return 'audio/amr';
    if (starts(bytes, ascii('ftyp'), 4)) return 'audio/mp4';
    if (starts(bytes, ascii('ID3'))) return 'audio/mpeg';
    if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) return 'audio/aac';
    if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return 'audio/mpeg';
    return null;
  }
  if (starts(bytes, ascii('%PDF-'))) return 'application/pdf';
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return OLE_TYPES.includes(saved) ? saved : null;
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) return OOXML_TYPES.includes(saved) ? saved : null;
  if (saved === 'text/plain' && !bytes.includes(0)) { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'text/plain'; } catch { return null; } }
  return null;
}
/** Same rules as images for every kind: size, magic bytes, saved type, provider type and saved fingerprint must all agree. */
export function verifyWhatsAppMedia(kind: WhatsAppMediaKind, download: WhatsAppMediaDownload, saved: { mimeType: string; sha256: string }): string {
  const { bytes } = download, type = detectWhatsAppMedia(kind, bytes, saved.mimeType);
  if (!type || (kind === 'audio' && !AUDIO_TYPES.includes(type)) || bytes.length < 1 || bytes.length > WHATSAPP_MEDIA_MAX_BYTES[kind] || baseType(saved.mimeType) !== type || baseType(download.mimeType) !== type
    || !digestMatches(bytes, saved.sha256) || (download.sha256 !== undefined && !digestMatches(bytes, download.sha256))) throw new WhatsAppMediaError('rejected');
  return type;
}

export interface WhatsAppMediaPreviewAudit { (scope: AuthenticatedScope, action: 'whatsapp.media.previewed' | 'whatsapp.media.downloaded' | 'whatsapp.media.uploaded' | 'whatsapp.media.preview_refused', details: { connectionId: string; providerMessageId: string; outcome: string; kind?: WhatsAppMediaKind; bytes?: number; mimeType?: string }): Promise<void> }
export interface WhatsAppMediaPreview { status: 'verified'; contentType: WhatsAppPreviewImageType; bytes: Buffer }
export interface WhatsAppMediaContent { status: 'verified'; kind: WhatsAppMediaKind; contentType: string; bytes: Buffer; filename?: string }

/**
 * Owner-only image preview. The browser names a saved message; the server resolves the media reference inside the
 * owner's scoped transaction, downloads through the adapter, verifies, audits, and only then returns bytes.
 * Nothing is persisted, cached or forwarded. Failures are truthful: not_configured, unavailable or rejected.
 */
export class WhatsAppMediaPreviewService {
  private readonly recent = new Map<string, number[]>();
  constructor(private readonly durable: DurableWhatsAppService, private readonly policy: PolicyGateway, private readonly audit: WhatsAppMediaPreviewAudit,
    private readonly provider?: WhatsAppMediaProvider, private readonly limits = { perWindow: 20, windowMs: 10 * 60000, timeoutMs: 15000 }, private readonly now = Date.now) {}

  async preview(scope: AuthenticatedScope, connectionId: string, providerMessageId: string): Promise<WhatsAppMediaPreview> {
    const result = await this.content(scope, connectionId, providerMessageId, 'image');
    return { status: 'verified', contentType: result.contentType as WhatsAppPreviewImageType, bytes: result.bytes };
  }

  /** Image preview, audio playback or document download of a saved incoming attachment; same ownership, policy, verification and audit. */
  async content(scope: AuthenticatedScope, connectionId: string, providerMessageId: string, expected?: WhatsAppMediaKind): Promise<WhatsAppMediaContent> {
    const caller = { ...scope };
    if (!caller.sessionTokenHash || caller.role === 'viewer'
      || !this.policy.evaluate(caller, { actionName: 'whatsapp.media.preview', parameters: { connectionId, providerMessageId } }).allowed) throw new ForbiddenError('WhatsApp media preview denied.');
    // Ownership first: an unknown, foreign or wrong-kind message is denied before any provider I/O or audit.
    const saved = await this.durable.mediaReference(caller, connectionId, providerMessageId).catch(error => { throw error instanceof AppError ? error : new ForbiddenError('WhatsApp media preview denied.'); });
    if (expected && saved.kind !== expected) throw new ForbiddenError('WhatsApp media preview denied.');
    const refuse = async (outcome: WhatsAppMediaFailure | 'rate_limited') => {
      await this.audit(caller, 'whatsapp.media.preview_refused', { connectionId, providerMessageId, outcome, kind: saved.kind });
      if (outcome === 'not_configured') return new AppError('WhatsApp media access is not set up.', 'WHATSAPP_MEDIA_NOT_CONFIGURED', 503);
      if (outcome === 'rate_limited') return new AppError('Too many attachment requests. Try again later.', 'WHATSAPP_MEDIA_RATE_LIMITED', 429);
      return new AppError('The attachment could not be verified.', 'WHATSAPP_MEDIA_UNVERIFIED', 502);
    };
    if (!this.provider) throw await refuse('not_configured');
    const key = caller.workspaceId + ':' + caller.userId, at = this.now();
    const window = (this.recent.get(key) ?? []).filter(t => at - t < this.limits.windowMs);
    if (window.length >= this.limits.perWindow) { this.recent.set(key, window); throw await refuse('rate_limited'); }
    this.recent.set(key, [...window, at]);
    let contentType: string, bytes: Buffer;
    try {
      const download = await this.provider.download(saved.mediaId, AbortSignal.timeout(this.limits.timeoutMs), WHATSAPP_MEDIA_MAX_BYTES[saved.kind]);
      contentType = verifyWhatsAppMedia(saved.kind, download, saved); bytes = download.bytes;
    } catch (error) {
      throw await refuse(error instanceof WhatsAppMediaError ? error.reason : 'unavailable');
    }
    // Fail closed: if the audit cannot be written, no bytes leave the server.
    await this.audit(caller, saved.kind === 'image' ? 'whatsapp.media.previewed' : 'whatsapp.media.downloaded', { connectionId, providerMessageId, outcome: 'verified', kind: saved.kind, bytes: bytes.length, mimeType: contentType });
    return { status: 'verified', kind: saved.kind, contentType, bytes, ...(saved.filename ? { filename: saved.filename } : {}) };
  }
}

/** Audit through the existing RLS-protected audit table, re-checking the live session. No new table or migration. */
export function createWhatsAppMediaPreviewAudit(db: TransactionalDbClient): WhatsAppMediaPreviewAudit {
  return (scope, action, details) => db.withScopedTransaction(scope, async tx => {
    const { rows } = await tx.query<{ workspace_id: string; user_id: string; role: string }>('SELECT workspace_id, user_id, role FROM public.resolve_session_scope($1)', [scope.sessionTokenHash]);
    const current = rows[0];
    if (!current || current.workspace_id !== scope.workspaceId || current.user_id !== scope.userId || !['owner', 'admin', 'member'].includes(current.role)) throw new ForbiddenError('WhatsApp media preview denied.');
    await new AuditEventRepository(tx).create(scope.workspaceId, action, 'whatsapp_media', details, scope.userId, details.connectionId);
  });
}
