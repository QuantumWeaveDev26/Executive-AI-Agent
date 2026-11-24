import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { ApprovalRequest, MetaProviderMessageIdSchema, MetaWhatsAppReceipt, MetaWhatsAppSendInput, MetaWhatsAppSendInputSchema, MetaWhatsAppTestConfig, MetaWhatsAppTestConfigSchema, MetaWhatsAppWebhook, MetaWhatsAppWebhookSchema, computeCanonicalParameterHash } from '@thaara/contracts';
import { AuthenticatedScope } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import { PolicyGateway } from '@thaara/policy';
import { WhatsAppVault, maskPhoneNumber, sanitizeWhatsAppText } from './whatsapp.js';

const Config = TypeCompiler.Compile(MetaWhatsAppTestConfigSchema);
const Draft = TypeCompiler.Compile(MetaWhatsAppSendInputSchema);
const Envelope = TypeCompiler.Compile(MetaWhatsAppWebhookSchema);
const MessageId = TypeCompiler.Compile(MetaProviderMessageIdSchema);
const fail = (message: string, status = 400) => new AppError(message, 'META_TEST_UNAVAILABLE', status);
const disabled = (): MetaWhatsAppReceipt => ({ mode: 'offline_test', status: 'not_configured', providerMessageId: null, verified: false, reason: 'sending_disabled' });
const sameSecret = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
type Secrets = { accessToken: string; appSecret: string; verifyToken: string };
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

function assertNoTenantClaims(value: unknown, depth = 0): void {
  if (depth > 20) throw fail('Meta webhook payload is invalid.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(workspace_?id|user_?id)$/i.test(key)) throw new ForbiddenError('Meta webhook tenant claims are forbidden.');
    assertNoTenantClaims(child, depth + 1);
  }
}

/** Server-side descriptor only: no fetch, Authorization header, token, or execution capability. */
export function buildMetaTextRequest(version: string, phoneNumberId: string, recipient: string, body: string, replyTo?: string) {
  if (!/^v[2-9][0-9]\.0$/.test(version) || !/^[0-9]{6,24}$/.test(phoneNumberId) || !/^\+[1-9][0-9]{7,14}$/.test(recipient) || !body.trim() || body.length > 4096 || (replyTo !== undefined && !MessageId.Check(replyTo))) throw fail('Meta message parameters are invalid.');
  return { method: 'POST' as const, url: `https://graph.facebook.com/${version}/${phoneNumberId}/messages`, body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient.slice(1), type: 'text', text: { body }, ...(replyTo ? { context: { message_id: replyTo } } : {}) } };
}

/** An HTTP acknowledgement alone never establishes sent/delivered/read. This is fixture-only evidence. */
export function metaAcknowledgementReceipt(response: unknown): MetaWhatsAppReceipt {
  const r = response as { messaging_product?: unknown; messages?: { id?: unknown }[] } | null;
  if (!r || r.messaging_product !== 'whatsapp' || !Array.isArray(r.messages) || r.messages.length !== 1 || !MessageId.Check(r.messages[0]?.id)) throw fail('Meta acknowledgement is invalid.');
  return { mode: 'offline_test', status: 'unverified', providerMessageId: r.messages[0]!.id as string, verified: false };
}

export function advanceMetaTestReceipt(current: MetaWhatsAppReceipt, event: { providerMessageId: string; recipientAddress: string; status: 'sent' | 'delivered' | 'read' | 'failed' }, expectedRecipient: string): MetaWhatsAppReceipt {
  if (current.mode !== 'offline_test' || current.verified !== false || !current.providerMessageId || current.providerMessageId !== event.providerMessageId || !/^[1-9][0-9]{7,14}$/.test(expectedRecipient) || expectedRecipient !== event.recipientAddress || !['sent', 'delivered', 'read', 'failed'].includes(event.status)) throw fail('Meta delivery correlation failed.');
  const rank: Record<string, number> = { not_configured: -1, unverified: 0, failed: 0, sent: 1, delivered: 2, read: 3 };
  const next = event.status === 'failed' ? ((rank[current.status] ?? -1) < 2 ? 'failed' : current.status) : ((rank[event.status] ?? -1) > (rank[current.status] ?? -1) ? event.status : current.status);
  return { ...current, status: next, verified: false };
}

