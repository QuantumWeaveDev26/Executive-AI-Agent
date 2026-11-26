import {isPhoneCallEvidence} from '../../../packages/contracts/src/phone-call-evidence';
import { ApiRequestError, getCsrfToken, request } from './api';
import type {
  PhoneCallingDraft,
  PhoneCallingLanguage,
  PhoneCallingPrepare,
  PhoneCallingPrepared,
  PhoneCallingRecord,
  PhoneCallingReport,
  PhoneCallingProviderResult,
} from '../../../packages/contracts/src/phone-calling';

export type { PhoneCallingDraft, PhoneCallingLanguage, PhoneCallingPrepare, PhoneCallingPrepared, PhoneCallingRecord, PhoneCallingReport };

/** Step 110 AI calling client. It never dials, simulates or decides approval; the server is the only authority. */
export interface PhoneCallingStatus {
  status: 'not_configured' | 'simulation_only' | 'live_enabled';
  liveCallingEnabled: boolean;
  contactDirectoryConfigured: boolean;
  simulationEnabled: boolean;
  durableCallHistory: boolean;
  recordingEnabled: false;
  languages: PhoneCallingLanguage[];
  speechVerified: false;
}
export interface PhoneCallingCandidate { id: string; displayName: string; maskedPhone: string }
export interface PhoneCallingResolution { status: 'matched' | 'ambiguous' | 'not_found'; candidates: PhoneCallingCandidate[] }
export interface PhoneCallingHistory { calls: PhoneCallingRecord[]; durable: boolean; liveCallingEnabled: boolean }

const BASE = '/api/v1/connectors/phone/ai';
const LANGUAGES: readonly PhoneCallingLanguage[] = ['en-IN', 'kn-IN', 'kn-en'];
const STATES = new Set(['queued', 'ringing', 'answered', 'completed', 'failed', 'cancelled', 'busy', 'no_answer']);
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MASKED = /^\+\d{1,3} \*{6}\d{4}$/;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every((k) => keys.includes(k));
const text = (v: unknown, max: number, min = 1) => typeof v === 'string' && v.length >= min && v.length <= max;
const language = (v: unknown): v is PhoneCallingLanguage => LANGUAGES.includes(v as PhoneCallingLanguage);

export function isPhoneCallingStatus(v: unknown): v is PhoneCallingStatus {
  return obj(v) && (v.status === 'not_configured' || v.status === 'simulation_only' || v.status === 'live_enabled')
    && v.liveCallingEnabled === (v.status === 'live_enabled')
    && typeof v.contactDirectoryConfigured === 'boolean' && typeof v.simulationEnabled === 'boolean'
    && typeof v.durableCallHistory === 'boolean' && v.recordingEnabled === false && v.speechVerified === false
    && Array.isArray(v.languages) && v.languages.every(language);
}

function isCandidate(v: unknown): v is PhoneCallingCandidate {
  return obj(v) && exactKeys(v, ['id', 'displayName', 'maskedPhone']) && typeof v.id === 'string' && ID.test(v.id)
    && text(v.displayName, 128) && typeof v.maskedPhone === 'string' && MASKED.test(v.maskedPhone);
}

export function isPhoneCallingResolution(v: unknown): v is PhoneCallingResolution {
  if (!obj(v) || !Array.isArray(v.candidates) || v.candidates.length > 20 || !v.candidates.every(isCandidate)) return false;
  const n = v.candidates.length;
  return (v.status === 'matched' && n === 1) || (v.status === 'ambiguous' && n > 1) || (v.status === 'not_found' && n === 0);
}

