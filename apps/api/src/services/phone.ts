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
  PhoneBriefingActivityItem,
  PhoneBriefingFollowUpItem,
  PhoneBriefingN8nContext,
  PhoneBriefingQuery,
  PhoneBriefingQuerySchema,
  PhoneBriefingResponse,
  PhoneBriefingResponseSchema,
  PhoneCallIdSchema,
  PhoneCallLifecycleState,
  PhoneCallRecord,
  PhoneCallRecordSchema,
  PhoneConnectInput,
  PhoneConnectInputSchema,
  PhoneListCalls,
  PhoneListCallsResponse,
  PhoneListCallsResponseSchema,
  PhoneListCallsSchema,
  PhoneN8nContext,
  PhoneN8nContextSchema,
  PhoneOutboundCallRequest,
  PhoneOutboundCallRequestSchema,
  PhoneStatus,
  PhoneWebhookEventEnvelope,
  PhoneWebhookEventEnvelopeSchema,
  RequestScope,
  computeCanonicalParameterHash
} from '@thaara/contracts';
import { AuthenticatedScope } from '@thaara/db';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '@thaara/observability';
import {
  PolicyGateway,
  defaultPolicyGateway,
  detectWorkflowSecurityViolations,
  validateN8nWorkflowBlueprint
} from '@thaara/policy';

export const PHONE_CAPABILITIES = [
  'phone.calls.read',
  'phone.calls.history',
  'phone.briefing.prepare'
] as const;

export interface PhoneCiphertextStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export class PhoneVault {
  #key: Buffer;
  constructor(key: Buffer, private store: PhoneCiphertextStore) {
    if (key.length !== 32) {
      throw new Error('Phone vault requires a dedicated 256-bit encryption key.');
    }
    this.#key = Buffer.from(key);
  }

  private partition(scope: RequestScope, purpose: string): string {
    if (!scope.workspaceId || !scope.userId) {
      throw new Error('Phone vault requires an authenticated subject.');
    }
    return (
      'phone_telephony:' +
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
        'Phone telephony credentials are unavailable.',
        'PHONE_CREDENTIALS_INVALID',
        503
      );
    }
  }

  delete(scope: RequestScope, purpose: string): void {
    this.store.delete(this.partition(scope, purpose));
  }
}

export interface PhoneSessionRecord {
  accessToken: string;
  lineId: string;
  accountId: string;
  maskedLineNumber: string;
  capabilities: string[];
  expiresAt: number;
  verifiedAt: string;
}

export interface PhoneRawCallRecord {
  id: string;
  direction: 'inbound' | 'outbound_simulated';
  lifecycleState: PhoneCallLifecycleState;
  participantPhone: string;
  participantDisplayName: string;
  purposeSummary: string;
  startedAt: string;
  endedAt?: string | null;
  durationSeconds?: number | null;
  consentVerified?: boolean;
  approvalId?: string | null;
  receiptStatus?: 'verified_mock' | 'awaiting_approval' | 'failed' | 'cancelled';
  rawProviderSecret?: string;
}

export interface PhoneProvider {
  readonly mode: 'mock';
  verifyConnection(input: PhoneConnectInput): Promise<{
    accessToken: string;
    capabilities: string[];
    expiresInSeconds: number;
    maskedLineNumber: string;
  }>;
  listCalls(input: {
    accessToken: string;
    direction?: 'inbound' | 'outbound_simulated';
    lifecycleState?: PhoneCallLifecycleState;
    query?: string;
    limit: number;
    pageToken?: string;
  }): Promise<{ calls: unknown[]; nextPageToken?: string }>;
  readCall(input: { accessToken: string; callId: string }): Promise<unknown>;
}

const ConnectInputCompiler = TypeCompiler.Compile(PhoneConnectInputSchema);
const ListCallsCompiler = TypeCompiler.Compile(PhoneListCallsSchema);
const CallIdCompiler = TypeCompiler.Compile(PhoneCallIdSchema);
const CallRecordCompiler = TypeCompiler.Compile(PhoneCallRecordSchema);
const ListCallsResponseCompiler = TypeCompiler.Compile(PhoneListCallsResponseSchema);
const OutboundRequestCompiler = TypeCompiler.Compile(PhoneOutboundCallRequestSchema);
const WebhookEnvelopeCompiler = TypeCompiler.Compile(PhoneWebhookEventEnvelopeSchema);
const N8nContextCompiler = TypeCompiler.Compile(PhoneN8nContextSchema);
const BriefingQueryCompiler = TypeCompiler.Compile(PhoneBriefingQuerySchema);
const BriefingResponseCompiler = TypeCompiler.Compile(PhoneBriefingResponseSchema);

/**
 * Masks any phone number so only country prefix and last 4 digits are visible.
 * Never returns raw unmasked phone numbers.
 */
export function maskPhoneCallNumber(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length < 4) {
    return '******';
  }
  const last4 = digits.slice(-4);
  if (digits.length > 10) {
    const country = digits.slice(0, digits.length - 10);
    return `+${country} ******${last4}`;
  }
  return `+1 ******${last4}`;
}

export function hashPhoneParticipant(workspaceId: string, rawPhone: string): string {
  const normalized = rawPhone.replace(/\D/g, '');
  return (
    'ph_contact_' +
    createHash('sha256')
      .update(`${workspaceId}:phone_contact:${normalized}`)
      .digest('hex')
      .slice(0, 24)
  );
}

/**
 * Strips script/style blocks, HTML tags, and control characters from untrusted call metadata.
 */
