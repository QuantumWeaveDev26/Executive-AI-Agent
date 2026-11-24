import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { ApprovalRequest, MetaProviderMessageIdSchema, MetaWhatsAppSendInput, MetaWhatsAppSendInputSchema, MetaWhatsAppTestConfig, MetaWhatsAppTestConfigSchema, MetaWhatsAppWebhookSchema, N8nWhatsAppProviderReceipt, N8nWhatsAppReceipt, computeCanonicalParameterHash } from '@thaara/contracts';
import { AuthenticatedScope } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import { PolicyGateway } from '@thaara/policy';
import { WhatsAppVault, maskPhoneNumber, sanitizeWhatsAppText } from './whatsapp.js';
import { advanceMetaTestReceipt } from './meta-whatsapp-test.js';
const Config = TypeCompiler.Compile(MetaWhatsAppTestConfigSchema), Draft = TypeCompiler.Compile(MetaWhatsAppSendInputSchema), Envelope = TypeCompiler.Compile(MetaWhatsAppWebhookSchema), MessageId = TypeCompiler.Compile(MetaProviderMessageIdSchema);
const unavailable = () => new AppError('n8n WhatsApp is not configured.', 'WHATSAPP_N8N_NOT_CONFIGURED', 503);
const denied = () => new ForbiddenError('n8n WhatsApp request denied.');
const invalid = () => new AppError('Invalid n8n WhatsApp request.', 'WHATSAPP_N8N_INVALID', 400);
const validSecret = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9_-]{32,256}$/.test(s);
function copy<T>(input: T): T { try { const json = JSON.stringify(input); if (Buffer.byteLength(json) > 131072) throw invalid(); return JSON.parse(json); } catch { throw invalid(); } }
function noClaims(value: unknown, depth = 0) { if (depth > 20) throw invalid(); if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { if (/^(workspace_?id|user_?id)$/i.test(k)) throw denied(); noClaims(v, depth + 1); } }
export interface N8nWhatsAppSubmitTransport { readonly mode: 'mock'; submit(dispatchId: string, revision: number): Promise<{ dispatchId: string; status: 'not_configured' | 'unverified' }>; }

/** Explicit mock fetch required; the production HTTP transport is deliberately not configured. */
export class N8nWhatsAppMockHttpTransport implements N8nWhatsAppSubmitTransport {
  readonly mode = 'mock' as const;
  #options: { url: string; resolveToken(): Promise<string>; fetch: typeof fetch };
  constructor(options: { url: string; resolveToken(): Promise<string>; fetch: typeof fetch }) {
    const u = new URL(options.url);
    if (process.env.NODE_ENV !== 'test' || typeof options.fetch !== 'function' || u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.port && u.port !== '443') || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) || u.hostname.endsWith('.localhost') || u.hostname.endsWith('.local') || u.pathname !== '/webhook/thaara-v2-dev-whatsapp-approved-1082') throw invalid();
    this.#options = { ...options };
  }
  async submit(dispatchId: string, revision: number) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(dispatchId) || !Number.isSafeInteger(revision) || revision < 1) throw invalid();
    try {
      const token = await this.#options.resolveToken(); if (!validSecret(token)) throw denied();
      const response = await this.#options.fetch(this.#options.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ dispatchId, connectionRevision: revision }) });
      if (!response.ok || !response.body) throw unavailable();
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 16384) { await reader.cancel(); throw unavailable(); } chunks.push(part.value); } } finally { reader.releaseLock(); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (data.dispatchId !== dispatchId || !['not_configured', 'unverified'].includes(data.status)) throw unavailable();
      return { dispatchId, status: data.status as 'not_configured' | 'unverified' };
    } catch { throw new AppError('n8n dispatch outcome is uncertain; do not retry.', 'WHATSAPP_N8N_UNVERIFIED', 502); }
  }
}
interface Options {
  binding: MetaWhatsAppTestConfig; vault: WhatsAppVault; relayToken: string; dispatchToken: string; policyGateway: PolicyGateway;
  authorize(scope: AuthenticatedScope): Promise<boolean>;
  resolveApproval(scope: AuthenticatedScope, id: string): Promise<ApprovalRequest | null>;
  audit(scope: AuthenticatedScope, action: string, details: Record<string, unknown>): Promise<void>;
  transport?: N8nWhatsAppSubmitTransport;
}
interface Message { providerMessageId: string; recipientId: string; senderMaskedPhone: string; textPreview: string; timestamp: string; mode: 'offline_test'; untrusted: true; }
interface RelayStatus { id: string; recipient_id: string; status: 'sent' | 'delivered' | 'read' | 'failed'; timestamp: string; }
interface Attempt { id: string; draft: MetaWhatsAppSendInput; approvalId: string; created: number; claimed: boolean; receipt: N8nWhatsAppReceipt; }

