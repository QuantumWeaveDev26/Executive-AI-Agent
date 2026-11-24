import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import {
  ApprovalRequest,
  N8nWorkflowBlueprint,
  RequestScope,
  WhatsAppBriefingAttentionItem,
  WhatsAppBriefingN8nContext,
  WhatsAppBriefingQuery,
  WhatsAppBriefingQuerySchema,
  WhatsAppBriefingResponse,
  WhatsAppBriefingResponseSchema,
  WhatsAppBriefingThreadSummary,
  WhatsAppConnectInput,
  WhatsAppConnectInputSchema,
  WhatsAppContactSummary,
  WhatsAppListMessages,
  WhatsAppListMessagesResponse,
  WhatsAppListMessagesResponseSchema,
  WhatsAppMessage,
  WhatsAppMessageSchema,
  WhatsAppN8nContext,
  WhatsAppN8nContextSchema,
  WhatsAppSendMessageDraft,
  WhatsAppSendMessageDraftSchema,
  WhatsAppStatus,
  WhatsAppThreadSummary,
  WhatsAppWebhookEventEnvelope,
  WhatsAppWebhookEventEnvelopeSchema,
  computeCanonicalParameterHash
} from '@thaara/contracts';
import { AuthenticatedScope } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import {
  PolicyGateway,
  detectWorkflowSecurityViolations,
  validateN8nWorkflowBlueprint
} from '@thaara/policy';

export const WHATSAPP_CAPABILITIES = [
  'whatsapp.messages.read',
  'whatsapp.threads.read'
] as const;

export interface WhatsAppCiphertextStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export class WhatsAppVault {
  #key: Buffer;
  constructor(key: Buffer, private store: WhatsAppCiphertextStore) {
    if (key.length !== 32) {
      throw new Error('WhatsApp vault requires a dedicated 256-bit encryption key.');
    }
    this.#key = Buffer.from(key);
  }

  private partition(scope: RequestScope, purpose: string): string {
    if (!scope.workspaceId || !scope.userId) {
      throw new Error('WhatsApp vault requires an authenticated subject.');
    }
    return (
      'whatsapp_business:' +
      purpose +
      ':' +
      createHash('sha256')
        .update(JSON.stringify([scope.workspaceId, scope.userId, purpose]))
        .digest('hex')
    );
  }

  set(scope: RequestScope, purpose: string, value: unknown): void {
    const key = this.partition(scope, purpose);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(key));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final()
    ]);
    this.store.set(key, Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'));
  }

  get<T>(scope: RequestScope, purpose: string): T | undefined {
    const key = this.partition(scope, purpose);
    const raw = this.store.get(key);
    if (raw === undefined) {
      return undefined;
    }
    try {
      const data = Buffer.from(raw, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.#key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(key));
      decipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
      ) as T;
    } catch {
      throw new AppError(
        'WhatsApp Business credentials are unavailable.',
        'WHATSAPP_CREDENTIALS_INVALID',
        503
      );
    }
  }

  delete(scope: RequestScope, purpose: string): void {
    this.store.delete(this.partition(scope, purpose));
  }
}

export interface WhatsAppSessionRecord {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  maskedBusinessPhone: string;
  capabilities: string[];
  expiresAt: number;
  verifiedAt: string;
}

export interface WhatsAppRawMessage {
  id: string;
  threadId: string;
  direction?: 'inbound' | 'outbound_draft';
  senderPhone: string;
  senderDisplayName: string;
  text: string;
  timestamp: string;
  deliveryStatus?: 'received' | 'read' | 'draft_awaiting_approval';
  unreadCount?: number;
}

export interface WhatsAppProvider {
  readonly mode: 'mock';
  verifyConnection(input: WhatsAppConnectInput): Promise<{
    accessToken: string;
    capabilities: string[];
    expiresInSeconds: number;
    maskedBusinessPhone: string;
  }>;
  listMessages(input: {
    accessToken: string;
    threadId?: string;
    query?: string;
    limit: number;
    pageToken?: string;
  }): Promise<{ messages: unknown[]; nextPageToken?: string }>;
  readMessage(input: { accessToken: string; messageId: string }): Promise<unknown>;
}

export interface WhatsAppOptions {
  provider?: WhatsAppProvider;
  vault?: WhatsAppVault;
  webhookSecret?: string;
  now?: () => number;
}

type Audit = (
  scope: AuthenticatedScope,
  action: string,
  payload: Record<string, unknown>
) => Promise<void>;