/** Offline harness only. Not registered in buildApp, no environment loading, no network transport. */
export class MetaWhatsAppTestFoundation {
  #config?: MetaWhatsAppTestConfig;
  #vault?: WhatsAppVault;
  #policy?: PolicyGateway;
  #authorize?: Options['authorize'];
  #resolveApproval?: Options['resolveApproval'];
  #audit?: Audit;
  #now: () => number;
  #generation = 0;
  #active = false;
  #messages = new Map<string, InboxMessage>();
  #seenStatuses = new Set<string>();
  #attempts = new Map<string, { hash: string; promise: Promise<MetaWhatsAppReceipt> }>();

  constructor(options?: Options) {
    this.#now = options?.now ?? Date.now;
    if (!options) return;
    if (process.env.NODE_ENV !== 'test') throw fail('Meta offline infrastructure is test-only.', 503);
    const c = options.config, s = options.secrets;
    if (!Config.Check(c) || !options.reviewedGraphVersions?.includes(c.graphVersion) || new Set(c.recipients.map(r => r.id)).size !== c.recipients.length || new Set(c.recipients.map(r => r.phoneE164)).size !== c.recipients.length || !s || typeof s.appSecret !== 'string' || typeof s.verifyToken !== 'string' || typeof s.accessToken !== 'string' || !/^[a-fA-F0-9]{32}$/.test(s.appSecret) || !/^[a-zA-Z0-9_-]{32,128}$/.test(s.verifyToken) || !/^[a-zA-Z0-9._-]{20,4096}$/.test(s.accessToken) || typeof options.authorize !== 'function' || typeof options.resolveApproval !== 'function' || typeof options.audit !== 'function' || !options.vault || !options.policyGateway) throw fail('Meta test configuration is invalid.');
    this.#config = structuredClone(c);
    this.#vault = options.vault;
    this.#policy = options.policyGateway;
    this.#authorize = options.authorize;
    this.#resolveApproval = options.resolveApproval;
    this.#audit = options.audit;
    this.#vault.set(this.#owner(), this.#purpose(), { ...s });
    this.#active = true;
  }

  #owner(): AuthenticatedScope {
    return { workspaceId: this.#config!.workspaceId, userId: this.#config!.userId, role: 'member', sessionTokenHash: 'offline-meta-owner-binding' };
  }
  #purpose() { return `meta_cloud_test:${this.#config!.connectionId}:${this.#config!.revision}`; }
  #ensure(generation: number, allowDisconnected = false) {
    if (generation !== this.#generation || (!this.#active && !allowDisconnected)) throw fail('Meta test connection is unavailable.', 409);
  }
  async #access(scope: AuthenticatedScope, allowDisconnected = false): Promise<number> {
    const c = this.#config;
    if (!c || !scope || scope.workspaceId !== c.workspaceId || scope.userId !== c.userId || !this.#policy!.evaluate(scope, { actionName: 'whatsapp.connection.status', parameters: {} }).allowed) throw new ForbiddenError('Meta workspace access denied.');
    const generation = this.#generation;
    const snapshot = { ...scope };
    let authorized = false;
    try { authorized = await this.#authorize!({ ...scope }); } catch { throw new ForbiddenError('Meta workspace access denied.'); }
    if (!authorized || scope.workspaceId !== snapshot.workspaceId || scope.userId !== snapshot.userId || scope.role !== snapshot.role || scope.sessionTokenHash !== snapshot.sessionTokenHash) throw new ForbiddenError('Meta workspace access denied.');
    this.#ensure(generation, allowDisconnected);
    return generation;
  }
  #secrets(): Secrets {
    const secret = this.#vault!.get<Secrets>(this.#owner(), this.#purpose());
    if (!secret) throw fail('Meta test credentials are unavailable.', 503);
    return secret;
  }
  async #record(scope: AuthenticatedScope, action: string, details: Record<string, unknown>) {
    try { await this.#audit!(scope, action, details); } catch { throw fail('Meta test audit is unavailable.', 503); }
  }
  #timestamp(seconds: string): number {
    const timestamp = Number(seconds) * 1000;
    if (!Number.isSafeInteger(timestamp) || timestamp < this.#now() - 604800_000 || timestamp > this.#now() + 300_000) throw fail('Meta webhook event time is outside the accepted window.');
    return timestamp;
  }