export function isPhoneCallingDraft(v: unknown): v is PhoneCallingDraft {
  if (!obj(v) || !exactKeys(v, ['draftId', 'contactId', 'contactRevision', 'contactBindingHash', 'recipient', 'purpose', 'language', 'maxDurationSeconds', 'aiDisclosure', 'consentReference', 'idempotencyKey', 'mode', 'onBehalfOf', 'providerBindingHash', 'newRecipient'])) return false;
  if (v.onBehalfOf !== undefined && !text(v.onBehalfOf, 40)) return false;
  if (v.providerBindingHash !== undefined && (typeof v.providerBindingHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.providerBindingHash))) return false;
  if(v.newRecipient!==undefined){
    const n=v.newRecipient;
    if(!obj(n)||(n.previewApprovalId!==undefined&&(typeof n.previewApprovalId!=='string'||!UUID.test(n.previewApprovalId)))||!exactKeys(n,['phoneE164','consentConfirmed','eligibility','previewApprovalId'])||typeof n.phoneE164!=='string'||!/^\+91[6-9][0-9]{9}$/.test(n.phoneE164)||typeof n.consentConfirmed!=='boolean'||!['eligible','unverified'].includes(String(n.eligibility)))return false;
  }
  const r = v.recipient;
  return [v.draftId, v.contactId, v.consentReference, v.idempotencyKey].every((x) => typeof x === 'string' && ID.test(x))
    && Number.isSafeInteger(v.contactRevision) && (v.contactRevision as number) >= 1
    && typeof v.contactBindingHash === 'string' && /^[a-f0-9]{64}$/.test(v.contactBindingHash)
    && obj(r) && exactKeys(r, ['displayName', 'maskedPhone']) && text(r.displayName, 128) && typeof r.maskedPhone === 'string' && MASKED.test(r.maskedPhone)
    && text(v.purpose, 10000) && language(v.language) && Number.isSafeInteger(v.maxDurationSeconds)
    && (v.maxDurationSeconds as number) >= 30 && (v.maxDurationSeconds as number) <= 300
    && text(v.aiDisclosure, 300) && (v.mode === 'simulation' || v.mode === 'live');
}

/** The prepared draft must echo what the owner asked for; a substituted contact or language is rejected. */
export function isPhoneCallingPrepared(v: unknown, asked?: PhoneCallingPrepare): v is PhoneCallingPrepared {
  if (!obj(v) || !exactKeys(v, ['draft', 'approvalId', 'planId', 'stepId', 'status', 'liveCallingEnabled'])) return false;
  // liveCallingEnabled must match the draft: a live draft is never shown as simulation and vice versa.
  if (!isPhoneCallingDraft(v.draft) || v.status !== 'awaiting_approval' || v.liveCallingEnabled !== (v.draft.mode === 'live')) return false;
  if (![v.approvalId, v.planId, v.stepId].every((x) => typeof x === 'string' && UUID.test(x))) return false;
  if (!asked) return true;
  return v.draft.language === asked.language
    && (asked.selectedContactId === undefined || v.draft.contactId === asked.selectedContactId)
    && (asked.maxDurationSeconds !== undefined ? v.draft.maxDurationSeconds === asked.maxDurationSeconds
      : v.draft.mode === 'live' && v.draft.providerBindingHash !== undefined || v.draft.maxDurationSeconds === 120);
}

function isReport(v: unknown): v is PhoneCallingReport {
  return obj(v) && (v.conversation === undefined || isPhoneCallEvidence(v.conversation)) && text(v.text, 16000, 0) && text(v.spokenText, 16000, 0) && v.verified === false && typeof v.simulated === 'boolean'
    && Array.isArray(v.quotedResponses) && v.quotedResponses.length <= 12 && v.quotedResponses.every((q) => text(q, 1000, 0))
    && Array.isArray(v.evidenceIds) && v.evidenceIds.length <= 12 && v.evidenceIds.every((e) => typeof e === 'string' && ID.test(e));
}

const DISPATCH = new Set(['pending', 'claimed', 'unverified', 'failed', 'unknown']);
/** Simulated rows carry no provider data; live rows carry an outbox status and at most a provider call UUID. */
function consistentMode(c: Record<string, unknown>): boolean {
  const simulated = (c.draft as PhoneCallingDraft).mode === 'simulation';
  if (c.simulated !== simulated || (c.report as PhoneCallingReport).simulated !== simulated) return false;
  if (simulated) return c.providerCallId === null && c.dispatchStatus === undefined;
  return (c.providerCallId === null || (typeof c.providerCallId === 'string' && /^([A-Za-z0-9_.:-]{1,128}|[0-9]{8}\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,99})$/.test(c.providerCallId))) && DISPATCH.has(c.dispatchStatus as string);
}

function isSyncedDetails(v: unknown): boolean {
  if (v === undefined) return true;
  if (!obj(v)) return false;
  if (typeof v.recordingAvailable !== 'boolean' || typeof v.occurredAt !== 'string' || typeof v.outcomeLabel !== 'string') return false;
  if (!Array.isArray(v.transcript) || v.transcript.length > 200) return false;
  return v.transcript.every((t) => obj(t) && (t.speaker === 'thaara' || t.speaker === 'customer') && text(t.text, 2000));
}

