import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { WHATSAPP_MEDIA_UPLOAD_ACTION, isWhatsAppUploadIntent } from '@thaara/contracts';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { isMetaWhatsAppAnySendInput, type MetaWhatsAppAnySendInput, type MetaWhatsAppTestConfig, MetaWhatsAppDurableWebhookSchema, N8nWhatsAppProviderReceiptSchema, N8nWhatsAppReplyDraftRequestSchema, computeCanonicalParameterHash, whatsappDraftPreview, type MetaWhatsAppSendInput, type N8nWhatsAppProviderReceipt, type N8nWhatsAppReceipt, type N8nWhatsAppReplyDraft } from '@thaara/contracts';
import { isWhatsAppRelayScope, type AuthenticatedScope, type WhatsAppExecutionScope, type WhatsAppRelayOperation } from '@thaara/db';
import type { RequestScope } from '@thaara/contracts';
import type { WhatsAppDispatchRecord, WhatsAppStateStore, WhatsAppStateTransaction } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import type { PolicyGateway } from '@thaara/policy';
import { maskPhoneNumber, sanitizeWhatsAppText } from './whatsapp.js';
import { advanceMetaTestReceipt } from './meta-whatsapp-test.js';
import type { N8nWhatsAppInboxQuery } from '@thaara/contracts';
import { formatWhatsAppContactName, projectWhatsAppInbox, type SanitizedDeliveryFailureDetail } from './whatsapp-inbox.js';
import { normalizeWhatsAppIncomingContent } from './whatsapp-media.js';

const Draft = { Check: (value: unknown): value is MetaWhatsAppAnySendInput => isMetaWhatsAppAnySendInput(value) };
const Envelope = TypeCompiler.Compile(MetaWhatsAppDurableWebhookSchema);
const ReplyRequest = TypeCompiler.Compile(N8nWhatsAppReplyDraftRequestSchema);
const Receipt = TypeCompiler.Compile(N8nWhatsAppProviderReceiptSchema);
const denied = () => new ForbiddenError('WhatsApp durable operation denied.');
function snapshot<T>(value: T): T {
  try { const json = JSON.stringify(value); if (Buffer.byteLength(json) > 131072) throw denied(); return JSON.parse(json); }
  catch { throw new AppError('Invalid WhatsApp input.', 'WHATSAPP_DURABLE_INVALID', 400); }
}
// Meta's business-scoped user ID (contacts[].user_id) is provider data, not a Thaara tenant claim.
const isMetaContactUserId = (path: string[], key: string, child: unknown) =>
  key === 'user_id' && typeof child === 'string' && path.length === 2 && path[0] === 'contacts' && /^[0-9]+$/.test(path[1]!);
function rejectClaims(value: unknown, depth = 0, path: string[] = []): void {
  if (depth > 20) throw denied();
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (/^(workspace_?id|user_?id)$/i.test(key) && !isMetaContactUserId(path, key, child)) throw denied();
    rejectClaims(child, depth + 1, [...path, key]);
  }
}

/** Separately approved send profile: one connection, one recipient or '*' (any opted-in contact), an optional daily cap and an expiry. */
export interface WhatsAppSendProfile { connectionId: string; recipientId: string; maxPerDay: number | null; expiresAt: number; /** Only true once the outbound workflow handles template/media messages. */ richMessages?: boolean; /** Explicitly configurable customer-service auto-reply flag (false/absent by default). */ autoReply?: boolean }
/** Ceiling for an explicit Thaara daily cap. null = no Thaara cap (owner choice); per-message approval and Meta's own limits always apply. */
export const MAX_SENDS_PER_DAY = 250;
export const DEFAULT_MAX_AUTO_REPLIES_PER_RECIPIENT_PER_DAY = 60;
export const MAX_AUTO_REPLIES_PER_RECIPIENT_PER_DAY = 100;
const validCap = (cap: number | null) => cap === null || (Number.isSafeInteger(cap) && cap >= 1 && cap <= MAX_SENDS_PER_DAY);
export interface WhatsAppDispatcher {
  autoReplyEnabled?: boolean;
  submit(input: { connectionId: string; revision: number; dispatchId: string }): Promise<void>;
}
export interface WhatsAppAutoReplyOptions {
  /** Explicitly disabled by default. Must be true to allow automated customer-service replies. */
  enabled: boolean;
  /** Maximum automated replies per recipient per 24h window to prevent loops (default: 3, max: 10). */
  maxPerRecipientPerDay?: number;
  /** Minimum cooldown between automated replies to the same recipient in ms (default: 0). */
  cooldownMs?: number;
  /** Authenticated owner scope used to reserve the auto-reply after relay ingestion commits. */
  ownerScope?: AuthenticatedScope;
  /** Issues an approved standing ApprovalRequest ID for the exact canonical auto-reply draft. */
  authorizeDraft(scope: AuthenticatedScope, draft: MetaWhatsAppSendInput, tx?: WhatsAppStateTransaction): Promise<string> | string;
}
export interface WhatsAppCampaignContextResolverInput {
  scope: AuthenticatedScope;
  connectionId: string;
  recipientId: string;
  phoneE164: string;
  customerMessage: string;
}

export interface DurableSendOptions {
  profile(): WhatsAppSendProfile | null;
  dispatcher: WhatsAppDispatcher;
  /** Explicitly configurable customer-service auto-reply options (disabled by default). */
  autoReply?: WhatsAppAutoReplyOptions | (() => WhatsAppAutoReplyOptions | null);
  /** Optional ModelGatewayAdapter for unified AI generation. */
  modelGateway?: ModelGatewayAdapter;
  /** Optional campaign knowledge resolver for approved workspace WhatsApp campaigns. */
  resolveCampaignContext?: (input: WhatsAppCampaignContextResolverInput) => Promise<WhatsAppCampaignReplyContext | null>;
  /** When true, runs auto-reply evaluation asynchronously so webhook returns immediately. */
  asyncAutoReply?: boolean;
}
export interface DurableWhatsAppServiceOptions {
  modelGateway?: ModelGatewayAdapter;
  resolveCampaignContext?: (input: WhatsAppCampaignContextResolverInput) => Promise<WhatsAppCampaignReplyContext | null>;
  asyncAutoReply?: boolean;
}
const CUSTOMER_SERVICE_WINDOW_MS = 24 * 3600000;
/** Meta's reason for a failed delivery, reduced to safe operator fields (no phone numbers, no message text). */
export interface WhatsAppDeliveryFailure { event: 'whatsapp_delivery_failed'; connectionId: string; messageRef: string; code: number | null; title: string; details: string }
const safeReason = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\+?\d{7,}/g, '[number]').trim().slice(0, 160) : '';
function deliveryFailures(event: unknown, connectionId: string): Array<WhatsAppDeliveryFailure & { providerMessageId: string }> {
  const statuses = (event as { statuses?: unknown })?.statuses;
  if (!Array.isArray(statuses)) return [];
  return statuses.filter(st => st && typeof st === 'object' && (st as { status?: unknown }).status === 'failed').slice(0, 50).map(st => {
    const e = ((st as { errors?: unknown }).errors as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
    const id = typeof (st as { id?: unknown }).id === 'string' ? (st as { id: string }).id : '';
    return { event: 'whatsapp_delivery_failed' as const, connectionId, providerMessageId: id, messageRef: id.slice(-10), code: Number.isSafeInteger(e.code) ? e.code as number : null,
      title: safeReason(e.title ?? e.message), details: safeReason((e.error_data as { details?: unknown } | undefined)?.details) };
  });
}

import type { WhatsAppStoredAutoReplyMetadata } from '@thaara/contracts';
import {
  buildAutoReplyIdempotencyKey,
  buildConversationMemoryState,
  buildQuantumWeaveCustomerReply,
  extractWhatsAppCustomerEnquiry,
  isConnectionWideDeliveryFailure
} from './whatsapp-enquiries.js';
import { WhatsAppAIService, type WhatsAppCampaignReplyContext } from './whatsapp-ai-service.js';
import type { ModelGatewayAdapter } from './model-gateway.js';

export interface WhatsAppAutoReplyRecoveryResult {
  reserved: number;
  submitted: number;
  expired: number;
  skippedUncertain: number;
  failedRecovery: number;
}

const EMPTY_RECOVERY_RESULT: WhatsAppAutoReplyRecoveryResult = {
  reserved: 0,
  submitted: 0,
  expired: 0,
  skippedUncertain: 0,
  failedRecovery: 0
};

export interface WhatsAppRecoveryAttentionEvent {
  event: 'whatsapp_auto_reply_recovery_attention';
  connectionId: string;
  reason: 'expired_reservation' | 'startup_recovery_failed' | 'recovery_failed';
  dispatchId?: string;
  inboundMessageRef?: string;
}

/**
 * Shared per-store submission tracker coordinating concurrent DurableWhatsAppService instances
 * against the same backing store so simultaneous recovery passes never double-submit a dispatch,
 * while ensuring transaction rollbacks and pre-transmission submission failures never suppress recovery.
 */
type DurableRecipient = MetaWhatsAppTestConfig['recipients'][number];

const storeSubmissionTracker = new WeakMap<
  WhatsAppStateStore,
  {
    submitted: Set<string>;
    inFlight: Set<string>;
    startupFailedConnections: Set<string>;
    failedMessageIdsByConnection: Map<string, Set<string>>;
    n8nAgentReplies: Map<string, string>;
    dynamicRecipientsByConnection: Map<string, Map<string, DurableRecipient>>;
    appointments: Map<string, any>;
  }
>();

const PRE_TRANSMISSION_SYSTEM_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'ERR_INVALID_URL'
]);

/**
 * WA-01 Hardening (Concern 1): Positive allowlist for pre-transmission submission failures.
 * Only retry when there is reliable evidence that the request failed BEFORE network transmission
 * (e.g. ECONNREFUSED, DNS lookup failure, or explicit `preTransmissionFailure: true`).
 * Any unknown error, HTTP response error (e.g. 500/502/504), ECONNRESET, EPIPE, or timeout
 * returns `false` and MUST be classified as uncertain rather than automatically retryable.
 */
export function isReliablePreTransmissionSubmitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as {
    code?: unknown;
    name?: unknown;
    uncertain?: unknown;
    preTransmissionFailure?: unknown;
    cause?: unknown;
  };
  if (
    err.uncertain === true ||
    err.code === 'WHATSAPP_N8N_UNVERIFIED' ||
    err.name === 'TimeoutError' ||
    err.name === 'AbortError'
  ) {
    return false;
  }
  if (err.preTransmissionFailure === true) return true;
  if (typeof err.code === 'string' && PRE_TRANSMISSION_SYSTEM_CODES.has(err.code)) return true;
  const cause = err.cause as { code?: unknown; preTransmissionFailure?: unknown } | undefined;
  if (cause && typeof cause === 'object') {
    if (cause.preTransmissionFailure === true) return true;
    if (typeof cause.code === 'string' && PRE_TRANSMISSION_SYSTEM_CODES.has(cause.code)) return true;
  }
  return false;
}

/** Durable domain wired to owner/callback routes. Without approved send options it never fetches, sends or auto-replies. */
export class DurableWhatsAppService {
  /** Operator log sink for Meta delivery failures (server log only). Overridable in tests. */
  static deliveryFailureSink: (failure: WhatsAppDeliveryFailure) => void = failure => console.warn(JSON.stringify(failure));
  /** Operator log sink for WA-01 auto-reply recovery attention events. Overridable in tests. */
  static recoveryAttentionSink: (event: WhatsAppRecoveryAttentionEvent) => void = event => console.warn(JSON.stringify(event));
  private readonly failureDetails = new Map<string, Map<string, SanitizedDeliveryFailureDetail>>();
  private readonly submittedAutoReplyDispatches = new Set<string>();
  private readonly inFlightAutoReplySubmissions = new Set<string>();
  private readonly startupFailedConnections = new Set<string>();
  private readonly failedRecoveryMessagesByConn = new Map<string, Set<string>>();
  private readonly whatsAppAIService?: WhatsAppAIService;
  private startupRecoveryPromise: Promise<WhatsAppAutoReplyRecoveryResult>;