const ConnectCompiler = TypeCompiler.Compile(WhatsAppConnectInputSchema);
const MessageCompiler = TypeCompiler.Compile(WhatsAppMessageSchema);
const ListResponseCompiler = TypeCompiler.Compile(WhatsAppListMessagesResponseSchema);
const SendDraftCompiler = TypeCompiler.Compile(WhatsAppSendMessageDraftSchema);
const WebhookEnvelopeCompiler = TypeCompiler.Compile(WhatsAppWebhookEventEnvelopeSchema);
const N8nContextCompiler = TypeCompiler.Compile(WhatsAppN8nContextSchema);
const BriefingQueryCompiler = TypeCompiler.Compile(WhatsAppBriefingQuerySchema);
const BriefingResponseCompiler = TypeCompiler.Compile(WhatsAppBriefingResponseSchema);

/**
 * Masks personal or business phone numbers so full raw phone numbers are never exposed
 * in API responses, logs, or downstream automation contexts.
 */
export function maskPhoneNumber(rawPhone: string): string {
  const trimmed = rawPhone.trim();
  if (/^\+\d{1,3}\s\*{6}\d{4}$/.test(trimmed)) {
    return trimmed;
  }
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.length < 4) {
    return '+** ****0000';
  }
  const last4 = digits.slice(-4);
  const countryPrefix = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : '+';
  return `${countryPrefix}******${last4}`;
}

export function hashContactPhone(workspaceId: string, rawPhone: string): string {
  const normalized = rawPhone.replace(/[^0-9]/g, '');
  return (
    'wa_contact_' +
    createHash('sha256')
      .update(`${workspaceId}:${normalized}`)
      .digest('hex')
      .slice(0, 24)
  );
}

/**
 * Sanitizes untrusted WhatsApp message text or contact display names by stripping
 * script/style blocks, HTML tags, control characters, and zero-width characters.
 */
export function sanitizeWhatsAppText(raw: string, maxLength = 2048): string {
  const cleaned = raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, maxLength);
}