export function isPhoneCallingRecord(c: unknown): c is PhoneCallingRecord {
  return obj(c) && typeof c.id === 'string' && ID.test(c.id) && typeof c.approvalId === 'string' && UUID.test(c.approvalId)
    && isPhoneCallingDraft(c.draft) && STATES.has(c.state as string) && typeof c.createdAt === 'string' && typeof c.updatedAt === 'string'
    && c.verified === false && isReport(c.report) && consistentMode(c) && isSyncedDetails(c.syncedDetails);
}

export function isPhoneCallingHistory(v: unknown): v is PhoneCallingHistory {
  return obj(v) && typeof v.durable === 'boolean' && typeof v.liveCallingEnabled === 'boolean' && Array.isArray(v.calls) && v.calls.length <= 100
    && v.calls.every(isPhoneCallingRecord);
}

function checked<T>(value: unknown, guard: (v: unknown) => boolean, what: string): T {
  if (!guard(value)) throw new Error(`Unexpected ${what} response. No call was made.`);
  return value as T;
}

export async function loadPhoneCallingStatus(signal?: AbortSignal): Promise<PhoneCallingStatus> {
  return checked(await request<unknown>(`${BASE}/status`, { signal }), isPhoneCallingStatus, 'phone calling status');
}

export async function loadPhoneCallingHistory(signal?: AbortSignal): Promise<PhoneCallingHistory> {
  return checked(await request<unknown>(`${BASE}/calls`, { signal }), isPhoneCallingHistory, 'phone call history');
}

export async function resolvePhoneCallingContact(query: string): Promise<PhoneCallingResolution> {
  const q = query.trim();
  if (!q || q.length > 128) throw new Error('Enter a contact name (up to 128 characters).');
  return checked(await request<unknown>(`${BASE}/contacts/resolve`, { method: 'POST', body: JSON.stringify({ query: q }) }), isPhoneCallingResolution, 'contact');
}

export interface PhoneCallingRequest { approvalId: string; status: 'pending' | 'approved'; expiresAt: string; draft: PhoneCallingDraft }
export function isPhoneCallingRequestList(v: unknown): v is { requests: PhoneCallingRequest[] } {
  return obj(v) && exactKeys(v, ['requests']) && Array.isArray(v.requests) && v.requests.length <= 20
    && v.requests.every((r) => obj(r) && exactKeys(r, ['approvalId', 'status', 'expiresAt', 'draft']) && typeof r.approvalId === 'string' && UUID.test(r.approvalId)
      && (r.status === 'pending' || r.status === 'approved') && typeof r.expiresAt === 'string' && Number.isFinite(Date.parse(r.expiresAt)) && isPhoneCallingDraft(r.draft));
}
/** Owner's open call requests (pending or approved, not yet started), so a live request can be started after a reload. */
export async function loadPhoneCallingRequests(signal?: AbortSignal): Promise<PhoneCallingRequest[]> {
  return checked<{ requests: PhoneCallingRequest[] }>(await request<unknown>(`${BASE}/requests`, { signal }), isPhoneCallingRequestList, 'call request').requests;
}

/**
 * Starts ONE real call for an approved live request (explicit owner click only). The server re-checks the approval,
 * contact and consent and never dials twice; the response must be the live call for exactly this draft.
 */
export async function startPhoneCall(prepared: Pick<PhoneCallingPrepared, 'approvalId' | 'draft'>): Promise<PhoneCallingRecord> {
  if (!UUID.test(prepared.approvalId) || prepared.draft.mode !== 'live') throw new Error('Only an approved live request can be started. No call was made.');
  const result = await request<unknown>(`${BASE}/calls`, { method: 'POST', body: JSON.stringify({ approvalId: prepared.approvalId }) });
  const call = checked<PhoneCallingRecord>(result, isPhoneCallingRecord, 'call');
  if (call.approvalId !== prepared.approvalId || call.draft.draftId !== prepared.draft.draftId || call.draft.mode !== 'live' || call.simulated) {
    throw new Error('Unexpected call response. Reload call history.');
  }
  return call;
}