/** Dependency-injected, memory-only test bridge; no real credentials or live provider calls. */
export class N8nWhatsAppBridge {
  #binding?: MetaWhatsAppTestConfig; #vault?: WhatsAppVault; #policy?: PolicyGateway; #authorize?: Options['authorize']; #resolve?: Options['resolveApproval']; #audit?: Options['audit']; #transport?: N8nWhatsAppSubmitTransport;
  #active = false; #generation = 0; #messages = new Map<string, Message>(); #statuses = new Set<string>(); #pendingStatuses = new Map<string, RelayStatus>();
  #attempts = new Map<string, Attempt>(); #keys = new Map<string, { hash: string; id: string; promise: Promise<N8nWhatsAppReceipt> }>();
  constructor(options?: Options) {
    if (!options) return;
    if (process.env.NODE_ENV !== 'test') throw unavailable();
    if (!Config.Check(options.binding) || !validSecret(options.relayToken) || !validSecret(options.dispatchToken) || options.relayToken === options.dispatchToken || !options.vault || !options.policyGateway || typeof options.authorize !== 'function' || typeof options.resolveApproval !== 'function' || typeof options.audit !== 'function' || (options.transport && options.transport.mode !== 'mock') || new Set(options.binding.recipients.map(r => r.id)).size !== options.binding.recipients.length || new Set(options.binding.recipients.map(r => r.phoneE164)).size !== options.binding.recipients.length) throw invalid();
    this.#binding = copy(options.binding); this.#vault = options.vault; this.#policy = options.policyGateway; this.#authorize = options.authorize; this.#resolve = options.resolveApproval; this.#audit = options.audit; this.#transport = options.transport;
    this.#vault.set(this.#owner(), this.#purpose(), { relayToken: options.relayToken, dispatchToken: options.dispatchToken }); this.#active = true;
  }
  #owner(): AuthenticatedScope { if (!this.#binding) throw unavailable(); return { workspaceId: this.#binding.workspaceId, userId: this.#binding.userId, role: 'member', sessionTokenHash: 'offline-n8n-owner-binding' }; }
  #purpose() { return 'n8n_whatsapp:' + this.#binding!.connectionId + ':' + this.#binding!.revision; }
  #stable(generation: number, allowDisconnected = false) { if (generation !== this.#generation || (!this.#active && !allowDisconnected)) throw denied(); }
  async #fresh(scope: AuthenticatedScope, allowDisconnected = false) {
    const b = this.#binding; if (!b || !scope || scope.workspaceId !== b.workspaceId || scope.userId !== b.userId || !this.#policy!.evaluate(scope, { actionName: 'whatsapp.connection.status', parameters: {} }).allowed) throw denied();
    const snapshot = { ...scope }, generation = this.#generation;
    let active = false; try { active = await this.#authorize!({ ...snapshot }); } catch { throw denied(); }
    if (!active || scope.workspaceId !== snapshot.workspaceId || scope.userId !== snapshot.userId || scope.role !== snapshot.role || scope.sessionTokenHash !== snapshot.sessionTokenHash) throw denied();
    this.#stable(generation, allowDisconnected); return generation;
  }
  async #relay(connection: string, header: string) {
    if (!this.#active || !this.#binding) throw unavailable();
    const secret = this.#vault!.get<{ relayToken: string }>(this.#owner(), this.#purpose());
    if (connection !== this.#binding.connectionId || typeof header !== 'string' || header.length > 300 || !secret || !timingSafeEqual(createHash('sha256').update(header).digest(), createHash('sha256').update('Bearer ' + secret.relayToken).digest())) throw denied();
    return this.#fresh(this.#owner());
  }
  async #record(scope: AuthenticatedScope, action: string, details: Record<string, unknown>) { try { await this.#audit!({ ...scope }, action, details); } catch { throw new AppError('n8n WhatsApp audit unavailable.', 'WHATSAPP_N8N_AUDIT', 503); } }
  #time(seconds: string) { const n = Number(seconds) * 1000; if (!Number.isSafeInteger(n) || n < Date.now() - 604800000 || n > Date.now() + 300000) throw invalid(); return n; }
  async #approved(scope: AuthenticatedScope, draft: MetaWhatsAppSendInput, approvalId: string) {
    if (!approvalId || !Draft.Check(draft)) throw denied();
    let a: ApprovalRequest | null; try { a = copy(await this.#resolve!(scope, approvalId)); } catch { throw denied(); }
    await this.#fresh(scope);
    if (!a || a.id !== approvalId || !a.actionParams || !Number.isFinite(Date.parse(a.expiresAt)) || !this.#policy!.evaluate(scope, { actionName: 'whatsapp.meta.messages.send', parameters: draft, idempotencyKey: draft.idempotencyKey }, a, scope.userId).allowed) throw denied();
    const b = this.#binding!, r = b.recipients.find(r => r.id === draft.recipientId);
    if (draft.connectionId !== b.connectionId || draft.connectionRevision !== b.revision || draft.senderPhoneNumberId !== b.phoneNumberId || !r?.optedIn) throw denied();
    const messages = [...this.#messages.values()].filter(m => m.recipientId === r.id), latest = Math.max(0, ...messages.map(m => Date.parse(m.timestamp)));
    if (!latest || latest > Date.now() || Date.now() - latest >= 86400000 || (draft.replyToProviderMessageId && !messages.some(m => m.providerMessageId === draft.replyToProviderMessageId))) throw denied();
    return r;
  }
  async status(scope: AuthenticatedScope) { if (this.#binding) await this.#fresh(scope, true); return { transport: 'n8n' as const, mode: this.#binding ? 'offline_test' as const : 'disabled' as const, configured: this.#active, liveSendingEnabled: false as const, storage: this.#binding ? 'temporary_test_memory' as const : 'not_configured' as const }; }
  async history(scope: AuthenticatedScope) { await this.#fresh(scope); return [...this.#messages.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(m => ({ ...m })); }

  async ingest(connection: string, header: string, input: unknown) {
    const event = copy(input), generation = await this.#relay(connection, header); noClaims(event);
    const data = event as { field?: string };
    // Official Trigger emits change.value + field, dropping the original WABA envelope.
    // The WABA below is a trusted validation context, NOT a reconstructed signature proof.
    const wrapped = { object: 'whatsapp_business_account', entry: [{ id: this.#binding!.businessAccountId, changes: [{ field: data?.field, value: event }] }] };
    if (!Envelope.Check(wrapped)) throw invalid();
    const value = wrapped.entry[0]!.changes[0]!.value;
    if (value.metadata.phone_number_id !== this.#binding!.phoneNumberId || (!value.messages && !value.statuses)) throw denied();
    const staged: Message[] = [];
    for (const message of value.messages ?? []) { const r = this.#binding!.recipients.find(r => r.phoneE164.slice(1) === message.from); if (!r) throw denied(); staged.push({ providerMessageId: message.id, recipientId: r.id, senderMaskedPhone: maskPhoneNumber(r.phoneE164), textPreview: sanitizeWhatsAppText(message.text.body), timestamp: new Date(this.#time(message.timestamp)).toISOString(), mode: 'offline_test', untrusted: true }); }
    const statuses = (value.statuses ?? []).map(s => { this.#time(s.timestamp); if (!this.#binding!.recipients.some(r => r.phoneE164.slice(1) === s.recipient_id)) throw denied(); return s; });
    await this.#record(this.#owner(), 'whatsapp.n8n.relay_validated', { messages: staged.length, statuses: statuses.length }); await this.#fresh(this.#owner()); this.#stable(generation);
    const unique = new Map(staged.filter(m => !this.#messages.has(m.providerMessageId)).map(m => [m.providerMessageId, m]));
    const unseen = new Map<string, (typeof statuses)[number]>();
    for (const s of statuses) { const key = JSON.stringify([s.id, s.recipient_id, s.status, s.timestamp]); if (!this.#statuses.has(key)) unseen.set(key, s); }
    if (this.#messages.size + unique.size > 1000 || this.#statuses.size + unseen.size > 2000) throw unavailable();
    const updates = new Map<Attempt, N8nWhatsAppReceipt>(), unmatched = new Map<string, RelayStatus>(); let updateCount = 0;
    for (const [key, s] of unseen) {
      const attempt = [...this.#attempts.values()].find(a => a.receipt.providerMessageId === s.id);
      if (attempt) {
        const recipient = this.#binding!.recipients.find(r => r.id === attempt.draft.recipientId)!;
        const previous = updates.get(attempt) ?? attempt.receipt;
        updates.set(attempt, { ...previous, ...advanceMetaTestReceipt(previous, { providerMessageId: s.id, recipientAddress: s.recipient_id, status: s.status }, recipient.phoneE164.slice(1)) }); updateCount++;
      } else unmatched.set(key, s);
    }
    for (const [attempt, receipt] of updates) attempt.receipt = receipt;
    for (const [key, status] of unmatched) this.#pendingStatuses.set(key, status);
    for (const key of unseen.keys()) this.#statuses.add(key);
    for (const [id, m] of unique) this.#messages.set(id, m);
    return { acceptedMessages: unique.size, statusUpdates: updateCount, duplicates: staged.length + statuses.length - unique.size - unseen.size };
  }
  async dispatch(scope: AuthenticatedScope, input: MetaWhatsAppSendInput, approvalId?: string): Promise<N8nWhatsAppReceipt> {
    if (!this.#binding) return { transport: 'n8n', mode: 'offline_test', status: 'not_configured', dispatchId: null, providerMessageId: null, verified: false };
    const draft = copy(input), caller = { ...scope }, generation = await this.#fresh(scope); await this.#approved(caller, draft, approvalId ?? ''); this.#stable(generation);
    const hash = computeCanonicalParameterHash(draft), existing = this.#keys.get(draft.idempotencyKey);
    if (existing) { if (existing.hash !== hash) throw denied(); const result = await existing.promise; await this.#fresh(scope); this.#stable(generation); return { ...(this.#attempts.get(existing.id)?.receipt ?? result) }; }
    if (this.#keys.size >= 1000) throw unavailable();
    const id = randomUUID(), record: Attempt = { id, draft, approvalId: approvalId!, created: Date.now(), claimed: false, receipt: { transport: 'n8n', mode: 'offline_test', dispatchId: id, providerMessageId: null, status: 'not_configured', verified: false } }; this.#attempts.set(id, record);
    let attempted = false;
    const promise = (async () => {
      await this.#record(caller, 'whatsapp.n8n.dispatch_prepared', { dispatchId: id, approvalId }); await this.#approved(caller, draft, approvalId!); await this.#fresh(scope); this.#stable(generation);
      if (this.#transport) { attempted = true; try { const result = await this.#transport.submit(id, this.#binding!.revision); if (result.dispatchId !== id || !['not_configured', 'unverified'].includes(result.status)) throw denied(); if (!record.receipt.providerMessageId) record.receipt.status = result.status; } catch { if (!record.receipt.providerMessageId) record.receipt.status = 'unverified'; } }
      await this.#fresh(scope); this.#stable(generation); return { ...record.receipt };
    })(); const entry = { hash, id, promise }; this.#keys.set(draft.idempotencyKey, entry);
    try { return { ...await promise }; } catch (error) { if (!attempted && this.#keys.get(draft.idempotencyKey) === entry) { this.#keys.delete(draft.idempotencyKey); this.#attempts.delete(id); } throw error; }
  }
  async claim(connection: string, header: string, dispatchId: string, revision?: number) {
    const generation = await this.#relay(connection, header), record = this.#attempts.get(dispatchId);
    if ((revision !== undefined && revision !== this.#binding!.revision) || !record || record.claimed || Date.now() - record.created >= 60000) throw denied();
    const r = await this.#approved(this.#owner(), record.draft, record.approvalId);
    await this.#record(this.#owner(), 'whatsapp.n8n.claim_prepared', { dispatchId }); await this.#approved(this.#owner(), record.draft, record.approvalId); await this.#fresh(this.#owner()); this.#stable(generation);
    if (record.claimed || Date.now() - record.created >= 60000) throw denied(); record.claimed = true;
    return { authorized: true as const, dispatchEnabled: false as const, dispatchId, phoneNumberId: this.#binding!.phoneNumberId, recipientPhoneNumber: r.phoneE164, textBody: record.draft.bodyText };
  }
  async receipt(connection: string, header: string, input: N8nWhatsAppProviderReceipt) {
    const data = copy(input), generation = await this.#relay(connection, header), record = this.#attempts.get(data.dispatchId);
    if (!record?.claimed || !MessageId.Check(data.providerMessageId) || this.#binding!.recipients.find(r => r.id === record.draft.recipientId)?.phoneE164.slice(1) !== data.recipientAddress || (record.receipt.providerMessageId && record.receipt.providerMessageId !== data.providerMessageId) || [...this.#attempts.values()].some(a => a.id !== record.id && a.receipt.providerMessageId === data.providerMessageId)) throw denied();
    await this.#record(this.#owner(), 'whatsapp.n8n.receipt_unverified', { dispatchId: record.id }); await this.#fresh(this.#owner()); this.#stable(generation);
    if ((record.receipt.providerMessageId && record.receipt.providerMessageId !== data.providerMessageId) || [...this.#attempts.values()].some(a => a.id !== record.id && a.receipt.providerMessageId === data.providerMessageId)) throw denied();
    let next: N8nWhatsAppReceipt = { ...record.receipt, providerMessageId: data.providerMessageId, status: record.receipt.status === 'not_configured' ? 'unverified' : record.receipt.status, verified: false };
    const reconciled: string[] = [];
    for (const [key, status] of this.#pendingStatuses) {
      if (status.id === data.providerMessageId && status.recipient_id === data.recipientAddress) {
        next = { ...next, ...advanceMetaTestReceipt(next, { providerMessageId: status.id, recipientAddress: status.recipient_id, status: status.status }, data.recipientAddress) }; reconciled.push(key);
      }
    }
    record.receipt = next; for (const key of reconciled) this.#pendingStatuses.delete(key);
    return { ...record.receipt };
  }
  async disconnect(scope: AuthenticatedScope) { const caller = { ...scope }; await this.#fresh(scope, true); this.#generation++; this.#active = false; this.#vault!.delete(this.#owner(), this.#purpose()); this.#messages.clear(); this.#statuses.clear(); this.#pendingStatuses.clear(); this.#attempts.clear(); this.#keys.clear(); await this.#record(caller, 'whatsapp.n8n.disconnected', {}); }
}