  constructor(
    private readonly store: WhatsAppStateStore,
    private readonly policy: PolicyGateway,
    private readonly now = Date.now,
    private readonly send?: DurableSendOptions,
    private readonly serviceOptions?: DurableWhatsAppServiceOptions
  ) {
    const mg = this.serviceOptions?.modelGateway ?? this.send?.modelGateway;
    if (mg) {
      this.whatsAppAIService = new WhatsAppAIService(mg);
    }
    // WA-01 (Issue 1): Automatically discover and process pending auto-replies on service startup/restart
    // without requiring another incoming WhatsApp webhook.
    if (this.send?.autoReply || this.send?.dispatcher?.autoReplyEnabled === true) {
      this.startupRecoveryPromise = Promise.resolve()
        .then(() => this.recoverConfiguredAutoReplies(true))
        .catch(() => {
          const p = this.send?.profile();
          if (p?.connectionId && p.connectionId !== '*') {
            this.recordStartupRecoveryFailure(p.connectionId);
          }
          return { ...EMPTY_RECOVERY_RESULT, failedRecovery: 1 };
        });
    } else {
      this.startupRecoveryPromise = Promise.resolve({ ...EMPTY_RECOVERY_RESULT });
    }
  }

  private getStoreTracker() {
    let tracker = storeSubmissionTracker.get(this.store);
    if (!tracker) {
      tracker = {
        submitted: new Set<string>(),
        inFlight: new Set<string>(),
        startupFailedConnections: new Set<string>(),
        failedMessageIdsByConnection: new Map<string, Set<string>>(),
        n8nAgentReplies: new Map<string, string>(),
        dynamicRecipientsByConnection: new Map<string, Map<string, DurableRecipient>>(),
        appointments: new Map<string, any>()
      };
      storeSubmissionTracker.set(this.store, tracker);
    }
    return tracker;
  }

  getDynamicRecipient(connectionId: string, recipientId: string): DurableRecipient | undefined {
    const tracker = this.getStoreTracker();
    const map = tracker.dynamicRecipientsByConnection.get(connectionId);
    let r = map?.get(recipientId);
    if (!r && recipientId.startsWith('c_')) {
      const cleanDigits = recipientId.slice(2);
      r = {
        id: recipientId,
        phoneE164: `+${cleanDigits}`,
        optedIn: true
      };
      if (map) map.set(recipientId, r);
    }
    return r;
  }

  getDynamicRecipientByPhone(connectionId: string, phone: string): DurableRecipient | undefined {
    const tracker = this.getStoreTracker();
    const cleanDigits = phone.replace(/\D/g, '');
    const map = tracker.dynamicRecipientsByConnection.get(connectionId);
    if (map) {
      for (const r of map.values()) {
        if (r.phoneE164.replace(/\D/g, '') === cleanDigits) return r;
      }
    }
    return undefined;
  }

  findRecipient(b: MetaWhatsAppTestConfig, recipientId: string): DurableRecipient | undefined {
    const direct = b.recipients.find(r => r.id === recipientId);
    if (direct) return direct;
    if (recipientId.startsWith('c_')) {
      const cleanDigits = recipientId.slice(2).replace(/\D/g, '');
      const byPhone = b.recipients.find(r => r.phoneE164.replace(/\D/g, '') === cleanDigits);
      if (byPhone) return byPhone;
    }
    return this.getDynamicRecipient(b.connectionId, recipientId);
  }

  setDynamicRecipient(connectionId: string, recipientId: string, recipient: DurableRecipient): void {
    const tracker = this.getStoreTracker();
    let map = tracker.dynamicRecipientsByConnection.get(connectionId);
    if (!map) {
      map = new Map();
      tracker.dynamicRecipientsByConnection.set(connectionId, map);
    }
    map.set(recipientId, recipient);
  }

  hasDynamicRecipientPhone(connectionId: string, phoneWithoutPlus: string): boolean {
    const tracker = this.getStoreTracker();
    const cleanDigits = phoneWithoutPlus.replace(/\D/g, '');
    const map = tracker.dynamicRecipientsByConnection.get(connectionId);
    if (map) {
      for (const r of map.values()) {
        if (r.phoneE164.replace(/\D/g, '') === cleanDigits) return true;
      }
    }
    return false;
  }

  getAppointment(workspaceId: string, connectionId: string, recipientId: string): any {
    const tracker = this.getStoreTracker();
    return tracker.appointments.get(`${workspaceId}:${connectionId}:${recipientId}`);
  }

  setAppointment(workspaceId: string, connectionId: string, recipientId: string, appointment: any): void {
    const tracker = this.getStoreTracker();
    tracker.appointments.set(`${workspaceId}:${connectionId}:${recipientId}`, appointment);
  }

  private emitRecoveryAttention(event: WhatsAppRecoveryAttentionEvent): void {
    try {
      DurableWhatsAppService.recoveryAttentionSink(event);
    } catch {
      /* logging never affects state */
    }
  }

  private recordStartupRecoveryFailure(connectionId: string): void {
    const tracker = this.getStoreTracker();
    this.startupFailedConnections.add(connectionId);
    tracker.startupFailedConnections.add(connectionId);
    this.emitRecoveryAttention({
      event: 'whatsapp_auto_reply_recovery_attention',
      connectionId,
      reason: 'startup_recovery_failed'
    });
  }

  private recordMessageRecoveryFailure(connectionId: string, providerMessageId: string, isStartup: boolean): void {
    const tracker = this.getStoreTracker();
    let localSet = this.failedRecoveryMessagesByConn.get(connectionId);
    if (!localSet) {
      localSet = new Set<string>();
      this.failedRecoveryMessagesByConn.set(connectionId, localSet);
    }
    localSet.add(providerMessageId);

    let sharedSet = tracker.failedMessageIdsByConnection.get(connectionId);
    if (!sharedSet) {
      sharedSet = new Set<string>();
      tracker.failedMessageIdsByConnection.set(connectionId, sharedSet);
    }
    sharedSet.add(providerMessageId);

    if (isStartup) {
      this.startupFailedConnections.add(connectionId);
      tracker.startupFailedConnections.add(connectionId);
    }
    this.emitRecoveryAttention({
      event: 'whatsapp_auto_reply_recovery_attention',
      connectionId,
      reason: isStartup ? 'startup_recovery_failed' : 'recovery_failed',
      inboundMessageRef: providerMessageId.slice(-10)
    });
  }

  private clearMessageRecoveryFailure(connectionId: string, providerMessageId: string): void {
    const tracker = this.getStoreTracker();
    this.failedRecoveryMessagesByConn.get(connectionId)?.delete(providerMessageId);
    tracker.failedMessageIdsByConnection.get(connectionId)?.delete(providerMessageId);
  }

  private getRecoveryAttentionState(connectionId: string): { startupRecoveryFailed: boolean; failedMessageIds: ReadonlySet<string> } {
    const tracker = this.getStoreTracker();
    const startupRecoveryFailed =
      this.startupFailedConnections.has(connectionId) || tracker.startupFailedConnections.has(connectionId);
    const combined = new Set<string>([
      ...(this.failedRecoveryMessagesByConn.get(connectionId) ?? []),
      ...(tracker.failedMessageIdsByConnection.get(connectionId) ?? [])
    ]);
    return { startupRecoveryFailed, failedMessageIds: combined };
  }

  private isDispatchSubmittedOrInFlight(dispatchId: string): boolean {
    const tracker = this.getStoreTracker();
    return (
      this.submittedAutoReplyDispatches.has(dispatchId) ||
      this.inFlightAutoReplySubmissions.has(dispatchId) ||
      tracker.submitted.has(dispatchId) ||
      tracker.inFlight.has(dispatchId)
    );
  }

  /**
   * Synchronously claims an uncommitted submission slot AFTER the database reservation transaction has committed.
   * Never called inside `this.run()`, so a transaction rollback can never pollute in-memory tracking.
   */
  private claimAutoReplySubmission(dispatchId: string): boolean {
    if (this.isDispatchSubmittedOrInFlight(dispatchId)) return false;
    const tracker = this.getStoreTracker();
    this.inFlightAutoReplySubmissions.add(dispatchId);
    tracker.inFlight.add(dispatchId);
    return true;
  }

  private completeAutoReplySubmission(dispatchId: string): void {
    const tracker = this.getStoreTracker();
    this.inFlightAutoReplySubmissions.delete(dispatchId);
    tracker.inFlight.delete(dispatchId);
    this.submittedAutoReplyDispatches.add(dispatchId);
    tracker.submitted.add(dispatchId);
  }

  private releaseFailedAutoReplySubmission(dispatchId: string): void {
    const tracker = this.getStoreTracker();
    this.inFlightAutoReplySubmissions.delete(dispatchId);
    tracker.inFlight.delete(dispatchId);
    this.submittedAutoReplyDispatches.delete(dispatchId);
    tracker.submitted.delete(dispatchId);
  }

  /** Awaits automatic startup recovery (and runs a pass if auto-reply was enabled dynamically). */
  async waitForStartupRecovery(): Promise<WhatsAppAutoReplyRecoveryResult> {
    const initial = await this.startupRecoveryPromise;
    if (
      initial.reserved === 0 &&
      initial.submitted === 0 &&
      initial.expired === 0 &&
      initial.skippedUncertain === 0 &&
      initial.failedRecovery === 0 &&
      this.resolveAutoReplyConfig()?.enabled === true
    ) {
      return this.recoverConfiguredAutoReplies(true);
    }
    return initial;
  }

  /**
   * WA-01 (Issue 1): Discovers configured/owned connections and recovers pending automatic replies
   * without requiring a new incoming WhatsApp webhook.
   */
  async recoverConfiguredAutoReplies(isStartup = false): Promise<WhatsAppAutoReplyRecoveryResult> {
    const ar = this.resolveAutoReplyConfig(), profile = this.send?.profile();
    if (!ar?.enabled || !profile) {
      return { ...EMPTY_RECOVERY_RESULT };
    }
    let ownerScope = ar.ownerScope ?? null;
    if (!ownerScope && profile.connectionId && profile.connectionId !== '*' && this.store.resolveAutoReplyOwnerScopeByConnection) {
      try {
        ownerScope = await this.store.resolveAutoReplyOwnerScopeByConnection(profile.connectionId);
      } catch {
        ownerScope = null;
      }
    }
    if (!ownerScope?.sessionTokenHash) {
      return { ...EMPTY_RECOVERY_RESULT };
    }
    const connectionIds = new Set<string>();
    if (profile.connectionId && profile.connectionId !== '*') {
      connectionIds.add(profile.connectionId);
    }
    if (this.store.listOwned) {
      try {
        const owned = await this.store.listOwned(ownerScope);
        for (const conn of owned) {
          if (!conn.disconnected && this.autoReplyFor(conn.connectionId)) {
            connectionIds.add(conn.connectionId);
          }
        }
      } catch {
        if (isStartup && profile.connectionId && profile.connectionId !== '*') {
          this.recordStartupRecoveryFailure(profile.connectionId);
        }
      }
    }
    const totals: WhatsAppAutoReplyRecoveryResult = { ...EMPTY_RECOVERY_RESULT };
    for (const connId of connectionIds) {
      if (!this.autoReplyFor(connId)) continue;
      try {
        const res = await this.processCustomerAutoReplies(ownerScope, connId, isStartup);
        totals.reserved += res.reserved;
        totals.submitted += res.submitted;
        totals.expired += res.expired;
        totals.skippedUncertain += res.skippedUncertain;
        totals.failedRecovery += res.failedRecovery;
      } catch {
        totals.failedRecovery += 1;
        if (isStartup) {
          this.recordStartupRecoveryFailure(connId);
        }
      }
    }
    return totals;
  }