/** Creates an approval request only. Approval is decided separately and cannot dial while live calling is disabled. */
export async function preparePhoneCall(input: PhoneCallingPrepare): Promise<PhoneCallingPrepared> {
  const body: PhoneCallingPrepare = { contactQuery: input.contactQuery.trim(), purpose: input.purpose.trim(), language: input.language };
  if (input.selectedContactId !== undefined) body.selectedContactId = input.selectedContactId;
  if (input.maxDurationSeconds !== undefined) body.maxDurationSeconds = input.maxDurationSeconds;
  if (!text(body.contactQuery, 128) || !text(body.purpose, 10000) || !language(body.language)) throw new Error('Enter a contact, a purpose and a language.');
  const result = await request<unknown>(`${BASE}/drafts`, { method: 'POST', body: JSON.stringify(body) });
  return checked(result, (v) => isPhoneCallingPrepared(v, body), 'call draft');
}

export const SPEECH_LANG: Record<PhoneCallingLanguage, string> = { 'en-IN': 'en-IN', 'kn-IN': 'kn-IN', 'kn-en': 'en-IN' };
export interface SpeechLike { cancel(): void; speak(u: unknown): void }
export type SpeechOutcome = 'speaking' | 'unavailable' | 'empty';

/**
 * Reads the same evidence report aloud. Call only from an explicit user click: no auto-play, no microphone.
 * Returns a truthful outcome instead of throwing when the browser has no speech output.
 */
export function speakPhoneCallReport(
  record: Pick<PhoneCallingRecord, 'report' | 'draft'>,
  synth: SpeechLike | undefined = (globalThis as { speechSynthesis?: SpeechLike }).speechSynthesis,
  Utterance: (new (t: string) => { lang: string }) | undefined = (globalThis as { SpeechSynthesisUtterance?: new (t: string) => { lang: string } }).SpeechSynthesisUtterance,
): SpeechOutcome {
  const spoken = record.report.spokenText.trim();
  if (!spoken) return 'empty';
  if (!synth || !Utterance) return 'unavailable';
  const utterance = new Utterance(spoken);
  utterance.lang = SPEECH_LANG[record.draft.language];
  synth.cancel();
  synth.speak(utterance);
  return 'speaking';
}

export const LANGUAGE_LABELS: Record<PhoneCallingLanguage, string> = { 'en-IN': 'English', 'kn-IN': 'Kannada', 'kn-en': 'Kanglish (Kannada + English)' };
const STATE_LABELS: Record<string, string> = {
  queued: 'Queued', ringing: 'Ringing', answered: 'Answered', completed: 'Completed', failed: 'Failed',
  cancelled: 'Cancelled', busy: 'Busy', no_answer: 'No answer',
};
const DISPATCH_LABELS: Record<string, string> = {
  pending: 'Waiting to be placed', claimed: 'Being placed', unverified: 'Provider accepted the request (not yet confirmed)',
  failed: 'Provider refused — no call was placed', unknown: 'Outcome unknown — not retried automatically',
};
export const phoneDispatchLabel = (s: string | undefined) => (s ? DISPATCH_LABELS[s] ?? 'Unknown' : '');
export const phoneCallingStateLabel = (s: string) => STATE_LABELS[s] ?? 'Unknown';

// Step 110 A2: owner contact management. The browser sends a number once and only ever receives the masked form.
export type PhoneContactConsentSource = 'recipient_verbal' | 'recipient_written' | 'recipient_message';
export interface PhoneContactView {
  contactId: string; revision: number; displayName: string; aliases: string[]; maskedPhone: string; archived: boolean;
  consent: { callingAllowed: boolean; source: PhoneContactConsentSource; recordedAt: string; expiresAt: string; expired: boolean };
}
export interface PhoneContactForm {
  displayName: string; aliases?: string[]; phoneE164?: string;
  consent: { callingAllowed: boolean; source: PhoneContactConsentSource; validDays: number };
}
const SOURCES = new Set<PhoneContactConsentSource>(['recipient_verbal', 'recipient_written', 'recipient_message']);
export const CONSENT_SOURCE_LABELS: Record<PhoneContactConsentSource, string> = {
  recipient_verbal: 'They agreed verbally', recipient_written: 'They agreed in writing', recipient_message: 'They agreed by message',
};