export function sanitizePhoneMetadataText(value: unknown, maxLength = 512): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function computePhoneWebhookSignature(rawBody: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export const DEFAULT_SYNTHETIC_PHONE_CALLS: ReadonlyArray<PhoneRawCallRecord> = [
  {
    id: 'phcall_exec_001',
    direction: 'inbound',
    lifecycleState: 'completed',
    participantPhone: '+919876543210',
    participantDisplayName: 'Ananya Rao (Board Chair)',
    purposeSummary: 'Confirmed Q4 board audit committee schedule and briefing window.',
    startedAt: '2026-10-19T08:00:00.000Z',
    endedAt: '2026-10-19T08:12:00.000Z',
    durationSeconds: 720,
    consentVerified: true,
    approvalId: null,
    receiptStatus: 'verified_mock'
  },
  {
    id: 'phcall_exec_002',
    direction: 'outbound_simulated',
    lifecycleState: 'answered',
    participantPhone: '+919880011223',
    participantDisplayName: 'Vikram Menon (General Counsel)',
    purposeSummary: 'Simulated executive check-in on vendor contract addendum.',
    startedAt: '2026-10-19T08:30:00.000Z',
    endedAt: null,
    durationSeconds: null,
    consentVerified: true,
    approvalId: 'appr_synth_002',
    receiptStatus: 'verified_mock'
  },
  {
    id: 'phcall_exec_003',
    direction: 'outbound_simulated',
    lifecycleState: 'ringing',
    participantPhone: '+14155550199',
    participantDisplayName: 'Meera Krishnan (VP Operations)',
    purposeSummary: 'Simulated status call regarding Bengaluru facility readiness.',
    startedAt: '2026-10-19T08:45:00.000Z',
    endedAt: null,
    durationSeconds: null,
    consentVerified: true,
    approvalId: 'appr_synth_003',
    receiptStatus: 'verified_mock'
  },
  {
    id: 'phcall_exec_004',
    direction: 'outbound_simulated',
    lifecycleState: 'queued',
    participantPhone: '+919845099887',
    participantDisplayName: 'Rohan Deshmukh (CFO)',
    purposeSummary: 'Simulated liquidity forecast confirmation call.',
    startedAt: '2026-10-19T09:00:00.000Z',
    endedAt: null,
    durationSeconds: null,
    consentVerified: true,
    approvalId: 'appr_synth_004',
    receiptStatus: 'verified_mock'
  },
  {
    id: 'phcall_exec_005',
    direction: 'outbound_simulated',
    lifecycleState: 'failed',
    participantPhone: '+14155550144',
    participantDisplayName: 'External Advisory Desk',
    purposeSummary: 'Simulated line busy failure during schedule confirmation.',
    startedAt: '2026-10-19T07:15:00.000Z',
    endedAt: '2026-10-19T07:15:30.000Z',
    durationSeconds: 0,
    consentVerified: true,
    approvalId: 'appr_synth_005',
    receiptStatus: 'failed'
  },
  {
    id: 'phcall_exec_006',
    direction: 'outbound_simulated',
    lifecycleState: 'cancelled',
    participantPhone: '+919820112233',
    participantDisplayName: 'Investor Relations Lead',
    purposeSummary: 'Simulated call cancelled prior to connection.',
    startedAt: '2026-10-19T07:00:00.000Z',
    endedAt: '2026-10-19T07:00:10.000Z',
    durationSeconds: 0,
    consentVerified: true,
    approvalId: 'appr_synth_006',
    receiptStatus: 'cancelled'
  }
];

export function createMockPhoneProvider(
  syntheticCalls: ReadonlyArray<PhoneRawCallRecord> = DEFAULT_SYNTHETIC_PHONE_CALLS
): PhoneProvider {
  return {
    mode: 'mock',
    async verifyConnection(input) {
      return {
        accessToken: `ph_mock_tok_${input.lineId}_${input.accountId}`,
        capabilities: [...PHONE_CAPABILITIES],
        expiresInSeconds: 3600,
        maskedLineNumber: input.displayLineMasked
          ? maskPhoneCallNumber(input.displayLineMasked)
          : `+91 ******${input.lineId.replace(/\D/g, '').slice(-4).padStart(4, '0')}`
      };
    },
    async listCalls(input) {
      let filtered = [...syntheticCalls];
      if (input.direction) {
        filtered = filtered.filter((c) => c.direction === input.direction);
      }
      if (input.lifecycleState) {
        filtered = filtered.filter((c) => c.lifecycleState === input.lifecycleState);
      }
      if (input.query) {
        const q = input.query.toLowerCase();
        filtered = filtered.filter(
          (c) =>
            c.purposeSummary.toLowerCase().includes(q) ||
            c.participantDisplayName.toLowerCase().includes(q)
        );
      }
      const startIdx = input.pageToken ? Number.parseInt(input.pageToken, 10) || 0 : 0;
      const page = filtered.slice(startIdx, startIdx + input.limit);
      const nextIdx = startIdx + input.limit;
      return {
        calls: page,
        ...(nextIdx < filtered.length ? { nextPageToken: String(nextIdx) } : {})
      };
    },
    async readCall(input) {
      const found = syntheticCalls.find((c) => c.id === input.callId);
      if (!found) {
        throw new NotFoundError('Phone call record not found.');
      }
      return found;
    }
  };
}

export interface PhoneOptions {
  provider?: PhoneProvider;
  vault?: PhoneVault;
  webhookSecret?: string;
  policyGateway?: PolicyGateway;
  audit?: (
    scope: AuthenticatedScope,
    action: string,
    payload: Record<string, unknown>
  ) => Promise<void>;
  now?: () => number;
}

const VALID_LIFECYCLE_TRANSITIONS: Record<
  PhoneCallLifecycleState,
  ReadonlyArray<PhoneCallLifecycleState>
> = {
  queued: ['ringing', 'cancelled', 'failed'],
  ringing: ['answered', 'cancelled', 'failed'],
  answered: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
};

export class PhoneFoundation {
  private policyGateway: PolicyGateway;
  private provider?: PhoneProvider;
  private vault?: PhoneVault;
  private webhookSecret?: string;
  private auditFn?: PhoneOptions['audit'];
  private now: () => number;
  private simulatedCallsByScope = new Map<string, Map<string, PhoneCallRecord>>();
  private idempotencyByScope = new Map<
    string,
    { parameterHash: string; call: PhoneCallRecord }
  >();
  private deduplicatedEvents = new Map<string, PhoneCallRecord>();

  constructor(options: PhoneOptions = {}) {
    if (options.provider && options.provider.mode !== 'mock') {
      throw new Error('Only mock Phone telephony providers are permitted in Step 95.');
    }
    this.policyGateway = options.policyGateway ?? defaultPolicyGateway;
    this.provider = options.provider;
    this.vault = options.vault;
    this.webhookSecret = options.webhookSecret;
    this.auditFn = options.audit;
    this.now = options.now ?? (() => Date.now());
  }

  private get configured(): boolean {
    return Boolean(this.provider && this.vault);
  }

  private scopePartitionKey(scope: AuthenticatedScope): string {
    return `${scope.workspaceId}:${scope.userId}`;
  }

  private evaluatePolicy(
    scope: AuthenticatedScope,
    actionName: string,
    parameters: Record<string, unknown>,
    approvalRequest: ApprovalRequest | null = null,
    idempotencyKey?: string
  ): void {
    const decision = this.policyGateway.evaluate(
      scope,
      {
        actionName,
        parameters,
        idempotencyKey:
          idempotencyKey ??
          `phone:${actionName}:${scope.workspaceId}:${scope.userId}:${this.now()}`
      },
      approvalRequest ?? undefined,
      scope.userId
    );
    if (!decision.allowed) {
      throw new ForbiddenError('Phone telephony action denied by policy.');
    }
  }

  private async audit(
    scope: AuthenticatedScope,
    action: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.auditFn?.(scope, action, payload);
  }

  private activeSession(scope: AuthenticatedScope): PhoneSessionRecord {
    if (!this.configured) {
      throw new AppError(
        'Phone telephony integration is not configured.',
        'PHONE_NOT_CONFIGURED',
        503
      );
    }
    const session = this.vault!.get<PhoneSessionRecord>(scope, 'session');
    if (!session) {
      throw new AppError(
        'Phone telephony is disconnected.',
        'PHONE_DISCONNECTED',
        409
      );
    }
    if (
      session.expiresAt <= this.now() ||
      !PHONE_CAPABILITIES.every((cap) => session.capabilities.includes(cap))
    ) {
      throw new AppError(
        'Phone telephony reconnection is required.',
        'PHONE_RECONNECT_REQUIRED',
        409
      );
    }
    return session;
  }

  async status(scope: AuthenticatedScope): Promise<PhoneStatus> {
    this.evaluatePolicy(scope, 'phone.connection.status', {});
    if (!this.configured) {
      return {
        connectorName: 'phone_telephony',
        status: 'not_configured',
        configured: false,
        connected: false,
        mode: 'disabled',
        capabilities: [...PHONE_CAPABILITIES],
        maskedLineNumber: null,
        recordingEnabled: false,
        transcriptionEnabled: false,
        lastVerifiedAt: null
      };
    }

    const session = this.vault!.get<PhoneSessionRecord>(scope, 'session');
    if (!session) {
      return {
        connectorName: 'phone_telephony',
        status: 'disconnected',
        configured: true,
        connected: false,
        mode: 'mock',
        capabilities: [...PHONE_CAPABILITIES],
        maskedLineNumber: null,
        recordingEnabled: false,
        transcriptionEnabled: false,
        lastVerifiedAt: null
      };
    }

    const valid =
      session.expiresAt > this.now() &&
      PHONE_CAPABILITIES.every((cap) => session.capabilities.includes(cap));

    return {
      connectorName: 'phone_telephony',
      status: valid ? 'connected' : 'reconnect_required',
      configured: true,
      connected: valid,
      mode: 'mock',
      capabilities: session.capabilities.filter((c) =>
        (PHONE_CAPABILITIES as readonly string[]).includes(c)
      ),
      maskedLineNumber: session.maskedLineNumber,
      recordingEnabled: false,
      transcriptionEnabled: false,
      lastVerifiedAt: session.verifiedAt
    };
  }

  async connect(scope: AuthenticatedScope, input: PhoneConnectInput): Promise<PhoneStatus> {
    if (!ConnectInputCompiler.Check(input)) {
      throw new AppError('Invalid Phone connection input.', 'PHONE_INVALID_INPUT', 400);
    }
    this.evaluatePolicy(
      scope,
      'phone.connection.connect',
      input as unknown as Record<string, unknown>
    );
    if (!this.configured) {
      throw new AppError(
        'Phone telephony integration is not configured.',
        'PHONE_NOT_CONFIGURED',
        503
      );
    }

    const verified = await this.provider!.verifyConnection(input);
    const granted = verified.capabilities.filter((c) =>
      (PHONE_CAPABILITIES as readonly string[]).includes(c)
    );
    if (
      !verified.accessToken ||
      !PHONE_CAPABILITIES.every((cap) => granted.includes(cap))
    ) {
      throw new AppError(
        'Phone telephony connection did not grant required read-only capabilities.',
        'PHONE_CAPABILITY_MISSING',
        403
      );
    }

    const verifiedAt = new Date(this.now()).toISOString();
    const record: PhoneSessionRecord = {
      accessToken: verified.accessToken,
      lineId: input.lineId,
      accountId: input.accountId,
      maskedLineNumber: /\*{4,}/.test(verified.maskedLineNumber)
        ? verified.maskedLineNumber
        : maskPhoneCallNumber(verified.maskedLineNumber),
      capabilities: granted,
      expiresAt: this.now() + Math.max(60, verified.expiresInSeconds) * 1000,
      verifiedAt
    };

    this.vault!.set(scope, 'session', record);
    await this.audit(scope, 'phone.connection.connected', {
      connectorName: 'phone_telephony',
      mode: 'mock',
      capabilities: granted,
      maskedLineNumber: record.maskedLineNumber,
      recordingEnabled: false,
      transcriptionEnabled: false
    });

    return this.status(scope);
  }

  async disconnect(scope: AuthenticatedScope): Promise<PhoneStatus> {
    this.evaluatePolicy(scope, 'phone.connection.disconnect', {});
    this.vault?.delete(scope, 'session');
    const scopeKey = this.scopePartitionKey(scope);
    this.simulatedCallsByScope.delete(scopeKey);
    await this.audit(scope, 'phone.connection.disconnected', {
      connectorName: 'phone_telephony'
    });
    return this.status(scope);
  }

  private normalizeCall(scope: AuthenticatedScope, raw: unknown): PhoneCallRecord {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    const direction =
      r.direction === 'outbound_simulated' ? 'outbound_simulated' : 'inbound';
    const rawLifecycle = typeof r.lifecycleState === 'string' ? r.lifecycleState : 'queued';
    const lifecycleState: PhoneCallLifecycleState =
      rawLifecycle === 'ringing' ||
      rawLifecycle === 'answered' ||
      rawLifecycle === 'completed' ||
      rawLifecycle === 'failed' ||
      rawLifecycle === 'cancelled'
        ? rawLifecycle
        : 'queued';

    const rawPhone =
      typeof r.participantPhone === 'string' ? r.participantPhone : '+10000000000';
    const displayName =
      sanitizePhoneMetadataText(r.participantDisplayName, 128) || 'Unknown Caller';
    const purposeSummary = sanitizePhoneMetadataText(r.purposeSummary, 512);
    const startedAt =
      typeof r.startedAt === 'string' ? r.startedAt : new Date(this.now()).toISOString();
    const endedAt = typeof r.endedAt === 'string' ? r.endedAt : null;
    const durationSeconds =
      typeof r.durationSeconds === 'number' && Number.isInteger(r.durationSeconds) && r.durationSeconds >= 0
        ? r.durationSeconds
        : null;
    const consentVerified = typeof r.consentVerified === 'boolean' ? r.consentVerified : true;
    const approvalId = typeof r.approvalId === 'string' ? r.approvalId : null;
    const receiptStatus =
      r.receiptStatus === 'awaiting_approval' ||
      r.receiptStatus === 'failed' ||
      r.receiptStatus === 'cancelled'
        ? r.receiptStatus
        : lifecycleState === 'failed'
          ? 'failed'
          : lifecycleState === 'cancelled'
            ? 'cancelled'
            : 'verified_mock';

    const record: PhoneCallRecord = {
      id,
      direction,
      lifecycleState,
      participant: {
        contactHash: hashPhoneParticipant(scope.workspaceId, rawPhone),
        maskedPhone: maskPhoneCallNumber(rawPhone),
        displayName
      },
      purposeSummary,
      startedAt,
      endedAt,
      durationSeconds,
      recordingEnabled: false,
      transcriptionEnabled: false,
      consentVerified,
      approvalId,
      receiptStatus,
      untrusted: true,
      mode: 'mock'
    };

    if (!CallRecordCompiler.Check(record)) {
      throw new AppError(
        'Phone provider returned an invalid call record.',
        'PHONE_PROVIDER_INVALID_RESPONSE',
        502
      );
    }
    return record;
  }

  async listCalls(
    scope: AuthenticatedScope,
    input: PhoneListCalls = {}
  ): Promise<PhoneListCallsResponse> {
    if (!ListCallsCompiler.Check(input)) {
      throw new AppError('Invalid Phone list calls input.', 'PHONE_INVALID_INPUT', 400);
    }
    const query = input.query?.trim();
    if (query && /[\r\n\0]/.test(query)) {
      throw new AppError('Unsafe Phone search query.', 'PHONE_INVALID_QUERY', 400);
    }
    this.evaluatePolicy(
      scope,
      'phone.calls.list',
      input as unknown as Record<string, unknown>
    );
    const session = this.activeSession(scope);
    const limit = input.limit ?? 20;

    let providerResult: { calls: unknown[]; nextPageToken?: string };
    try {
      providerResult = await this.provider!.listCalls({
        accessToken: session.accessToken,
        direction: input.direction,
        lifecycleState: input.lifecycleState,
        query,
        limit,
        pageToken: input.pageToken
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(
        'Phone telephony call history list failed.',
        'PHONE_PROVIDER_UNAVAILABLE',
        502
      );
    }

    const providerCalls = (providerResult.calls ?? [])
      .slice(0, limit)
      .map((c) => this.normalizeCall(scope, c));

    const scopeCallsMap = this.simulatedCallsByScope.get(this.scopePartitionKey(scope));
    const localCalls = scopeCallsMap ? [...scopeCallsMap.values()] : [];
    const filteredLocal = localCalls.filter((c) => {
      if (input.direction && c.direction !== input.direction) return false;
      if (input.lifecycleState && c.lifecycleState !== input.lifecycleState) return false;
      if (query) {
        const q = query.toLowerCase();
        if (
          !c.purposeSummary.toLowerCase().includes(q) &&
          !c.participant.displayName.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });

    const mergedById = new Map<string, PhoneCallRecord>();
    for (const c of filteredLocal) {
      mergedById.set(c.id, c);
    }
    for (const c of providerCalls) {
      if (!mergedById.has(c.id)) {
        mergedById.set(c.id, c);
      }
    }

    const mergedCalls = [...mergedById.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);

    const response: PhoneListCallsResponse = {
      calls: mergedCalls,
      totalCount: mergedCalls.length,
      ...(providerResult.nextPageToken ? { nextPageToken: providerResult.nextPageToken } : {}),
      recordingEnabled: false,
      transcriptionEnabled: false,
      untrusted: true,
      mode: 'mock'
    };

    if (!ListCallsResponseCompiler.Check(response)) {
      throw new AppError(
        'Phone provider returned an invalid call history response.',
        'PHONE_PROVIDER_INVALID_RESPONSE',
        502
      );
    }

    await this.audit(scope, 'phone.calls.listed', {
      connectorName: 'phone_telephony',
      directionFiltered: Boolean(input.direction),
      lifecycleFiltered: Boolean(input.lifecycleState),
      returnedCalls: response.calls.length,
      recordingEnabled: false,
      transcriptionEnabled: false
    });

    return response;
  }

  async readCall(scope: AuthenticatedScope, callId: string): Promise<PhoneCallRecord> {
    if (!CallIdCompiler.Check(callId)) {
      throw new AppError('Invalid Phone call ID.', 'PHONE_INVALID_INPUT', 400);
    }
    this.evaluatePolicy(scope, 'phone.calls.read', { callId });
    const session = this.activeSession(scope);

    const scopeCalls = this.simulatedCallsByScope.get(this.scopePartitionKey(scope));
    const localMatch = scopeCalls?.get(callId);
    if (localMatch) {
      await this.audit(scope, 'phone.calls.read', {
        connectorName: 'phone_telephony',
        callId: localMatch.id,
        lifecycleState: localMatch.lifecycleState
      });
      return localMatch;
    }

    let raw: unknown;
    try {
      raw = await this.provider!.readCall({
        accessToken: session.accessToken,
        callId
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(
        'Phone telephony call read failed.',
        'PHONE_PROVIDER_UNAVAILABLE',
        502
      );
    }

    const call = this.normalizeCall(scope, raw);
    await this.audit(scope, 'phone.calls.read', {
      connectorName: 'phone_telephony',
      callId: call.id,
      lifecycleState: call.lifecycleState
    });
    return call;
  }

  /**
   * Prepares and queues a simulated outbound phone call request.
   * Strictly enforces:
   * 1. Explicit consent (`explicitConsentGranted === true`).
   * 2. Recording and transcription disabled (`recordingRequested !== true`, `transcriptionRequested !== true`).
   * 3. PolicyGateway evaluation (`phone.calls.request_outbound`, `approvalMode: 'explicit'`, `idempotencyRequired: true`).
   * 4. Explicit approved `ApprovalRequest` bound to the request parameters.
   * 5. Workspace/user-scoped idempotency (`idempotencyKey` replay vs 409 Conflict on payload mismatch).
   */
  async requestOutboundCall(
    scope: AuthenticatedScope,
    request: PhoneOutboundCallRequest,
    approvedRequest: ApprovalRequest | null = null
  ): Promise<{
    call: PhoneCallRecord;
    idempotentReplay: boolean;
  }> {
    if (!OutboundRequestCompiler.Check(request)) {
      throw new AppError('Invalid outbound phone call request.', 'PHONE_INVALID_INPUT', 400);
    }
    if (request.recordingRequested === true || request.transcriptionRequested === true) {
      throw new AppError(
        'Call recording and transcription are strictly disabled.',
        'PHONE_RECORDING_TRANSCRIPTION_DISABLED',
        400
      );
    }
    if (request.explicitConsentGranted !== true) {
      throw new ForbiddenError(
        'Explicit user consent (explicitConsentGranted: true) is required before requesting an outbound call.'
      );
    }

    this.evaluatePolicy(
      scope,
      'phone.calls.request_outbound',
      request as unknown as Record<string, unknown>,
      approvedRequest,
      request.idempotencyKey
    );
    if (!approvedRequest || approvedRequest.status !== 'approved') {
      throw new ForbiddenError('Outbound phone calls require explicit user approval.');
    }

    this.activeSession(scope);

    const scopeKey = this.scopePartitionKey(scope);
    const idempKey = `${scopeKey}:idemp:${request.idempotencyKey}`;
    const parameterHash = createHash('sha256')
      .update(
        JSON.stringify([
          maskPhoneCallNumber(request.recipientMaskedPhone),
          sanitizePhoneMetadataText(request.recipientDisplayName, 128),
          sanitizePhoneMetadataText(request.purposeSummary, 512),
          true
        ])
      )
      .digest('hex');

    const existingIdemp = this.idempotencyByScope.get(idempKey);
    if (existingIdemp) {
      if (existingIdemp.parameterHash !== parameterHash) {
        throw new ConflictError(
          `Idempotency key '${request.idempotencyKey}' was already used with different call parameters.`
        );
      }
      return {
        call: existingIdemp.call,
        idempotentReplay: true
      };
    }

    const callId = `phcall_sim_${parameterHash.slice(0, 12)}`;
    const call: PhoneCallRecord = {
      id: callId,
      direction: 'outbound_simulated',
      lifecycleState: 'queued',
      participant: {
        contactHash: hashPhoneParticipant(scope.workspaceId, request.recipientMaskedPhone),
        maskedPhone: maskPhoneCallNumber(request.recipientMaskedPhone),
        displayName:
          sanitizePhoneMetadataText(request.recipientDisplayName, 128) || 'Executive Contact'
      },
      purposeSummary: sanitizePhoneMetadataText(request.purposeSummary, 512),
      startedAt: new Date(this.now()).toISOString(),
      endedAt: null,
      durationSeconds: null,
      recordingEnabled: false,
      transcriptionEnabled: false,
      consentVerified: true,
      approvalId: approvedRequest.id,
      receiptStatus: 'verified_mock',
      untrusted: true,
      mode: 'mock'
    };

    let scopeCalls = this.simulatedCallsByScope.get(scopeKey);
    if (!scopeCalls) {
      scopeCalls = new Map<string, PhoneCallRecord>();
      this.simulatedCallsByScope.set(scopeKey, scopeCalls);
    }
    scopeCalls.set(call.id, call);
    this.idempotencyByScope.set(idempKey, { parameterHash, call });

    await this.audit(scope, 'phone.calls.outbound_simulated_queued', {
      connectorName: 'phone_telephony',
      callId: call.id,
      approvalId: approvedRequest.id,
      idempotencyKey: request.idempotencyKey,
      lifecycleState: call.lifecycleState,
      receiptStatus: call.receiptStatus,
      recordingEnabled: false,
      transcriptionEnabled: false
    });

    return {
      call,
      idempotentReplay: false
    };
  }

  /**
   * Transitions a tenant-scoped simulated call across mock lifecycle states:
   * `queued -> ringing -> answered -> completed | failed | cancelled`.
   */
  async transitionSimulatedCallLifecycle(
    scope: AuthenticatedScope,
    callId: string,
    nextState: PhoneCallLifecycleState,
    durationSeconds?: number
  ): Promise<PhoneCallRecord> {
    this.activeSession(scope);
    const scopeKey = this.scopePartitionKey(scope);
    const scopeCalls = this.simulatedCallsByScope.get(scopeKey);
    const existing = scopeCalls?.get(callId);
    if (!existing) {
      throw new NotFoundError(`Simulated phone call '${callId}' not found in current scope.`);
    }

    const allowedNext = VALID_LIFECYCLE_TRANSITIONS[existing.lifecycleState] ?? [];
    if (!allowedNext.includes(nextState)) {
      throw new ConflictError(
        `Invalid phone call lifecycle transition from '${existing.lifecycleState}' to '${nextState}'.`
      );
    }

    const isTerminal =
      nextState === 'completed' || nextState === 'failed' || nextState === 'cancelled';
    const updated: PhoneCallRecord = {
      ...existing,
      lifecycleState: nextState,
      endedAt: isTerminal ? new Date(this.now()).toISOString() : null,
      durationSeconds:
        nextState === 'completed'
          ? durationSeconds ?? 180
          : nextState === 'failed' || nextState === 'cancelled'
            ? 0
            : null,
      recordingEnabled: false,
      transcriptionEnabled: false,
      receiptStatus:
        nextState === 'failed'
          ? 'failed'
          : nextState === 'cancelled'
            ? 'cancelled'
            : 'verified_mock'
    };

    scopeCalls!.set(callId, updated);
    await this.audit(scope, 'phone.calls.lifecycle_transitioned', {
      connectorName: 'phone_telephony',
      callId,
      previousState: existing.lifecycleState,
      lifecycleState: updated.lifecycleState,
      receiptStatus: updated.receiptStatus,
      recordingEnabled: false,
      transcriptionEnabled: false
    });

    return updated;
  }

  /**
   * Offline/mocked webhook signature verification, replay protection, and tenant-scoped
   * event deduplication. No live public webhook endpoint is exposed in Step 95.
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
    call: PhoneCallRecord;
  }> {
    const secret = this.webhookSecret;
    if (!secret || secret.length < 16) {
      throw new AppError(
        'Phone webhook verification secret is not configured.',
        'PHONE_WEBHOOK_NOT_CONFIGURED',
        503
      );
    }

    const expectedSig = computePhoneWebhookSignature(input.rawBody, secret);
    const providedBuf = Buffer.from(input.signatureHeader || '', 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      await this.audit(scope, 'phone.webhook.rejected_signature', {
        connectorName: 'phone_telephony',
        reason: 'invalid_signature'
      });
      throw new AppError(
        'Invalid Phone webhook signature.',
        'PHONE_WEBHOOK_SIGNATURE_INVALID',
        401
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      throw new AppError('Invalid Phone webhook JSON.', 'PHONE_WEBHOOK_INVALID_PAYLOAD', 400);
    }

    if (!WebhookEnvelopeCompiler.Check(parsed)) {
      throw new AppError(
        'Phone webhook payload failed schema validation.',
        'PHONE_WEBHOOK_INVALID_PAYLOAD',
        400
      );
    }

    const envelope = parsed as PhoneWebhookEventEnvelope;
    if (envelope.workspaceId !== scope.workspaceId || envelope.userId !== scope.userId) {
      throw new ForbiddenError('Phone webhook event scope mismatch.');
    }

    const nowSeconds = Math.floor(this.now() / 1000);
    const maxSkewSeconds = input.maxSkewSeconds ?? 300;
    if (Math.abs(nowSeconds - envelope.timestampSeconds) > maxSkewSeconds) {
      await this.audit(scope, 'phone.webhook.rejected_replay', {
        connectorName: 'phone_telephony',
        eventId: envelope.eventId,
        reason: 'timestamp_out_of_window'
      });
      throw new AppError(
        'Phone webhook event timestamp is outside the replay protection window.',
        'PHONE_WEBHOOK_REPLAY_DETECTED',
        409
      );
    }

    const scopeKey = this.scopePartitionKey(scope);
    const eventKey = `${scopeKey}:event:${envelope.eventId}`;
    const stateKey = `${scopeKey}:call:${envelope.callId}:${envelope.lifecycleState}`;
    const existing =
      this.deduplicatedEvents.get(eventKey) ?? this.deduplicatedEvents.get(stateKey);
    if (existing) {
      return {
        accepted: true,
        deduplicated: true,
        eventId: envelope.eventId,
        call: existing
      };
    }

    const isTerminal =
      envelope.lifecycleState === 'completed' ||
      envelope.lifecycleState === 'failed' ||
      envelope.lifecycleState === 'cancelled';
    const timestampIso = new Date(envelope.timestampSeconds * 1000).toISOString();

    const normalized = this.normalizeCall(scope, {
      id: envelope.callId,
      direction: envelope.direction ?? 'inbound',
      lifecycleState: envelope.lifecycleState,
      participantPhone: envelope.callerPhone,
      participantDisplayName: envelope.callerDisplayName,
      purposeSummary: envelope.purposeSummary,
      startedAt: timestampIso,
      endedAt: isTerminal ? timestampIso : null,
      durationSeconds: envelope.durationSeconds ?? (isTerminal ? 0 : null),
      consentVerified: true,
      approvalId: null
    });

    this.deduplicatedEvents.set(eventKey, normalized);
    this.deduplicatedEvents.set(stateKey, normalized);

    let scopeCalls = this.simulatedCallsByScope.get(scopeKey);
    if (!scopeCalls) {
      scopeCalls = new Map<string, PhoneCallRecord>();
      this.simulatedCallsByScope.set(scopeKey, scopeCalls);
    }
    scopeCalls.set(normalized.id, normalized);

    await this.audit(scope, 'phone.webhook.ingested_mock', {
      connectorName: 'phone_telephony',
      eventId: envelope.eventId,
      callId: normalized.id,
      lifecycleState: normalized.lifecycleState,
      recordingEnabled: false,
      transcriptionEnabled: false
    });

    return {
      accepted: true,
      deduplicated: false,
      eventId: envelope.eventId,
      call: normalized
    };
  }

  /**
   * Prepares sanitized, inactive (`active: false`) Phone call context for future
   * Thaara-only n8n workflow blueprints without modifying or activating any existing n8n workflows.
   */
  toN8nContext(listResponse: PhoneListCallsResponse): PhoneN8nContext {
    const context: PhoneN8nContext = {
      connectorName: 'phone_telephony',
      mode: 'mock',
      untrusted: true,
      active: false,
      recordingEnabled: false,
      transcriptionEnabled: false,
      callCount: listResponse.calls.length,
      calls: listResponse.calls.map((c) => ({
        ...c,
        purposeSummary: sanitizePhoneMetadataText(c.purposeSummary, 512),
        recordingEnabled: false,
        transcriptionEnabled: false,
        untrusted: true,
        mode: 'mock'
      }))
    };

    if (!N8nContextCompiler.Check(context)) {
      throw new AppError(
        'Phone n8n context failed contract validation.',
        'PHONE_N8N_CONTEXT_INVALID',
        500
      );
    }

    return context;
  }

  /**
   * Prepares an executive Phone call-history briefing from authorized synthetic calls
   * and generates a validated offline (`active: false`) n8n workflow blueprint containing
   * metadata references only (never raw phone numbers or private call details).
   */
  async prepareBriefing(
    scope: AuthenticatedScope,
    input: PhoneBriefingQuery = {}
  ): Promise<PhoneBriefingResponse> {
    if (!BriefingQueryCompiler.Check(input)) {
      throw new AppError('Invalid Phone briefing query.', 'PHONE_INVALID_INPUT', 400);
    }
    this.evaluatePolicy(
      scope,
      'phone.briefing.prepare',
      input as unknown as Record<string, unknown>
    );

    const generateBlueprint = input.generateWorkflowBlueprint ?? true;
    const workflowName = (
      input.workflowName ?? 'Daily Executive Phone Call Briefing'
    ).trim();
    if (
      workflowName.length < 3 ||
      workflowName.length > 120 ||
      /<[^>]+>/.test(workflowName) ||
      detectWorkflowSecurityViolations([workflowName]).length > 0
    ) {
      throw new AppError(
        'Invalid or unsafe Phone briefing workflowName.',
        'PHONE_INVALID_INPUT',
        400
      );
    }

    const listed = await this.listCalls(scope, {
      ...(input.direction ? { direction: input.direction } : {}),
      ...(input.lifecycleState ? { lifecycleState: input.lifecycleState } : {}),
      ...(input.query ? { query: input.query } : {}),
      limit: input.limit ?? 25
    });

    const followUpRegex =
      /\b(?:confirm|follow[\s-]*up|callback|schedule|review|urgent|board|forecast|addendum|action|pending|readiness)\b/i;

    const isMissedOrFailed = (call: PhoneCallRecord): boolean =>
      call.lifecycleState === 'failed' ||
      call.lifecycleState === 'cancelled' ||
      (call.direction === 'inbound' &&
        (call.lifecycleState === 'ringing' || call.lifecycleState === 'queued'));

    const followUpItems: PhoneBriefingFollowUpItem[] = [];
    const followUpCallIdSet = new Set<string>();

    for (const call of listed.calls) {
      const missedOrFailed = isMissedOrFailed(call);
      const pendingCall =
        call.lifecycleState === 'queued' ||
        call.lifecycleState === 'ringing' ||
        call.lifecycleState === 'answered';
      const hasActionKeyword = followUpRegex.test(call.purposeSummary);

      if (missedOrFailed || pendingCall || hasActionKeyword) {
        followUpCallIdSet.add(call.id);
        const reason =
          call.lifecycleState === 'failed'
            ? 'failed_call_retry_or_review'
            : call.lifecycleState === 'cancelled'
              ? 'cancelled_call_reschedule_check'
              : call.lifecycleState === 'queued' || call.lifecycleState === 'ringing'
                ? 'pending_call_in_progress'
                : 'follow_up_action_noted';
        followUpItems.push({
          callId: call.id,
          direction: call.direction,
          lifecycleState: call.lifecycleState,
          participant: call.participant,
          startedAt: call.startedAt,
          reason,
          snippet: sanitizePhoneMetadataText(call.purposeSummary, 280),
          untrusted: true
        });
      }
    }

    const recentCalls: PhoneBriefingActivityItem[] = listed.calls.map((c) => ({
      callId: c.id,
      direction: c.direction,
      lifecycleState: c.lifecycleState,
      participant: c.participant,
      startedAt: c.startedAt,
      durationSeconds: c.durationSeconds,
      summarySnippet: sanitizePhoneMetadataText(c.purposeSummary, 280),
      needsFollowUp: followUpCallIdSet.has(c.id),
      untrusted: true
    }));

    const missedOrFailedCalls = recentCalls.filter((item) =>
      listed.calls.some((c) => c.id === item.callId && isMissedOrFailed(c))
    );

    const inboundCount = listed.calls.filter((c) => c.direction === 'inbound').length;
    const outboundSimulatedCount = listed.calls.filter(
      (c) => c.direction === 'outbound_simulated'
    ).length;

    const n8nContext: PhoneBriefingN8nContext = {
      connector: 'phone_telephony',
      operation: 'read_call_history_briefing_metadata',
      readOnly: true,
      active: false,
      recordingEnabled: false,
      transcriptionEnabled: false,
      callIds: recentCalls.map((c) => c.callId),
      missedOrFailedCallIds: missedOrFailedCalls.map((c) => c.callId),
      followUpCallIds: followUpItems.map((f) => f.callId),
      totalCalls: recentCalls.length,
      inboundCount,
      outboundSimulatedCount,
      missedOrFailedCount: missedOrFailedCalls.length
    };

    const headline =
      recentCalls.length === 0
        ? 'No Phone telephony calls in the current briefing window.'
        : `${recentCalls.length} phone call${recentCalls.length === 1 ? '' : 's'} (${inboundCount} incoming, ${outboundSimulatedCount} outgoing simulated, ${missedOrFailedCalls.length} missed/failed, ${followUpItems.length} follow-up item${followUpItems.length === 1 ? '' : 's'}).`;

    const blueprintResult = generateBlueprint
      ? buildPhoneBriefingN8nBlueprint({
          workflowName,
          n8nContext
        })
      : undefined;

    const result: PhoneBriefingResponse = {
      headline,
      totalCalls: recentCalls.length,
      inboundCount,
      outboundSimulatedCount,
      missedOrFailedCount: missedOrFailedCalls.length,
      followUpCount: followUpItems.length,
      missedOrFailedCalls,
      recentCalls,
      followUpItems,
      n8nContext,
      ...(blueprintResult
        ? {
            n8nBlueprint: blueprintResult.blueprint,
            workflowHash: blueprintResult.workflowHash
          }
        : {}),
      recordingEnabled: false,
      transcriptionEnabled: false,
      untrusted: true,
      mode: 'mock'
    };

    if (!BriefingResponseCompiler.Check(result)) {
      throw new AppError(
        'Phone briefing response failed contract validation.',
        'PHONE_PROVIDER_INVALID_RESPONSE',
        502
      );
    }

    await this.audit(scope, 'phone.briefing.completed', {
      connectorName: 'phone_telephony',
      mode: 'mock',
      totalCalls: result.totalCalls,
      inboundCount: result.inboundCount,
      outboundSimulatedCount: result.outboundSimulatedCount,
      missedOrFailedCount: result.missedOrFailedCount,
      followUpCount: result.followUpCount,
      recordingEnabled: false,
      transcriptionEnabled: false,
      blueprintGenerated: Boolean(blueprintResult)
    });

    return result;
  }
}

export function buildPhoneBriefingN8nBlueprint(input: {
  workflowName: string;
  n8nContext: PhoneBriefingN8nContext;
}): { blueprint: N8nWorkflowBlueprint; workflowHash: string } {
  const workflowHash = computeCanonicalParameterHash({
    schema: 'thaara.phone_briefing_workflow.v1',
    workflowName: input.workflowName,
    callIds: input.n8nContext.callIds,
    missedOrFailedCallIds: input.n8nContext.missedOrFailedCallIds,
    followUpCallIds: input.n8nContext.followUpCallIds,
    totalCalls: input.n8nContext.totalCalls,
    inboundCount: input.n8nContext.inboundCount,
    outboundSimulatedCount: input.n8nContext.outboundSimulatedCount,
    missedOrFailedCount: input.n8nContext.missedOrFailedCount
  });
  const suffix = workflowHash.slice(0, 8);
  const triggerNode = 'Daily_Phone_Digest_Trigger';
  const filterNode = 'Filter_Missed_And_FollowUp_Calls';
  const composeDraftNode = 'Compose_Phone_Briefing_Draft';

  const blueprint: N8nWorkflowBlueprint = {
    name: input.workflowName,
    active: false,
    versionId: `v1-${workflowHash.slice(0, 16)}`,
    nodes: [
      {
        id: `node-ph-trigger-${suffix}`,
        name: triggerNode,
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1,
        position: [240, 300],
        parameters: {
          mode: 'everyDay',
          connector: 'phone_telephony',
          operation: 'read_call_history_briefing_metadata',
          readOnly: true
        }
      },
      {
        id: `node-ph-filter-${suffix}`,
        name: filterNode,
        type: 'n8n-nodes-base.if',
        typeVersion: 1,
        position: [480, 300],
        parameters: {
          field: 'total_calls',
          operator: 'not_equals',
          value: '0'
        }
      },
      {
        id: `node-ph-briefing-${suffix}`,
        name: composeDraftNode,
        type: 'n8n-nodes-base.set',
        typeVersion: 1,
        position: [720, 300],
        parameters: {
          connector: 'phone_telephony',
          callIds: input.n8nContext.callIds,
          missedOrFailedCallIds: input.n8nContext.missedOrFailedCallIds,
          followUpCallIds: input.n8nContext.followUpCallIds,
          totalCalls: input.n8nContext.totalCalls,
          inboundCount: input.n8nContext.inboundCount,
          outboundSimulatedCount: input.n8nContext.outboundSimulatedCount,
          missedOrFailedCount: input.n8nContext.missedOrFailedCount,
          recordingEnabled: false,
          transcriptionEnabled: false,
          outboundCallingEnabled: false,
          rawPrivateCallDetailsEmbedded: false,
          untrustedCallMetadata: true,
          deliveryMode: 'offline_briefing_draft_only_no_live_execution'
        }
      }
    ],
    connections: {
      [triggerNode]: {
        main: [[{ node: filterNode, type: 'main', index: 0 }]]
      },
      [filterNode]: {
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
      `Failed to validate offline Phone n8n blueprint: ${validation.errors.join('; ')}`,
      'PHONE_BLUEPRINT_INVALID',
      500
    );
  }
  return { blueprint, workflowHash };
}
