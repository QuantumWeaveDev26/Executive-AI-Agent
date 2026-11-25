import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import {
  PHONE_RECORDING_PLAYBACK_ACTION,
  capturePhoneCallEvidence,
  isPhoneProviderCallId,
  type PhoneCallingDraft,
  type PhoneCallingRecord,
  type PhoneInboundHistoryDetailRecord,
  type PhoneInboundHistorySummary,
  type PhoneN8nCallSyncBatchRequest,
  type PhoneN8nCallSyncBatchResponse,
  type PhoneN8nCallbackEmailPayload,
  type PhoneN8nCallbackEvaluateClaimRequest,
  type PhoneN8nCallbackEvaluateClaimResponse,
  type PhoneN8nCallbackReceiptRequest,
  type PhoneN8nCallbackReceiptResponse,
  type PhoneN8nSyncCheckpointResponse,
  type PhoneN8nSyncedCallInput,
  type PhoneSyncedCallDetails,
  type PhoneSyncedTranscriptTurn
} from '@thaara/contracts';
import {
  AuditEventRepository,
  applyPhoneProviderEvent,
  type AuthenticatedScope,
  type DbClient,
  type TransactionalDbClient
} from '@thaara/db';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError } from '@thaara/observability';
import type { PolicyGateway } from '@thaara/policy';

const E164_RE = /^\+[1-9][0-9]{7,14}$/;
const SIMPLE_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const INTERACTION_ID_RE = /^(?:[A-Za-z0-9_.:-]{1,128}|[0-9]{8}\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,199})$/;
const CALL_SYNC_JOB = 'phone.n8n.call_sync';
const SYNC_CURSOR_JOB = 'phone.n8n.sync_checkpoint';
const CALLBACK_NOTIFY_JOB = 'phone.n8n.callback_notify';
const DEFAULT_OVERLAP_MINUTES = 15;
const DEFAULT_BACKFILL_DAYS = 30;
const CLAIM_LEASE_MS = 10 * 60 * 1000;
const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
const RETENTION_FUTURE_ISO = '2099-12-31T23:59:59.000Z';

const CALLBACK_KEYWORD_RE =
  /\b(?:callback|call\s+(?:you\s+|me\s+)?back|team\s+will\s+(?:call|contact|reach\s+out)|have\s+(?:someone|our\s+team)\s+(?:call|contact)|arrange\s+a\s+call|schedule\s+a\s+call)\b|ಮರಳಿ ಕರೆ|ಮತ್ತೆ ಕರೆ|ವಾಪಸ್ ಕರೆ|ತಂಡ.*ಸಂಪರ್ಕ|वापस कॉल|दोबारा कॉल|टीम.*संपर्क/iu;

const CALLBACK_RECAP_PROMPT_RE =
  /\b(?:(?:may|can|shall|should)\s+i|would\s+you\s+like\s+me\s+to|let\s+me\s+know\s+if\s+i\s+(?:can|may|should))\s+(?:(?:go\s+ahead\s+and|proceed\s+(?:to|and))\s+)?(?:save|record|submit|register|book|arrange|send|log)\b[\s\S]{0,180}\b(?:callback|call\s+back|request|these\s+details|your\s+details|(?:this|it)\s+for\s+you)\b|\b(?:do you|can you|please|would you)\s+confirm\b[\s\S]{0,180}\b(?:save|record|submit|register|book|callback|call\s+back|details)\b|\bshall\s+i\s+(?:confirm|book|register|submit)\b|ದಾಖಲಿಸಬಹುದೇ|ದಾಖಲಿಸಲೇ|ಉಳಿಸಬಹುದೇ|ಸಲ್ಲಿಸಬಹುದೇ|ಬುಕ್\s*ಮಾಡಬಹುದೇ|ಬುಕ್\s*ಮಾಡಲಾ|ಸಬ್ಮಿಟ್\s*ಮಾಡಬಹುದೇ|ಸಬ್ಮಿಟ್\s*ಮಾಡಲೇ|ಕಳುಹಿಸಬಹುದೇ|क्या मैं[\s\S]{0,500}(?:दर्ज|भेज|बुक|सेव|सबमिट)|(?:सबमिट|बुक|दर्ज|सेव)\s*कर\s*(?:दूँ|दूं|लूँ|लूं)?/iu;

const CALLBACK_BOOKED_ACK_RE =
  /\b(?:callback\s+request\s+has\s+been\s+(?:successfully\s+)?(?:booked|saved|registered|submitted)|our\s+team\s+will\s+(?:call|contact|reach\s+out\s+to)\s+you\s+(?:soon|shortly))\b/iu;

const LEADING_FILLER = '(?:(?:ah+|uh+|um+|oh+|hmm+|haan?|ha|ji)[,.\\s!।]+)*';
const ACTION_TARGET = '(?:it|that|this|the\\s+(?:callback(?:\\s+request)?|call\\s+back(?:\\s+request)?|request|details)|(?:my\\s+)?(?:callback(?:\\s+request)?|call\\s+back(?:\\s+request)?|request|details))';
const ACTION_VERB = `(?:save|submit|book|record|register|confirm|send|do|proceed|submitted|booked|saved|recorded|registered|confirmed)(?:\\s+${ACTION_TARGET})?`;
const NATURAL_CLAUSE = `(?:i['’]?ll\\s+do\\s+(?:it|that)|(?:i\\s+want|i['’]?d\\s+like|please\\s+arrange)\\s+(?:a\\s+|the\\s+|this\\s+|my\\s+)?(?:callback|call\\s+back)(?:\\s+request)?|sounds\\s+good|go\\s+for\\s+it|that\\s+works|perfect|fine|alright|all\\s+right)`;
const AFFIRMATIVE_RE = new RegExp(
  `^${LEADING_FILLER}(?:yes|yeah|yep|yup|sure|okay|ok|correct|right|haan|ha|ji|${NATURAL_CLAUSE}|(?:you\\s+(?:can|may)\\s+)?(?:kindly\\s+)?go\\s+ahead(?:\\s+and\\s+${ACTION_VERB})?|(?:you\\s+(?:can|may)\\s+)?(?:kindly\\s+)?${ACTION_VERB}|please(?:\\s+(?:do|go\\s+ahead|${ACTION_VERB}))?|that['’]?s\\s+(?:correct|right)|ಹೌದು|ಸರಿ|ಓಕೆ|ಮಾಡಿ|ದಾಖಲಿಸಿ|ಸಲ್ಲಿಸಿ|ಬುಕ್\\s*ಮಾಡಿ|howdu|haudu|sari|हाँ|हां|जी(?:\\s*(?:हाँ|हां|बिल्कुल))?|ठीक\\s*है|बिल्कुल|सबमिट\\s*कर(?:\\s*दीजिए|\\s*दो)?|बुक\\s*कर(?:\\s*दीजिए|\\s*दो)?)(?:[,.\\s!।]+(?:and\\s+)?(?:you\\s+(?:can|may)\\s+)?(?:kindly\\s+)?(?:please|correct|that['’]?s\\s*(?:correct|right)|go\\s+ahead|${ACTION_VERB}|${NATURAL_CLAUSE}|sure|thank\\s+you|thanks|ದಯವಿಟ್ಟು|ಸರಿ|ಮಾಡಿ|ದಾಖಲಿಸಿ|ಸಲ್ಲಿಸಿ|ಬುಕ್\\s*ಮಾಡಿ|जी|धन्यवाद|कर\\s*दीजिए|कर\\s*दो))*[.!।\\s]*$`,
  'iu'
);
const NEGATIVE_GUARD_RE = /\b(?:no|not|never|don['’]?t|wait|hold on|wrong|incorrect|actually|cancel|change)\b|ಬೇಡ|ಇಲ್ಲ|ತಪ್ಪು|ಬದಲ|नहीं|नही|मत|गलत|बदल/iu;
const WITHDRAWAL_RE = /(?:do not|don['’]t)\s+(?:call|contact)|cancel\s+(?:the\s+|my\s+)?callback|not\s+interested\s+in\s+(?:a\s+)?callback|no\s+callback|ಕರೆ ಮಾಡಬೇಡಿ|ಕರೆ ಬೇಡ|संपर्क मत|कॉल मत/iu;

export interface PersistedSyncedCall {
  callId: string;
  workspaceId: string;
  ownerUserId: string;
  direction: 'inbound' | 'outbound';
  attemptId: string;
  interactionId: string | null;
  connectivityStatus: 'connected' | 'no_answer' | 'busy' | 'failed' | 'unknown';
  callStatus: 'ended' | 'interrupted' | 'failed' | 'no_answer' | 'busy' | 'unknown';
  failureReason: string | null;
  endedBy: string | null;
  occurredAt: string;
  timestampSource: 'provider_started' | 'provider_ended' | 'received_at';
  durationSeconds: number | null;
  phoneE164: string | null;
  maskedInboundPhone: string;
  maskedOutboundPhone: string;
  customerName: string | null;
  business: string | null;
  serviceNeeded: string | null;
  requirements: string | null;
  preferredCallbackTime: string | null;
  summary: string | null;
  recordingAvailable: boolean;
  appVersion: number | null;
  languageName: string | null;
  transcript: PhoneSyncedTranscriptTurn[];
  callbackEligibility: 'confirmed' | 'needs_review' | 'declined' | 'not_requested';
  callbackRequestId: string | null;
  updatedAt: string;
}

export interface PersistedCallbackClaimState {
  callId: string;
  callbackRequestId: string;
  status: 'processing' | 'completed' | 'failed' | 'retrying';
  claimAttemptId: string | null;
  attempts: number;
  claimedAtMs: number | null;
  providerMessageId: string | null;
  lastError: string | null;
}

export interface PersistedSyncCursor {
  cursorStartDatetime: string;
  backfillCompleted: boolean;
  callbackCutoffDatetime: string;
}

export interface ExistingDbCallbackInfo {
  requestId: string;
  callId: string;
  requestStatus: string;
  notificationStatus: string;
  providerMessageId: string | null;
  name: string | null;
  business: string | null;
  service: string | null;
  phoneNumber: string | null;
  discussionDetails: string | null;
}

export interface PhoneN8nSyncStore {
  getCursor(workspaceId: string, ownerUserId: string, defaultCutoffIso: string): Promise<PersistedSyncCursor>;
  saveCursor(workspaceId: string, ownerUserId: string, cursor: PersistedSyncCursor): Promise<void>;
  upsertCall(record: PersistedSyncedCall): Promise<'created' | 'updated' | 'unchanged'>;
  listCalls(workspaceId: string, ownerUserId: string, direction: 'inbound' | 'outbound'): Promise<PersistedSyncedCall[]>;
  getCall(workspaceId: string, ownerUserId: string, direction: 'inbound' | 'outbound', callId: string): Promise<PersistedSyncedCall | null>;
  findExistingCallback(workspaceId: string, ownerUserId: string, callId: string): Promise<ExistingDbCallbackInfo | null>;
  claimCallbackDelivery(input: {
    workspaceId: string;
    ownerUserId: string;
    callId: string;
    callbackRequestId: string;
    claimAttemptId: string;
    nowMs: number;
  }): Promise<{ claimed: true; attempts: number } | { claimed: false; reason: 'already_sent' | 'already_claimed' | 'retry_exhausted' }>;
  recordCallbackReceipt(input: {
    workspaceId: string;
    ownerUserId: string;
    callId: string;
    claimAttemptId: string;
    outcome: 'submitted' | 'failed' | 'pending';
    sanitizedProviderMessageId: string | null;
    errorSummary: string | null;
  }): Promise<{ recorded: boolean; status: 'submitted' | 'failed' | 'pending' | 'duplicate' }>;
  syncOutboundProviderState?(input: {
    workspaceId: string;
    ownerUserId: string;
    attemptId: string;
    interactionId: string | null;
    connectivityStatus: PersistedSyncedCall['connectivityStatus'];
  }): Promise<void>;
}

export interface SarvamAnalyticsCredentials {
  orgId: string;
  workspaceId: string;
  appId: string;
  apiKey: string;
}

export interface PhoneN8nSyncOptions {
  store: PhoneN8nSyncStore;
  resolveMachinePrincipal: () => Promise<{
    workspaceId: string;
    ownerUserId: string;
    expectedToken: string;
    inboundRouteId?: string;
  } | null>;
  resolveSarvamCredentials?: () => Promise<SarvamAnalyticsCredentials | null>;
  policyGateway?: PolicyGateway;
  auditDb?: TransactionalDbClient;
  fetchImpl?: typeof fetch;
  now?: () => number;
  activatedAtIso?: string;
}

const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export function derivePhoneN8nSyncToken(secretMaterial: string, workspaceId: string, ownerUserId: string): string {
  return createHmac('sha256', secretMaterial)
    .update(`thaara-phone-n8n-sync-v1:${workspaceId}:${ownerUserId}`, 'utf8')
    .digest('hex');
}

function cleanText(value: unknown, maxLen = 2000): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLen);
}

export function normalizeE164Phone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/[\s()-]/g, '');
  if (!raw) return null;
  if (/^91[6-9][0-9]{9}$/.test(raw)) return `+${raw}`;
  if (/^[6-9][0-9]{9}$/.test(raw)) return `+91${raw}`;
  return E164_RE.test(raw) ? raw : null;
}