  /** Live sending is on for this connection only while an approved, unexpired profile names it. */
  private liveFor(connectionId: string) {
    const p = this.send?.profile();
    return !!p && p.connectionId === connectionId && this.now() < p.expiresAt;
  }
  private resolveAutoReplyConfig(): WhatsAppAutoReplyOptions | null {
    if (this.send?.autoReply) {
      return typeof this.send.autoReply === 'function' ? this.send.autoReply() : this.send.autoReply;
    }
    if (this.send?.dispatcher?.autoReplyEnabled === true && typeof this.store.resolveAutoReplyOwnerScope === 'function') {
      return {
        enabled: true,
        authorizeDraft: async (_scope, draft, tx) => {
          if (tx?.createAutoReplyApproval) {
            return tx.createAutoReplyApproval(draft);
          }
          return '';
        }
      };
    }
    return null;
  }
  /** Customer-service auto-reply is disabled by default; active only when live sending AND explicit auto-reply are both enabled. */
  autoReplyFor(connectionId: string): boolean {
    if (!this.liveFor(connectionId)) return false;
    const p = this.send?.profile();
    if (p?.autoReply === false) return false;
    const ar = this.resolveAutoReplyConfig();
    return ar?.enabled === true;
  }

  /** Latest valid inbound timestamp (ms) for a recipient, or null if none. */
  private latestInboundTime(tx: WhatsAppStateTransaction, recipientId: string): number | null {
    const times = tx.state.messages
      .filter(m => m.recipientId === recipientId)
      .map(m => Date.parse(m.timestamp))
      .filter(t => Number.isFinite(t) && t > 0);
    return times.length > 0 ? Math.max(...times) : null;
  }

  /** WA-05: Canonical 24-hour customer-service window gate. Rejects missing, future-dated (latest > now), and expired (>=24h) timestamps. */
  private isCustomerServiceWindowOpen(tx: WhatsAppStateTransaction, recipientId: string, now = this.now()): boolean {
    const latest = this.latestInboundTime(tx, recipientId);
    return latest !== null && latest <= now && now - latest < CUSTOMER_SERVICE_WINDOW_MS;
  }

  /** True only for the profiled connection and recipient (or any opted-in contact for '*'), inside Meta's 24 h window, under the cap and before expiry. */
  private sendAllowed(tx: WhatsAppStateTransaction, d: WhatsAppDispatchRecord) {
    const p = this.send?.profile(), now = this.now(), b = tx.state.binding;
    const recipient = b.recipients.find(r => r.id === d.draft.recipientId) ?? this.getDynamicRecipient(b.connectionId, d.draft.recipientId);
    if (!p || p.connectionId !== b.connectionId || !recipient?.optedIn || (p.recipientId !== '*' && p.recipientId !== d.draft.recipientId) || !(now < p.expiresAt) || !validCap(p.maxPerDay)) return false;
    if (!('bodyText' in d.draft) && p.richMessages !== true) return false;
    if (!('template' in d.draft) && !this.isCustomerServiceWindowOpen(tx, d.draft.recipientId, now)) return false;
    return p.maxPerDay === null || tx.state.dispatches.filter(o => o.id !== d.id && o.claimedAt !== null && now - o.claimedAt < CUSTOMER_SERVICE_WINDOW_MS).length < p.maxPerDay;
  }

  async resolveRelay(tokenHash: string, id: string, operation: WhatsAppRelayOperation) {
    if (!this.store.resolveRelay) throw new AppError('WhatsApp callback storage is not configured.', 'WHATSAPP_RELAY_UNAVAILABLE', 503);
    return this.store.resolveRelay(tokenHash, id, operation);
  }

