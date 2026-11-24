import { ApiRequestError, getCsrfToken, request } from './api';
import { isN8nWhatsAppContactsUpdate, isN8nWhatsAppContactsUpdated, isN8nWhatsAppTemplateDraftRequest, isN8nWhatsAppMediaDraftRequest, isN8nWhatsAppPreparedDraft, isN8nWhatsAppMediaUpload, type N8nWhatsAppPreparedDraft, type N8nWhatsAppTemplateDraftRequest, type N8nWhatsAppMediaUpload } from '../../../packages/contracts/src/whatsapp-n8n';
import { isMetaWhatsAppAnySendInput } from '../../../packages/contracts/src/meta-whatsapp';
import { isWhatsAppUploadAuthorizationDraft, type WhatsAppUploadAuthorizationDraft } from '../../../packages/contracts/src/whatsapp-upload';
// Browser-safe leaf contracts: reuse existing workspace schemas and interpreted validation (no eval).
import { isN8nWhatsAppConnections, isN8nWhatsAppContacts, isN8nWhatsAppTemplates, type N8nWhatsAppTemplates, isN8nWhatsAppInbox, isN8nWhatsAppReceipt, isN8nWhatsAppReplyDraft, type N8nWhatsAppContacts, type N8nWhatsAppConnections, type N8nWhatsAppInbox, type N8nWhatsAppInboxQuery, type N8nWhatsAppReceipt, type N8nWhatsAppReplyDraft } from '../../../packages/contracts/src/whatsapp-n8n';
export type StoredConnection = N8nWhatsAppConnections['connections'][number];
export type PreparedDraft = N8nWhatsAppReplyDraft | N8nWhatsAppPreparedDraft;
export type ContactUpdate = { id: string; displayName?: string; phoneE164?: string; optedIn: boolean };
export type MediaDraft = N8nWhatsAppMediaUpload['media'] & { caption?: string };
const base = '/api/v1/connectors/whatsapp/n8n/durable';
const invalid = () => new ApiRequestError(502, 'Stored WhatsApp data is unavailable.');
const masked = (value: string) => /^\+[0-9* ]{4,31}$/.test(value) && value.includes('*') && !/\d{7,}/.test(value);
const safeAttachment = (m: N8nWhatsAppInbox['messages'][number]) => {
  const a = m.attachment; if (!a) return true;
  if (m.direction !== 'inbound' || (a.filename !== undefined && (a.kind !== 'document' || /[\u0000-\u001f\u007f/\\]/.test(a.filename)))) return false;
  return a.kind === 'image' ? a.mimeType.startsWith('image/') : a.kind === 'audio' ? a.mimeType.startsWith('audio/') : /^(application|text)\//.test(a.mimeType);
};
export async function loadStoredWhatsAppConnections(signal?: AbortSignal): Promise<N8nWhatsAppConnections> {
  const data = await request<unknown>(base + '/connections', { signal, cache: 'no-store' });
  if (!isN8nWhatsAppConnections(data) || new Set(data.connections.map(c => c.connectionId)).size !== data.connections.length) throw invalid();
  return data;
}
export async function loadStoredWhatsAppInbox(connection: StoredConnection, query: N8nWhatsAppInboxQuery, signal?: AbortSignal): Promise<N8nWhatsAppInbox> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(connection.connectionId) || connection.disconnected || !Number.isSafeInteger(connection.revision) || connection.revision < 1) throw invalid();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!['query', 'recipientId', 'pageSize', 'pageToken'].includes(key)) throw invalid();
    if (value !== undefined) params.set(key, String(value));
  }
  if ((query.query?.length ?? 0) > 256) throw invalid();
  const data = await request<unknown>(base + '/' + encodeURIComponent(connection.connectionId) + '/inbox?' + params, { signal, cache: 'no-store' });
  if (!isN8nWhatsAppInbox(data) || data.connectionId !== connection.connectionId || data.revision !== connection.revision
    || data.messages.some(m => !safeAttachment(m))
    || data.messages.some(m => !masked(m.maskedPhone) || !Number.isFinite(Date.parse(m.timestamp)) || (m.deliveryEvents !== undefined && (m.direction !== 'outbound' || !m.providerMessageId || new Set(m.deliveryEvents.map(e => e.status)).size !== m.deliveryEvents.length || m.deliveryEvents.some(e => !Number.isFinite(Date.parse(e.timestamp)) || new Date(e.timestamp).toISOString() !== e.timestamp))))
    || data.conversations.some(c => !masked(c.maskedPhone) || !Number.isFinite(Date.parse(c.lastMessageAt)) || (c.contactName !== undefined && (!c.contactName.trim() || c.contactName.length > 80 || /\+?\d{7,}/.test(c.contactName))))
    || new Set(data.messages.map(m => m.id)).size !== data.messages.length
    || (data.nextPageToken !== null && !/^[a-f0-9]{64}\.\d{1,4}$/.test(data.nextPageToken))
    || (query.recipientId && data.messages.some(m => m.recipientId !== query.recipientId))) throw invalid();
  return data;
}
// Reply preparation: server-built draft -> owner approval -> reserved as "Prepared, not sent". Sending stays disabled.
const connectionPath = (c: StoredConnection) => { if (!/^[a-zA-Z0-9_-]{1,128}$/.test(c.connectionId) || c.disconnected) throw invalid(); return base + '/' + encodeURIComponent(c.connectionId); };
export async function prepareStoredWhatsAppReply(c: StoredConnection, input: { recipientId: string; bodyText: string; replyToProviderMessageId?: string }): Promise<N8nWhatsAppReplyDraft> {
  const data = await request<unknown>(connectionPath(c) + '/reply-drafts', { method: 'POST', body: JSON.stringify(input), cache: 'no-store' });
  if (!isN8nWhatsAppReplyDraft(data) || data.draft.connectionId !== c.connectionId || data.draft.connectionRevision !== c.revision || data.draft.recipientId !== input.recipientId || data.draft.bodyText !== input.bodyText) throw invalid();
  return data;
}
export async function requestWhatsAppReplyApproval(prepared: PreparedDraft | WhatsAppUploadAuthorizationDraft): Promise<string> {
  const data = await request<{ id?: unknown; status?: unknown; actionName?: unknown }>('/api/v1/approvals', { method: 'POST', body: JSON.stringify({ actionName: prepared.actionName, actionParams: prepared.draft, riskLevel: prepared.riskLevel, ttlSeconds: 3600 }) });
  if (typeof data?.id !== 'string' || !/^[0-9a-f-]{36}$/.test(data.id) || data.status !== 'pending' || data.actionName !== prepared.actionName) throw invalid();
  return data.id;
}
export async function approveAndReserveWhatsAppReply(c: StoredConnection, prepared: PreparedDraft, approvalId: string): Promise<N8nWhatsAppReceipt> {
  if (!isN8nWhatsAppPreparedDraft(prepared) || !isMetaWhatsAppAnySendInput(prepared.draft) || prepared.draft.connectionId !== c.connectionId || prepared.draft.connectionRevision !== c.revision) throw invalid();
  const decided = await request<{ status?: unknown }>('/api/v1/approvals/' + encodeURIComponent(approvalId) + '/decide', { method: 'POST', body: JSON.stringify({ status: 'approved' }) });
  if (decided?.status !== 'approved') throw invalid();
  const receipt = await request<unknown>(connectionPath(c) + '/dispatches', { method: 'POST', body: JSON.stringify({ draft: prepared.draft, approvalId }), cache: 'no-store' });
  if (!isN8nWhatsAppReceipt(receipt) || receipt.verified !== false || receipt.providerMessageId !== null) throw invalid();
  return receipt;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function checkedPrepared(data: unknown, c: StoredConnection, recipientId: string): N8nWhatsAppPreparedDraft {
  if (!isN8nWhatsAppPreparedDraft(data) || !isMetaWhatsAppAnySendInput(data.draft) || data.draft.connectionId !== c.connectionId || data.draft.connectionRevision !== c.revision || data.draft.recipientId !== recipientId) throw invalid();
  return data;
}
export async function prepareStoredWhatsAppTemplate(c: StoredConnection, input: N8nWhatsAppTemplateDraftRequest): Promise<N8nWhatsAppPreparedDraft> {
  if (!isN8nWhatsAppTemplateDraftRequest(input)) throw invalid();
  const data = checkedPrepared(await request<unknown>(connectionPath(c) + '/template-drafts', { method: 'POST', body: JSON.stringify(input), cache: 'no-store' }), c, input.recipientId);
  if (!('template' in data.draft) || data.draft.template.name !== input.name || data.draft.template.language !== input.language || !same(data.draft.template.bodyParams ?? [], input.bodyParams ?? []) || !same(data.draft.template.headerParams ?? [], input.headerParams ?? [])) throw invalid();
  return data;
}
export async function prepareStoredWhatsAppMedia(c: StoredConnection, input: { recipientId: string; media: MediaDraft }): Promise<N8nWhatsAppPreparedDraft> {
  if (!isN8nWhatsAppMediaDraftRequest(input)) throw invalid();
  const data = checkedPrepared(await request<unknown>(connectionPath(c) + '/media-drafts', { method: 'POST', body: JSON.stringify(input), cache: 'no-store' }), c, input.recipientId);
  if (!('media' in data.draft) || Object.keys(input.media).some(key => (input.media as any)[key] !== (data.draft as any).media[key]) || Object.keys(data.draft.media).length !== Object.keys(input.media).length) throw invalid();
  return data;
}
export async function saveStoredWhatsAppContacts(c: StoredConnection, input: { contacts: ContactUpdate[] }): Promise<{ connectionId: string; revision: number; contacts: number }> {
  if (!isN8nWhatsAppContactsUpdate(input) || new Set(input.contacts.map(x => x.id)).size !== input.contacts.length) throw invalid();
  const data = await request<unknown>(connectionPath(c) + '/contacts', { method: 'PUT', body: JSON.stringify(input), cache: 'no-store' });
  if (!isN8nWhatsAppContactsUpdated(data)) throw invalid();
  const result = data as { connectionId: string; revision: number; contacts: number };
  if (result.connectionId !== c.connectionId || result.revision !== c.revision + 1 || result.contacts !== input.contacts.length) throw invalid();
  return result;
}
export async function confirmStoredWhatsAppAppointment(c: StoredConnection, recipientId: string): Promise<{ status: string; calendlyUrl?: string; bookingLinkSent?: boolean; preparedConfirmationReply?: string }> {
  const data = await request<unknown>(connectionPath(c) + '/appointments/confirm', {
    method: 'POST',
    body: JSON.stringify({ recipientId }),
    cache: 'no-store'
  });
  return data as any;
}
export async function declineStoredWhatsAppAppointment(c: StoredConnection, recipientId: string): Promise<{ status: string }> {
  const data = await request<unknown>(connectionPath(c) + '/appointments/decline', {
    method: 'POST',
    body: JSON.stringify({ recipientId }),
    cache: 'no-store'
  });
  return data as any;
}
const uploadKinds: Record<string, 'image' | 'audio' | 'document'> = {
  'image/jpeg': 'image', 'image/png': 'image', 'audio/ogg': 'audio', 'audio/mpeg': 'audio', 'audio/aac': 'audio', 'audio/amr': 'audio', 'audio/mp4': 'audio',
  'application/pdf': 'document', 'text/plain': 'document', 'application/msword': 'document', 'application/vnd.ms-excel': 'document', 'application/vnd.ms-powerpoint': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document'
};
export function validateWhatsAppFile(file: Pick<File, 'name' | 'type' | 'size'>): 'image' | 'audio' | 'document' {
  const kind = uploadKinds[file.type], max = (kind === 'image' ? 5 : kind === 'audio' ? 16 : 20) * 1024 * 1024;
  if (!kind || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > max || !file.name?.trim() || file.name.length > 160 || /[\u0000-\u001f\u007f/\\]/.test(file.name)) throw new ApiRequestError(400, 'Choose a supported file within the size limit.');
  return kind;
}
export async function prepareStoredWhatsAppUpload(c: StoredConnection, file: File): Promise<WhatsAppUploadAuthorizationDraft> {
  validateWhatsAppFile(file);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
  const description = { filename: file.name, mimeType: file.type, bytes: file.size, sha256, idempotencyKey: crypto.randomUUID() };
  const data = await request<unknown>(connectionPath(c) + '/media-upload-drafts', { method: 'POST', body: JSON.stringify(description), cache: 'no-store' });
  if (!isWhatsAppUploadAuthorizationDraft(data) || data.draft.connectionId !== c.connectionId || data.draft.connectionRevision !== c.revision || Object.entries(description).some(([k, v]) => (data.draft as any)[k] !== v)) throw invalid();
  return data;
}
export async function approveWhatsAppUpload(approvalId: string): Promise<void> {
  const data = await request<{ status?: string }>('/api/v1/approvals/' + encodeURIComponent(approvalId) + '/decide', { method: 'POST', body: JSON.stringify({ status: 'approved' }) });
  if (data?.status !== 'approved') throw invalid();
}
export async function uploadStoredWhatsAppFile(c: StoredConnection, file: File, authorization?: { approvalId: string; idempotencyKey: string }): Promise<N8nWhatsAppMediaUpload> {
  const kind = validateWhatsAppFile(file), path = connectionPath(c);
  if (!authorization || !/^[a-f0-9-]{36}$/i.test(authorization.approvalId) || !/^[a-zA-Z0-9_-]{8,128}$/.test(authorization.idempotencyKey)) throw invalid();
  const headers = new Headers({ 'Content-Type': 'application/octet-stream', 'x-thaara-file-type': file.type, 'x-thaara-file-name': encodeURIComponent(file.name) });
  headers.set('x-thaara-upload-approval', authorization.approvalId); headers.set('x-thaara-idempotency-key', authorization.idempotencyKey);
  const csrf = getCsrfToken(); if (csrf) headers.set('x-csrf-token', csrf);
  const res = await fetch(path + '/media-uploads', { method: 'POST', body: file, headers, credentials: 'include', cache: 'no-store', redirect: 'error' });
  if (!res.ok) throw new ApiRequestError(res.status, res.status === 503 ? 'File upload is not set up yet.' : 'The file could not be safely uploaded.');
  const data: unknown = await res.json();
  if (!isN8nWhatsAppMediaUpload(data) || data.media.kind !== kind || data.media.mimeType !== file.type || (kind === 'audio' && data.media.filename !== undefined)) throw invalid();
  return data;
}
// Image preview (Step 108.22): the server verifies and audits; the browser re-checks type, size and magic bytes before display.
export const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
export type ImagePreviewFailure = 'not_configured' | 'denied' | 'rate_limited' | 'unverified';
export class ImagePreviewError extends Error { constructor(readonly reason: ImagePreviewFailure) { super('Image preview ' + reason); } }
export async function loadStoredWhatsAppImagePreview(c: StoredConnection, providerMessageId: string, call: typeof fetch = fetch): Promise<Blob> {
  if (!/^wamid\.[a-zA-Z0-9._=+/-]{1,250}$/.test(providerMessageId)) throw new ImagePreviewError('denied');
  const headers = new Headers({ Accept: 'image/jpeg, image/png', 'Content-Type': 'application/json' });
  const csrf = getCsrfToken(); if (csrf) headers.set('x-csrf-token', csrf);
  let res: Response;
  try { res = await call(connectionPath(c) + '/media/' + encodeURIComponent(providerMessageId) + '/preview', { method: 'POST', body: '{}', headers, credentials: 'include', cache: 'no-store', redirect: 'error' }); }
  catch { throw new ImagePreviewError('unverified'); }
  if (!res.ok) throw new ImagePreviewError(res.status === 503 ? 'not_configured' : res.status === 401 || res.status === 403 ? 'denied' : res.status === 429 ? 'rate_limited' : 'unverified');
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const bytes = new Uint8Array(await res.arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b);
  if (!bytes.length || bytes.length > PREVIEW_MAX_BYTES || !((type === 'image/jpeg' && jpeg) || (type === 'image/png' && png))) throw new ImagePreviewError('unverified');
  return new Blob([bytes], { type });
}
// Documents (download only) and audio (inline player). The server verifies type, size and fingerprint and audits each request.
export const ATTACHMENT_LIMITS = { document: 20 * 1024 * 1024, audio: 16 * 1024 * 1024 } as const;
const ATTACHMENT_TYPES: Record<'document' | 'audio', string[]> = {
  document: ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  audio: ['audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/amr', 'audio/mp4']
};
export async function loadStoredWhatsAppAttachment(c: StoredConnection, providerMessageId: string, kind: 'document' | 'audio', call: typeof fetch = fetch): Promise<{ blob: Blob; filename: string }> {
  if (!/^wamid\.[a-zA-Z0-9._=+/-]{1,250}$/.test(providerMessageId)) throw new ImagePreviewError('denied');
  const headers = new Headers({ Accept: ATTACHMENT_TYPES[kind].join(', '), 'Content-Type': 'application/json' });
  const csrf = getCsrfToken(); if (csrf) headers.set('x-csrf-token', csrf);
  let res: Response;
  try { res = await call(connectionPath(c) + '/media/' + encodeURIComponent(providerMessageId) + '/content', { method: 'POST', body: '{}', headers, credentials: 'include', cache: 'no-store', redirect: 'error' }); }
  catch { throw new ImagePreviewError('unverified'); }
  if (!res.ok) throw new ImagePreviewError(res.status === 503 ? 'not_configured' : res.status === 401 || res.status === 403 ? 'denied' : res.status === 429 ? 'rate_limited' : 'unverified');
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const disposition = res.headers.get('content-disposition') ?? '';
  if (res.headers.get('x-whatsapp-media-kind') !== kind || !ATTACHMENT_TYPES[kind].includes(type) || (kind === 'document' && !disposition.startsWith('attachment;'))) throw new ImagePreviewError('unverified');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length || bytes.length > ATTACHMENT_LIMITS[kind]) throw new ImagePreviewError('unverified');
  let filename = /filename="([^"]{1,80})"/.exec(disposition)?.[1] ?? 'whatsapp-' + kind;
  const encoded = /filename\*=UTF-8''([^;]{1,600})/.exec(disposition)?.[1];
  if (encoded) { try { filename = decodeURIComponent(encoded); } catch { /* keep fallback name */ } }
  filename = filename.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').slice(0, 160) || 'whatsapp-' + kind;
  return { blob: new Blob([bytes], { type }), filename };
}
export type StoredTemplate = N8nWhatsAppTemplates['templates'][number];
export async function loadStoredWhatsAppTemplates(c: StoredConnection): Promise<StoredTemplate[]> {
  const data = await request<unknown>(connectionPath(c) + '/templates', { cache: 'no-store' });
  if (!isN8nWhatsAppTemplates(data) || data.connectionId !== c.connectionId) throw invalid();
  return data.templates;
}
/** Fills {{n}} placeholders for preview only; values are plain text and never interpreted. */
export function fillTemplate(text: string, values: string[]): string { return text.replace(/\{\{(\d{1,2})\}\}/g, (m, n) => { const v = values[Number(n) - 1]; return v ? v : m; }); }
export type StoredContact = N8nWhatsAppContacts['contacts'][number];
export async function loadStoredWhatsAppContacts(c: StoredConnection, signal?: AbortSignal): Promise<StoredContact[]> {
  const data = await request<unknown>(connectionPath(c) + '/contacts', { signal, cache: 'no-store' });
  if (!isN8nWhatsAppContacts(data) || data.connectionId !== c.connectionId || data.revision !== c.revision || data.contacts.some(x => !masked(x.maskedPhone) || /\+?\d{7,}/.test(x.contactName))
    || new Set(data.contacts.map(x => x.recipientId)).size !== data.contacts.length) throw invalid();
  return data.contacts;
}
// "New" markers are per device: the last time this browser opened a conversation. Not a provider read receipt.
const seenKey = (connectionId: string, recipientId: string) => 'thaara.wa.seen.' + connectionId + '.' + recipientId;
export function lastSeen(connectionId: string, recipientId: string): number { try { return Number(localStorage.getItem(seenKey(connectionId, recipientId))) || 0; } catch { return 0; } }
export function markSeen(connectionId: string, recipientId: string, at = Date.now()) { try { localStorage.setItem(seenKey(connectionId, recipientId), String(at)); } catch { /* storage unavailable: markers simply stay */ } }
export type ReplyState = { phase: 'idle' | 'working' | 'awaiting_upload_approval' | 'awaiting_approval' | 'prepared' | 'failed'; prepared?: PreparedDraft; uploadReview?: WhatsAppUploadAuthorizationDraft; uploadAttempted?: boolean; approvalId?: string; receipt?: N8nWhatsAppReceipt };
export interface StoredWhatsAppState {
  connections: StoredConnection[]; selectedId: string | null; recipientId: string | null; query: string;
  data: N8nWhatsAppInbox | null; loading: boolean; error: 'unauthorized' | 'unavailable' | 'changed' | null; reply: ReplyState;
  /** Chat list kept from the latest all-conversations load, so opening one chat keeps the list visible. */
  conversations: N8nWhatsAppInbox['conversations']; recent: N8nWhatsAppInbox['messages']; contacts: StoredContact[] | null;
}
export const initialStoredWhatsAppState = (role: string): StoredWhatsAppState => ({ connections: [], selectedId: null, recipientId: null, query: '', data: null, loading: false, error: ['owner', 'admin', 'member'].includes(role) ? null : 'unauthorized', reply: { phase: 'idle' }, conversations: [], recent: [], contacts: null });
interface InboxApi { connections: typeof loadStoredWhatsAppConnections; inbox: typeof loadStoredWhatsAppInbox; prepare?: typeof prepareStoredWhatsAppReply; requestApproval?: typeof requestWhatsAppReplyApproval; approve?: typeof approveAndReserveWhatsAppReply; contacts?: typeof loadStoredWhatsAppContacts; prepareTemplate?: typeof prepareStoredWhatsAppTemplate; prepareMedia?: typeof prepareStoredWhatsAppMedia; upload?: typeof uploadStoredWhatsAppFile; saveContacts?: typeof saveStoredWhatsAppContacts; prepareUpload?: typeof prepareStoredWhatsAppUpload; approveUpload?: typeof approveWhatsAppUpload; confirmAppointment?: typeof confirmStoredWhatsAppAppointment; declineAppointment?: typeof declineStoredWhatsAppAppointment; }
export function createStoredWhatsAppModel(role: string, notify: (state: StoredWhatsAppState) => void, api: InboxApi = { connections: loadStoredWhatsAppConnections, inbox: loadStoredWhatsAppInbox, confirmAppointment: confirmStoredWhatsAppAppointment, declineAppointment: declineStoredWhatsAppAppointment }) {
  let state = initialStoredWhatsAppState(role), disposed = false, generation = 0, operation = 0, contactsSaving = false, controller: AbortController | undefined;
  let pendingUpload: { file: File; caption: string; review: WhatsAppUploadAuthorizationDraft; approvalId: string } | undefined;
  const emit = (patch: Partial<StoredWhatsAppState>) => { if (!disposed) { state = { ...state, ...patch }; notify(state); } };
  const begin = () => { controller?.abort(); controller = new AbortController(); return { id: ++generation, signal: controller.signal }; };
  const current = (id: number) => !disposed && generation === id;
  const fail = (error: unknown) => {
    const unauthorized = error instanceof ApiRequestError && [401, 403].includes(error.status);
    if (unauthorized) ++operation;
    emit({ data: null, loading: false, ...(unauthorized ? { connections: [], selectedId: null, recipientId: null, contacts: null, conversations: [], recent: [], reply: { phase: 'idle' as const } } : {}), error: unauthorized ? 'unauthorized' : error instanceof ApiRequestError && error.status === 409 ? 'changed' : 'unavailable' });
  };
  async function reload(append = false) {
    if (disposed || state.error === 'unauthorized') return;
    const connection = state.connections.find(c => c.connectionId === state.selectedId && !c.disconnected);
    if (!connection) { emit({ data: null, loading: false }); return; }
    const previous = append ? state.data : null, token = previous?.nextPageToken;
    if (append && !token) return;
    const run = begin(); emit({ loading: true, error: null, data: previous });
    try {
      const data = await api.inbox(connection, { query: state.query, ...(state.recipientId ? { recipientId: state.recipientId } : {}), pageSize: 20, ...(token ? { pageToken: token } : {}) }, run.signal);
      if (!current(run.id)) return;
      if (data.connectionId !== connection.connectionId || data.revision !== connection.revision) throw invalid();
      if (token && data.nextPageToken) {
        const [beforeHash, beforeOffset] = token.split('.'), [afterHash, afterOffset] = data.nextPageToken.split('.');
        if (beforeHash !== afterHash || !Number.isSafeInteger(Number(afterOffset)) || Number(afterOffset) <= Number(beforeOffset)) throw invalid();
      }
      const messages = previous ? [...previous.messages, ...data.messages] : data.messages;
      if (messages.length > 2000 || new Set(messages.map(m => m.id)).size !== messages.length) throw invalid();
      emit({ data: { ...data, messages }, loading: false, ...(!state.recipientId && !append ? { conversations: data.conversations, recent: data.messages } : {}) });
    } catch (error) { if (current(run.id)) fail(error); }
  }
  async function loadContacts() {
    const c = state.connections.find(x => x.connectionId === state.selectedId && !x.disconnected);
    if (!c || disposed) return;
    const version = generation;
    const active = () => !disposed && generation === version && state.selectedId === c.connectionId && state.connections.some(x => x.connectionId === c.connectionId && x.revision === c.revision);
    try { const contacts = await (api.contacts ?? loadStoredWhatsAppContacts)(c); if (active()) emit({ contacts }); }
    catch { if (active()) emit({ contacts: null }); }
  }
  async function prepare(work: (c: StoredConnection, recipientId: string, active: () => boolean) => Promise<PreparedDraft>) {
    const c = state.connections.find(x => x.connectionId === state.selectedId && !x.disconnected), recipientId = state.recipientId;
    if (disposed || contactsSaving || !['owner', 'admin', 'member'].includes(role) || !c || !recipientId || ['working', 'awaiting_approval', 'awaiting_upload_approval'].includes(state.reply.phase)) return;
    const version = ++operation;
    const active = () => !disposed && operation === version && state.selectedId === c.connectionId && state.recipientId === recipientId && state.connections.some(x => x.connectionId === c.connectionId && x.revision === c.revision && !x.disconnected);
    emit({ reply: { phase: 'working' } });
    try {
      const prepared = await work(c, recipientId, active);
      if (!active()) return;
      if (prepared.draft.connectionId !== c.connectionId || prepared.draft.connectionRevision !== c.revision || prepared.draft.recipientId !== recipientId) throw invalid();
      const approvalId = await (api.requestApproval ?? requestWhatsAppReplyApproval)(prepared);
      if (active()) emit({ reply: { phase: 'awaiting_approval', prepared, approvalId } });
    } catch { if (active()) emit({ reply: { phase: 'failed' } }); }
  }
  const model = {
    async load() {
      if (disposed) return;
      ++operation;
      pendingUpload = undefined;
      if (!['owner', 'admin', 'member'].includes(role)) { emit(initialStoredWhatsAppState(role)); return; }
      const selectedId = state.selectedId;
      const run = begin(); emit({ ...initialStoredWhatsAppState(role), loading: true });
      try {
        const catalog = await api.connections(run.signal); if (!current(run.id)) return;
        const available = catalog.connections.filter(c => !c.disconnected);
        const selected = available.find(c => c.connectionId === selectedId) ?? (available.length === 1 ? available[0] : undefined);
        emit({ connections: catalog.connections, selectedId: selected?.connectionId ?? null, loading: false });
        await reload(); void loadContacts();
      } catch (error) { if (current(run.id)) fail(error); }
    },
    async select(id: string) { if (disposed) return; pendingUpload = undefined; ++operation; begin(); emit({ selectedId: id, recipientId: null, query: '', data: null, error: null, reply: { phase: 'idle' }, conversations: [], recent: [], contacts: null }); await reload(); void loadContacts(); },
    /** Quiet refresh of the current view (keeps selection); skipped while a reply is being prepared. */
    async refresh() { if (disposed || state.loading || state.reply.phase === 'working' || !state.selectedId) return; await reload(); if (!state.recipientId) void loadContacts(); },
    async search(query: string) { if (disposed) return; begin(); emit({ query, data: null, error: null }); if (query.length > 256) { fail(invalid()); return; } await reload(); },
    async recipient(id: string | null) { if (disposed) return; pendingUpload = undefined; ++operation; begin(); emit({ recipientId: id, data: null, error: null, reply: { phase: 'idle' }, ...(id ? { query: '' } : {}) }); await reload(); },
    async prepareReply(bodyText: string, replyToProviderMessageId?: string) {
      if (!bodyText.trim() || bodyText.length > 4096) return;
      await prepare((c, recipientId) => (api.prepare ?? prepareStoredWhatsAppReply)(c, { recipientId, bodyText, ...(replyToProviderMessageId ? { replyToProviderMessageId } : {}) }));
    },
    async prepareTemplate(input: Omit<N8nWhatsAppTemplateDraftRequest, 'recipientId'>) { await prepare((c, recipientId) => (api.prepareTemplate ?? prepareStoredWhatsAppTemplate)(c, { ...input, recipientId })); },
    async prepareMedia(file: File, caption = '') {
      const c = state.connections.find(x => x.connectionId === state.selectedId && !x.disconnected), recipientId = state.recipientId;
      if (disposed || contactsSaving || !c || !recipientId || !['owner', 'admin', 'member'].includes(role) || !['idle', 'failed'].includes(state.reply.phase)) return;
      const version = ++operation, active = () => !disposed && version === operation && state.selectedId === c.connectionId && state.recipientId === recipientId;
      emit({ reply: { phase: 'working' } });
      try {
        const kind = validateWhatsAppFile(file);
        if (caption.length > 1024 || (kind === 'audio' && caption.trim())) throw invalid();
        const review = await (api.prepareUpload ?? prepareStoredWhatsAppUpload)(c, file);
        if (!active()) return;
        const approvalId = await (api.requestApproval ?? requestWhatsAppReplyApproval)(review);
        if (!active()) return;
        pendingUpload = { file, caption, review, approvalId };
        emit({ reply: { phase: 'awaiting_upload_approval', uploadReview: review, approvalId } });
      } catch { if (active()) emit({ reply: { phase: 'failed' } }); }
    },
    async approveUpload() {
      const c = state.connections.find(x => x.connectionId === state.selectedId && !x.disconnected), recipientId = state.recipientId, upload = pendingUpload;
      if (disposed || contactsSaving || !c || !recipientId || !upload || state.reply.phase !== 'awaiting_upload_approval' || upload.review.draft.connectionId !== c.connectionId || upload.review.draft.connectionRevision !== c.revision) return;
      const version = ++operation, active = () => !disposed && version === operation && state.selectedId === c.connectionId && state.recipientId === recipientId;
      let attempted = false;
      emit({ reply: { phase: 'working' } });
      try {
        await (api.approveUpload ?? approveWhatsAppUpload)(upload.approvalId);
        if (!active()) return;
        attempted = true;
        const uploaded = await (api.upload ?? uploadStoredWhatsAppFile)(c, upload.file, { approvalId: upload.approvalId, idempotencyKey: upload.review.draft.idempotencyKey });
        if (!active()) return;
        const prepared = await (api.prepareMedia ?? prepareStoredWhatsAppMedia)(c, { recipientId, media: { ...uploaded.media, ...(uploaded.media.kind !== 'audio' && upload.caption.trim() ? { caption: upload.caption.trim() } : {}) } });
        if (!active()) return;
        const approvalId = await (api.requestApproval ?? requestWhatsAppReplyApproval)(prepared);
        if (active()) { pendingUpload = undefined; emit({ reply: { phase: 'awaiting_approval', prepared, approvalId } }); }
      } catch { if (active()) emit({ reply: { phase: 'failed', uploadAttempted: attempted } }); }
    },
    async saveContacts(input: { contacts: ContactUpdate[] }): Promise<boolean> {
      const c = state.connections.find(x => x.connectionId === state.selectedId && !x.disconnected);
      if (disposed || contactsSaving || !['owner', 'admin'].includes(role) || !c || state.reply.phase === 'working') return false;
      contactsSaving = true;
      try { await (api.saveContacts ?? saveStoredWhatsAppContacts)(c, input); if (disposed || state.selectedId !== c.connectionId) return false; await model.load(); return true; }
      catch { return false; }
      finally { contactsSaving = false; }
    },
    async confirmAppointment(recipientId: string) {
      const c = state.connections.find(x => x.connectionId === state.selectedId && !x.disconnected);
      if (disposed || !['owner', 'admin'].includes(role) || !c) return;
      try {
        await (api.confirmAppointment ?? confirmStoredWhatsAppAppointment)(c, recipientId);
        await reload();
      } catch (error) {
        fail(error);
      }
    },
    async declineAppointment(recipientId: string) {
      const c = state.connections.find(x => x.connectionId === state.selectedId && !x.disconnected);
      if (disposed || !['owner', 'admin'].includes(role) || !c) return;
      try {
        await (api.declineAppointment ?? declineStoredWhatsAppAppointment)(c, recipientId);
        await reload();
      } catch (error) {
        fail(error);
      }
    },
    async approveReply() {
      const c = state.connections.find(x => x.connectionId === state.selectedId && !x.disconnected), r = state.reply, recipientId = state.recipientId;
      if (disposed || contactsSaving || !c || r.phase !== 'awaiting_approval' || !r.prepared || !r.approvalId || r.prepared.draft.connectionId !== c.connectionId || r.prepared.draft.connectionRevision !== c.revision || r.prepared.draft.recipientId !== recipientId) return;
      const version = ++operation;
      emit({ reply: { ...r, phase: 'working' } });
      try { const receipt = await (api.approve ?? approveAndReserveWhatsAppReply)(c, r.prepared, r.approvalId); if (disposed || version !== operation || state.selectedId !== c.connectionId || state.recipientId !== recipientId) return; emit({ reply: { phase: 'prepared', prepared: r.prepared, receipt } }); await reload();
        // In live mode, pick up WhatsApp's sent/delivered/read events soon after approval.
        if (state.data?.liveSendingEnabled) for (const ms of [4000, 12000, 30000]) setTimeout(() => { if (!disposed) void model.refresh(); }, ms); }
      catch { if (!disposed && version === operation && state.selectedId === c.connectionId && state.recipientId === recipientId) emit({ reply: { phase: 'failed' } }); }
    },
    discardReply() { if (!disposed && state.reply.phase !== 'working') { pendingUpload = undefined; ++operation; emit({ reply: { phase: 'idle' } }); } },
    next: () => reload(true),
    dispose() { disposed = true; pendingUpload = undefined; ++generation; ++operation; controller?.abort(); }
  };
  return model;
}