function maskInboundPhone(e164: string | null, providerMasked?: string | null): string {
  if (e164 && e164.length >= 4) return `•••• ${e164.slice(-4)}`;
  if (providerMasked && /\d{4}$/.test(providerMasked.trim())) {
    return `•••• ${providerMasked.trim().slice(-4)}`;
  }
  return 'Number unavailable';
}

function maskOutboundPhone(e164: string | null, providerMasked?: string | null): string {
  if (e164) {
    const ccMatch = /^\+(\d{1,3})\d*(\d{4})$/.exec(e164);
    if (ccMatch) return `+${ccMatch[1]} ******${ccMatch[2]}`;
  }
  if (providerMasked && /\d{4}$/.test(providerMasked.trim())) {
    return `+91 ******${providerMasked.trim().slice(-4)}`;
  }
  return '+91 ******0000';
}

function parseProviderIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(v)
    ? v.replace(' ', 'T').replace(/(\.\d{3})\d+$/, '$1') + 'Z'
    : v;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseAppVersion(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim().replace(/^v/i, ''));
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return null;
}

export function sanitizeProviderMessageId(raw: unknown, fallbackSeed: string): string {
  if (typeof raw === 'string' && raw.trim()) {
    const stripped = raw.trim().replace(/^<|>$/g, '').replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (stripped.length >= 1) return stripped.slice(0, 120);
  }
  return `n8n_${sha256Hex(fallbackSeed).slice(0, 32)}`;
}