  private async run<T>(scope: WhatsAppExecutionScope, id: string, work: (tx: WhatsAppStateTransaction, caller: WhatsAppExecutionScope) => Promise<T>, allowDisconnected = false, relayOperation?: WhatsAppRelayOperation) {
    const caller = { ...scope };
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || caller.role === 'viewer' || (isWhatsAppRelayScope(caller) ? (caller.operation !== relayOperation || 'sessionTokenHash' in caller || caller.connectionId !== id) : !caller.sessionTokenHash)) throw denied();
    return this.store.transaction(caller, id, async tx => {
      const b = tx.state.binding;
      if (b.workspaceId !== caller.workspaceId || b.userId !== caller.userId || b.connectionId !== id || (!allowDisconnected && tx.state.disconnected) || !this.policy.evaluate(caller, { actionName: 'whatsapp.connection.status', parameters: {} }).allowed) throw denied();
      await tx.assertAuthorized();
      const result = await work(tx, caller);
      await tx.assertAuthorized();
      return structuredClone(result);
    });
  }
  private async approved(tx: WhatsAppStateTransaction, scope: RequestScope, draft: MetaWhatsAppAnySendInput, approvalId: string, decisionOnly = false) {
    const saved = await tx.approval(approvalId), approval = saved && decisionOnly && ['pending', 'approved'].includes(saved.status) ? { ...saved, status: 'approved' as const, approverUserId: scope.userId } : saved, b = tx.state.binding, recipient = b.recipients.find(r => r.id === draft.recipientId) ?? this.getDynamicRecipient(b.connectionId, draft.recipientId);
    const windowOpen = recipient ? this.isCustomerServiceWindowOpen(tx, recipient.id) : false;
    const consentSatisfied = Boolean(recipient?.optedIn || windowOpen);
    if (!Draft.Check(draft) || !approval || approval.id !== approvalId || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= this.now() || !this.policy.evaluate(scope, { actionName: 'whatsapp.meta.messages.send', parameters: draft, idempotencyKey: draft.idempotencyKey }, approval, scope.userId).allowed || tx.state.disconnected || draft.connectionId !== b.connectionId || draft.connectionRevision !== b.revision || draft.senderPhoneNumberId !== b.phoneNumberId || !recipient || !consentSatisfied) throw denied();
    const messages = tx.state.messages.filter(m => m.recipientId === recipient.id);
    // Approved templates are Meta's mechanism outside the 24 h window; text and media must be inside it (and never future-dated).
    const replyTo = 'replyToProviderMessageId' in draft ? draft.replyToProviderMessageId : undefined;
    if ((!('template' in draft) && !this.isCustomerServiceWindowOpen(tx, recipient.id)) || (replyTo && !messages.some(m => m.providerMessageId === replyTo))) throw denied();
    await tx.assertAuthorized(); return recipient;
  }
  private eventTime(seconds: string) {
    const time = Number(seconds) * 1000;
    if (!Number.isSafeInteger(time) || time < this.now() - 604800000 || time > this.now() + 300000) throw denied();
    return new Date(time).toISOString();
  }
  private reconcile(tx: WhatsAppStateTransaction, dispatch: WhatsAppDispatchRecord) {
    const recipient = this.findRecipient(tx.state.binding, dispatch.draft.recipientId);
    if (!recipient) throw denied();
    // Persistent rows have no arrival order. Sort provider timestamps, with failure winning a sent tie.
    // Rebuild from all correlated evidence so replay order cannot flip sent/failed after restart.
    const tie = { sent: 0, failed: 1, delivered: 2, read: 3 };
    const events = tx.state.events.filter(e => e.providerMessageId === dispatch.receipt.providerMessageId && e.recipientAddress === recipient.phoneE164.slice(1))
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp) || tie[a.status] - tie[b.status]);
    if (events.length) dispatch.receipt.status = 'unverified';
    for (const event of events) {
      dispatch.receipt = { ...dispatch.receipt, ...advanceMetaTestReceipt(dispatch.receipt, event, recipient.phoneE164.slice(1)) };
    }
    return dispatch.receipt;
  }
  status(scope: AuthenticatedScope, id: string) {
    return this.run(scope, id, async tx => ({ transport: 'n8n' as const, mode: 'offline_test' as const, configured: false, liveSendingEnabled: false as const, storage: 'postgresql_offline' as const, revision: tx.state.binding.revision, disconnected: tx.state.disconnected }), true);
  }
  history(scope: AuthenticatedScope, id: string) {
    return this.run(scope, id, async tx => tx.state.messages.map(({ autoReply: _ar, ...m }) => ({ ...m })).sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
  }
  async inbox(scope: AuthenticatedScope, id: string, query: N8nWhatsAppInboxQuery = {}) {
    const input = snapshot(query);
    return this.run(scope, id, async (tx, caller) => {
      if (isWhatsAppRelayScope(caller)) throw denied();
      const attention = this.getRecoveryAttentionState(id);
      return {
        ...projectWhatsAppInbox(caller, tx.state, input, this.failureDetails.get(id), this.now(), attention, this.getStoreTracker().dynamicRecipientsByConnection.get(id)),
        liveSendingEnabled: this.liveFor(id)
      };
    });
  }
  /** Authorized contacts with masked numbers and truthful eligibility (opt-in and Meta's 24 h customer-service window). Read-only. */
  async contacts(scope: AuthenticatedScope, id: string) {
    return this.run(scope, id, async (tx, caller) => {
      if (isWhatsAppRelayScope(caller)) throw denied();
      const b = tx.state.binding, now = this.now();
      return { connectionId: b.connectionId, revision: b.revision, liveSendingEnabled: this.liveFor(id), contacts: b.recipients.map(r => {
        const last = this.latestInboundTime(tx, r.id);
        const lastInboundAt = last === null ? null : new Date(last).toISOString();
        return { recipientId: r.id, contactName: formatWhatsAppContactName(r.id, r.displayName), maskedPhone: maskPhoneNumber(r.phoneE164), optedIn: r.optedIn, lastInboundAt,
          eligibility: !r.optedIn ? 'not_opted_in' as const : this.isCustomerServiceWindowOpen(tx, r.id, now) ? 'eligible' as const : 'window_closed' as const };
      }) };
    });
  }
  /** Server-built template or media draft for approval (never sent here). Media must be inside the 24 h window; templates need not. */
  async contentDraft(scope: AuthenticatedScope, id: string, recipientId: string, content: { template: Extract<MetaWhatsAppAnySendInput, { template: unknown }>['template'] } | { media: Extract<MetaWhatsAppAnySendInput, { media: unknown }>['media'] }) {
    await this.ensureRecipientRegistered(scope, id, recipientId);
    return this.run(scope, id, async (tx, caller) => {
      if (isWhatsAppRelayScope(caller)) throw denied();
      const b = tx.state.binding, recipient = this.findRecipient(b, recipientId);
      if (!recipient?.optedIn) throw denied();
      if ('media' in content && !this.isCustomerServiceWindowOpen(tx, recipient.id)) {
        throw new AppError('The 24-hour reply window is closed; use an approved template.', 'WHATSAPP_WINDOW_CLOSED', 409);
      }
      const draft = { connectionId: b.connectionId, connectionRevision: b.revision, senderPhoneNumberId: b.phoneNumberId, recipientId: recipient.id, idempotencyKey: ('template' in content ? 'tmpl-' : 'media-') + randomUUID(), ...content };
      if (!Draft.Check(draft)) throw new AppError('Invalid WhatsApp message.', 'WHATSAPP_DURABLE_INVALID', 400);
      return { draft, actionName: 'whatsapp.meta.messages.send' as const, riskLevel: 'high' as const, liveSendingEnabled: false as const };
    });
  }
  /** Owner-only contact management: replaces the recipient list (1–5, unique IDs/numbers, explicit opt-in), revision +1, audited. */
  async updateContacts(scope: AuthenticatedScope, id: string, input: unknown) {
    const list = snapshot(input) as Array<{ id?: unknown; phoneE164?: unknown; optedIn?: unknown; displayName?: unknown }>;
    const valid = Array.isArray(list) && list.length >= 1 && list.length <= 500 && list.every(r => r && typeof r === 'object'
      && Object.keys(r).every(k => ['id', 'phoneE164', 'optedIn', 'displayName', 'appointment'].includes(k))
      && typeof r.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(r.id) && (r.phoneE164 === undefined || (typeof r.phoneE164 === 'string' && /^\+[1-9][0-9]{7,14}$/.test(r.phoneE164)))
      && typeof r.optedIn === 'boolean' && (r.displayName === undefined || (typeof r.displayName === 'string' && /^[^\u0000-\u001f\u007f]{1,80}$/.test(r.displayName))))
      && new Set(list.map(r => r.id)).size === list.length;
    if (!valid) throw new AppError('Invalid WhatsApp contacts.', 'WHATSAPP_DURABLE_INVALID', 400);
    return this.run(scope, id, async (tx, caller) => {
      if (isWhatsAppRelayScope(caller) || caller.role === 'member') throw denied();
      const b = tx.state.binding, invalid = () => new AppError('Invalid WhatsApp contacts.', 'WHATSAPP_DURABLE_INVALID', 400);
      const recipients = list.map(r => {
        const existing = b.recipients.find(x => x.id === r.id);
        // A known contact keeps its stored number unless a new one is given; a new contact must bring one.
        const phoneE164 = (r.phoneE164 as string | undefined) ?? existing?.phoneE164;
        if (!phoneE164) throw invalid();
        return { id: r.id as string, phoneE164, optedIn: r.optedIn as boolean, ...(r.displayName ? { displayName: r.displayName as string } : {}) };
      });
      if (new Set(recipients.map(r => r.phoneE164)).size !== recipients.length) throw invalid();
      if (isDeepStrictEqual(b.recipients, recipients)) throw new AppError('Contacts are unchanged.', 'WHATSAPP_DURABLE_INVALID', 400);
      b.recipients = recipients; b.revision += 1;
      await tx.audit('whatsapp.durable.contacts_updated', { revision: b.revision });
      return { connectionId: b.connectionId, revision: b.revision, contacts: recipients.length };
    });
  }
  /** Idempotently registers a newly messaged recipient into the connection binding so dispatch triggers succeed. */
  async ensureRecipientRegistered(
    scope: AuthenticatedScope,
    id: string,
    recipientId: string,
    details?: { phoneE164?: string; displayName?: string }
  ): Promise<boolean> {
    const existing = await this.run(scope, id, async tx => {
      const found = tx.state.binding.recipients.find(r => r.id === recipientId);
      return { found: Boolean(found), recipients: tx.state.binding.recipients };
    }, true).catch(() => null);
    if (!existing || existing.found) return true;

    const dyn = this.getDynamicRecipient(id, recipientId);
    let phoneE164 = details?.phoneE164 ?? dyn?.phoneE164;
    if (!phoneE164 && recipientId.startsWith('c_')) {
      const cleanDigits = recipientId.slice(2).replace(/\D/g, '');
      if (cleanDigits.length >= 7 && cleanDigits.length <= 15) {
        phoneE164 = `+${cleanDigits}`;
      }
    }
    if (!phoneE164) return false;
    const byPhone = existing.recipients.find(r => r.phoneE164 === phoneE164);
    if (byPhone) return true;

    let displayName = details?.displayName ?? dyn?.displayName;
    if (displayName && (/^c \d+/i.test(displayName) || /^\+\d+/.test(displayName))) {
      displayName = undefined;
    }

    const newContact = {
      id: recipientId,
      phoneE164,
      optedIn: true,
      ...(displayName ? { displayName } : {})
    };

    // Inbound dynamic customers (c_<digits>) are tracked dynamically in memory / durable tracker.
    // They are authorized against verified 24-hour service-window records in whatsapp_n8n_messages without mutating connection revision.
    if (recipientId.startsWith('c_')) {
      this.setDynamicRecipient(id, recipientId, newContact);
      return true;
    }

    // Static named contacts are bounded by 50 entries (no sliding window or arbitrary eviction).
    const remainingExisting = existing.recipients.filter(
      r => r.id !== recipientId && r.phoneE164 !== phoneE164
    );
    const updatedList = [...remainingExisting, newContact];
    if (updatedList.length > 50) {
      return false;
    }
    try {
      await this.updateContacts(scope, id, updatedList);
      return true;
    } catch {
      return false;
    }
  }
  async updateRecipientAppointment(
    scope: AuthenticatedScope,
    id: string,
    recipientId: string,
    appointment: any,
    auditAction?: 'appointment_confirmed' | 'appointment_rescheduled' | 'appointment_cancelled'
  ) {
    if (appointment && typeof appointment === 'object') {
      appointment.bookingLinkSent = true;
    }
    this.setAppointment(scope.workspaceId, id, recipientId, appointment);
    const dyn = this.getDynamicRecipient(id, recipientId);
    if (dyn) {
      (dyn as any).appointment = appointment;
      this.setDynamicRecipient(id, recipientId, dyn);
    }
    return this.run(scope, id, async (tx, caller) => {
      if (isWhatsAppRelayScope(caller)) throw denied();
      if (auditAction) {
        await tx.audit('whatsapp.durable.contacts_updated', { revision: tx.state.binding.revision });
      }
      return { recipientId, revision: tx.state.binding.revision, appointment };
    });
  }

  async dispatchAppointmentApproval(
    scope: AuthenticatedScope,
    id: string,
    recipientId: string,
    appointment: any,
    bodyText: string
  ): Promise<{ status: 'AWAITING_CUSTOMER_BOOKING'; calendlyUrl: string; bookingLinkSent: true; preparedConfirmationReply: string; receipt?: N8nWhatsAppReceipt; alreadySent?: boolean }> {
    if (scope.role === 'viewer') throw denied();
    const result = await this.run(scope, id, async (tx, caller) => {
      if (isWhatsAppRelayScope(caller)) throw denied();
      const dyn = this.getDynamicRecipient(id, recipientId);
      if (dyn) {
        (dyn as any).appointment = appointment;
        this.setDynamicRecipient(id, recipientId, dyn);
      }

      const b = tx.state.binding;
      // Durable unique consultation identity scoped to connection, recipient, and consultation request.
      // Every consultation request must have a durable unique identity; never fall back to generic 'consultation'.
      let consultationIdentity = appointment?.consultationId;
      if (!consultationIdentity || consultationIdentity === 'consultation') {
        const existingDispatch = tx.state.dispatches.find(
          d => d.draft.recipientId === recipientId && d.draft.idempotencyKey.startsWith(`calendly-link-${id}-${recipientId}-`)
        );
        if (existingDispatch) {
          consultationIdentity = existingDispatch.draft.idempotencyKey.replace(`calendly-link-${id}-${recipientId}-`, '');
        } else if (appointment?.startAt && appointment?.startAt !== 'null') {
          consultationIdentity = `slot-${appointment.startAt}`;
        } else if (appointment?.date && appointment?.date !== 'null') {
          consultationIdentity = `date-${appointment.date}`;
        } else {
          consultationIdentity = `req-${randomUUID()}`;
        }
        if (appointment && typeof appointment === 'object') {
          appointment.consultationId = consultationIdentity;
        }
      }
      const idempotencyKey = `calendly-link-${id}-${recipientId}-${consultationIdentity}`;
      const draft: MetaWhatsAppSendInput = {
        connectionId: b.connectionId,
        connectionRevision: b.revision,
        senderPhoneNumberId: b.phoneNumberId,
        recipientId,
        bodyText,
        idempotencyKey
      };

      const parameterHash = computeCanonicalParameterHash(draft);
      const existingIndex = tx.state.dispatches.findIndex(d => d.draft.idempotencyKey === draft.idempotencyKey);
      if (existingIndex >= 0) {
        const existing = tx.state.dispatches[existingIndex]!;
        // The provider has accepted only when there is an external provider message ID and status is sent/delivered/read.
        const isProviderAccepted = Boolean(
          existing.receipt.providerMessageId !== null &&
          ['sent', 'delivered', 'read'].includes(existing.receipt.status)
        );
        const isExpiredUnclaimed = existing.claimedAt === null && this.now() >= existing.expiresAt;
        const isExpiredClaimed = existing.claimedAt !== null && !isProviderAccepted && (this.now() - existing.claimedAt > 60000);
        const isFailed = existing.receipt.status === 'failed';

        if (isProviderAccepted) {
          // Repeated clicks or retries for a dispatch ALREADY accepted by the provider:
          // do not resubmit, report alreadySent: true.
          return {
            status: 'AWAITING_CUSTOMER_BOOKING' as const,
            calendlyUrl: appointment.calendlyUrl,
            bookingLinkSent: true as const,
            preparedConfirmationReply: bodyText,
            receipt: existing.receipt,
            dispatchId: existing.id,
            revision: b.revision,
            shouldSubmit: false,
            alreadySent: true
          };
        }

        if (isFailed || isExpiredUnclaimed || isExpiredClaimed) {
          // Safe recovery of failed or expired reservations: remove stale dispatch and allow fresh reservation.
          tx.state.dispatches.splice(existingIndex, 1);
        } else {
          // In-flight dispatch pending claim or provider ack: do not duplicate send,
          // and prevent incorrect alreadySent responses when the provider has not accepted the dispatch.
          return {
            status: 'AWAITING_CUSTOMER_BOOKING' as const,
            calendlyUrl: appointment.calendlyUrl,
            bookingLinkSent: true as const,
            preparedConfirmationReply: bodyText,
            receipt: existing.receipt,
            dispatchId: existing.id,
            revision: b.revision,
            shouldSubmit: false,
            alreadySent: false
          };
        }
      }

      const dispatchId = randomUUID(), createdAt = this.now();
      const receipt: N8nWhatsAppReceipt = {
        transport: 'n8n',
        mode: 'offline_test',
        dispatchId,
        providerMessageId: null,
        status: 'not_configured',
        verified: false
      };
      await tx.audit('whatsapp.durable.reserved', { dispatchId, revision: b.revision });
      let approvalId = randomUUID() as `${string}-${string}-${string}-${string}-${string}`;
      if (typeof tx.createAutoReplyApproval === 'function') {
        approvalId = (await tx.createAutoReplyApproval(draft)) as `${string}-${string}-${string}-${string}-${string}`;
      }
      tx.state.dispatches.push({
        id: dispatchId,
        draft,
        parameterHash,
        approvalId,
        createdAt,
        expiresAt: createdAt + 60000,
        claimedAt: null,
        receipt
      });

      return {
        status: 'AWAITING_CUSTOMER_BOOKING' as const,
        calendlyUrl: appointment.calendlyUrl,
        bookingLinkSent: true as const,
        preparedConfirmationReply: bodyText,
        receipt,
        dispatchId,
        revision: b.revision,
        shouldSubmit: true
      };
    });

    if (appointment && typeof appointment === 'object') {
      appointment.bookingLinkSent = true;
    }
    this.setAppointment(scope.workspaceId, id, recipientId, appointment);

    const sendInst = this.send;
    if (result.shouldSubmit && result.dispatchId && sendInst?.dispatcher) {
      const profile = sendInst.profile();
      if (
        profile &&
        profile.connectionId === id &&
        (profile.recipientId === '*' || profile.recipientId === recipientId) &&
        this.now() < profile.expiresAt &&
        validCap(profile.maxPerDay)
      ) {
        try {
          await sendInst.dispatcher.submit({ connectionId: id, revision: result.revision, dispatchId: result.dispatchId });
        } catch {
          // pre-transmission or network error: dispatch remains recorded
        }
      }
    }

    return {
      status: result.status,
      calendlyUrl: result.calendlyUrl,
      bookingLinkSent: result.bookingLinkSent,
      preparedConfirmationReply: result.preparedConfirmationReply,
      receipt: result.receipt,
      alreadySent: result.alreadySent
    };
  }
  async getRecipient(scope: AuthenticatedScope, id: string, recipientId: string) {
    return this.run(scope, id, async (tx, caller) => {
      if (isWhatsAppRelayScope(caller)) throw denied();
      const b = tx.state.binding;
      let recipient = b.recipients.find(r => r.id === recipientId) ?? this.getDynamicRecipient(id, recipientId);
      if (!recipient && recipientId.startsWith('c_')) {
        const cleanDigits = recipientId.slice(2);
        recipient = {
          id: recipientId,
          phoneE164: `+${cleanDigits}`,
          optedIn: true
        };
        this.setDynamicRecipient(id, recipientId, recipient);
      }
      if (!recipient) return null;
      let appt = this.getAppointment(scope.workspaceId, id, recipientId) ?? (recipient as any).appointment;
      if (!appt) {
        // Reconstruct durable consultation state from persisted PostgreSQL dispatches across restarts
        const existingDispatch = tx.state.dispatches
          .filter(d => d.draft.recipientId === recipientId && d.draft.idempotencyKey.startsWith(`calendly-link-${id}-${recipientId}-`))
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (existingDispatch) {
          const consultationIdentity = existingDispatch.draft.idempotencyKey.replace(`calendly-link-${id}-${recipientId}-`, '');
          const isAccepted = Boolean(
            existingDispatch.receipt.providerMessageId !== null &&
            ['sent', 'delivered', 'read'].includes(existingDispatch.receipt.status)
          );
          appt = {
            status: 'AWAITING_CUSTOMER_BOOKING',
            calendlyUrl: 'https://calendly.com/team-brandmint/30min',
            linkSentAt: new Date(existingDispatch.createdAt).toISOString(),
            bookingLinkSent: true,
            consultationId: consultationIdentity,
            bookingEvidenceVerified: isAccepted
          };
          this.setAppointment(scope.workspaceId, id, recipientId, appt);
        }
      }
      const enrichedRecipient = appt ? { ...recipient, appointment: appt } : { ...recipient };
      const messages = tx.state.messages.filter(m => m.recipientId === recipientId);
      return { recipient: enrichedRecipient, messages };
    });
  }
  /** Owner-scoped business account and phone IDs of the connection (server-side use only; never sent to browsers). */
  async authorizePersonalApproval(scope: AuthenticatedScope, connectionId: string, approvalId: string) {
    return this.run(scope, connectionId, async (tx, caller) => {
      if (isWhatsAppRelayScope(caller)) throw denied();
      const approval = await tx.approval(approvalId);
      if (!approval || approval.requesterUserId !== caller.userId || approval.riskLevel !== 'high' || !['pending', 'approved'].includes(approval.status)) throw denied();
      if (approval.actionName === 'whatsapp.meta.messages.send') { await this.approved(tx, caller, approval.actionParams as MetaWhatsAppAnySendInput, approvalId, true); return; }
      const intent = approval.actionParams, b = tx.state.binding;
      if (approval.actionName !== WHATSAPP_MEDIA_UPLOAD_ACTION || !isWhatsAppUploadIntent(intent) || intent.connectionId !== b.connectionId || intent.connectionRevision !== b.revision || intent.senderPhoneNumberId !== b.phoneNumberId
        || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= this.now() || !this.policy.evaluate(caller, { actionName: WHATSAPP_MEDIA_UPLOAD_ACTION, parameters: intent, idempotencyKey: intent.idempotencyKey }, { ...approval, status: 'approved', approverUserId: caller.userId }, caller.userId).allowed) throw denied();
    });
  }
  async accountIds(scope: AuthenticatedScope, id: string) {
    return this.run(scope, id, async (tx, caller) => {
      if (isWhatsAppRelayScope(caller)) throw denied();
      return { businessAccountId: tx.state.binding.businessAccountId, phoneNumberId: tx.state.binding.phoneNumberId, revision: tx.state.binding.revision };
    });
  }
  /** Owner-scoped lookup of a saved incoming attachment reference. Never returned to browsers; no provider I/O here. */
  async mediaReference(scope: AuthenticatedScope, id: string, providerMessageId: string) {
    return this.run(scope, id, async (tx, caller) => {
      if (isWhatsAppRelayScope(caller)) throw denied();
      const media = tx.state.messages.find(m => m.providerMessageId === providerMessageId)?.media;
      if (!media) throw denied();
      return { kind: media.kind, mediaId: media.mediaId, mimeType: media.mimeType, sha256: media.sha256, ...(media.filename ? { filename: media.filename } : {}) };
    });
  }
  async connections(scope: AuthenticatedScope) {
    const caller = { ...scope };
    if (!caller.sessionTokenHash || !this.policy.evaluate(caller, { actionName: 'whatsapp.connection.status', parameters: {} }).allowed) throw denied();
    if (!this.store.listOwned) throw new AppError('WhatsApp inbox storage is unavailable.', 'WHATSAPP_INBOX_UNAVAILABLE', 503);
    const owned = await this.store.listOwned(caller); const liveOwned = owned.filter(c => !c.disconnected && this.liveFor(c.connectionId)); return { mode: 'offline_test' as const, liveSendingEnabled: false as const, connections: liveOwned.length > 0 ? liveOwned : owned };
  }

  /**
   * WA-03: Distinguishes recipient-specific failures from genuine connection-wide failures (such as Meta 131042).
   * A failed dispatch halts auto-replies for `recipientId` if:
   *  1. The failed dispatch was addressed to `recipientId`, OR
   *  2. The failed dispatch was on the same connection AND its correlated failure metadata is a connection-wide failure.
   */
  private hasBlockingDeliveryFailure(tx: WhatsAppStateTransaction, connectionId: string, recipientId: string, now = this.now()): boolean {
    const inMemoryFailures = this.failureDetails.get(connectionId);
    for (const d of tx.state.dispatches) {
      if (d.receipt.status !== 'failed' || d.createdAt > now || now - d.createdAt >= CUSTOMER_SERVICE_WINDOW_MS) continue;
      if (d.draft.recipientId === recipientId) return true;
      if (d.draft.connectionId === connectionId && d.receipt.providerMessageId) {
        const statusEvent = tx.state.events.find(
          e => e.providerMessageId === d.receipt.providerMessageId && e.status === 'failed' && e.failure
        );
        const failure = statusEvent?.failure ?? inMemoryFailures?.get(d.receipt.providerMessageId) ?? null;
        if (isConnectionWideDeliveryFailure(failure)) return true;
      }
    }
    return false;
  }

  private getAutoReplyLimits() {
    const ar = this.resolveAutoReplyConfig();
    const maxPerRecipient = Math.min(
      MAX_AUTO_REPLIES_PER_RECIPIENT_PER_DAY,
      Math.max(1, Number.isSafeInteger(ar?.maxPerRecipientPerDay) ? ar!.maxPerRecipientPerDay! : DEFAULT_MAX_AUTO_REPLIES_PER_RECIPIENT_PER_DAY)
    );
    const cooldownMs = Math.max(0, Number.isSafeInteger(ar?.cooldownMs) ? ar!.cooldownMs! : 0);
    return { maxPerRecipient, cooldownMs };
  }

  /**
   * WA-02: Evaluates per-recipient 24h auto-reply cap, cooldown, and identical-text ping-pong loop guard
   * against the current locked transaction state.
   */
  private isBlockedByAutoReplyLoopOrRateGuard(
    tx: WhatsAppStateTransaction,
    recipientId: string,
    providerMessageId: string,
    textPreview: string,
    msgTime: number,
    now = this.now()
  ): boolean {
    const { maxPerRecipient, cooldownMs } = this.getAutoReplyLimits();
    const recentRecipientAutoReplies = tx.state.dispatches.filter(
      d =>
        d.draft.recipientId === recipientId &&
        d.draft.idempotencyKey.startsWith('auto-reply-') &&
        d.createdAt <= now &&
        now - d.createdAt < CUSTOMER_SERVICE_WINDOW_MS &&
        !(d.claimedAt === null && d.receipt.status === 'not_configured' && now >= d.expiresAt)
    );
    if (recentRecipientAutoReplies.length >= maxPerRecipient) return true;
    if (
      cooldownMs > 0 &&
      recentRecipientAutoReplies.some(
        d => now - d.createdAt < cooldownMs || (msgTime >= d.createdAt && msgTime - d.createdAt < cooldownMs)
      )
    ) {
      return true;
    }

    const normalizedLatest = textPreview.trim().toLocaleLowerCase('en');
    const answeredMessageIds = new Set(
      recentRecipientAutoReplies
        .map(d => ('replyToProviderMessageId' in d.draft ? d.draft.replyToProviderMessageId : undefined))
        .filter((x): x is string => typeof x === 'string')
    );
    const priorAnsweredForRecipient = tx.state.messages
      .filter(
        m =>
          m.recipientId === recipientId &&
          m.providerMessageId !== providerMessageId &&
          answeredMessageIds.has(m.providerMessageId) &&
          now - Date.parse(m.timestamp) < CUSTOMER_SERVICE_WINDOW_MS
      )
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const mostRecentAnswered = priorAnsweredForRecipient[priorAnsweredForRecipient.length - 1];
    return Boolean(
      mostRecentAnswered && mostRecentAnswered.textPreview.trim().toLocaleLowerCase('en') === normalizedLatest
    );
  }

  /**
   * WA-01: Computes the durable per-inbound-message auto-reply metadata at ingestion time when auto-reply is enabled.
   */
  private computeInitialMessageAutoReply(
    tx: WhatsAppStateTransaction,
    connectionId: string,
    providerMessageId: string,
    recipient: WhatsAppStateTransaction['state']['binding']['recipients'][number],
    textPreview: string,
    timestamp: string,
    n8nAgentReply?: string
  ): WhatsAppStoredAutoReplyMetadata | undefined {
    if (!this.autoReplyFor(connectionId)) return undefined;
    const now = this.now();
    const evaluatedAt = new Date(now).toISOString();
    const idempotencyKey = buildAutoReplyIdempotencyKey(providerMessageId);
    const profile = this.send?.profile();
    if (!recipient.optedIn || !profile || (profile.recipientId !== '*' && profile.recipientId !== recipient.id)) {
      return { status: 'disabled', idempotencyKey, evaluatedAt };
    }

    const msgTime = Date.parse(timestamp);
    if (!Number.isFinite(msgTime) || msgTime <= 0 || msgTime > now || now - msgTime >= CUSTOMER_SERVICE_WINDOW_MS) {
      return { status: 'skipped_window_closed', idempotencyKey, evaluatedAt };
    }

    const activeOutboundMessages = tx.state.dispatches
      .filter(
        d =>
          d.draft.recipientId === recipient.id &&
          d.receipt.status !== 'failed' &&
          !(d.claimedAt === null && d.receipt.status === 'not_configured' && now >= d.expiresAt)
      )
      .map(d => ({
        providerMessageId: d.receipt.providerMessageId,
        direction: 'outbound' as const,
        textPreview: sanitizeWhatsAppText(whatsappDraftPreview(d.draft)).slice(0, 2048),
        timestamp: new Date(d.createdAt).toISOString()
      }));

    const recipientMessages = [
      ...tx.state.messages
        .filter(m => m.recipientId === recipient.id)
        .map(m => ({
          providerMessageId: m.providerMessageId,
          direction: 'inbound' as const,
          textPreview: m.textPreview,
          timestamp: m.timestamp
        })),
      ...activeOutboundMessages,
      {
        providerMessageId,
        direction: 'inbound' as const,
        textPreview,
        timestamp
      }
    ];

    const appointmentRecord = this.getAppointment(tx.state.binding.workspaceId, connectionId, recipient.id);
    const enquiryInput = {
      connectionId,
      recipientId: recipient.id,
      contactName: formatWhatsAppContactName(recipient.id, recipient.displayName),
      maskedPhone: maskPhoneNumber(recipient.phoneE164),
      optedIn: recipient.optedIn,
      ...(appointmentRecord ? { appointmentRecord } : {}),
      messages: recipientMessages
    };
    const enquiry = extractWhatsAppCustomerEnquiry(enquiryInput);
    if (!enquiry) {
      return { status: 'skipped_loop_guard', idempotencyKey, evaluatedAt };
    }
    const memory = buildConversationMemoryState(enquiryInput);

    const hasPriorReply = activeOutboundMessages.length > 0;
    const hasNewerInbound = tx.state.messages.some(
      m => m.recipientId === recipient.id && m.providerMessageId !== providerMessageId && m.timestamp.localeCompare(timestamp) > 0
    );

    const proposal = buildQuantumWeaveCustomerReply({
      enquiry,
      latestCustomerMessage: textPreview,
      optedIn: recipient.optedIn,
      windowOpen: true,
      autoReplyMode: true,
      hasPriorReply,
      hasNewerInbound,
      memory,
      ...(n8nAgentReply ? { n8nAgentReply } : {})
    });
    if (!proposal.allowed) {
      if (proposal.escalationReason) {
        return { status: 'escalated', idempotencyKey, evaluatedAt, reason: proposal.escalationReason };
      }
      if (proposal.reason === 'window_closed') {
        return { status: 'skipped_window_closed', idempotencyKey, evaluatedAt };
      }
      return { status: 'skipped_loop_guard', idempotencyKey, evaluatedAt };
    }

    if (this.hasBlockingDeliveryFailure(tx, connectionId, recipient.id, now)) {
      return { status: 'skipped_failure_guard', idempotencyKey, evaluatedAt };
    }

    if (this.isBlockedByAutoReplyLoopOrRateGuard(tx, recipient.id, providerMessageId, textPreview, msgTime, now)) {
      return { status: 'skipped_loop_guard', idempotencyKey, evaluatedAt };
    }

    return { status: 'pending', idempotencyKey, evaluatedAt };
  }

  async ingest(scope: WhatsAppExecutionScope, id: string, input: unknown) {
    const event = snapshot(input); rejectClaims(event);
    const rawAgentReply = typeof (event as { n8nAgentReply?: unknown })?.n8nAgentReply === 'string'
      ? (event as { n8nAgentReply: string }).n8nAgentReply.trim().slice(0, 4096)
      : undefined;
    const rawAgentRepliesMap =
      (event as { n8nAgentReplies?: unknown })?.n8nAgentReplies &&
      typeof (event as { n8nAgentReplies?: unknown }).n8nAgentReplies === 'object'
        ? ((event as { n8nAgentReplies: Record<string, unknown> }).n8nAgentReplies)
        : undefined;
    const parsedFailures = deliveryFailures(event, id);
    const failureByMessageId = new Map(
      parsedFailures
        .filter(f => f.providerMessageId && (f.code !== null || f.title.length > 0 || f.details.length > 0))
        .map(f => [f.providerMessageId, { code: f.code, title: f.title, details: f.details }])
    );
    const incomingMessageIds: string[] = [];
    const result = await this.run(scope, id, async tx => {
      const b = tx.state.binding, wrapped = { object: 'whatsapp_business_account', entry: [{ id: b.businessAccountId, changes: [{ field: (event as any)?.field, value: event }] }] };
      if (!Envelope.Check(wrapped)) throw denied();
      const value = wrapped.entry[0]!.changes[0]!.value;
      if (value.metadata.phone_number_id !== b.phoneNumberId || (!value.messages && !value.statuses)) throw denied();
      let acceptedMessages = 0, statusUpdates = 0, duplicates = 0;
      for (const s of value.statuses ?? []) {
        this.eventTime(s.timestamp);
        if (!b.recipients.some(r => r.phoneE164.slice(1) === s.recipient_id) && !this.hasDynamicRecipientPhone(id, s.recipient_id)) continue;
        const key = createHash('sha256').update(JSON.stringify([s.id, s.recipient_id, s.status, s.timestamp])).digest('hex');
        if (tx.state.events.some(e => e.key === key)) { duplicates++; continue; }
        const failureMeta = s.status === 'failed' ? failureByMessageId.get(s.id) : undefined;
        tx.state.events.push({ key, providerMessageId: s.id, recipientAddress: s.recipient_id, status: s.status, timestamp: s.timestamp, ...(failureMeta ? { failure: failureMeta } : {}) });
        for (const d of tx.state.dispatches) if (d.receipt.providerMessageId === s.id) { this.reconcile(tx, d); statusUpdates++; }
      }
      for (const m of value.messages ?? []) {
        let recipient = b.recipients.find(r => r.phoneE164.slice(1) === m.from) ?? this.getDynamicRecipientByPhone(id, m.from);
        const timestamp = this.eventTime(m.timestamp);
        if (!recipient) {
          const cleanDigits = m.from.replace(/\D/g, '');
          if (cleanDigits.length >= 7 && cleanDigits.length <= 15) {
            const rawContacts = (value as { contacts?: Array<{ wa_id?: string; profile?: { name?: string } }> }).contacts;
            const profileContact = rawContacts?.find(c => c.wa_id === m.from || c.wa_id === cleanDigits);
            const profileName = profileContact?.profile?.name?.trim().slice(0, 80);
            recipient = {
              id: `c_${cleanDigits}`,
              phoneE164: `+${cleanDigits}`,
              optedIn: true,
              ...(profileName ? { displayName: profileName } : {})
            };
            this.setDynamicRecipient(id, recipient.id, recipient);
          } else {
            throw denied();
          }
        }
        const content = normalizeWhatsAppIncomingContent(m);
        const existing = tx.state.messages.find(old => old.providerMessageId === m.id);
        if (existing) { if (existing.recipientId !== recipient.id || !isDeepStrictEqual(existing.media ?? null, content.media ?? null)) throw denied(); duplicates++; continue; }
        const msgAgentReply =
          typeof rawAgentRepliesMap?.[m.id] === 'string'
            ? (rawAgentRepliesMap[m.id] as string).trim().slice(0, 4096)
            : (value.messages?.length === 1 ? rawAgentReply : undefined);
        if (msgAgentReply) {
          this.getStoreTracker().n8nAgentReplies.set(m.id, msgAgentReply);
        }
        const autoReply = this.computeInitialMessageAutoReply(tx, id, m.id, recipient, content.textPreview, timestamp, msgAgentReply);
        tx.state.messages.push({
          providerMessageId: m.id,
          recipientId: recipient.id,
          senderMaskedPhone: maskPhoneNumber(recipient.phoneE164),
          ...content,
          timestamp,
          mode: 'offline_test',
          untrusted: true,
          ...(autoReply ? { autoReply } : {})
        });
        incomingMessageIds.push(m.id);
        acceptedMessages++;
      }
      if (tx.state.messages.length > 1000 || tx.state.events.length > 2000) throw denied();
      await tx.audit('whatsapp.durable.events', { messages: acceptedMessages, statuses: statusUpdates });
      return { acceptedMessages, statusUpdates, duplicates };
    }, false, 'events');
    // Only after the events were validated and committed: record Meta's failure reason for the operator and inbox projection.
    for (const { providerMessageId, ...failure } of parsedFailures) {
      if (providerMessageId) {
        let byConn = this.failureDetails.get(id);
        if (!byConn) { byConn = new Map(); this.failureDetails.set(id, byConn); }
        byConn.set(providerMessageId, { code: failure.code, title: failure.title, details: failure.details });
      }
      try { DurableWhatsAppService.deliveryFailureSink(failure); } catch { /* logging never affects ingestion */ }
    }
    if (this.autoReplyFor(id) && (result.acceptedMessages > 0 || result.duplicates > 0)) {
      const targets = incomingMessageIds.length > 0 ? incomingMessageIds : undefined;
      if (this.serviceOptions?.asyncAutoReply ?? this.send?.asyncAutoReply) {
        queueMicrotask(() => {
          this.processCustomerAutoReplies(scope, id, false, targets).catch(err => {
            console.warn(JSON.stringify({ event: 'whatsapp_async_auto_reply_error', error: String(err) }));
          });
        });
      } else {
        await this.processCustomerAutoReplies(scope, id, false, targets);
      }
    }
    return result;
  }

  /**
   * WA-01: Safe recovery entry point for previously accepted inbound messages with `autoReply.status === 'pending'`.
   * Preserves idempotency, avoids duplicate sends, defines safe behavior for 60s expired reservations,
   * and never resends uncertain provider deliveries.
   */
  async recoverAutoReplies(scope: AuthenticatedScope, id: string): Promise<WhatsAppAutoReplyRecoveryResult> {
    if (!this.autoReplyFor(id)) return { ...EMPTY_RECOVERY_RESULT };
    return this.processCustomerAutoReplies(scope, id, false);
  }

  private async processCustomerAutoReplies(
    scope: WhatsAppExecutionScope,
    id: string,
    isStartup = false,
    targetMessageIds?: string[]
  ): Promise<WhatsAppAutoReplyRecoveryResult> {
    const ar = this.resolveAutoReplyConfig(), profile = this.send?.profile();
    if (!ar?.enabled || !profile || !this.autoReplyFor(id)) return { ...EMPTY_RECOVERY_RESULT };
    let ownerScope = ar.ownerScope ?? (isWhatsAppRelayScope(scope) ? null : scope);
    if (!ownerScope && this.store.resolveAutoReplyOwnerScope) {
      try {
        ownerScope = await this.store.resolveAutoReplyOwnerScope(scope, id);
      } catch {
        ownerScope = null;
      }
    }
    if (!ownerScope?.sessionTokenHash) return { ...EMPTY_RECOVERY_RESULT };

    let pendingMessageIds: string[] = [];
    try {
      pendingMessageIds = await this.run(ownerScope, id, async tx =>
        tx.state.messages
          .filter(m => {
            if (m.autoReply?.status !== 'pending') return false;
            if (targetMessageIds && targetMessageIds.length > 0 && !targetMessageIds.includes(m.providerMessageId)) {
              return false;
            }
            return true;
          })
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .map(m => m.providerMessageId)
      );
    } catch {
      if (isStartup) {
        this.recordStartupRecoveryFailure(id);
      }
      return { ...EMPTY_RECOVERY_RESULT, failedRecovery: 1 };
    }

    let reserved = 0;
    let submitted = 0;
    let expired = 0;
    let skippedUncertain = 0;
    let failedRecovery = 0;

    type TxOutcome =
      | { status: 'ready_to_submit'; dispatchId: string; revision: number; created: boolean; needsSubmit: true }
      | { status: 'expired_reservation'; dispatchId: string; revision: number; created: false; needsSubmit: false }
      | { status: 'uncertain_or_claimed'; dispatchId: string; revision: number; created: false; needsSubmit: false };

    for (const inboundMessageId of pendingMessageIds) {
      let outcome: TxOutcome | null = null;
      try {
        const msgRecipientInfo = await this.run(ownerScope, id, async tx => {
          const m = tx.state.messages.find(msg => msg.providerMessageId === inboundMessageId);
          if (!m || m.autoReply?.status !== 'pending') return null;
          const existingDispatch = tx.state.dispatches.find(
            d => d.draft.idempotencyKey === m.autoReply?.idempotencyKey ||
                 ('replyToProviderMessageId' in d.draft && d.draft.replyToProviderMessageId === m.providerMessageId)
          );
          if (existingDispatch) return null;
          const r = tx.state.binding.recipients.find(rec => rec.id === m.recipientId) ?? this.getDynamicRecipient(tx.state.binding.connectionId, m.recipientId);
          const inboundHistory = tx.state.messages
            .filter(old => old.recipientId === m.recipientId && old.timestamp.localeCompare(m.timestamp) <= 0)
            .map(old => ({ role: 'user' as const, content: old.textPreview, timestamp: old.timestamp }));
          const outboundHistory = tx.state.dispatches
            .filter(d => d.draft.recipientId === m.recipientId && new Date(d.createdAt).toISOString().localeCompare(m.timestamp) <= 0)
            .map(d => ({ role: 'assistant' as const, content: sanitizeWhatsAppText(whatsappDraftPreview(d.draft)), timestamp: new Date(d.createdAt).toISOString() }));
          const history = [...inboundHistory, ...outboundHistory]
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
            .map(({ role, content }) => ({ role, content }));
          const recipientMessages = [
            ...tx.state.messages
              .filter(msg => msg.recipientId === m.recipientId)
              .map(msg => ({ direction: 'inbound' as const, textPreview: msg.textPreview, timestamp: msg.timestamp })),
            ...tx.state.dispatches
              .filter(d => d.draft.recipientId === m.recipientId && d.receipt.status !== 'failed')
              .map(d => ({ direction: 'outbound' as const, textPreview: sanitizeWhatsAppText(whatsappDraftPreview(d.draft)), timestamp: new Date(d.createdAt).toISOString() }))
          ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
          const memory = buildConversationMemoryState({
            connectionId: tx.state.binding.connectionId,
            recipientId: m.recipientId,
            ...(r?.displayName ? { contactName: r.displayName } : {}),
            maskedPhone: r?.phoneE164 ? `***${r.phoneE164.slice(-4)}` : '',
            optedIn: r?.optedIn ?? false,
            messages: recipientMessages
          });
          return { recipientId: m.recipientId, textPreview: m.textPreview, phoneE164: r?.phoneE164 ?? '', displayName: r?.displayName, history, memory };
        }, true).catch(() => null);
        if (msgRecipientInfo?.recipientId) {
          await this.ensureRecipientRegistered(ownerScope, id, msgRecipientInfo.recipientId);
        }

        let precomputedAiReply: string | undefined;
        // When the Unified Thaara AI Engine is enabled (or an active workspace campaign matches this recipient),
        // evaluate the reply via whatsAppAIService so campaign knowledge context flows cleanly without a second bot.
        if (msgRecipientInfo) {
          const campaignResolver =
            this.serviceOptions?.resolveCampaignContext ?? this.send?.resolveCampaignContext;
          let campaignContext: WhatsAppCampaignReplyContext | null = null;
          if (campaignResolver && msgRecipientInfo.phoneE164) {
            try {
              campaignContext = await campaignResolver({
                scope: ownerScope,
                connectionId: id,
                recipientId: msgRecipientInfo.recipientId,
                phoneE164: msgRecipientInfo.phoneE164,
                customerMessage: msgRecipientInfo.textPreview
              });
            } catch {
              campaignContext = null;
            }
          }

          const effectiveAiService =
            this.whatsAppAIService ?? (campaignContext ? new WhatsAppAIService(undefined) : undefined);
          if (effectiveAiService) {
            try {
              const aiRes = await effectiveAiService.generateCustomerReply({
                connectionId: id,
                recipientId: msgRecipientInfo.recipientId,
                phoneE164: msgRecipientInfo.phoneE164,
                customerName: msgRecipientInfo.displayName,
                latestCustomerMessage: msgRecipientInfo.textPreview,
                conversationHistory: msgRecipientInfo.history,
                ...(msgRecipientInfo.memory ? { memory: msgRecipientInfo.memory } : {}),
                ...(campaignContext ? { campaignContext } : {})
              });
              if (aiRes.replyText) {
                precomputedAiReply = aiRes.replyText;
              }
            } catch {
              precomputedAiReply = undefined;
            }
          }
        }

        // WA-01 & WA-02: Single serialized connection-locked transaction performs all rate, cooldown, loop, window,
        // and failure-circuit-breaker checks AND reserves the dispatch atomically.
        // Importantly, this callback NEVER mutates `submittedAutoReplyDispatches` or `inFlightAutoReplySubmissions`
        // so a transaction rollback can never leave stale tracking state.
        outcome = await this.run(ownerScope, id, async (tx, caller): Promise<TxOutcome | null> => {
          const b = tx.state.binding, now = this.now();
          if (tx.state.disconnected || !this.autoReplyFor(id)) return null;
          const curProfile = this.send?.profile();
          if (!curProfile || curProfile.connectionId !== id || !(now < curProfile.expiresAt) || !validCap(curProfile.maxPerDay)) return null;

          const inboundMsg = tx.state.messages.find(m => m.providerMessageId === inboundMessageId);
          if (!inboundMsg || inboundMsg.autoReply?.status !== 'pending') return null;
          const recipient = b.recipients.find(r => r.id === inboundMsg.recipientId) ?? this.getDynamicRecipient(b.connectionId, inboundMsg.recipientId);
          if (!recipient) return null;
          const windowOpen = this.isCustomerServiceWindowOpen(tx, recipient.id, now);
          if ((!recipient.optedIn && !windowOpen) || (curProfile.recipientId !== '*' && curProfile.recipientId !== recipient.id)) return null;

          const idempotencyKey = inboundMsg.autoReply.idempotencyKey;
          const existingDispatch = tx.state.dispatches.find(
            d => d.draft.idempotencyKey === idempotencyKey || ('replyToProviderMessageId' in d.draft && d.draft.replyToProviderMessageId === inboundMsg.providerMessageId)
          );
          if (existingDispatch) {
            // WA-01 (Issue 3): Never resend if the dispatch was claimed, has a providerMessageId, has a non-not_configured status,
            // or has already been submitted / is in-flight to n8n.
            if (
              existingDispatch.claimedAt !== null ||
              existingDispatch.receipt.status !== 'not_configured' ||
              existingDispatch.receipt.providerMessageId !== null ||
              this.isDispatchSubmittedOrInFlight(existingDispatch.id)
            ) {
              return {
                status: 'uncertain_or_claimed',
                dispatchId: existingDispatch.id,
                revision: existingDispatch.draft.connectionRevision,
                created: false,
                needsSubmit: false
              };
            }
            // WA-01 (Issue 2): Safe behavior when an existing reserved dispatch has expired after 60 seconds:
            // Do not submit the expired dispatchId (claim() rejects >= expiresAt), do not create a replacement message,
            // and do not invent a delivery receipt.
            if (now >= existingDispatch.expiresAt) {
              return {
                status: 'expired_reservation',
                dispatchId: existingDispatch.id,
                revision: existingDispatch.draft.connectionRevision,
                created: false,
                needsSubmit: false
              };
            }
            // Unclaimed, unexpired, 'not_configured', and not yet submitted: safe to hand off to n8n.
            return {
              status: 'ready_to_submit',
              dispatchId: existingDispatch.id,
              revision: existingDispatch.draft.connectionRevision,
              created: false,
              needsSubmit: true
            };
          }

          // 1. WA-05: Must be within the verified 24-hour customer-service window (rejects future-dated and expired timestamps).
          const msgTime = Date.parse(inboundMsg.timestamp);
          if (!Number.isFinite(msgTime) || msgTime <= 0 || msgTime > now || now - msgTime >= CUSTOMER_SERVICE_WINDOW_MS || !this.isCustomerServiceWindowOpen(tx, recipient.id, now)) {
            return null;
          }

          // 2. WA-03: Recipient-specific & connection-wide (e.g., Meta 131042) failure circuit breaker.
          if (this.hasBlockingDeliveryFailure(tx, b.connectionId, recipient.id, now)) return null;

          // 3. WA-02: Concurrency-safe per-recipient 24h cap, cooldown, and ping-pong loop guard inside the reservation lock.
          if (this.isBlockedByAutoReplyLoopOrRateGuard(tx, recipient.id, inboundMsg.providerMessageId, inboundMsg.textPreview, msgTime, now)) {
            return null;
          }

          // 4. Extract structured customer enquiry and run Quantum Weave auto-reply & escalation evaluation.
          const activeOutboundMessages = tx.state.dispatches
            .filter(
              d =>
                d.draft.recipientId === recipient.id &&
                d.receipt.status !== 'failed' &&
                !(d.claimedAt === null && d.receipt.status === 'not_configured' && now >= d.expiresAt)
            )
            .map(d => ({
              providerMessageId: d.receipt.providerMessageId,
              direction: 'outbound' as const,
              textPreview: sanitizeWhatsAppText(whatsappDraftPreview(d.draft)).slice(0, 2048),
              timestamp: new Date(d.createdAt).toISOString()
            }));

          const recipientMessages = [
            ...tx.state.messages
              .filter(m => m.recipientId === recipient.id && m.timestamp.localeCompare(inboundMsg.timestamp) <= 0)
              .map(m => ({
                providerMessageId: m.providerMessageId,
                direction: 'inbound' as const,
                textPreview: m.textPreview,
                timestamp: m.timestamp
              })),
            ...activeOutboundMessages
          ];
          const appointmentRecord = this.getAppointment(tx.state.binding.workspaceId, b.connectionId, recipient.id);
          const enquiryInput = {
            connectionId: b.connectionId,
            recipientId: recipient.id,
            contactName: formatWhatsAppContactName(recipient.id, recipient.displayName),
            maskedPhone: maskPhoneNumber(recipient.phoneE164),
            optedIn: recipient.optedIn,
            ...(appointmentRecord ? { appointmentRecord } : {}),
            messages: recipientMessages
          };
          const enquiry = extractWhatsAppCustomerEnquiry(enquiryInput);
          if (!enquiry) return null;
          const memory = buildConversationMemoryState(enquiryInput);

          const hasPriorReply = activeOutboundMessages.length > 0;
          const hasNewerInbound = tx.state.messages.some(
            m => m.recipientId === recipient.id && m.providerMessageId !== inboundMsg.providerMessageId && m.timestamp.localeCompare(inboundMsg.timestamp) > 0
          );
          const n8nAgentReply = this.whatsAppAIService ? undefined : this.getStoreTracker().n8nAgentReplies.get(inboundMsg.providerMessageId);

          const proposal = buildQuantumWeaveCustomerReply({
            enquiry,
            latestCustomerMessage: inboundMsg.textPreview,
            optedIn: recipient.optedIn,
            windowOpen: true,
            autoReplyMode: true,
            hasPriorReply,
            hasNewerInbound,
            memory,
            ...(n8nAgentReply ? { n8nAgentReply } : {}),
            ...(precomputedAiReply ? { aiGeneratedReply: precomputedAiReply } : {})
          });
          if (!proposal.allowed || !proposal.replyText) {
            inboundMsg.autoReply = {
              status: 'skipped_loop_guard',
              idempotencyKey,
              evaluatedAt: new Date(now).toISOString()
            };
            return null;
          }

          const draft: MetaWhatsAppSendInput = {
            connectionId: b.connectionId,
            connectionRevision: b.revision,
            senderPhoneNumberId: b.phoneNumberId,
            recipientId: recipient.id,
            bodyText: proposal.replyText,
            replyToProviderMessageId: inboundMsg.providerMessageId,
            idempotencyKey
          };
          if (!Draft.Check(draft) || tx.state.dispatches.length >= 1000) return null;

          const approvalId = await ar.authorizeDraft(caller as AuthenticatedScope, draft, tx);
          if (typeof approvalId !== 'string' || approvalId.length === 0) return null;

          await this.approved(tx, caller, draft, approvalId);
          const parameterHash = computeCanonicalParameterHash(draft);
          const dispatchId = randomUUID(), createdAt = this.now();
          const receipt: N8nWhatsAppReceipt = { transport: 'n8n', mode: 'offline_test', dispatchId, providerMessageId: null, status: 'not_configured', verified: false };
          await tx.audit('whatsapp.durable.reserved', { dispatchId, revision: tx.state.binding.revision });
          await this.approved(tx, caller, draft, approvalId);
          tx.state.dispatches.push({ id: dispatchId, draft, parameterHash, approvalId, createdAt, expiresAt: createdAt + 60000, claimedAt: null, receipt });
          return { status: 'ready_to_submit', dispatchId, revision: draft.connectionRevision, created: true, needsSubmit: true };
        });
      } catch {
        failedRecovery++;
        this.recordMessageRecoveryFailure(id, inboundMessageId, isStartup);
        outcome = null;
      }

      if (!outcome) continue;
      this.clearMessageRecoveryFailure(id, inboundMessageId);
      if (outcome.created) reserved++;
      if (outcome.status === 'expired_reservation') {
        expired++;
        this.emitRecoveryAttention({
          event: 'whatsapp_auto_reply_recovery_attention',
          connectionId: id,
          reason: 'expired_reservation',
          dispatchId: outcome.dispatchId,
          inboundMessageRef: inboundMessageId.slice(-10)
        });
        continue;
      }
      if (outcome.status === 'uncertain_or_claimed') {
        skippedUncertain++;
        continue;
      }

      if (outcome.needsSubmit) {
        // Synchronously claim submission slot after transaction commit so concurrent instances never double-submit
        // and transaction rollbacks never pollute tracking state.
        if (!this.claimAutoReplySubmission(outcome.dispatchId)) {
          skippedUncertain++;
          continue;
        }
        const curProfile = this.send?.profile();
        if (curProfile && curProfile.connectionId === id && this.now() < curProfile.expiresAt && validCap(curProfile.maxPerDay)) {
          try {
            await this.send!.dispatcher.submit({ connectionId: id, revision: outcome.revision, dispatchId: outcome.dispatchId });
            this.completeAutoReplySubmission(outcome.dispatchId);
            submitted++;
          } catch (error) {
            if (isReliablePreTransmissionSubmitError(error)) {
              // WA-01 Hardening (Concern 1): Only release for retry when there is reliable evidence that the request
              // failed BEFORE network transmission (e.g. ECONNREFUSED, ENOTFOUND, or explicit preTransmissionFailure: true).
              this.releaseFailedAutoReplySubmission(outcome.dispatchId);
            } else {
              // Unknown errors, HTTP 5xx, ECONNRESET, timeouts, or unverified responses are classified as UNCERTAIN
              // and NEVER automatically retried so a message that may have reached n8n/Meta is never resent.
              this.completeAutoReplySubmission(outcome.dispatchId);
              skippedUncertain++;
            }
          }
        } else {
          this.releaseFailedAutoReplySubmission(outcome.dispatchId);
        }
      }
    }

    if (failedRecovery === 0) {
      const tracker = this.getStoreTracker();
      this.startupFailedConnections.delete(id);
      tracker.startupFailedConnections.delete(id);
    }

    return { reserved, submitted, expired, skippedUncertain, failedRecovery };
  }

  /** Builds an unsent reply draft from the owner's own binding for approval. No state change, no audit, no transport. */
  async replyDraft(scope: AuthenticatedScope, id: string, input: unknown): Promise<N8nWhatsAppReplyDraft> {
    const request = snapshot(input);
    if (!ReplyRequest.Check(request)) throw new AppError('Invalid WhatsApp reply.', 'WHATSAPP_DURABLE_INVALID', 400);
    await this.ensureRecipientRegistered(scope, id, request.recipientId);
    return this.run(scope, id, async (tx, caller) => {
      if (isWhatsAppRelayScope(caller)) throw denied();
      const b = tx.state.binding, recipient = this.findRecipient(b, request.recipientId);
      if (!recipient) throw denied();
      const windowOpen = this.isCustomerServiceWindowOpen(tx, recipient.id);
      if (!recipient.optedIn && !windowOpen) throw denied();
      if (!windowOpen) {
        throw new AppError('The 24-hour reply window is closed; use an approved template.', 'WHATSAPP_WINDOW_CLOSED', 409);
      }
      if (request.replyToProviderMessageId && !tx.state.messages.some(m => m.providerMessageId === request.replyToProviderMessageId && m.recipientId === recipient.id)) throw denied();
      const draft: MetaWhatsAppSendInput = { connectionId: b.connectionId, connectionRevision: b.revision, senderPhoneNumberId: b.phoneNumberId, recipientId: recipient.id,
        bodyText: request.bodyText, ...(request.replyToProviderMessageId ? { replyToProviderMessageId: request.replyToProviderMessageId } : {}), idempotencyKey: 'reply-' + randomUUID() };
      if (!Draft.Check(draft)) throw denied();
      return { draft, actionName: 'whatsapp.meta.messages.send' as const, riskLevel: 'high' as const, liveSendingEnabled: false as const };
    });
  }
  async reserve(scope: AuthenticatedScope, id: string, input: MetaWhatsAppAnySendInput, approvalId: string): Promise<N8nWhatsAppReceipt> {
    const draft = snapshot(input);
    await this.ensureRecipientRegistered(scope, id, draft.recipientId);
    const { receipt, created } = await this.run(scope, id, async (tx, caller) => {
      await this.approved(tx, caller, draft, approvalId);
      const parameterHash = computeCanonicalParameterHash(draft), existing = tx.state.dispatches.find(d => d.draft.idempotencyKey === draft.idempotencyKey);
      if (existing) { if (existing.parameterHash !== parameterHash || existing.approvalId !== approvalId) throw denied(); return { receipt: existing.receipt, created: false }; }
      if (draft.idempotencyKey.startsWith('auto-reply-')) {
        const now = this.now();
        const replyTo = 'replyToProviderMessageId' in draft ? draft.replyToProviderMessageId : undefined;
        const inboundMsg = replyTo ? tx.state.messages.find(m => m.providerMessageId === replyTo && m.recipientId === draft.recipientId) : undefined;
        const msgTime = inboundMsg ? Date.parse(inboundMsg.timestamp) : now;
        if (
          this.hasBlockingDeliveryFailure(tx, id, draft.recipientId, now) ||
          this.isBlockedByAutoReplyLoopOrRateGuard(tx, draft.recipientId, replyTo ?? '', 'bodyText' in draft ? draft.bodyText : '', msgTime, now)
        ) {
          throw denied();
        }
      }
      if (tx.state.dispatches.length >= 1000) throw denied();
      const dispatchId = randomUUID(), createdAt = this.now();
      const receipt: N8nWhatsAppReceipt = { transport: 'n8n', mode: 'offline_test', dispatchId, providerMessageId: null, status: 'not_configured', verified: false };
      await tx.audit('whatsapp.durable.reserved', { dispatchId, revision: tx.state.binding.revision });
      await this.approved(tx, caller, draft, approvalId);
      tx.state.dispatches.push({ id: dispatchId, draft, parameterHash, approvalId, createdAt, expiresAt: createdAt + 60000, claimedAt: null, receipt });
      return { receipt, created: true };
    });
    // Hand over only after the reservation transaction committed (the n8n claim needs its own transaction).
    // The claim re-checks approval, revision and the send profile; a failed hand-over simply lets the reservation expire.
    const profile = this.send?.profile();
    if (created && receipt.dispatchId && profile && profile.connectionId === id && (profile.recipientId === '*' || profile.recipientId === draft.recipientId) && this.now() < profile.expiresAt && validCap(profile.maxPerDay)) {
      const isAutoReply = draft.idempotencyKey.startsWith('auto-reply-');
      if (!isAutoReply || this.claimAutoReplySubmission(receipt.dispatchId)) {
        try {
          await this.send!.dispatcher.submit({ connectionId: id, revision: draft.connectionRevision, dispatchId: receipt.dispatchId });
          if (isAutoReply) this.completeAutoReplySubmission(receipt.dispatchId);
        } catch (error) {
          if (isAutoReply) {
            if (isReliablePreTransmissionSubmitError(error)) {
              this.releaseFailedAutoReplySubmission(receipt.dispatchId);
            } else {
              this.completeAutoReplySubmission(receipt.dispatchId);
            }
          }
        }
      }
    }
    return receipt;
  }
  claim(scope: WhatsAppExecutionScope, id: string, dispatchId: string, revision: number) {
    return this.run(scope, id, async (tx, caller) => {
      const d = tx.state.dispatches.find(d => d.id === dispatchId);
      if (!d || revision !== tx.state.binding.revision || d.claimedAt !== null || this.now() >= d.expiresAt || this.now() < d.createdAt) throw denied();
      await this.approved(tx, caller, d.draft, d.approvalId);
      await tx.audit('whatsapp.durable.claimed', { dispatchId, revision });
      const recipient = await this.approved(tx, caller, d.draft, d.approvalId);
      if (!recipient || this.now() >= d.expiresAt) throw denied();
      d.claimedAt = this.now();
      // A consumed claim is conservatively uncertain even if the caller crashes before acknowledgement.
      d.receipt.status = 'unverified';
      return { authorized: true as const, dispatchEnabled: this.sendAllowed(tx, d), dispatchId, phoneNumberId: tx.state.binding.phoneNumberId, recipientPhoneNumber: recipient.phoneE164, ...('bodyText' in d.draft ? { messageType: 'text' as const, textBody: d.draft.bodyText } : 'template' in d.draft ? { messageType: 'template' as const, template: d.draft.template } : { messageType: 'media' as const, media: d.draft.media }), ...('replyToProviderMessageId' in d.draft && d.draft.replyToProviderMessageId ? { replyToProviderMessageId: d.draft.replyToProviderMessageId } : {}) };
    }, false, 'claim');
  }
  async receipt(scope: WhatsAppExecutionScope, id: string, input: N8nWhatsAppProviderReceipt): Promise<N8nWhatsAppReceipt> {
    const data = snapshot(input);
    return this.run(scope, id, async tx => {
      if (!Receipt.Check(data)) throw denied();
      const d = tx.state.dispatches.find(d => d.id === data.dispatchId), recipient = d && this.findRecipient(tx.state.binding, d.draft.recipientId);
      if (!d || d.claimedAt === null || !recipient || recipient.phoneE164.slice(1) !== data.recipientAddress || (d.receipt.providerMessageId && d.receipt.providerMessageId !== data.providerMessageId) || tx.state.dispatches.some(other => other.id !== d.id && other.receipt.providerMessageId === data.providerMessageId)) throw denied();
      await tx.audit('whatsapp.durable.receipt', { dispatchId: d.id });
      d.receipt.providerMessageId = data.providerMessageId;
      return this.reconcile(tx, d);
    }, false, 'receipts');
  }
  unknown(scope: AuthenticatedScope, id: string, dispatchId: string): Promise<N8nWhatsAppReceipt> {
    return this.run(scope, id, async tx => {
      const d = tx.state.dispatches.find(d => d.id === dispatchId); if (!d || d.claimedAt === null) throw denied();
      await tx.audit('whatsapp.durable.unknown', { dispatchId });
      if (!d.receipt.providerMessageId) d.receipt.status = 'unverified'; return d.receipt;
    });
  }
  disconnect(scope: AuthenticatedScope, id: string) {
    return this.run(scope, id, async tx => {
      if (!tx.state.disconnected) {
        const revision = tx.state.binding.revision + 1; if (!Number.isSafeInteger(revision)) throw denied();
        await tx.audit('whatsapp.durable.disconnected', { revision });
        tx.state.disconnected = true; tx.state.binding.revision = revision;
      }
      return { disconnected: true as const, revision: tx.state.binding.revision };
    }, true);
  }
}