export function isPhoneContactView(v: unknown): v is PhoneContactView {
  if (!obj(v) || !exactKeys(v, ['contactId', 'revision', 'displayName', 'aliases', 'maskedPhone', 'archived', 'consent'])) return false;
  const c = v.consent;
  return typeof v.contactId === 'string' && ID.test(v.contactId) && Number.isSafeInteger(v.revision) && (v.revision as number) >= 1
    && text(v.displayName, 128) && Array.isArray(v.aliases) && v.aliases.length <= 20 && v.aliases.every((a) => text(a, 128))
    && typeof v.maskedPhone === 'string' && MASKED.test(v.maskedPhone) && typeof v.archived === 'boolean'
    && obj(c) && exactKeys(c, ['callingAllowed', 'source', 'recordedAt', 'expiresAt', 'expired']) && typeof c.callingAllowed === 'boolean'
    && SOURCES.has(c.source as PhoneContactConsentSource) && typeof c.recordedAt === 'string' && typeof c.expiresAt === 'string' && typeof c.expired === 'boolean';
}

function contactBody(form: PhoneContactForm, requirePhone: boolean): PhoneContactForm {
  const displayName = form.displayName.trim();
  const aliases = [...new Set((form.aliases ?? []).map((a) => a.trim()).filter(Boolean))];
  const phone = form.phoneE164?.replace(/[\s-]/g, '');
  const days = form.consent.validDays;
  if (!text(displayName, 128) || /[<>]/.test(displayName) || aliases.length > 20 || aliases.some((a) => a.length > 128 || /[<>]/.test(a))
    || (requirePhone && !phone) || (phone !== undefined && phone !== '' && !/^\+91[6-9][0-9]{9}$/.test(phone))
    || !SOURCES.has(form.consent.source) || typeof form.consent.callingAllowed !== 'boolean' || !Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('Enter a name, a +91 mobile number and how the person agreed. Nothing was saved.');
  }
  const body: PhoneContactForm = { displayName, aliases, consent: { callingAllowed: form.consent.callingAllowed, source: form.consent.source, validDays: days } };
  if (phone) body.phoneE164 = phone;
  return body;
}

function checkedContact(v: unknown, displayName: string): PhoneContactView {
  const c = checked<PhoneContactView>(v, isPhoneContactView, 'contact');
  if (c.displayName !== displayName) throw new Error('Unexpected contact response. Reload contacts.');
  return c;
}

export async function listPhoneContacts(signal?: AbortSignal): Promise<PhoneContactView[]> {
  const r = await request<unknown>(`${BASE}/contacts`, { signal });
  if (!obj(r) || !Array.isArray(r.contacts) || r.contacts.length > 1000 || !r.contacts.every(isPhoneContactView)) throw new Error('Unexpected contacts response.');
  return r.contacts as PhoneContactView[];
}

export async function createPhoneContact(form: PhoneContactForm): Promise<PhoneContactView> {
  const body = contactBody(form, true);
  return checkedContact(await request<unknown>(`${BASE}/contacts`, { method: 'POST', body: JSON.stringify(body) }), body.displayName);
}

export async function updatePhoneContact(contactId: string, expectedRevision: number, form: PhoneContactForm): Promise<PhoneContactView> {
  if (!ID.test(contactId)) throw new Error('Invalid contact.');
  const body = contactBody(form, false);
  const result = await request<unknown>(`${BASE}/contacts/${encodeURIComponent(contactId)}`, { method: 'PUT', body: JSON.stringify({ expectedRevision, ...body }) });
  const c = checkedContact(result, body.displayName);
  if (c.contactId !== contactId || c.revision !== expectedRevision + 1) throw new Error('Unexpected contact response. Reload contacts.');
  return c;
}

export async function archivePhoneContact(contactId: string, expectedRevision: number): Promise<PhoneContactView> {
  if (!ID.test(contactId)) throw new Error('Invalid contact.');
  const c = checked<PhoneContactView>(await request<unknown>(`${BASE}/contacts/${encodeURIComponent(contactId)}/archive`, { method: 'POST', body: JSON.stringify({ expectedRevision }) }), isPhoneContactView, 'contact');
  if (c.contactId !== contactId || !c.archived) throw new Error('Unexpected contact response. Reload contacts.');
  return c;
}