function extractCallerStatedField(turns: PhoneSyncedTranscriptTurn[], kind: 'name' | 'business' | 'service' | 'time'): string | null {
  const callerText = turns.filter(t => t.speaker === 'customer').map(t => t.text).join('\n');
  if (!callerText) return null;
  if (kind === 'name') {
    const m = /\b(?:my name is|i am|i'm|this is)\s+([A-Z][a-zA-Z]{1,30}(?:\s+[A-Z][a-zA-Z]{1,30})?)\b/i.exec(callerText);
    if (m?.[1]) {
      const candidate = m[1].trim();
      if (!/^(?:interested|calling|looking|asking|from|here|fine|good|ready|okay|sure)$/i.test(candidate.split(/\s+/)[0]!)) {
        return candidate;
      }
    }
    return null;
  }
  if (kind === 'time') {
    const m = /\b((?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this\s+(?:morning|afternoon|evening)|next\s+week)(?:\s+(?:at|around|after|before)?\s*[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?|\s+(?:morning|afternoon|evening))?|[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm|a\.m\.|p\.m\.))\b/i.exec(callerText);
    return m?.[1] ? cleanText(m[1], 240) : null;
  }
  return null;
}

export function evaluateTranscriptCallbackStatus(input: {
  direction: 'inbound' | 'outbound';
  connectivityStatus: PersistedSyncedCall['connectivityStatus'];
  phoneE164: string | null;
  customerName: string | null;
  serviceNeeded: string | null;
  requirements: string | null;
  turns: PhoneSyncedTranscriptTurn[];
  existingDbCallback?: ExistingDbCallbackInfo | null;
}): 'confirmed' | 'needs_review' | 'declined' | 'not_requested' {
  if (input.direction !== 'inbound') return 'not_requested';
  if (input.existingDbCallback) {
    if (input.existingDbCallback.requestStatus === 'cancelled') return 'declined';
    if (
      input.existingDbCallback.requestStatus === 'requested' &&
      ['pending', 'sending', 'submitted'].includes(input.existingDbCallback.notificationStatus) &&
      input.phoneE164
    ) {
      return 'confirmed';
    }
  }
  if (input.connectivityStatus !== 'connected' || input.turns.length === 0) {
    return 'not_requested';
  }

  const callerTurns = input.turns.filter(t => t.speaker === 'customer');
  const fullText = input.turns.map(t => t.text).join('\n');

  if (callerTurns.some(t => WITHDRAWAL_RE.test(t.text))) {
    return 'declined';
  }

  const mentionsCallback = CALLBACK_KEYWORD_RE.test(fullText) || Boolean(input.existingDbCallback);
  if (!mentionsCallback) {
    return 'not_requested';
  }

  // Locate assistant recap/confirmation prompt followed by caller affirmative response without subsequent withdrawal/negation
  let confirmedAtIndex = -1;
  for (let i = 0; i < input.turns.length; i++) {
    const turn = input.turns[i]!;
    if (turn.speaker === 'thaara' && CALLBACK_RECAP_PROMPT_RE.test(turn.text)) {
      for (let j = i + 1; j < input.turns.length; j++) {
        const next = input.turns[j]!;
        if (next.speaker === 'thaara') {
          if (CALLBACK_BOOKED_ACK_RE.test(next.text) && confirmedAtIndex >= 0) break;
          continue;
        }
        const trimmed = next.text.trim();
        if (NEGATIVE_GUARD_RE.test(trimmed) || WITHDRAWAL_RE.test(trimmed)) {
          confirmedAtIndex = -1;
          break;
        }
        if (AFFIRMATIVE_RE.test(trimmed)) {
          confirmedAtIndex = j;
          break;
        }
      }
    }
  }

  // If caller explicitly declined after a recap prompt ("No, don't book it")
  for (let i = 0; i < input.turns.length - 1; i++) {
    if (input.turns[i]!.speaker === 'thaara' && CALLBACK_RECAP_PROMPT_RE.test(input.turns[i]!.text)) {
      const reply = input.turns.slice(i + 1).find(t => t.speaker === 'customer');
      if (reply && /^\s*(?:no|nope|nah|don['’]?t|cancel|ಬೇಡ|ಇಲ್ಲ|नहीं|मत)\b/iu.test(reply.text)) {
        return 'declined';
      }
    }
  }

  if (confirmedAtIndex < 0) {
    return 'needs_review';
  }

  // Check if any caller turn after confirmation withdrew or negated
  for (let k = confirmedAtIndex + 1; k < input.turns.length; k++) {
    const later = input.turns[k]!;
    if (later.speaker === 'customer' && (WITHDRAWAL_RE.test(later.text) || /\b(?:wait|hold on|wrong|cancel|don['’]?t\s+(?:book|save|submit))\b/iu.test(later.text))) {
      return 'needs_review';
    }
  }

  // Require verified phone + at least customer name or service/requirement
  const hasCoreDetail = Boolean(input.customerName || input.serviceNeeded || input.requirements);
  if (!input.phoneE164 || !hasCoreDetail) {
    return 'needs_review';
  }

  return 'confirmed';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildCallbackEmailPayload(call: PersistedSyncedCall): PhoneN8nCallbackEmailPayload {
  if (!call.phoneE164) {
    throw new AppError('Callback email requires a verified E.164 phone number.', 'PHONE_CALLBACK_MISSING_PHONE', 422);
  }
  const callDateTimeIst = `${new Date(call.occurredAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short'
  })} IST`;
  const callStatusLabel =
    call.callStatus === 'ended' ? 'Completed' : call.callStatus.replace(/_/g, ' ');
  const providerCallRef = call.interactionId ?? call.attemptId;

  const fields = {
    customerName: call.customerName,
    phoneNumber: call.phoneE164,
    businessName: call.business,
    requiredService: call.serviceNeeded,
    customerRequirement: call.requirements,
    preferredCallbackTime: call.preferredCallbackTime,
    callDateTimeIst,
    callId: providerCallRef,
    conversationSummary: call.summary,
    callbackStatus: 'Confirmed' as const,
    callStatus: callStatusLabel
  };

  const lines: string[] = ['New customer callback request received.', ''];
  if (fields.customerName) lines.push(`Customer: ${fields.customerName}`);
  lines.push(`Phone: ${fields.phoneNumber}`);
  if (fields.businessName) lines.push(`Business: ${fields.businessName}`);
  if (fields.requiredService) lines.push(`Service: ${fields.requiredService}`);
  if (fields.customerRequirement) lines.push(`Requirement: ${fields.customerRequirement}`);
  if (fields.preferredCallbackTime) lines.push(`Preferred Callback: ${fields.preferredCallbackTime}`);
  lines.push(`Call Date & Time: ${fields.callDateTimeIst}`);
  lines.push(`Call ID: ${fields.callId}`);
  if (fields.conversationSummary) lines.push(`Summary: ${fields.conversationSummary}`);
  lines.push(`Callback Status: ${fields.callbackStatus}`);
  lines.push(`Call Status: ${fields.callStatus}`);

  const rowHtml = (label: string, val: string | null) =>
    val
      ? `<tr><td style="padding:6px 12px 6px 0;font-weight:600;color:#334155;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(val)}</td></tr>`
      : '';

  const htmlBody = [
    '<div style="font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:640px;color:#0f172a;line-height:1.5;">',
    '<h2 style="margin:0 0 12px;font-size:18px;color:#0f172a;">New Callback Request — Thaara AI</h2>',
    '<p style="margin:0 0 16px;color:#475569;">New customer callback request received and verified from call transcript.</p>',
    '<table style="border-collapse:collapse;width:100%;font-size:14px;">',
    rowHtml('Customer', fields.customerName),
    rowHtml('Phone', fields.phoneNumber),
    rowHtml('Business', fields.businessName),
    rowHtml('Service', fields.requiredService),
    rowHtml('Requirement', fields.customerRequirement),
    rowHtml('Preferred Callback', fields.preferredCallbackTime),
    rowHtml('Call Date & Time', fields.callDateTimeIst),
    rowHtml('Call ID', fields.callId),
    rowHtml('Summary', fields.conversationSummary),
    rowHtml('Callback Status', fields.callbackStatus),
    rowHtml('Call Status', fields.callStatus),
    '</table>',
    '</div>'
  ].join('');

  return {
    fromEmail: 'Thaara AI Notifications <team.quantumweaveai@gmail.com>',
    toEmail: 'connect@brandmintai.io',
    subject: 'New Callback Request — Thaara AI',
    textBody: lines.join('\n'),
    htmlBody,
    fields
  };
}

export class PhoneN8nSyncService {
  private readonly store: PhoneN8nSyncStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly activatedAtIso: string;

  constructor(private readonly options: PhoneN8nSyncOptions) {
    this.store = options.store;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.activatedAtIso = options.activatedAtIso ?? new Date(this.now()).toISOString();
  }

  async authenticateMachineToken(providedHeader: string | string[] | undefined) {
    const raw = typeof providedHeader === 'string' ? providedHeader.trim() : '';
    if (!raw || raw.length < 32 || raw.length > 512) {
      throw new UnauthorizedError('Missing or invalid phone n8n sync credentials.');
    }
    const principal = await this.options.resolveMachinePrincipal();
    if (!principal || !principal.expectedToken) {
      throw new AppError('Phone n8n sync bridge is not configured.', 'PHONE_N8N_NOT_CONFIGURED', 503);
    }
    const a = Buffer.from(raw, 'utf8');
    const b = Buffer.from(principal.expectedToken, 'utf8');
    if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) {
      throw new ForbiddenError('Phone n8n sync token verification failed.');
    }
    return {
      workspaceId: principal.workspaceId,
      ownerUserId: principal.ownerUserId,
      inboundRouteId: principal.inboundRouteId ?? 'sarvam-inbound'
    };
  }

  private computeCallId(
    workspaceId: string,
    inboundRouteId: string,
    input: PhoneN8nSyncedCallInput
  ): string {
    const interactionId = cleanText(input.interactionId, 220);
    if (input.direction === 'inbound' && interactionId && INTERACTION_ID_RE.test(interactionId)) {
      return sha256Hex(`${inboundRouteId}\n${interactionId}`);
    }
    const canonical = interactionId ?? `attempt:${input.attemptId}`;
    return sha256Hex(`sarvam-sync-v1\n${workspaceId}\n${input.direction}\n${canonical}`);
  }

  private async normalizeInputCall(
    principal: { workspaceId: string; ownerUserId: string; inboundRouteId: string },
    input: PhoneN8nSyncedCallInput
  ): Promise<PersistedSyncedCall> {
    const callId = this.computeCallId(principal.workspaceId, principal.inboundRouteId, input);
    const existingCb =
      input.direction === 'inbound'
        ? await this.store.findExistingCallback(principal.workspaceId, principal.ownerUserId, callId)
        : null;

    const interactionId = cleanText(input.interactionId, 220);
    const appVersion = parseAppVersion(input.appVersion);
    const phoneE164 =
      normalizeE164Phone(input.userContact) ??
      normalizeE164Phone(existingCb?.phoneNumber) ??
      null;

    const rawMessages = input.messages ?? [];
    const transcript: PhoneSyncedTranscriptTurn[] = [];
    for (const msg of rawMessages.slice(0, 200)) {
      const text = cleanText(msg.content, 2000) ?? cleanText(msg.english_content, 2000);
      if (!text) continue;
      const role = msg.role.trim().toLowerCase();
      const speaker: 'thaara' | 'customer' =
        role === 'assistant' || role === 'agent' || role === 'bot' || role === 'thaara'
          ? 'thaara'
          : 'customer';
      transcript.push({
        speaker,
        text,
        ...(msg.language_name ? { languageName: cleanText(msg.language_name, 64) } : {})
      });
    }

    // Strip historical <v26 "Manan" template default unless caller actually said "manan"
    const rawVarName = cleanText(input.agentVariables?.user_name, 240);
    const callerSpokeManan = transcript.some(
      t => t.speaker === 'customer' && /\bmanan\b/i.test(t.text)
    );
    const safeVarName =
      rawVarName &&
      rawVarName.toLowerCase() === 'manan' &&
      (appVersion === null || appVersion < 26) &&
      !callerSpokeManan
        ? null
        : rawVarName;

    const customerName =
      cleanText(existingCb?.name, 240) ??
      safeVarName ??
      extractCallerStatedField(transcript, 'name');

    const business =
      cleanText(existingCb?.business, 400) ??
      cleanText(input.agentVariables?.business_name, 400);

    const serviceNeeded =
      cleanText(existingCb?.service, 400) ??
      cleanText(input.agentVariables?.service_needed, 400) ??
      cleanText(input.agentVariables?.call_purpose, 400);

    const customerStatements = transcript
      .filter(t => t.speaker === 'customer')
      .map(t => t.text)
      .join(' ')
      .trim();

    const requirements =
      cleanText(existingCb?.discussionDetails, 2000) ??
      cleanText(input.agentVariables?.call_purpose, 1000) ??
      (customerStatements ? cleanText(customerStatements, 1200) : null);

    const summary =
      cleanText(input.agentVariables?.call_summary, 2000) ??
      cleanText(existingCb?.discussionDetails, 2000) ??
      (requirements ? cleanText(requirements, 600) : null);

    const preferredCallbackTime =
      cleanText(input.agentVariables?.preferred_callback_time, 400) ??
      extractCallerStatedField(transcript, 'time');

    const startIso = parseProviderIso(input.startDatetime);
    const endIso = parseProviderIso(input.endDatetime);
    const attemptedIso = parseProviderIso(input.attemptedAt);
    const occurredAt =
      endIso ?? startIso ?? attemptedIso ?? new Date(this.now()).toISOString();
    const timestampSource: PersistedSyncedCall['timestampSource'] = endIso
      ? 'provider_ended'
      : startIso || attemptedIso
        ? 'provider_started'
        : 'received_at';

    const durationSeconds =
      typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)
        ? Math.max(0, Math.round(input.durationSeconds))
        : startIso && endIso && Date.parse(endIso) >= Date.parse(startIso)
          ? Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000)
          : null;

    let callStatus: PersistedSyncedCall['callStatus'] = 'unknown';
    if (input.connectivityStatus === 'connected') {
      callStatus = endIso || durationSeconds !== null || transcript.length > 0 ? 'ended' : 'interrupted';
    } else if (input.connectivityStatus === 'no_answer') {
      callStatus = 'no_answer';
    } else if (input.connectivityStatus === 'busy') {
      callStatus = 'busy';
    } else if (input.connectivityStatus === 'failed') {
      callStatus = 'failed';
    }

    const callbackEligibility = evaluateTranscriptCallbackStatus({
      direction: input.direction,
      connectivityStatus: input.connectivityStatus,
      phoneE164,
      customerName,
      serviceNeeded,
      requirements,
      turns: transcript,
      existingDbCallback: existingCb
    });

    const callbackRequestId =
      callbackEligibility === 'confirmed'
        ? existingCb?.requestId ??
          sha256Hex(JSON.stringify([principal.workspaceId, principal.ownerUserId, 'inbound', callId]))
        : null;

    return {
      callId,
      workspaceId: principal.workspaceId,
      ownerUserId: principal.ownerUserId,
      direction: input.direction,
      attemptId: input.attemptId,
      interactionId: interactionId && INTERACTION_ID_RE.test(interactionId) ? interactionId : null,
      connectivityStatus: input.connectivityStatus,
      callStatus,
      failureReason: cleanText(input.failureReason, 400),
      endedBy: cleanText(input.endedBy, 64),
      occurredAt,
      timestampSource,
      durationSeconds,
      phoneE164,
      maskedInboundPhone: maskInboundPhone(phoneE164, input.userContactMasked),
      maskedOutboundPhone: maskOutboundPhone(phoneE164, input.userContactMasked),
      customerName,
      business,
      serviceNeeded,
      requirements,
      preferredCallbackTime,
      summary,
      recordingAvailable: Boolean(input.recordingAvailable && interactionId),
      appVersion,
      languageName: cleanText(input.languageName, 64),
      transcript,
      callbackEligibility,
      callbackRequestId,
      updatedAt: new Date(this.now()).toISOString()
    };
  }

  async getCheckpoint(providedToken: string | string[] | undefined): Promise<PhoneN8nSyncCheckpointResponse> {
    const principal = await this.authenticateMachineToken(providedToken);
    const cursor = await this.store.getCursor(
      principal.workspaceId,
      principal.ownerUserId,
      this.activatedAtIso
    );
    return {
      status: 'ready',
      cursorStartDatetime: cursor.cursorStartDatetime,
      backfillCompleted: cursor.backfillCompleted,
      overlapMinutes: DEFAULT_OVERLAP_MINUTES,
      callbackCutoffDatetime: cursor.callbackCutoffDatetime
    };
  }

  async syncBatch(
    providedToken: string | string[] | undefined,
    body: PhoneN8nCallSyncBatchRequest
  ): Promise<PhoneN8nCallSyncBatchResponse> {
    const principal = await this.authenticateMachineToken(providedToken);
    const currentCursor = await this.store.getCursor(
      principal.workspaceId,
      principal.ownerUserId,
      this.activatedAtIso
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let inboundCount = 0;
    let outboundCount = 0;
    let latestMs = Date.parse(currentCursor.cursorStartDatetime);

    for (const rawCall of body.calls) {
      const normalized = await this.normalizeInputCall(principal, rawCall);
      if (normalized.direction === 'inbound') inboundCount++;
      else outboundCount++;

      const outcome = await this.store.upsertCall(normalized);
      if (outcome === 'created') created++;
      else if (outcome === 'updated') updated++;
      else unchanged++;

      if (normalized.direction === 'outbound' && this.store.syncOutboundProviderState) {
        await this.store.syncOutboundProviderState({
          workspaceId: principal.workspaceId,
          ownerUserId: principal.ownerUserId,
          attemptId: normalized.attemptId,
          interactionId: normalized.interactionId,
          connectivityStatus: normalized.connectivityStatus
        });
      }

      const callMs = Date.parse(normalized.occurredAt);
      if (Number.isFinite(callMs) && callMs > latestMs) {
        latestMs = callMs;
      }
    }

    let nextCursorIso = currentCursor.cursorStartDatetime;
    if (body.advanceCursorTo && Number.isFinite(Date.parse(body.advanceCursorTo))) {
      const advMs = Date.parse(body.advanceCursorTo);
      const overlapAdjustedMs = Math.max(
        Date.parse(currentCursor.cursorStartDatetime),
        advMs - DEFAULT_OVERLAP_MINUTES * 60 * 1000
      );
      nextCursorIso = new Date(overlapAdjustedMs).toISOString();
    } else if (body.calls.length > 0 && Number.isFinite(latestMs)) {
      const overlapAdjustedMs = Math.max(
        Date.parse(currentCursor.cursorStartDatetime),
        latestMs - DEFAULT_OVERLAP_MINUTES * 60 * 1000
      );
      nextCursorIso = new Date(overlapAdjustedMs).toISOString();
    }

    const backfillCompleted =
      body.markBackfillCompleted === true ? true : currentCursor.backfillCompleted;

    await this.store.saveCursor(principal.workspaceId, principal.ownerUserId, {
      cursorStartDatetime: nextCursorIso,
      backfillCompleted,
      callbackCutoffDatetime: currentCursor.callbackCutoffDatetime
    });

    return {
      status: 'synced',
      received: body.calls.length,
      created,
      updated,
      unchanged,
      inboundCount,
      outboundCount,
      cursorStartDatetime: nextCursorIso
    };
  }

  async evaluateAndClaimCallback(
    providedToken: string | string[] | undefined,
    body: PhoneN8nCallbackEvaluateClaimRequest
  ): Promise<PhoneN8nCallbackEvaluateClaimResponse> {
    const principal = await this.authenticateMachineToken(providedToken);
    const normalized = await this.normalizeInputCall(principal, body.call);

    // Always persist/enrich the inbound call record so Needs Review / Declined / Confirmed is visible in Call History
    await this.store.upsertCall(normalized);

    if (normalized.direction !== 'inbound') {
      return {
        sendAllowed: false,
        eligibility: 'not_requested',
        reason: 'Outbound calls do not trigger inbound callback notifications.',
        callId: normalized.callId,
        callbackRequestId: null,
        claimAttemptId: null,
        email: null
      };
    }

    const cursor = await this.store.getCursor(
      principal.workspaceId,
      principal.ownerUserId,
      this.activatedAtIso
    );

    if (
      body.allowHistoricalReplay !== true &&
      Date.parse(normalized.occurredAt) < Date.parse(cursor.callbackCutoffDatetime)
    ) {
      return {
        sendAllowed: false,
        eligibility: 'historical_skipped',
        reason: 'Historical call occurred prior to workflow activation cutoff.',
        callId: normalized.callId,
        callbackRequestId: normalized.callbackRequestId,
        claimAttemptId: null,
        email: null
      };
    }

    if (normalized.callbackEligibility !== 'confirmed' || !normalized.callbackRequestId) {
      const reasonMap: Record<'needs_review' | 'declined' | 'not_requested', string> = {
        needs_review: 'Callback confirmation or required caller details are incomplete; marked for owner review.',
        declined: 'Caller declined or withdrew the callback request.',
        not_requested: 'No callback request occurred on this call.'
      };
      const elig = normalized.callbackEligibility === 'confirmed' ? 'needs_review' : normalized.callbackEligibility;
      return {
        sendAllowed: false,
        eligibility: elig,
        reason: reasonMap[elig],
        callId: normalized.callId,
        callbackRequestId: null,
        claimAttemptId: null,
        email: null
      };
    }

    const claimAttemptId = randomUUID();
    const claimResult = await this.store.claimCallbackDelivery({
      workspaceId: principal.workspaceId,
      ownerUserId: principal.ownerUserId,
      callId: normalized.callId,
      callbackRequestId: normalized.callbackRequestId,
      claimAttemptId,
      nowMs: this.now()
    });

    if (!claimResult.claimed) {
      const mapped = claimResult.reason === 'already_sent' ? 'already_sent' : 'already_claimed';
      return {
        sendAllowed: false,
        eligibility: mapped,
        reason:
          claimResult.reason === 'already_sent'
            ? 'Callback notification was submitted to delivery provider.'
            : claimResult.reason === 'retry_exhausted'
              ? 'Callback notification retry budget exhausted; requires owner review.'
              : 'Callback notification is already claimed for delivery.',
        callId: normalized.callId,
        callbackRequestId: normalized.callbackRequestId,
        claimAttemptId: null,
        email: null
      };
    }

    const email = buildCallbackEmailPayload(normalized);
    return {
      sendAllowed: true,
      eligibility: 'confirmed',
      reason: 'Verified customer-confirmed callback claimed for single delivery.',
      callId: normalized.callId,
      callbackRequestId: normalized.callbackRequestId,
      claimAttemptId,
      email
    };
  }

  async recordCallbackReceipt(
    providedToken: string | string[] | undefined,
    body: PhoneN8nCallbackReceiptRequest
  ): Promise<PhoneN8nCallbackReceiptResponse> {
    const principal = await this.authenticateMachineToken(providedToken);
    const sanitizedId =
      body.outcome === 'submitted'
        ? sanitizeProviderMessageId(body.providerMessageId, `${body.callId}:${body.claimAttemptId}`)
        : null;
    const res = await this.store.recordCallbackReceipt({
      workspaceId: principal.workspaceId,
      ownerUserId: principal.ownerUserId,
      callId: body.callId,
      claimAttemptId: body.claimAttemptId,
      outcome: body.outcome,
      sanitizedProviderMessageId: sanitizedId,
      errorSummary: cleanText(body.errorSummary, 500)
    });
    return {
      recorded: res.recorded,
      status: res.status,
      sanitizedProviderMessageId: sanitizedId
    };
  }

  private assertOwnerScope(scope: AuthenticatedScope) {
    if (!scope || scope.role !== 'owner' || !scope.workspaceId || !scope.userId) {
      throw new ForbiddenError('Only the workspace owner can access phone call history and recordings.');
    }
  }

  async listInboundHistory(scope: AuthenticatedScope): Promise<{
    status: 'ready';
    reports: PhoneInboundHistorySummary[];
  }> {
    this.assertOwnerScope(scope);
    const rows = await this.store.listCalls(scope.workspaceId, scope.userId, 'inbound');
    const reports: PhoneInboundHistorySummary[] = rows.slice(0, 100).map(r => {
      const outcome: PhoneInboundHistorySummary['outcome'] =
        r.callbackEligibility === 'confirmed'
          ? 'callback_requested'
          : r.callbackEligibility === 'needs_review'
            ? 'needs_review'
            : 'enquired';
      return {
        id: r.callId,
        occurredAt: r.occurredAt,
        maskedPhone: r.maskedInboundPhone,
        outcome,
        providerVerified: false,
        customerName: r.customerName,
        preferredContactTime: r.preferredCallbackTime,
        direction: 'inbound',
        durationSeconds: r.durationSeconds,
        callStatus: r.callStatus,
        enquirySummary: r.summary ?? r.requirements,
        recordingAvailable: r.recordingAvailable,
        transcriptAvailable: r.transcript.length > 0
      };
    });
    return { status: 'ready', reports };
  }

  async getInboundHistoryDetail(
    scope: AuthenticatedScope,
    id: string
  ): Promise<{ status: 'ready' | 'not_found'; report: PhoneInboundHistoryDetailRecord | null }> {
    this.assertOwnerScope(scope);
    const r = await this.store.getCall(scope.workspaceId, scope.userId, 'inbound', id);
    if (!r) {
      return { status: 'not_found', report: null };
    }
    const existingCb = await this.store.findExistingCallback(scope.workspaceId, scope.userId, id);
    const outcome: PhoneInboundHistoryDetailRecord['outcome'] =
      r.callbackEligibility === 'confirmed'
        ? 'callback_requested'
        : r.callbackEligibility === 'needs_review'
          ? 'needs_review'
          : 'enquired';
    const callbackConsent: 'confirmed' | 'declined' | 'unknown' =
      r.callbackEligibility === 'confirmed'
        ? 'confirmed'
        : r.callbackEligibility === 'declined'
          ? 'declined'
          : 'unknown';
    const callbackPreference: 'requested' | 'declined' | 'unknown' =
      r.callbackEligibility === 'confirmed' || r.callbackEligibility === 'needs_review'
        ? 'requested'
        : r.callbackEligibility === 'declined'
          ? 'declined'
          : 'unknown';

    const report: PhoneInboundHistoryDetailRecord = {
      id: r.callId,
      occurredAt: r.occurredAt,
      maskedPhone: r.maskedInboundPhone,
      callerPhone: r.phoneE164,
      customerName: r.customerName,
      business: r.business,
      serviceNeeded: r.serviceNeeded,
      enquirySummary: r.summary ?? r.requirements,
      outcome,
      callbackRequestId: r.callbackRequestId,
      providerVerified: false,
      ...(r.interactionId ? { providerInteractionId: r.interactionId } : {}),
      timestampSource: r.timestampSource,
      durationSeconds: r.durationSeconds,
      callStatus: r.callStatus,
      preferredContactTime: r.preferredCallbackTime,
      callbackConsent,
      callbackPreference,
      appointment: null,
      transcript: r.transcript.map(t => ({
        speaker: t.speaker === 'thaara' ? ('agent' as const) : ('caller' as const),
        text: t.text,
        languageBasis: 'provider_original' as const
      })),
      transcriptExpiresAt: RETENTION_FUTURE_ISO,
      recordingReference:
        r.recordingAvailable && r.interactionId
          ? {
              interactionId: r.interactionId,
              expiresAt: RETENTION_FUTURE_ISO,
              noticeConfirmed: true
            }
          : null,
      recordingAvailable: r.recordingAvailable,
      callbackNotificationStatus:
        (existingCb?.notificationStatus as PhoneInboundHistoryDetailRecord['callbackNotificationStatus']) ??
        null
    };
    return { status: 'ready', report };
  }

  private toOutboundSyncedDetails(r: PersistedSyncedCall, fallbackName?: string): PhoneSyncedCallDetails {
    const outcomeLabel =
      r.connectivityStatus === 'connected'
        ? 'Completed'
        : r.connectivityStatus === 'no_answer'
          ? 'No answer'
          : r.connectivityStatus === 'busy'
            ? 'Busy'
            : r.connectivityStatus === 'failed'
              ? 'Failed'
              : 'Unknown';
    return {
      interactionId: r.interactionId,
      attemptId: r.attemptId,
      recordingAvailable: r.recordingAvailable,
      durationSeconds: r.durationSeconds,
      occurredAt: r.occurredAt,
      customerName: r.customerName ?? fallbackName ?? null,
      phoneNumber: r.phoneE164,
      business: r.business,
      serviceNeeded: r.serviceNeeded,
      requirements: r.requirements,
      summary: r.summary,
      preferredCallbackTime: r.preferredCallbackTime,
      outcomeLabel,
      callbackStatus:
        r.callbackEligibility === 'confirmed'
          ? 'confirmed'
          : r.callbackEligibility === 'needs_review'
            ? 'needs_review'
            : r.callbackEligibility === 'declined'
              ? 'declined'
              : 'none',
      transcript: r.transcript
    };
  }

  async enrichOutboundHistory(
    scope: AuthenticatedScope,
    baseHistory: { calls: PhoneCallingRecord[]; durable: boolean; liveCallingEnabled: boolean }
  ): Promise<{ calls: PhoneCallingRecord[]; durable: boolean; liveCallingEnabled: boolean }> {
    if (scope.role !== 'owner' || !scope.workspaceId || !scope.userId) {
      return baseHistory;
    }
    const syncedOutbound = await this.store.listCalls(scope.workspaceId, scope.userId, 'outbound');
    if (syncedOutbound.length === 0) return baseHistory;

    const byInteractionId = new Map<string, PersistedSyncedCall>();
    const byAttemptId = new Map<string, PersistedSyncedCall>();
    for (const s of syncedOutbound) {
      if (s.interactionId) byInteractionId.set(s.interactionId, s);
      byAttemptId.set(s.attemptId, s);
    }

    const matchedSyncIds = new Set<string>();
    const enrichedExisting = baseHistory.calls.map(call => {
      if (call.simulated) return call;
      const providerRequestId = (call as { providerRequestId?: string | null }).providerRequestId;
      const candidate =
        (call.providerCallId ? byInteractionId.get(call.providerCallId) : undefined) ??
        byAttemptId.get(call.id) ??
        (providerRequestId ? byAttemptId.get(providerRequestId) : undefined);
      if (!candidate) return call;
      // Verify recipient phone suffix matches when both sides carry digits so mismatched calls are never attached
      const callLast4 = call.draft.recipient.maskedPhone.replace(/\D/g, '').slice(-4);
      const syncLast4 = candidate.phoneE164 ? candidate.phoneE164.replace(/\D/g, '').slice(-4) : '';
      if (callLast4.length === 4 && syncLast4.length === 4 && callLast4 !== syncLast4) {
        return call;
      }
      const match = candidate;
      matchedSyncIds.add(match.callId);

      const syncedDetails = this.toOutboundSyncedDetails(match, call.draft.recipient.displayName);
      const evidence =
        !call.report.conversation && match.transcript.length > 0
          ? capturePhoneCallEvidence(
              match.transcript.map(t => ({
                role: t.speaker === 'thaara' ? 'assistant' : 'user',
                text: t.text
              })),
              'provider_transcript'
            )
          : call.report.conversation;
      const quotes =
        call.report.quotedResponses.length > 0
          ? call.report.quotedResponses
          : match.transcript
              .filter(t => t.speaker === 'customer')
              .slice(0, 12)
              .map(t => t.text.slice(0, 1000));

      const mappedState: PhoneCallingRecord['state'] =
        call.state === 'completed' || call.state === 'failed' || call.state === 'busy' || call.state === 'no_answer'
          ? call.state
          : match.connectivityStatus === 'connected' && match.callStatus === 'ended'
            ? 'completed'
            : match.connectivityStatus === 'busy'
              ? 'busy'
              : match.connectivityStatus === 'no_answer'
                ? 'no_answer'
                : match.connectivityStatus === 'failed'
                  ? 'failed'
                  : call.state;

      return {
        ...call,
        state: mappedState,
        providerCallId:
          call.providerCallId ??
          (match.interactionId && isPhoneProviderCallId(match.interactionId) ? match.interactionId : null),
        report: {
          ...call.report,
          ...(evidence ? { conversation: evidence } : {}),
          quotedResponses: quotes,
          text:
            match.summary && call.report.text.startsWith('Live call.')
              ? `Live call (${syncedDetails.outcomeLabel.toLowerCase()}). ${match.summary}`.slice(0, 16000)
              : call.report.text
        },
        syncedDetails
      };
    });

    // Also surface synced Sarvam outbound calls that don't yet have a local phone_calls row
    const standaloneRecords: PhoneCallingRecord[] = [];
    for (const s of syncedOutbound) {
      if (matchedSyncIds.has(s.callId)) continue;
      // Match against existing calls by timestamp+masked suffix if providerCallId was null before webhook arrived
      const last4 = s.phoneE164 ? s.phoneE164.slice(-4) : null;
      const heuristicIdx = enrichedExisting.findIndex(
        c =>
          !c.simulated &&
          !c.syncedDetails &&
          last4 &&
          c.draft.recipient.maskedPhone.endsWith(last4) &&
          Math.abs(Date.parse(c.createdAt) - Date.parse(s.occurredAt)) <= 10 * 60 * 1000
      );
      if (heuristicIdx >= 0) {
        const target = enrichedExisting[heuristicIdx]!;
        const syncedDetails = this.toOutboundSyncedDetails(s, target.draft.recipient.displayName);
        const evidence =
          !target.report.conversation && s.transcript.length > 0
            ? capturePhoneCallEvidence(
                s.transcript.map(t => ({
                  role: t.speaker === 'thaara' ? 'assistant' : 'user',
                  text: t.text
                })),
                'provider_transcript'
              )
            : target.report.conversation;
        enrichedExisting[heuristicIdx] = {
          ...target,
          providerCallId:
            target.providerCallId ??
            (s.interactionId && isPhoneProviderCallId(s.interactionId) ? s.interactionId : null),
          report: {
            ...target.report,
            ...(evidence ? { conversation: evidence } : {}),
            quotedResponses:
              target.report.quotedResponses.length > 0
                ? target.report.quotedResponses
                : s.transcript
                    .filter(t => t.speaker === 'customer')
                    .slice(0, 12)
                    .map(t => t.text.slice(0, 1000))
          },
          syncedDetails
        };
        continue;
      }

      const displayName = s.customerName ?? (s.maskedOutboundPhone || 'Outbound recipient');
      const deterministicUuid = [
        s.callId.slice(0, 8),
        s.callId.slice(8, 12),
        '4' + s.callId.slice(13, 16),
        '8' + s.callId.slice(17, 20),
        s.callId.slice(20, 32)
      ].join('-');
      const syncedDetails = this.toOutboundSyncedDetails(s, displayName);
      const evidence =
        s.transcript.length > 0
          ? capturePhoneCallEvidence(
              s.transcript.map(t => ({
                role: t.speaker === 'thaara' ? 'assistant' : 'user',
                text: t.text
              })),
              'provider_transcript'
            )
          : undefined;
      const state: PhoneCallingRecord['state'] =
        s.connectivityStatus === 'connected'
          ? 'completed'
          : s.connectivityStatus === 'busy'
            ? 'busy'
            : s.connectivityStatus === 'no_answer'
              ? 'no_answer'
              : 'failed';
      const draft: PhoneCallingDraft = {
        draftId: `sync_${s.callId.slice(0, 24)}`,
        contactId: `sync_contact_${s.callId.slice(0, 16)}`,
        contactRevision: 1,
        contactBindingHash: s.callId,
        recipient: {
          displayName: displayName.slice(0, 128),
          maskedPhone: s.maskedOutboundPhone
        },
        purpose: (s.requirements ?? s.serviceNeeded ?? s.summary ?? 'Authorized outbound call').slice(0, 1000),
        language: 'en-IN',
        maxDurationSeconds: 300,
        aiDisclosure: 'Hello, I am Thaara from Quantum Weave AI.',
        consentReference: `sync_consent_${s.callId.slice(0, 16)}`,
        idempotencyKey: `sync_idem_${s.callId.slice(0, 20)}`,
        mode: 'live'
      };

      standaloneRecords.push({
        id: `sync_${s.callId.slice(0, 32)}`,
        approvalId: deterministicUuid,
        draft,
        state,
        createdAt: s.occurredAt,
        updatedAt: s.updatedAt,
        providerCallId: s.interactionId && isPhoneProviderCallId(s.interactionId) ? s.interactionId : null,
        verified: false,
        simulated: false,
        dispatchStatus: 'unverified',
        report: {
          ...(evidence ? { conversation: evidence } : {}),
          text: (s.summary ?? `Outbound call (${syncedDetails.outcomeLabel.toLowerCase()}).`).slice(0, 16000),
          spokenText: (s.summary ?? `Outbound call ${syncedDetails.outcomeLabel.toLowerCase()}.`).slice(0, 16000),
          quotedResponses: s.transcript
            .filter(t => t.speaker === 'customer')
            .slice(0, 12)
            .map(t => t.text.slice(0, 1000)),
          evidenceIds: s.transcript.length > 0 ? ['sync_tx_1'] : [],
          verified: false,
          simulated: false
        },
        syncedDetails
      });
    }

    const combined = [...enrichedExisting, ...standaloneRecords]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 100);

    return {
      ...baseHistory,
      calls: combined
    };
  }

  async resolveRecordingInteractionId(
    scope: AuthenticatedScope,
    direction: 'inbound' | 'outbound',
    callId: string,
    outboundService?: { history(scope: AuthenticatedScope): Promise<{ calls: PhoneCallingRecord[] }> }
  ): Promise<string> {
    this.assertOwnerScope(scope);

    if (this.options.policyGateway) {
      const decision = this.options.policyGateway.evaluate(
        {
          workspaceId: scope.workspaceId,
          userId: scope.userId,
          role: scope.role
        },
        {
          actionName: PHONE_RECORDING_PLAYBACK_ACTION,
          parameters: { direction, callId }
        }
      );
      if (!decision.allowed) {
        throw new ForbiddenError('Policy gateway denied call recording playback.');
      }
    }

    let interactionId: string | null = null;
    let recordingAvailable = false;

    if (direction === 'inbound') {
      const synced = await this.store.getCall(scope.workspaceId, scope.userId, 'inbound', callId);
      if (synced) {
        interactionId = synced.interactionId;
        recordingAvailable = synced.recordingAvailable;
      }
    } else {
      // Outbound can be requested by PhoneCallingRecord.id (UUID or sync_<hash>) or synced callId
      if (callId.startsWith('sync_')) {
        const prefix = callId.slice(5);
        const all = await this.store.listCalls(scope.workspaceId, scope.userId, 'outbound');
        const found = all.find(c => c.callId.startsWith(prefix));
        if (found) {
          interactionId = found.interactionId;
          recordingAvailable = found.recordingAvailable;
        }
      } else {
        const direct = await this.store.getCall(scope.workspaceId, scope.userId, 'outbound', callId);
        if (direct) {
          interactionId = direct.interactionId;
          recordingAvailable = direct.recordingAvailable;
        } else if (outboundService) {
          const hist = await this.enrichOutboundHistory(scope, {
            ...(await outboundService.history(scope)),
            durable: true,
            liveCallingEnabled: true
          });
          const row = hist.calls.find(c => c.id === callId);
          if (row) {
            interactionId = row.syncedDetails?.interactionId ?? row.providerCallId;
            recordingAvailable = row.syncedDetails ? row.syncedDetails.recordingAvailable : Boolean(row.providerCallId);
          }
        }
      }
    }

    if (!interactionId || !recordingAvailable || !INTERACTION_ID_RE.test(interactionId)) {
      throw new NotFoundError('Recording unavailable');
    }
    return interactionId;
  }

  async streamRecording(
    scope: AuthenticatedScope,
    direction: 'inbound' | 'outbound',
    callId: string,
    outboundService?: { history(scope: AuthenticatedScope): Promise<{ calls: PhoneCallingRecord[] }> }
  ): Promise<{ contentType: string; bytes: Buffer }> {
    const interactionId = await this.resolveRecordingInteractionId(scope, direction, callId, outboundService);
    const creds = await this.options.resolveSarvamCredentials?.();
    if (!creds || !creds.apiKey) {
      throw new AppError('Recording playback service is not configured.', 'PHONE_RECORDING_NOT_CONFIGURED', 503);
    }
    if (![creds.orgId, creds.workspaceId, creds.appId].every(v => SIMPLE_ID_RE.test(v))) {
      throw new AppError('Invalid provider recording configuration.', 'PHONE_RECORDING_CONFIG_DENIED', 503);
    }

    const url = `https://apps.sarvam.ai/api/analytics/v1/${[
      creds.orgId,
      creds.workspaceId,
      creds.appId
    ]
      .map(encodeURIComponent)
      .join('/')}/recordings/${encodeURIComponent(interactionId)}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          'X-API-Key': creds.apiKey,
          Accept: 'audio/wav, audio/*;q=0.9'
        }
      });
    } catch {
      throw new AppError('Provider recording temporarily unavailable.', 'PHONE_RECORDING_UPSTREAM_ERROR', 502);
    }

    if (response.status === 404 || response.status === 204 || !response.body) {
      throw new NotFoundError('Recording unavailable');
    }
    if (!response.ok) {
      throw new AppError('Provider recording could not be retrieved.', 'PHONE_RECORDING_UPSTREAM_DENIED', 502);
    }

    const contentType = (response.headers.get('content-type') ?? 'audio/wav').split(';')[0]!.trim().toLowerCase();
    if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      throw new AppError('Unexpected recording media format from provider.', 'PHONE_RECORDING_INVALID_MEDIA', 502);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_RECORDING_BYTES) {
          throw new AppError('Recording exceeds maximum allowed stream size.', 'PHONE_RECORDING_TOO_LARGE', 502);
        }
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }

    if (total === 0) {
      throw new NotFoundError('Recording unavailable');
    }

    if (this.options.auditDb) {
      await this.options.auditDb.withScopedTransaction(scope, async tx => {
        await new AuditEventRepository(tx).create(
          scope.workspaceId,
          'phone.recording.streamed',
          'phone_call_recording',
          { direction, callId, byteLength: total },
          scope.userId,
          callId
        );
      });
    }

    return {
      contentType: contentType === 'application/octet-stream' ? 'audio/wav' : contentType,
      bytes: Buffer.concat(chunks)
    };
  }

  async readTranscript(
    scope: AuthenticatedScope,
    direction: 'inbound' | 'outbound',
    callId: string,
    outboundService?: { history(scope: AuthenticatedScope): Promise<{ calls: PhoneCallingRecord[] }> }
  ): Promise<{
    callId: string;
    direction: 'inbound' | 'outbound';
    fullTranscriptAvailable: boolean;
    transcript: Array<{ speaker: 'thaara' | 'customer'; text: string; languageBasis?: string }>;
  }> {
    if (scope.role !== 'owner' || !scope.workspaceId || !scope.userId) {
      throw new ForbiddenError('Only the workspace owner can view call transcripts.');
    }

    const directSynced =
      direction === 'inbound'
        ? await this.store.getCall(scope.workspaceId, scope.userId, 'inbound', callId)
        : await this.store.getCall(scope.workspaceId, scope.userId, 'outbound', callId);
    if (directSynced && directSynced.transcript.length > 0 && directSynced.transcript.some(t => t.speaker === 'thaara')) {
      return {
        callId,
        direction,
        fullTranscriptAvailable: true,
        transcript: directSynced.transcript.map(t => ({
          speaker: t.speaker,
          text: t.text
        }))
      };
    }

    let interactionId: string | null = directSynced?.interactionId ?? null;
    if (!interactionId && direction === 'outbound' && outboundService) {
      const hist = await this.enrichOutboundHistory(scope, {
        ...(await outboundService.history(scope)),
        durable: true,
        liveCallingEnabled: true
      });
      const row = hist.calls.find(c => c.id === callId);
      if (row) {
        if (row.report.conversation?.turns && row.report.conversation.turns.some(t => t.speaker === 'thaara')) {
          return {
            callId,
            direction,
            fullTranscriptAvailable: true,
            transcript: row.report.conversation.turns
              .filter(t => t.speaker === 'thaara' || t.speaker === 'customer')
              .map(t => ({
                speaker: t.speaker as 'thaara' | 'customer',
                text: t.text,
                languageBasis: t.source
              }))
          };
        }
        interactionId = row.syncedDetails?.interactionId ?? row.providerCallId ?? null;
      }
    }

    if (!interactionId || !INTERACTION_ID_RE.test(interactionId)) {
      return { callId, direction, fullTranscriptAvailable: false, transcript: [] };
    }

    const creds = await this.options.resolveSarvamCredentials?.();
    if (!creds || !creds.apiKey || ![creds.orgId, creds.workspaceId, creds.appId].every(v => SIMPLE_ID_RE.test(v))) {
      return { callId, direction, fullTranscriptAvailable: false, transcript: [] };
    }

    const url = `https://apps.sarvam.ai/api/analytics/v1/${[
      creds.orgId,
      creds.workspaceId,
      creds.appId
    ]
      .map(encodeURIComponent)
      .join('/')}/transcripts/${encodeURIComponent(interactionId)}`;

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          'X-API-Key': creds.apiKey,
          Accept: 'application/json'
        }
      });
      if (!response.ok) {
        return { callId, direction, fullTranscriptAvailable: false, transcript: [] };
      }
      const data = (await response.json()) as {
        interaction_id?: string;
        messages?: Array<{ role?: unknown; content?: unknown }>;
      };
      if (!data || !Array.isArray(data.messages)) {
        return { callId, direction, fullTranscriptAvailable: false, transcript: [] };
      }
      const turns = data.messages
        .slice(0, 200)
        .filter(m => m && (m.role === 'assistant' || m.role === 'user') && typeof m.content === 'string' && m.content.trim().length > 0)
        .map(m => ({
          speaker: (m.role === 'assistant' ? 'thaara' : 'customer') as 'thaara' | 'customer',
          text: String(m.content).trim().slice(0, 2000),
          languageBasis: 'provider_transcript'
        }));
      return {
        callId,
        direction,
        fullTranscriptAvailable: turns.some(t => t.speaker === 'thaara'),
        transcript: turns
      };
    } catch {
      return { callId, direction, fullTranscriptAvailable: false, transcript: [] };
    }
  }
}

/** Deterministic in-memory store for isolated unit and offline integration tests. */
export function createInMemoryPhoneN8nSyncStore(options?: {
  existingCallbacks?: ExistingDbCallbackInfo[];
  now?: () => number;
}): PhoneN8nSyncStore {
  const cursors = new Map<string, PersistedSyncCursor>();
  const calls = new Map<string, PersistedSyncedCall>();
  const claims = new Map<string, PersistedCallbackClaimState>();
  const existingCallbacks = new Map<string, ExistingDbCallbackInfo>();
  const nowFn = options?.now ?? Date.now;

  for (const cb of options?.existingCallbacks ?? []) {
    existingCallbacks.set(`${cb.callId}`, { ...cb });
  }

  const keyFor = (w: string, u: string, extra = '') => `${w}:${u}:${extra}`;

  return {
    async getCursor(workspaceId, ownerUserId, defaultCutoffIso) {
      const k = keyFor(workspaceId, ownerUserId);
      const found = cursors.get(k);
      if (found) return { ...found };
      const initial: PersistedSyncCursor = {
        cursorStartDatetime: new Date(nowFn() - DEFAULT_BACKFILL_DAYS * 86400 * 1000).toISOString(),
        backfillCompleted: false,
        callbackCutoffDatetime: defaultCutoffIso
      };
      cursors.set(k, initial);
      return { ...initial };
    },
    async saveCursor(workspaceId, ownerUserId, cursor) {
      cursors.set(keyFor(workspaceId, ownerUserId), { ...cursor });
    },
    async upsertCall(record) {
      const k = keyFor(record.workspaceId, record.ownerUserId, `${record.direction}:${record.callId}`);
      const prev = calls.get(k);
      if (!prev) {
        calls.set(k, structuredClone(record));
        return 'created';
      }
      const prevComparable = JSON.stringify({ ...prev, updatedAt: '' });
      const nextComparable = JSON.stringify({ ...record, updatedAt: '' });
      if (prevComparable === nextComparable) return 'unchanged';
      // Preserve richer transcript if a retry sent an empty transcript array
      const merged: PersistedSyncedCall = {
        ...record,
        transcript: record.transcript.length >= prev.transcript.length ? record.transcript : prev.transcript,
        recordingAvailable: record.recordingAvailable || prev.recordingAvailable
      };
      calls.set(k, structuredClone(merged));
      return 'updated';
    },
    async listCalls(workspaceId, ownerUserId, direction) {
      const prefix = keyFor(workspaceId, ownerUserId, `${direction}:`);
      const items: PersistedSyncedCall[] = [];
      for (const [k, v] of calls.entries()) {
        if (k.startsWith(prefix)) items.push(structuredClone(v));
      }
      return items.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    },
    async getCall(workspaceId, ownerUserId, direction, callId) {
      const found = calls.get(keyFor(workspaceId, ownerUserId, `${direction}:${callId}`));
      return found ? structuredClone(found) : null;
    },
    async findExistingCallback(_workspaceId, _ownerUserId, callId) {
      const cb = existingCallbacks.get(callId);
      return cb ? { ...cb } : null;
    },
    async claimCallbackDelivery({ workspaceId, ownerUserId, callId, callbackRequestId, claimAttemptId, nowMs }) {
      const existingCb = existingCallbacks.get(callId);
      if (existingCb && (existingCb.notificationStatus === 'submitted' || existingCb.providerMessageId)) {
        return { claimed: false, reason: 'already_sent' };
      }
      if (existingCb && existingCb.notificationStatus === 'sending') {
        return { claimed: false, reason: 'already_claimed' };
      }
      const k = keyFor(workspaceId, ownerUserId, callId);
      const cur = claims.get(k);
      if (cur) {
        if (cur.status === 'completed' || cur.providerMessageId) {
          return { claimed: false, reason: 'already_sent' };
        }
        if (cur.status === 'processing' && cur.claimedAtMs && nowMs - cur.claimedAtMs < CLAIM_LEASE_MS) {
          return { claimed: false, reason: 'already_claimed' };
        }
        if (cur.attempts >= 3) {
          return { claimed: false, reason: 'retry_exhausted' };
        }
      }
      const attempts = (cur?.attempts ?? 0) + 1;
      claims.set(k, {
        callId,
        callbackRequestId,
        status: 'processing',
        claimAttemptId,
        attempts,
        claimedAtMs: nowMs,
        providerMessageId: null,
        lastError: null
      });
      if (existingCb && existingCb.notificationStatus === 'pending') {
        existingCb.notificationStatus = 'sending';
      }
      return { claimed: true, attempts };
    },
    async recordCallbackReceipt({ workspaceId, ownerUserId, callId, claimAttemptId, outcome, sanitizedProviderMessageId, errorSummary }) {
      const k = keyFor(workspaceId, ownerUserId, callId);
      const cur = claims.get(k);
      if (!cur) return { recorded: false, status: 'failed' };
      if (cur.status === 'completed' && outcome === 'submitted') {
        return { recorded: true, status: 'duplicate' };
      }
      if (cur.claimAttemptId !== claimAttemptId) {
        return { recorded: false, status: 'failed' };
      }
      const existingCb = existingCallbacks.get(callId);
      if (outcome === 'submitted') {
        cur.status = 'completed';
        cur.providerMessageId = sanitizedProviderMessageId;
        if (existingCb) {
          existingCb.notificationStatus = 'submitted';
          existingCb.providerMessageId = sanitizedProviderMessageId;
        }
        return { recorded: true, status: 'submitted' };
      }
      cur.status = outcome === 'pending' ? 'retrying' : 'failed';
      cur.claimedAtMs = null;
      cur.lastError = errorSummary;
      if (existingCb) {
        existingCb.notificationStatus = outcome === 'pending' ? 'pending' : 'failed';
      }
      return { recorded: true, status: outcome };
    }
  };
}

/**
 * Durable PostgreSQL store backed by existing `public.job_runs`, `public.audit_events`,
 * `public.phone_callback_requests`, and `public.phone_calls` — zero new SQL migrations required.
 */
export function createPostgresPhoneN8nSyncStore(db: TransactionalDbClient): PhoneN8nSyncStore {
  async function withOwnerTx<T>(
    workspaceId: string,
    ownerUserId: string,
    work: (tx: DbClient, hasActiveOwnerSession: boolean) => Promise<T>
  ): Promise<T> {
    const bootstrapScope: AuthenticatedScope = {
      workspaceId,
      userId: ownerUserId,
      role: 'owner',
      sessionTokenHash: '0'.repeat(64)
    };
    return db.withScopedTransaction(bootstrapScope, async tx => {
      // Check if an active owner session exists so session-RLS tables (phone_callback_requests) can also be coordinated
      const sess = await tx.query<{ token_hash: string }>(
        `SELECT token_hash FROM public.sessions
         WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > clock_timestamp()
         ORDER BY expires_at DESC LIMIT 1`,
        [workspaceId, ownerUserId]
      );
      const tokenHash = sess.rows[0]?.token_hash;
      if (tokenHash) {
        await tx.query(`SELECT set_config('app.session_token_hash', $1, true)`, [tokenHash]);
      }
      return work(tx, Boolean(tokenHash));
    });
  }

  return {
    async getCursor(workspaceId, ownerUserId, defaultCutoffIso) {
      return withOwnerTx(workspaceId, ownerUserId, async tx => {
        const key = `sarvam_sync_cursor:${ownerUserId}`;
        const { rows } = await tx.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM public.job_runs
           WHERE workspace_id = $1 AND job_name = $2 AND idempotency_key = $3
           ORDER BY updated_at DESC LIMIT 1`,
          [workspaceId, SYNC_CURSOR_JOB, key]
        );
        const p = rows[0]?.payload;
        if (
          p &&
          typeof p.cursorStartDatetime === 'string' &&
          typeof p.backfillCompleted === 'boolean' &&
          typeof p.callbackCutoffDatetime === 'string'
        ) {
          return {
            cursorStartDatetime: p.cursorStartDatetime,
            backfillCompleted: p.backfillCompleted,
            callbackCutoffDatetime: p.callbackCutoffDatetime
          };
        }
        const initial: PersistedSyncCursor = {
          cursorStartDatetime: new Date(Date.now() - DEFAULT_BACKFILL_DAYS * 86400 * 1000).toISOString(),
          backfillCompleted: false,
          callbackCutoffDatetime: defaultCutoffIso
        };
        await tx.query(
          `INSERT INTO public.job_runs (workspace_id, job_name, status, idempotency_key, payload, updated_at)
           VALUES ($1, $2, 'completed', $3, $4::jsonb, clock_timestamp())`,
          [workspaceId, SYNC_CURSOR_JOB, key, JSON.stringify({ ownerUserId, ...initial })]
        );
        return initial;
      });
    },

    async saveCursor(workspaceId, ownerUserId, cursor) {
      await withOwnerTx(workspaceId, ownerUserId, async tx => {
        const key = `sarvam_sync_cursor:${ownerUserId}`;
        const updated = await tx.query(
          `UPDATE public.job_runs
           SET payload = $4::jsonb, updated_at = clock_timestamp()
           WHERE workspace_id = $1 AND job_name = $2 AND idempotency_key = $3
           RETURNING id`,
          [workspaceId, SYNC_CURSOR_JOB, key, JSON.stringify({ ownerUserId, ...cursor })]
        );
        if (updated.rows.length === 0) {
          await tx.query(
            `INSERT INTO public.job_runs (workspace_id, job_name, status, idempotency_key, payload, updated_at)
             VALUES ($1, $2, 'completed', $3, $4::jsonb, clock_timestamp())`,
            [workspaceId, SYNC_CURSOR_JOB, key, JSON.stringify({ ownerUserId, ...cursor })]
          );
        }
      });
    },

    async upsertCall(record) {
      return withOwnerTx(record.workspaceId, record.ownerUserId, async tx => {
        const idemKey = `sarvam_call:${record.direction}:${record.callId}`;
        await tx.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`${record.workspaceId}:${idemKey}`]
        );
        const existing = await tx.query<{ id: string; payload: PersistedSyncedCall }>(
          `SELECT id, payload FROM public.job_runs
           WHERE workspace_id = $1 AND job_name = $2 AND idempotency_key = $3
           ORDER BY updated_at DESC LIMIT 1`,
          [record.workspaceId, CALL_SYNC_JOB, idemKey]
        );
        const prev = existing.rows[0]?.payload;
        if (!prev) {
          await tx.query(
            `INSERT INTO public.job_runs (workspace_id, job_name, status, idempotency_key, payload, updated_at, completed_at)
             VALUES ($1, $2, 'completed', $3, $4::jsonb, clock_timestamp(), clock_timestamp())`,
            [record.workspaceId, CALL_SYNC_JOB, idemKey, JSON.stringify(record)]
          );
          await new AuditEventRepository(tx).create(
            record.workspaceId,
            'phone.n8n.call_synced',
            'phone_call_history',
            { direction: record.direction, callId: record.callId, status: record.callStatus },
            record.ownerUserId,
            record.callId
          );
          return 'created';
        }
        const merged: PersistedSyncedCall = {
          ...record,
          transcript:
            Array.isArray(prev.transcript) && prev.transcript.length > record.transcript.length
              ? prev.transcript
              : record.transcript,
          recordingAvailable: Boolean(record.recordingAvailable || prev.recordingAvailable)
        };
        const prevComp = JSON.stringify({ ...prev, updatedAt: '' });
        const nextComp = JSON.stringify({ ...merged, updatedAt: '' });
        if (prevComp === nextComp) return 'unchanged';

        await tx.query(
          `UPDATE public.job_runs
           SET payload = $2::jsonb, updated_at = clock_timestamp()
           WHERE id = $1`,
          [existing.rows[0]!.id, JSON.stringify(merged)]
        );
        return 'updated';
      });
    },

    async listCalls(workspaceId, ownerUserId, direction) {
      return withOwnerTx(workspaceId, ownerUserId, async tx => {
        const prefix = `sarvam_call:${direction}:%`;
        const { rows } = await tx.query<{ payload: PersistedSyncedCall }>(
          `SELECT payload FROM public.job_runs
           WHERE workspace_id = $1 AND job_name = $2 AND idempotency_key LIKE $3
           ORDER BY COALESCE((payload->>'occurredAt')::timestamptz, created_at) DESC
           LIMIT 100`,
          [workspaceId, CALL_SYNC_JOB, prefix]
        );
        return rows
          .map(r => r.payload)
          .filter(p => p && p.workspaceId === workspaceId && p.ownerUserId === ownerUserId && p.direction === direction);
      });
    },

    async getCall(workspaceId, ownerUserId, direction, callId) {
      return withOwnerTx(workspaceId, ownerUserId, async tx => {
        const idemKey = `sarvam_call:${direction}:${callId}`;
        const { rows } = await tx.query<{ payload: PersistedSyncedCall }>(
          `SELECT payload FROM public.job_runs
           WHERE workspace_id = $1 AND job_name = $2 AND idempotency_key = $3
           ORDER BY updated_at DESC LIMIT 1`,
          [workspaceId, CALL_SYNC_JOB, idemKey]
        );
        const p = rows[0]?.payload;
        if (!p || p.workspaceId !== workspaceId || p.ownerUserId !== ownerUserId || p.direction !== direction) {
          return null;
        }
        return p;
      });
    },

    async findExistingCallback(workspaceId, ownerUserId, callId) {
      return withOwnerTx(workspaceId, ownerUserId, async (tx, hasActiveOwnerSession) => {
        if (!hasActiveOwnerSession) return null;
        try {
          const { rows } = await tx.query<{
            request_id: string;
            call_id: string;
            request_status: string;
            notification_status: string;
            provider_message_id: string | null;
            details: Record<string, unknown>;
          }>(
            `SELECT request_id, call_id, request_status, notification_status, provider_message_id, details
             FROM public.phone_callback_requests
             WHERE workspace_id = $1 AND owner_user_id = $2 AND direction = 'inbound' AND call_id = $3
             LIMIT 1`,
            [workspaceId, ownerUserId, callId]
          );
          const row = rows[0];
          if (!row) return null;
          return {
            requestId: row.request_id,
            callId: row.call_id,
            requestStatus: row.request_status,
            notificationStatus: row.notification_status,
            providerMessageId: row.provider_message_id,
            name: cleanText(row.details?.name, 240),
            business: cleanText(row.details?.business, 400),
            service: cleanText(row.details?.service, 400),
            phoneNumber: cleanText(row.details?.phoneNumber, 32),
            discussionDetails: cleanText(row.details?.discussionDetails, 2000)
          };
        } catch {
          return null;
        }
      });
    },

    async claimCallbackDelivery({ workspaceId, ownerUserId, callId, callbackRequestId, claimAttemptId, nowMs }) {
      return withOwnerTx(workspaceId, ownerUserId, async (tx, hasActiveOwnerSession) => {
        const idemKey = `callback_notify:${callId}`;
        await tx.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`${workspaceId}:${idemKey}`]
        );

        // Coordinate with Phone Step 115 table when session scope is available
        if (hasActiveOwnerSession) {
          try {
            const cbRows = await tx.query<{
              request_id: string;
              notification_status: string;
              provider_message_id: string | null;
              attempts: number;
            }>(
              `SELECT request_id, notification_status, provider_message_id, attempts
               FROM public.phone_callback_requests
               WHERE workspace_id = $1 AND owner_user_id = $2 AND direction = 'inbound' AND call_id = $3
               FOR UPDATE`,
              [workspaceId, ownerUserId, callId]
            );
            const cb = cbRows.rows[0];
            if (cb) {
              if (cb.notification_status === 'submitted' || cb.provider_message_id) {
                return { claimed: false as const, reason: 'already_sent' as const };
              }
              if (cb.notification_status === 'sending') {
                return { claimed: false as const, reason: 'already_claimed' as const };
              }
              if (cb.notification_status === 'pending' && cb.attempts < 2) {
                await tx.query(
                  `UPDATE public.phone_callback_requests
                   SET notification_status = 'sending',
                       notification_attempt_id = $4::uuid,
                       attempts = attempts + 1,
                       sending_started_at = clock_timestamp()
                   WHERE workspace_id = $1 AND owner_user_id = $2 AND request_id = $3 AND notification_status = 'pending'`,
                  [workspaceId, ownerUserId, cb.request_id, claimAttemptId]
                );
              }
            }
          } catch {
            // Continue with durable job_runs single-delivery lock below
          }
        }

        const existing = await tx.query<{
          id: string;
          status: string;
          retries_count: number;
          payload: Record<string, unknown>;
          result: Record<string, unknown> | null;
        }>(
          `SELECT id, status, retries_count, payload, result
           FROM public.job_runs
           WHERE workspace_id = $1 AND job_name = $2 AND idempotency_key = $3
           ORDER BY created_at DESC LIMIT 1
           FOR UPDATE`,
          [workspaceId, CALLBACK_NOTIFY_JOB, idemKey]
        );

        const row = existing.rows[0];
        if (row) {
          if (row.status === 'completed' || row.result?.providerMessageId) {
            return { claimed: false as const, reason: 'already_sent' as const };
          }
          const claimedAtMs = typeof row.payload?.claimedAtMs === 'number' ? row.payload.claimedAtMs : 0;
          if (row.status === 'processing' && nowMs - claimedAtMs < CLAIM_LEASE_MS) {
            return { claimed: false as const, reason: 'already_claimed' as const };
          }
          if (row.retries_count >= 3) {
            return { claimed: false as const, reason: 'retry_exhausted' as const };
          }
          const attempts = row.retries_count + 1;
          await tx.query(
            `UPDATE public.job_runs
             SET status = 'processing',
                 retries_count = $2,
                 payload = $3::jsonb,
                 updated_at = clock_timestamp()
             WHERE id = $1`,
            [
              row.id,
              attempts,
              JSON.stringify({
                ownerUserId,
                callId,
                callbackRequestId,
                claimAttemptId,
                claimedAtMs: nowMs
              })
            ]
          );
          await new AuditEventRepository(tx).create(
            workspaceId,
            'phone.n8n.callback_claimed',
            'phone_callback_request',
            { callId, callbackRequestId, attempts },
            ownerUserId,
            callbackRequestId
          );
          return { claimed: true as const, attempts };
        }

        await tx.query(
          `INSERT INTO public.job_runs (workspace_id, job_name, status, idempotency_key, retries_count, payload, updated_at)
           VALUES ($1, $2, 'processing', $3, 1, $4::jsonb, clock_timestamp())`,
          [
            workspaceId,
            CALLBACK_NOTIFY_JOB,
            idemKey,
            JSON.stringify({
              ownerUserId,
              callId,
              callbackRequestId,
              claimAttemptId,
              claimedAtMs: nowMs
            })
          ]
        );
        await new AuditEventRepository(tx).create(
          workspaceId,
          'phone.n8n.callback_claimed',
          'phone_callback_request',
          { callId, callbackRequestId, attempts: 1 },
          ownerUserId,
          callbackRequestId
        );
        return { claimed: true as const, attempts: 1 };
      });
    },

    async recordCallbackReceipt({
      workspaceId,
      ownerUserId,
      callId,
      claimAttemptId,
      outcome,
      sanitizedProviderMessageId,
      errorSummary
    }) {
      return withOwnerTx(workspaceId, ownerUserId, async (tx, hasActiveOwnerSession) => {
        const idemKey = `callback_notify:${callId}`;
        await tx.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`${workspaceId}:${idemKey}`]
        );
        const existing = await tx.query<{
          id: string;
          status: string;
          payload: Record<string, unknown>;
        }>(
          `SELECT id, status, payload FROM public.job_runs
           WHERE workspace_id = $1 AND job_name = $2 AND idempotency_key = $3
           ORDER BY created_at DESC LIMIT 1
           FOR UPDATE`,
          [workspaceId, CALLBACK_NOTIFY_JOB, idemKey]
        );
        const row = existing.rows[0];
        if (!row) return { recorded: false, status: 'failed' as const };
        if (row.status === 'completed' && outcome === 'submitted') {
          return { recorded: true, status: 'duplicate' as const };
        }
        if (row.payload?.claimAttemptId !== claimAttemptId) {
          return { recorded: false, status: 'failed' as const };
        }

        const nextJobStatus =
          outcome === 'submitted' ? 'completed' : outcome === 'pending' ? 'retrying' : 'failed';
        await tx.query(
          `UPDATE public.job_runs
           SET status = $2,
               result = $3::jsonb,
               error = $4,
               updated_at = clock_timestamp(),
               completed_at = CASE WHEN $2 = 'completed' THEN clock_timestamp() ELSE completed_at END
           WHERE id = $1`,
          [
            row.id,
            nextJobStatus,
            JSON.stringify({
              outcome,
              providerMessageId: sanitizedProviderMessageId,
              recordedAt: new Date().toISOString()
            }),
            errorSummary
          ]
        );

        if (hasActiveOwnerSession) {
          try {
            if (outcome === 'submitted' && sanitizedProviderMessageId) {
              await tx.query(
                `UPDATE public.phone_callback_requests
                 SET notification_status = 'submitted',
                     provider_message_id = $4
                 WHERE workspace_id = $1 AND owner_user_id = $2 AND call_id = $3
                   AND notification_status = 'sending' AND notification_attempt_id = $5::uuid`,
                [workspaceId, ownerUserId, callId, sanitizedProviderMessageId, claimAttemptId]
              );
            } else {
              await tx.query(
                `UPDATE public.phone_callback_requests
                 SET notification_status = $4,
                     next_attempt_at = CASE WHEN $4 = 'pending' THEN clock_timestamp() + interval '60 seconds' ELSE next_attempt_at END
                 WHERE workspace_id = $1 AND owner_user_id = $2 AND call_id = $3
                   AND notification_status = 'sending' AND notification_attempt_id = $5::uuid AND ($4 <> 'pending' OR attempts < 2)`,
                [workspaceId, ownerUserId, callId, outcome === 'pending' ? 'pending' : 'failed', claimAttemptId]
              );
            }
          } catch {
            // Non-fatal if Step 115 row had attempts=2 or worker principal constraint
          }
        }

        await new AuditEventRepository(tx).create(
          workspaceId,
          'phone.n8n.callback_receipt',
          'phone_callback_request',
          {
            callId,
            outcome,
            hasProviderMessageId: Boolean(sanitizedProviderMessageId)
          },
          ownerUserId,
          callId
        );
        return { recorded: true, status: outcome };
      });
    },

    async syncOutboundProviderState({ workspaceId, ownerUserId, attemptId, interactionId, connectivityStatus }) {
      await withOwnerTx(workspaceId, ownerUserId, async (tx, hasActiveOwnerSession) => {
        if (!hasActiveOwnerSession) return;
        try {
          const found = await tx.query<{
            call_id: string;
            state: string;
            provider_request_id: string | null;
            provider_call_id: string | null;
          }>(
            `SELECT call_id, state, provider_request_id, provider_call_id
             FROM public.phone_calls
             WHERE workspace_id = $1 AND owner_user_id = $2
               AND (provider_request_id = $3 OR ($4::text IS NOT NULL AND provider_call_id = $4))
             LIMIT 1`,
            [workspaceId, ownerUserId, attemptId, interactionId]
          );
          const row = found.rows[0];
          if (!row || !row.provider_request_id) return;
          if (['completed', 'failed', 'busy', 'no_answer', 'cancelled'].includes(row.state)) return;

          const pCallId = interactionId ?? row.provider_call_id ?? `attempt_${attemptId.slice(0, 48)}`;
          const targetState =
            connectivityStatus === 'connected'
              ? 'completed'
              : connectivityStatus === 'busy'
                ? 'busy'
                : connectivityStatus === 'no_answer'
                  ? 'no_answer'
                  : connectivityStatus === 'failed'
                    ? 'failed'
                    : null;
          if (!targetState) return;

          if (targetState === 'completed' && row.state === 'queued') {
            await applyPhoneProviderEvent(tx, {
              callId: row.call_id,
              providerRequestId: row.provider_request_id,
              providerCallId: pCallId,
              state: 'ringing',
              eventId: `n8nsync-ring-${attemptId.slice(0, 48)}`,
              eventHash: sha256Hex(`ring:${row.call_id}:${attemptId}`)
            });
            await applyPhoneProviderEvent(tx, {
              callId: row.call_id,
              providerRequestId: row.provider_request_id,
              providerCallId: pCallId,
              state: 'answered',
              eventId: `n8nsync-ans-${attemptId.slice(0, 48)}`,
              eventHash: sha256Hex(`ans:${row.call_id}:${attemptId}`)
            });
          } else if (targetState === 'completed' && row.state === 'ringing') {
            await applyPhoneProviderEvent(tx, {
              callId: row.call_id,
              providerRequestId: row.provider_request_id,
              providerCallId: pCallId,
              state: 'answered',
              eventId: `n8nsync-ans-${attemptId.slice(0, 48)}`,
              eventHash: sha256Hex(`ans:${row.call_id}:${attemptId}`)
            });
          }
          await applyPhoneProviderEvent(tx, {
            callId: row.call_id,
            providerRequestId: row.provider_request_id,
            providerCallId: pCallId,
            state: targetState,
            eventId: `n8nsync-end-${attemptId.slice(0, 48)}`,
            eventHash: sha256Hex(`end:${row.call_id}:${attemptId}:${targetState}`)
          });
        } catch {
          // Never fail call-history batch sync if legacy state guard ignores transition
        }
      });
    }
  };
}