  async status(scope: AuthenticatedScope) {
    if (this.#config) await this.#access(scope, true);
    return { provider: 'meta_cloud_test' as const, mode: this.#config ? 'offline_test' as const : 'disabled' as const, configured: Boolean(this.#config && this.#active), state: this.#config ? (this.#active ? 'offline_test_configured' : 'disconnected') : 'not_configured', connected: false, sendEnabled: false, identityVerified: false, storage: this.#config ? 'temporary_test_memory' : 'not_configured' };
  }
  async verifyChallenge(query: Record<string, unknown>): Promise<string> {
    if (!this.#config || !this.#active) throw fail('Meta test connection is unavailable.', 503);
    query = { ...query };
    const generation = await this.#access(this.#owner());
    const token = query['hub.verify_token'], challenge = query['hub.challenge'];
    if (query['hub.mode'] !== 'subscribe' || typeof token !== 'string' || token.length > 128 || typeof challenge !== 'string' || !/^[0-9]{1,128}$/.test(challenge) || !sameSecret(token, this.#secrets().verifyToken)) throw new ForbiddenError('Meta webhook verification failed.');
    this.#ensure(generation);
    return challenge;
  }

  async ingestWebhook(rawBody: Buffer, signature: string) {
    if (!this.#config || !this.#active) throw fail('Meta test connection is unavailable.', 503);
    if (!Buffer.isBuffer(rawBody) || rawBody.length > 131072) throw fail('Meta webhook payload is invalid.');
    rawBody = Buffer.from(rawBody);
    if (typeof signature !== 'string' || !/^sha256=[a-fA-F0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature.slice(7), 'hex'), createHmac('sha256', this.#secrets().appSecret).update(rawBody).digest())) throw new ForbiddenError('Meta webhook signature is invalid.');
    const generation = await this.#access(this.#owner());
    let parsed: unknown;
    try { parsed = JSON.parse(rawBody.toString('utf8')); } catch { throw fail('Meta webhook payload is invalid.'); }
    assertNoTenantClaims(parsed);
    if (!Envelope.Check(parsed)) throw fail('Meta webhook payload is invalid.');
    const staged: InboxMessage[] = [], statuses: string[] = [];
    for (const entry of (parsed as MetaWhatsAppWebhook).entry) {
      if (entry.id !== this.#config.businessAccountId) throw new ForbiddenError('Unknown Meta business asset.');
      for (const change of entry.changes) {
        const value = change.value;
        if (value.metadata.phone_number_id !== this.#config.phoneNumberId) throw new ForbiddenError('Unknown Meta business asset.');
        if (!value.messages && !value.statuses) throw fail('Meta webhook payload is invalid.');
        for (const message of value.messages ?? []) {
          const recipient = this.#config.recipients.find(r => r.phoneE164.slice(1) === message.from);
          if (!recipient) throw new ForbiddenError('Unknown Meta test recipient.');
          staged.push({ providerMessageId: message.id, recipientId: recipient.id, senderMaskedPhone: maskPhoneNumber(recipient.phoneE164), textPreview: sanitizeWhatsAppText(message.text.body), timestamp: new Date(this.#timestamp(message.timestamp)).toISOString(), mode: 'offline_test', untrusted: true });
        }
        for (const status of value.statuses ?? []) {
          this.#timestamp(status.timestamp);
          if (!this.#config.recipients.some(r => r.phoneE164.slice(1) === status.recipient_id)) throw new ForbiddenError('Unknown Meta test recipient.');
          statuses.push(JSON.stringify([status.id, status.recipient_id, status.status, status.timestamp]));
        }
      }
    }
    await this.#record(this.#owner(), 'whatsapp.meta_test.webhook_validated', { messageCount: staged.length, statusCount: statuses.length });
    await this.#access(this.#owner());
    this.#ensure(generation);
    const uniqueMessages = new Map(staged.filter(m => !this.#messages.has(m.providerMessageId)).map(m => [m.providerMessageId, m]));
    const uniqueStatuses = new Set(statuses.filter(s => !this.#seenStatuses.has(s)));
    if (this.#messages.size + uniqueMessages.size > 1000 || this.#seenStatuses.size + uniqueStatuses.size > 2000) throw fail('Meta test inbox capacity reached.', 503);
    for (const [id, m] of uniqueMessages) this.#messages.set(id, m);
    for (const key of uniqueStatuses) this.#seenStatuses.add(key);
    // No known outbound execution exists: unsolicited statuses cannot create receipts.
    return { acceptedMessages: uniqueMessages.size, ignoredStatuses: uniqueStatuses.size, duplicates: staged.length + statuses.length - uniqueMessages.size - uniqueStatuses.size };
  }

  async history(scope: AuthenticatedScope): Promise<InboxMessage[]> {
    await this.#access(scope);
    return [...this.#messages.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(m => ({ ...m }));
  }
  async disconnect(scope: AuthenticatedScope) {
    const caller = { ...scope };
    await this.#access(scope, true);
    // Authorized disconnect revokes locally before any fallible/slow audit callback.
    // Its immutable owner binding cannot target a different tenant if the caller mutates.
    this.#generation++;
    this.#active = false;
    this.#vault!.delete(this.#owner(), this.#purpose());
    this.#messages.clear(); this.#seenStatuses.clear(); this.#attempts.clear();
    await this.#record(caller, 'whatsapp.meta_test.disconnected', { connectionId: this.#config!.connectionId });
  }

  async prepareSend(scope: AuthenticatedScope, input: MetaWhatsAppSendInput, approvalId?: string): Promise<MetaWhatsAppReceipt> {
    if (!this.#config) return disabled();
    if (!Draft.Check(input)) throw fail('Meta message parameters are invalid.');
    const draft = structuredClone(input);
    const generation = await this.#access(scope);
    if (!approvalId) throw new ForbiddenError('Explicit Meta send approval is required.');
    let approved: ApprovalRequest | null;
    try { approved = structuredClone(await this.#resolveApproval!(scope, approvalId)); } catch { throw fail('Meta approval is unavailable.', 503); }
    await this.#access(scope); this.#ensure(generation);
    if (!approved || approved.id !== approvalId || !approved.actionParams || !Number.isFinite(Date.parse(approved.expiresAt)) || !this.#policy!.evaluate(scope, { actionName: 'whatsapp.meta.messages.send', parameters: draft, idempotencyKey: draft.idempotencyKey }, approved, scope.userId).allowed) throw new ForbiddenError('Explicit Meta send approval is required.');
    const c = this.#config;
    const recipient = c.recipients.find(r => r.id === draft.recipientId);
    if (draft.connectionId !== c.connectionId || draft.connectionRevision !== c.revision || draft.senderPhoneNumberId !== c.phoneNumberId || !recipient?.optedIn) throw new ForbiddenError('Meta sender or recipient binding is invalid.');
    const history = [...this.#messages.values()].filter(m => m.recipientId === recipient.id);
    const latest = Math.max(0, ...history.map(m => Date.parse(m.timestamp)));
    if (!latest || this.#now() - latest >= 86400_000 || latest > this.#now()) throw new ForbiddenError('An open customer-service window is required.');
    if (draft.replyToProviderMessageId && !history.some(m => m.providerMessageId === draft.replyToProviderMessageId)) throw new ForbiddenError('Meta reply recipient does not match.');
    buildMetaTextRequest(c.graphVersion, c.phoneNumberId, recipient.phoneE164, draft.bodyText, draft.replyToProviderMessageId);
    const hash = computeCanonicalParameterHash(draft), previous = this.#attempts.get(draft.idempotencyKey);
    if (previous && previous.hash !== hash) throw new ForbiddenError('Meta idempotency conflict.');
    if (previous) {
      const receipt = await previous.promise;
      await this.#access(scope); this.#ensure(generation);
      return { ...receipt };
    }
    if (this.#attempts.size >= 1000) throw fail('Meta test attempt capacity reached.', 503);
    const promise = (async () => {
      const receipt = disabled();
      await this.#record(scope, 'whatsapp.meta_test.send_disabled', { connectionId: c.connectionId, approvalId, status: receipt.status });
      await this.#access(scope); this.#ensure(generation);
      return receipt;
    })();
    const attempt = { hash, promise };
    this.#attempts.set(draft.idempotencyKey, attempt);
    try { return { ...await promise }; }
    catch (error) {
      if (this.#attempts.get(draft.idempotencyKey) === attempt) this.#attempts.delete(draft.idempotencyKey);
      throw error;
    }
  }
}