/** One-tap "Call now" from the Chat card: the owner's confirmation of exactly this request, then at most one call. */
export async function confirmPhoneCall(approvalId: string, expected: Pick<PhoneCallingDraft, 'draftId'>): Promise<PhoneCallingRecord> {
  if (!UUID.test(approvalId)) throw new Error('Invalid call request. No call was made.');
  const result = await request<unknown>(`${BASE}/calls/confirm`, { method: 'POST', body: JSON.stringify({ approvalId }) });
  const call = checked<PhoneCallingRecord>(result, isPhoneCallingRecord, 'call');
  if (call.approvalId !== approvalId || call.draft.draftId !== expected.draftId || call.simulated) throw new Error('Unexpected call response. Reload call history.');
  return call;
}

/** Thaara's spoken report (WAV) for one of the owner's calls. Throws ApiRequestError(503) when no voice is configured. */
export async function fetchPhoneCallReportAudio(callId: string, call: typeof fetch = fetch): Promise<Blob> {
  if (!UUID.test(callId)) throw new Error('Invalid call.');
  const headers = new Headers({ Accept: 'audio/wav' });
  const csrf = getCsrfToken();
  if (csrf) headers.set('x-csrf-token', csrf);
  const res = await call(`${BASE}/calls/${encodeURIComponent(callId)}/speech`, { method: 'POST', headers, credentials: 'include' });
  if (!res.ok) throw new ApiRequestError(res.status, `Report voice unavailable (${res.status})`);
  const type = res.headers.get('content-type') ?? '';
  if (!/^audio\/(wav|x-wav|wave)\b/.test(type)) throw new Error('Unexpected report audio.');
  const blob = await res.blob();
  if (!blob.size || blob.size > 20_000_000) throw new Error('Unexpected report audio.');
  return blob;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'busy', 'no_answer']);
export const isTerminalCallState = (s: string) => TERMINAL.has(s);
export async function readPhoneCallProviderResult(callId:string):Promise<PhoneCallingProviderResult> {
  if(!UUID.test(callId))throw new Error('Invalid call.');
  const v=await request<unknown>(`${BASE}/calls/${encodeURIComponent(callId)}/result`,{method:'POST',body:'{}'});
  if(!obj(v)||!exactKeys(v,['callId','status','outcome','responses','conversation','verified','source'])||(v.conversation!==undefined&&!isPhoneCallEvidence(v.conversation))||v.callId!==callId||v.verified!==false||v.source!=='provider_api'
    ||!['available','pending','unavailable'].includes(String(v.status))||!Array.isArray(v.responses)||v.responses.length>12||!v.responses.every(s=>typeof s==='string'&&s.length<=1000)
    ||(v.outcome!==undefined&&!['completed','busy','no_answer','failed'].includes(String(v.outcome))))throw new Error('Unexpected provider result.');
  return v as unknown as PhoneCallingProviderResult;
}
export function phoneCallStartError(status: number): string {
  return status === 503 ? 'Real calling is not switched on yet. No call was made.'
    : status === 429 ? "Thaara's daily call limit has been reached. No call was made."
    : status === 403 ? 'This request can no longer be used (changed contact, consent or expired).'
    : 'The call outcome is unknown. Check call history before taking any further action.';
}
/** The same plain sentence the server speaks: quotes or outcome only, never an interpretation. */
export function callReportSentence(call: PhoneCallingRecord): string {
  const prefix = call.simulated ? 'This was a test simulation. ' : 'Provider report is unverified. ';
  const name = call.draft.recipient.displayName, quotes = call.report.quotedResponses;
  const rendered = /rendered in English by the call provider/.test(call.report.text);
  const sentence = (() => { switch (call.state) {
    case 'completed': return quotes.length ? `${name} said: ${quotes.map((q) => `"${q}"`).join(' ')}${rendered ? ' (English version from the call service)' : ''}` : `The call with ${name} ended, but no answer was recorded.`;
    case 'no_answer': return `${name} did not answer.`;
    case 'busy': return `${name}'s line was busy.`;
    case 'failed': return `The call to ${name} could not be completed.`;
    case 'cancelled': return `The call to ${name} was cancelled.`;
    default: return call.state === 'queued'
      ? call.dispatchStatus === 'unknown' || call.dispatchStatus === 'claimed'
        ? `The call outcome for ${name} is unknown. Check call history; do not retry automatically.`
        : `Waiting for the call to ${name} to be confirmed.`
      : `Calling ${name}…`;
  } })();
  return prefix + sentence;
}