export function computeWhatsAppWebhookSignature(rawBody: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export class WhatsAppFoundation {
  private policyGateway: PolicyGateway;
  private provider?: WhatsAppProvider;
  private vault?: WhatsAppVault;
  private webhookSecret?: string;
  private now: () => number;
  private audit: Audit;
  private deduplicatedEvents = new Map<string, WhatsAppMessage>();

  constructor(
    options: WhatsAppOptions & {
      policyGateway: PolicyGateway;
      audit?: Audit;
    }
  ) {
    if ((options.provider as { mode?: string } | undefined)?.mode === 'live') {
      throw new Error('Live WhatsApp Business provider is disabled in Step 91.');
    }
    this.policyGateway = options.policyGateway;
    this.provider = options.provider;
    this.vault = options.vault;
    this.webhookSecret = options.webhookSecret;
    this.now = options.now ?? (() => Date.now());
    this.audit = options.audit ?? (async () => {});
  }

  private configured(): boolean {
    return Boolean(this.provider && this.vault && this.provider.mode === 'mock');
  }

  private evaluatePolicy(
    scope: AuthenticatedScope,
    actionName: string,
    parameters: Record<string, unknown>,
    approvedRequest: ApprovalRequest | null = null,
    idempotencyKey?: string
  ): void {
    const decision = this.policyGateway.evaluate(
      scope,
      { actionName, parameters, idempotencyKey },
      approvedRequest,
      scope.userId
    );
    if (!decision.allowed) {
      throw new ForbiddenError('WhatsApp Business action denied by policy.');
    }
  }

  status(scope: AuthenticatedScope): WhatsAppStatus {
    this.evaluatePolicy(scope, 'whatsapp.connection.status', {});
    if (!this.configured()) {
      return {
        connectorName: 'whatsapp_business',
        status: 'not_configured',
        configured: false,
        connected: false,
        mode: 'disabled',
        capabilities: [],
        maskedBusinessPhone: null,
        lastVerifiedAt: null
      };
    }

    try {
      const session = this.vault!.get<WhatsAppSessionRecord>(scope, 'session');
      if (!session) {
        return {
          connectorName: 'whatsapp_business',
          status: 'disconnected',
          configured: true,
          connected: false,
          mode: 'mock',
          capabilities: [],
          maskedBusinessPhone: null,
          lastVerifiedAt: null
        };
      }

      const validCapabilities =
        session.capabilities.length === WHATSAPP_CAPABILITIES.length &&
        WHATSAPP_CAPABILITIES.every((c) => session.capabilities.includes(c));

      if (session.expiresAt <= this.now() || !validCapabilities) {
        return {
          connectorName: 'whatsapp_business',
          status: 'reconnect_required',
          configured: true,
          connected: false,
          mode: 'mock',
          capabilities: [...WHATSAPP_CAPABILITIES],
          maskedBusinessPhone: session.maskedBusinessPhone,
          lastVerifiedAt: session.verifiedAt
        };
      }

      return {
        connectorName: 'whatsapp_business',
        status: 'connected',
        configured: true,
        connected: true,
        mode: 'mock',
        capabilities: [...WHATSAPP_CAPABILITIES],
        maskedBusinessPhone: session.maskedBusinessPhone,
        lastVerifiedAt: session.verifiedAt
      };
    } catch {
      return {
        connectorName: 'whatsapp_business',
        status: 'reconnect_required',
        configured: true,
        connected: false,
        mode: 'mock',
        capabilities: [],
        maskedBusinessPhone: null,
        lastVerifiedAt: null
      };
    }
  }

  async connect(scope: AuthenticatedScope, input: WhatsAppConnectInput): Promise<WhatsAppStatus> {
    if (!ConnectCompiler.Check(input)) {
      throw new AppError('Invalid WhatsApp connection input.', 'WHATSAPP_INVALID_INPUT', 400);
    }
    this.evaluatePolicy(scope, 'whatsapp.connection.connect', input as unknown as Record<string, unknown>);
    if (!this.configured()) {
      throw new AppError(
        'WhatsApp Business provider is not configured.',
        'WHATSAPP_NOT_CONFIGURED',
        503
      );
    }

    let verified: Awaited<ReturnType<WhatsAppProvider['verifyConnection']>>;
    try {
      verified = await this.provider!.verifyConnection(input);
    } catch {
      await this.audit(scope, 'whatsapp.connection.failed', {
        connectorName: 'whatsapp_business',
        reason: 'verification_failed'
      });
      throw new AppError(
        'WhatsApp Business connection verification failed.',
        'WHATSAPP_CONNECT_FAILED',
        502
      );
    }

    const validCapabilities =
      verified.capabilities.length === WHATSAPP_CAPABILITIES.length &&
      WHATSAPP_CAPABILITIES.every((c) => verified.capabilities.includes(c));
    if (!verified.accessToken || verified.expiresInSeconds <= 0 || !validCapabilities) {
      throw new AppError(
        'WhatsApp Business provider returned invalid capabilities.',
        'WHATSAPP_CAPABILITY_MISMATCH',
        403
      );
    }

    const verifiedAt = new Date(this.now()).toISOString();
    const maskedBusinessPhone = maskPhoneNumber(
      input.displayPhoneMasked ?? verified.maskedBusinessPhone
    );

    this.vault!.set(scope, 'session', {
      accessToken: verified.accessToken,
      phoneNumberId: input.phoneNumberId,
      businessAccountId: input.businessAccountId,
      maskedBusinessPhone,
      capabilities: [...WHATSAPP_CAPABILITIES],
      expiresAt: this.now() + verified.expiresInSeconds * 1000,
      verifiedAt
    } satisfies WhatsAppSessionRecord);

    await this.audit(scope, 'whatsapp.connection.connected', {
      connectorName: 'whatsapp_business',
      mode: 'mock',
      capabilities: [...WHATSAPP_CAPABILITIES]
    });

    return this.status(scope);
  }

  async disconnect(scope: AuthenticatedScope): Promise<WhatsAppStatus> {
    this.evaluatePolicy(scope, 'whatsapp.connection.disconnect', {});
    if (!this.configured()) {
      return this.status(scope);
    }
    this.vault!.delete(scope, 'session');
    await this.audit(scope, 'whatsapp.connection.disconnected', {
      connectorName: 'whatsapp_business',
      mode: 'mock'
    });
    return this.status(scope);
  }

  private activeSession(scope: AuthenticatedScope): WhatsAppSessionRecord {
    if (!this.configured()) {
      throw new AppError(
        'WhatsApp Business provider is not configured.',
        'WHATSAPP_NOT_CONFIGURED',
        503
      );
    }
    const session = this.vault!.get<WhatsAppSessionRecord>(scope, 'session');
    if (!session) {
      throw new AppError('WhatsApp Business is disconnected.', 'WHATSAPP_DISCONNECTED', 409);
    }
    if (session.expiresAt <= this.now()) {
      throw new AppError(
        'WhatsApp Business reconnection is required.',
        'WHATSAPP_RECONNECT_REQUIRED',
        409
      );
    }
    return session;
  }

  private normalizeMessage(scope: AuthenticatedScope, raw: unknown): WhatsAppMessage {
    if (!raw || typeof raw !== 'object') {
      throw new AppError(
        'WhatsApp provider returned an invalid message payload.',
        'WHATSAPP_PROVIDER_INVALID_RESPONSE',
        502
      );
    }
    const rec = raw as Partial<WhatsAppRawMessage>;
    if (
      typeof rec.id !== 'string' ||
      typeof rec.threadId !== 'string' ||
      typeof rec.senderPhone !== 'string' ||
      typeof rec.senderDisplayName !== 'string' ||
      typeof rec.text !== 'string' ||
      typeof rec.timestamp !== 'string' ||
      Number.isNaN(Date.parse(rec.timestamp))
    ) {
      throw new AppError(
        'WhatsApp provider returned malformed message fields.',
        'WHATSAPP_PROVIDER_INVALID_RESPONSE',
        502
      );
    }

    const sender: WhatsAppContactSummary = {
      contactHash: hashContactPhone(scope.workspaceId, rec.senderPhone),
      maskedPhone: maskPhoneNumber(rec.senderPhone),
      displayName: sanitizeWhatsAppText(rec.senderDisplayName, 128) || 'Unknown Contact'
    };

    const message: WhatsAppMessage = {
      id: rec.id,
      threadId: rec.threadId,
      direction: rec.direction === 'outbound_draft' ? 'outbound_draft' : 'inbound',
      sender,
      textPreview: sanitizeWhatsAppText(rec.text, 2048),
      timestamp: new Date(rec.timestamp).toISOString(),
      deliveryStatus:
        rec.deliveryStatus === 'read' || rec.deliveryStatus === 'draft_awaiting_approval'
          ? rec.deliveryStatus
          : 'received',
      untrusted: true,
      mode: 'mock'
    };

    if (!MessageCompiler.Check(message)) {
      throw new AppError(
        'WhatsApp provider message failed contract validation.',
        'WHATSAPP_PROVIDER_INVALID_RESPONSE',
        502
      );
    }

    return message;
  }

  async listMessages(
    scope: AuthenticatedScope,
    input: WhatsAppListMessages = {}
  ): Promise<WhatsAppListMessagesResponse> {
    this.evaluatePolicy(scope, 'whatsapp.messages.list', input as unknown as Record<string, unknown>);
    const session = this.activeSession(scope);
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const query = input.query ? sanitizeWhatsAppText(input.query, 256) : undefined;

    let providerRes: { messages: unknown[]; nextPageToken?: string };
    try {
      providerRes = await this.provider!.listMessages({
        accessToken: session.accessToken,
        threadId: input.threadId,
        query,
        limit,
        pageToken: input.pageToken
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(
        'WhatsApp Business message listing failed.',
        'WHATSAPP_PROVIDER_UNAVAILABLE',
        502
      );
    }

    if (!providerRes || !Array.isArray(providerRes.messages)) {
      throw new AppError(
        'WhatsApp provider returned an invalid list payload.',
        'WHATSAPP_PROVIDER_INVALID_RESPONSE',
        502
      );
    }

    const messages = providerRes.messages
      .slice(0, limit)
      .map((m) => this.normalizeMessage(scope, m))
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

    const threadMap = new Map<string, WhatsAppThreadSummary>();
    for (const msg of messages) {
      const existing = threadMap.get(msg.threadId);
      const isUnread = msg.direction === 'inbound' && msg.deliveryStatus === 'received' ? 1 : 0;
      if (!existing) {
        threadMap.set(msg.threadId, {
          threadId: msg.threadId,
          participant: msg.sender,
          lastMessageAt: msg.timestamp,
          lastMessagePreview: msg.textPreview.slice(0, 512),
          unreadCount: isUnread,
          untrusted: true,
          mode: 'mock'
        });
      } else {
        existing.unreadCount += isUnread;
      }
    }

    const response: WhatsAppListMessagesResponse = {
      messages,
      threads: [...threadMap.values()],
      ...(typeof providerRes.nextPageToken === 'string'
        ? { nextPageToken: providerRes.nextPageToken }
        : {}),
      untrusted: true,
      mode: 'mock'
    };

    if (!ListResponseCompiler.Check(response)) {
      throw new AppError(
        'WhatsApp message list response failed contract validation.',
        'WHATSAPP_PROVIDER_INVALID_RESPONSE',
        502
      );
    }

    await this.audit(scope, 'whatsapp.messages.listed', {
      connectorName: 'whatsapp_business',
      threadFiltered: Boolean(input.threadId),
      queryLength: query?.length ?? 0,
      returnedMessages: messages.length,
      returnedThreads: response.threads.length
    });

    return response;
  }

  async readMessage(scope: AuthenticatedScope, messageId: string): Promise<WhatsAppMessage> {
    this.evaluatePolicy(scope, 'whatsapp.messages.read', { messageId });
    const session = this.activeSession(scope);

    let raw: unknown;
    try {
      raw = await this.provider!.readMessage({
        accessToken: session.accessToken,
        messageId
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(
        'WhatsApp Business message read failed.',
        'WHATSAPP_PROVIDER_UNAVAILABLE',
        502
      );
    }

    const message = this.normalizeMessage(scope, raw);
    await this.audit(scope, 'whatsapp.messages.read', {
      connectorName: 'whatsapp_business',
      messageId: message.id,
      threadId: message.threadId
    });
    return message;
  }

  /**
   * Outbound WhatsApp sending is strictly approval-gated (`whatsapp.messages.send`,
   * `approvalMode: 'explicit'`, `risk: 'high'`). Calls without an explicit approved
   * `ApprovalRequest` matching the draft parameters are rejected by PolicyGateway.
   */
  async sendMessage(
    scope: AuthenticatedScope,
    draft: WhatsAppSendMessageDraft,
    approvedRequest: ApprovalRequest | null = null
  ): Promise<{
    status: 'not_configured';
    mode: 'mock';
    approvalId: string;
    message: string;
  }> {
    if (!SendDraftCompiler.Check(draft)) {
      throw new AppError('Invalid WhatsApp message draft.', 'WHATSAPP_INVALID_INPUT', 400);
    }
    this.evaluatePolicy(
      scope,
      'whatsapp.messages.send',
      draft as unknown as Record<string, unknown>,
      approvedRequest,
      draft.idempotencyKey
    );
    if (!approvedRequest || approvedRequest.status !== 'approved') {
      throw new ForbiddenError('WhatsApp outbound message sending requires explicit user approval.');
    }

    this.activeSession(scope);

    await this.audit(scope, 'whatsapp.messages.send_not_configured', {
      connectorName: 'whatsapp_business',
      approvalId: approvedRequest.id,
      threadId: draft.threadId,
      idempotencyKey: draft.idempotencyKey,
      status: 'not_configured'
    });

    return {
      status: 'not_configured',
      mode: 'mock',
      approvalId: approvedRequest.id,
      message: 'Live WhatsApp outbound message delivery is not configured in Step 91.'
    };
  }

  /**
   * Offline/mocked webhook signature verification, replay protection, and tenant-scoped
   * event deduplication. No live public webhook endpoint is exposed in Step 91.
   */
  async verifyAndIngestMockWebhookEvent(
    scope: AuthenticatedScope,
    input: {
      rawBody: string;
      signatureHeader: string;
      maxSkewSeconds?: number;
    }
  ): Promise<{
    accepted: boolean;
    deduplicated: boolean;
    eventId: string;
    message: WhatsAppMessage;
  }> {
    const secret = this.webhookSecret;
    if (!secret || secret.length < 16) {
      throw new AppError(
        'WhatsApp webhook verification secret is not configured.',
        'WHATSAPP_WEBHOOK_NOT_CONFIGURED',
        503
      );
    }

    const expectedSig = computeWhatsAppWebhookSignature(input.rawBody, secret);
    const providedBuf = Buffer.from(input.signatureHeader || '', 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      await this.audit(scope, 'whatsapp.webhook.rejected_signature', {
        connectorName: 'whatsapp_business',
        reason: 'invalid_signature'
      });
      throw new AppError(
        'Invalid WhatsApp webhook signature.',
        'WHATSAPP_WEBHOOK_SIGNATURE_INVALID',
        401
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      throw new AppError('Invalid WhatsApp webhook JSON.', 'WHATSAPP_WEBHOOK_INVALID_PAYLOAD', 400);
    }

    if (!WebhookEnvelopeCompiler.Check(parsed)) {
      throw new AppError(
        'WhatsApp webhook payload failed schema validation.',
        'WHATSAPP_WEBHOOK_INVALID_PAYLOAD',
        400
      );
    }

    const envelope = parsed as WhatsAppWebhookEventEnvelope;
    if (envelope.workspaceId !== scope.workspaceId || envelope.userId !== scope.userId) {
      throw new ForbiddenError('WhatsApp webhook event scope mismatch.');
    }

    const nowSeconds = Math.floor(this.now() / 1000);
    const maxSkewSeconds = input.maxSkewSeconds ?? 300;
    if (Math.abs(nowSeconds - envelope.timestampSeconds) > maxSkewSeconds) {
      await this.audit(scope, 'whatsapp.webhook.rejected_replay', {
        connectorName: 'whatsapp_business',
        eventId: envelope.eventId,
        reason: 'timestamp_out_of_window'
      });
      throw new AppError(
        'WhatsApp webhook event timestamp is outside the replay protection window.',
        'WHATSAPP_WEBHOOK_REPLAY_DETECTED',
        409
      );
    }

    const eventKey = `${scope.workspaceId}:${ scope.userId }:event:${envelope.eventId}`;
    const messageKey = `${scope.workspaceId}:${scope.userId}:msg:${envelope.messageId}`;
    const existing = this.deduplicatedEvents.get(eventKey) ?? this.deduplicatedEvents.get(messageKey);
    if (existing) {
      return {
        accepted: true,
        deduplicated: true,
        eventId: envelope.eventId,
        message: existing
      };
    }

    const normalized = this.normalizeMessage(scope, {
      id: envelope.messageId,
      threadId: envelope.threadId,
      direction: 'inbound',
      senderPhone: envelope.senderPhone,
      senderDisplayName: envelope.senderDisplayName,
      text: envelope.text,
      timestamp: new Date(envelope.timestampSeconds * 1000).toISOString(),
      deliveryStatus: 'received'
    });

    this.deduplicatedEvents.set(eventKey, normalized);
    this.deduplicatedEvents.set(messageKey, normalized);

    await this.audit(scope, 'whatsapp.webhook.ingested_mock', {
      connectorName: 'whatsapp_business',
      eventId: envelope.eventId,
      messageId: normalized.id,
      threadId: normalized.threadId
    });

    return {
      accepted: true,
      deduplicated: false,
      eventId: envelope.eventId,
      message: normalized
    };
  }

  /**
   * Prepares sanitized, inactive (`active: false`) WhatsApp message context for future
   * n8n workflow blueprints without modifying or activating any n8n workflows.
   */
  toN8nContext(listResponse: WhatsAppListMessagesResponse): WhatsAppN8nContext {
    const context: WhatsAppN8nContext = {
      connectorName: 'whatsapp_business',
      mode: 'mock',
      untrusted: true,
      active: false,
      threadCount: listResponse.threads.length,
      messageCount: listResponse.messages.length,
      messages: listResponse.messages.map((m) => ({
        ...m,
        textPreview: sanitizeWhatsAppText(m.textPreview, 512),
        untrusted: true,
        mode: 'mock'
      }))
    };

    if (!N8nContextCompiler.Check(context)) {
      throw new AppError(
        'WhatsApp n8n context failed contract validation.',
        'WHATSAPP_N8N_CONTEXT_INVALID',
        500
      );
    }

    return context;
  }

  /**
   * Prepares an executive WhatsApp conversation briefing from authorized synthetic messages
   * and generates a validated offline (`active: false`) n8n workflow blueprint containing
   * metadata references only (never raw private messages or unmasked phone numbers).
   */
  async prepareBriefing(
    scope: AuthenticatedScope,
    input: WhatsAppBriefingQuery = {}
  ): Promise<WhatsAppBriefingResponse> {
    if (!BriefingQueryCompiler.Check(input)) {
      throw new AppError('Invalid WhatsApp briefing query.', 'WHATSAPP_INVALID_INPUT', 400);
    }
    this.evaluatePolicy(
      scope,
      'whatsapp.briefing.prepare',
      input as unknown as Record<string, unknown>
    );

    const generateBlueprint = input.generateWorkflowBlueprint ?? true;
    const workflowName = (
      input.workflowName ?? 'Daily Executive WhatsApp Briefing'
    ).trim();
    if (
      workflowName.length < 3 ||
      workflowName.length > 120 ||
      detectWorkflowSecurityViolations([workflowName]).length > 0
    ) {
      throw new AppError(
        'Invalid or unsafe WhatsApp briefing workflowName.',
        'WHATSAPP_INVALID_INPUT',
        400
      );
    }

    const listed = await this.listMessages(scope, {
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.query ? { query: input.query } : {}),
      limit: input.limit ?? 25
    });

    const attentionRegex =
      /\b(?:urgent|confirm|review|approve|action|deadline|board|call|summary|please|addendum)\b/i;

    const attentionItems: WhatsAppBriefingAttentionItem[] = [];
    for (const msg of listed.messages) {
      const isUnreadInbound = msg.direction === 'inbound' && msg.deliveryStatus === 'received';
      const hasActionSignal = attentionRegex.test(msg.textPreview);
      if (isUnreadInbound || hasActionSignal) {
        const snippet = sanitizeWhatsAppText(msg.textPreview, 280);
        attentionItems.push({
          messageId: msg.id,
          threadId: msg.threadId,
          sender: msg.sender,
          timestamp: msg.timestamp,
          reason: isUnreadInbound
            ? hasActionSignal
              ? 'unread_action_requested'
              : 'unread_inbound'
            : 'action_or_review_requested',
          snippet,
          untrusted: true
        });
      }
    }

    const messagesByThread = new Map<string, WhatsAppMessage[]>();
    for (const msg of listed.messages) {
      const group = messagesByThread.get(msg.threadId) ?? [];
      group.push(msg);
      messagesByThread.set(msg.threadId, group);
    }

    const conversationSummaries: WhatsAppBriefingThreadSummary[] = listed.threads.map((t) => {
      const threadMsgs = messagesByThread.get(t.threadId) ?? [];
      const threadAttention = attentionItems.filter((a) => a.threadId === t.threadId);
      const needsAttention = t.unreadCount > 0 || threadAttention.length > 0;
      const attentionReason =
        t.unreadCount > 0
          ? `${t.unreadCount} unread message${t.unreadCount === 1 ? '' : 's'}${threadAttention.length > 0 ? ' requiring executive review' : ''}`
          : threadAttention.length > 0
            ? 'Action or review item detected'
            : undefined;

      return {
        threadId: t.threadId,
        participant: t.participant,
        unreadCount: t.unreadCount,
        messageCount: threadMsgs.length,
        lastMessageAt: t.lastMessageAt,
        summarySnippet: sanitizeWhatsAppText(t.lastMessagePreview, 280),
        needsAttention,
        ...(attentionReason ? { attentionReason } : {}),
        untrusted: true
      };
    });

    const unreadCount = conversationSummaries.reduce((sum, c) => sum + c.unreadCount, 0);
    const n8nContext: WhatsAppBriefingN8nContext = {
      connector: 'whatsapp_business',
      operation: 'read_conversation_briefing_metadata',
      readOnly: true,
      active: false,
      threadIds: conversationSummaries.map((c) => c.threadId),
      attentionMessageIds: attentionItems.map((a) => a.messageId),
      unreadTotal: unreadCount
    };

    const headline =
      listed.messages.length === 0
        ? 'No WhatsApp Business messages in the current briefing window.'
        : `${conversationSummaries.length} WhatsApp conversation${conversationSummaries.length === 1 ? '' : 's'} (${unreadCount} unread, ${attentionItems.length} item${attentionItems.length === 1 ? '' : 's'} needing attention).`;

    const blueprintResult = generateBlueprint
      ? buildWhatsAppBriefingN8nBlueprint({
          workflowName,
          n8nContext
        })
      : undefined;

    const result: WhatsAppBriefingResponse = {
      headline,
      totalMessages: listed.messages.length,
      totalThreads: conversationSummaries.length,
      unreadCount,
      attentionCount: attentionItems.length,
      conversationSummaries,
      attentionItems,
      n8nContext,
      ...(blueprintResult
        ? {
            n8nBlueprint: blueprintResult.blueprint,
            workflowHash: blueprintResult.workflowHash
          }
        : {}),
      untrusted: true,
      mode: 'mock'
    };

    if (!BriefingResponseCompiler.Check(result)) {
      throw new AppError(
        'WhatsApp briefing response failed contract validation.',
        'WHATSAPP_PROVIDER_INVALID_RESPONSE',
        502
      );
    }

    await this.audit(scope, 'whatsapp.briefing.completed', {
      connectorName: 'whatsapp_business',
      mode: 'mock',
      totalMessages: result.totalMessages,
      totalThreads: result.totalThreads,
      unreadCount: result.unreadCount,
      attentionCount: result.attentionCount,
      blueprintGenerated: Boolean(blueprintResult)
    });

    return result;
  }
}

export function buildWhatsAppBriefingN8nBlueprint(input: {
  workflowName: string;
  n8nContext: WhatsAppBriefingN8nContext;
}): { blueprint: N8nWorkflowBlueprint; workflowHash: string } {
  const workflowHash = computeCanonicalParameterHash({
    schema: 'thaara.whatsapp_briefing_workflow.v1',
    workflowName: input.workflowName,
    threadIds: input.n8nContext.threadIds,
    attentionMessageIds: input.n8nContext.attentionMessageIds,
    unreadTotal: input.n8nContext.unreadTotal
  });
  const suffix = workflowHash.slice(0, 8);
  const triggerNode = 'Daily_WhatsApp_Digest_Trigger';
  const attentionNode = 'Filter_Unread_Attention_Items';
  const composeDraftNode = 'Compose_WhatsApp_Briefing_Draft';

  const blueprint: N8nWorkflowBlueprint = {
    name: input.workflowName,
    active: false,
    versionId: `v1-${workflowHash.slice(0, 16)}`,
    nodes: [
      {
        id: `node-wa-trigger-${suffix}`,
        name: triggerNode,
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1,
        position: [240, 300],
        parameters: {
          mode: 'everyDay',
          connector: 'whatsapp_business',
          operation: 'read_conversation_briefing_metadata',
          readOnly: true
        }
      },
      {
        id: `node-wa-attention-${suffix}`,
        name: attentionNode,
        type: 'n8n-nodes-base.if',
        typeVersion: 1,
        position: [480, 300],
        parameters: {
          field: 'attention_count',
          operator: 'not_equals',
          value: '0'
        }
      },
      {
        id: `node-wa-briefing-${suffix}`,
        name: composeDraftNode,
        type: 'n8n-nodes-base.set',
        typeVersion: 1,
        position: [720, 300],
        parameters: {
          connector: 'whatsapp_business',
          threadIds: input.n8nContext.threadIds,
          attentionMessageIds: input.n8nContext.attentionMessageIds,
          unreadTotal: input.n8nContext.unreadTotal,
          untrustedMessageData: true,
          rawPrivateMessagesEmbedded: false,
          outboundMessageSendingEnabled: false,
          deliveryMode: 'offline_briefing_draft_only_no_live_execution'
        }
      }
    ],
    connections: {
      [triggerNode]: {
        main: [[{ node: attentionNode, type: 'main', index: 0 }]]
      },
      [attentionNode]: {
        main: [[{ node: composeDraftNode, type: 'main', index: 0 }]]
      }
    },
    settings: {
      executionOrder: 'v1',
      saveManualExecutions: false
    },
    meta: {
      generatedBy: 'thaara-v2-offline-workflow-builder',
      importReadiness: 'offline_schema_validated_not_live_verified',
      externallyVerifiedWithLiveN8n: false
    }
  };

  const validation = validateN8nWorkflowBlueprint(blueprint);
  if (!validation.valid) {
    throw new AppError(
      `Failed to validate offline WhatsApp n8n blueprint: ${validation.errors.join('; ')}`,
      'WHATSAPP_BLUEPRINT_INVALID',
      500
    );
  }
  return { blueprint, workflowHash };
}

export function createInMemoryWhatsAppStore(): WhatsAppCiphertextStore {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k),
    set: (k, v) => {
      map.set(k, v);
    },
    delete: (k) => {
      map.delete(k);
    }
  };
}

export const DEFAULT_SYNTHETIC_WHATSAPP_MESSAGES: readonly WhatsAppRawMessage[] = [
  {
    id: 'wamid_exec_board_001',
    threadId: 'wa_thread_board_chair',
    direction: 'inbound',
    senderPhone: '+919876543210',
    senderDisplayName: 'Ananya Rao (Board Chair)',
    text: 'Please share the Q4 liquidity summary before our 11:00 IST board call.',
    timestamp: '2026-10-19T04:15:00.000Z',
    deliveryStatus: 'received'
  },
  {
    id: 'wamid_exec_counsel_002',
    threadId: 'wa_thread_general_counsel',
    direction: 'inbound',
    senderPhone: '+919811122233',
    senderDisplayName: 'Vikram Menon (General Counsel)',
    text: '<script>alert("xss")</script>Updated vendor addendum clause 4.2 is ready for review.',
    timestamp: '2026-10-19T05:00:00.000Z',
    deliveryStatus: 'read'
  },
  {
    id: 'wamid_exec_board_003',
    threadId: 'wa_thread_board_chair',
    direction: 'inbound',
    senderPhone: '+919876543210',
    senderDisplayName: 'Ananya Rao (Board Chair)',
    text: 'Also confirm whether the Bengaluru audit committee dial-in has changed.',
    timestamp: '2026-10-19T05:30:00.000Z',
    deliveryStatus: 'received'
  }
];

export function createMockWhatsAppProvider(
  messages: readonly WhatsAppRawMessage[] = DEFAULT_SYNTHETIC_WHATSAPP_MESSAGES
): WhatsAppProvider {
  return {
    mode: 'mock',
    async verifyConnection(input) {
      return {
        accessToken: `mock-wa-token-${input.phoneNumberId}`,
        capabilities: [...WHATSAPP_CAPABILITIES],
        expiresInSeconds: 3600,
        maskedBusinessPhone: input.displayPhoneMasked ?? '+91 ******9000'
      };
    },
    async listMessages(input) {
      const filtered = messages.filter((m) => {
        if (input.threadId && m.threadId !== input.threadId) {
          return false;
        }
        if (input.query) {
          const q = input.query.toLowerCase();
          return (
            m.text.toLowerCase().includes(q) ||
            m.senderDisplayName.toLowerCase().includes(q)
          );
        }
        return true;
      });
      return {
        messages: filtered.slice(0, input.limit)
      };
    },
    async readMessage(input) {
      const found = messages.find((m) => m.id === input.messageId);
      if (!found) {
        throw new AppError('WhatsApp message not found.', 'WHATSAPP_MESSAGE_NOT_FOUND', 404);
      }
      return found;
    }
  };
}