async function readSecretFileSafe(filePath: string, maxBytes = 8192): Promise<string | null> {
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.size < 1 || info.size > maxBytes) return null;
    const text = (await readFile(filePath, 'utf8')).trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Runtime loader for the pilot container: uses already-mounted `/run/secrets/sarvam_*` files
 * and resolves the active pilot workspace owner from PostgreSQL without requiring new compose secrets.
 */
export function createRuntimePhoneN8nSyncService(options: {
  db: TransactionalDbClient;
  policyGateway: PolicyGateway;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): PhoneN8nSyncService {
  const env = options.env ?? process.env;
  const profilePath = env.THAARA_SARVAM_PROFILE_FILE ?? '/run/secrets/sarvam_profile';
  const apiKeyPath = env.THAARA_SARVAM_API_KEY_FILE ?? '/run/secrets/sarvam_api_key';
  const webhookSecretPath = env.THAARA_SARVAM_WEBHOOK_SECRET_FILE ?? '/run/secrets/sarvam_webhook_secret';
  const explicitSyncSecret = env.THAARA_PHONE_N8N_SYNC_SECRET;

  let cachedOwner: { workspaceId: string; ownerUserId: string } | null = null;

  async function resolveOwnerWorkspace(): Promise<{ workspaceId: string; ownerUserId: string } | null> {
    if (cachedOwner) return cachedOwner;
    try {
      const wsRes = await options.db.query<{ id: string }>(
        `SELECT id FROM public.workspaces ORDER BY created_at ASC LIMIT 2`
      );
      if (wsRes.rows.length === 0) return null;
      const workspaceId = wsRes.rows[0]!.id;
      const bootstrapScope: AuthenticatedScope = {
        workspaceId,
        userId: '00000000-0000-4000-8000-000000000000',
        role: 'owner',
        sessionTokenHash: '0'.repeat(64)
      };
      const ownerId = await options.db.withScopedTransaction(bootstrapScope, async tx => {
        const mRes = await tx.query<{ user_id: string }>(
          `SELECT user_id FROM public.memberships WHERE workspace_id = $1 AND role = 'owner' ORDER BY created_at ASC LIMIT 1`,
          [workspaceId]
        );
        return mRes.rows[0]?.user_id ?? null;
      });
      if (!ownerId) return null;
      cachedOwner = { workspaceId, ownerUserId: ownerId };
      return cachedOwner;
    } catch {
      return null;
    }
  }

  return new PhoneN8nSyncService({
    store: createPostgresPhoneN8nSyncStore(options.db),
    policyGateway: options.policyGateway,
    auditDb: options.db,
    fetchImpl: options.fetchImpl,
    async resolveMachinePrincipal() {
      const owner = await resolveOwnerWorkspace();
      if (!owner) return null;
      const secretMaterial = explicitSyncSecret?.trim() || (await readSecretFileSafe(webhookSecretPath, 4096));
      if (!secretMaterial || secretMaterial.length < 16) return null;
      const profileRaw = await readSecretFileSafe(profilePath, 16384);
      let inboundRouteId = 'qw-callback-dd60ce8ff4e842df8d19ab50674810c2';
      if (profileRaw) {
        try {
          const p = JSON.parse(profileRaw) as Record<string, unknown>;
          if (typeof p.inboundRouteId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(p.inboundRouteId)) {
            inboundRouteId = p.inboundRouteId;
          }
        } catch {
          // keep default routeId
        }
      }
      return {
        workspaceId: owner.workspaceId,
        ownerUserId: owner.ownerUserId,
        expectedToken: derivePhoneN8nSyncToken(secretMaterial, owner.workspaceId, owner.ownerUserId),
        inboundRouteId
      };
    },
    async resolveSarvamCredentials() {
      const [profileRaw, apiKey] = await Promise.all([
        readSecretFileSafe(profilePath, 16384),
        readSecretFileSafe(apiKeyPath, 4096)
      ]);
      if (!profileRaw || !apiKey) return null;
      try {
        const parsed = JSON.parse(profileRaw) as Record<string, unknown>;
        const orgId = typeof parsed.orgId === 'string' ? parsed.orgId : '';
        const workspaceId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId : '';
        const appId = typeof parsed.appId === 'string' ? parsed.appId : '';
        if (!orgId || !workspaceId || !appId) return null;
        return { orgId, workspaceId, appId, apiKey };
      } catch {
        return null;
      }
    }
  });
}
