import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pc from '../src/phone-calling';
import { PhoneCallingPanel } from '../src/PhoneCallingPanel';
import { PhoneScreen } from '../src/PhoneScreen';
import { PhoneCallChatCard } from '../src/PhoneCallChatCard';

const uuid = (n: number) => `${n}1111111-1111-4111-8111-111111111111`;
const draft = {
  draftId: 'draft-1', contactId: 'ram', contactRevision: 1, contactBindingHash: 'a'.repeat(64),
  recipient: { displayName: 'Ram', maskedPhone: '+91 ******0002' }, purpose: 'Can you attend tomorrow?', language: 'kn-en' as const,
  maxDurationSeconds: 120, aiDisclosure: 'Namaskara, naanu Thaara, AI assistant. Iga maatanaadalu anukoolave?', consentReference: 'synthetic-consent',
  idempotencyKey: 'idem-1', mode: 'simulation' as const,
};
const prepared = { draft, approvalId: uuid(1), planId: uuid(2), stepId: uuid(3), status: 'awaiting_approval' as const, liveCallingEnabled: false as const };
const report = { text: 'Simulation only; no real call was made. Call state: completed. Recipient\'s final words (untrusted quotes): "Yes".', spokenText: 'Simulation only; no real call was made.', quotedResponses: ['Yes'], evidenceIds: ['t1'], verified: false as const, simulated: true as const };
const record = { id: 'call-1', approvalId: uuid(1), draft, state: 'completed' as const, createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z', providerCallId: null, verified: false as const, simulated: true as const, report };
const status = (over: object = {}) => ({ status: 'not_configured', liveCallingEnabled: false, contactDirectoryConfigured: false, simulationEnabled: false, durableCallHistory: false, recordingEnabled: false, languages: ['en-IN', 'kn-IN', 'kn-en'], speechVerified: false, ...over });
const respond = (data: unknown, ok = true, statusCode = 200) => vi.fn(async () => ({ ok, status: statusCode, json: async () => data }));

describe('Chat calling report honesty and approval card', () => {
  it('shows a matching callback report panel only after a real call ends', () => {
    const real = { ...record, simulated: false, report: { ...report, simulated: false } };
    expect(renderToStaticMarkup(<PhoneCallChatCard approvalId={uuid(1)} initialState={{ call: real }} />)).toContain('data-testid="phone-callback-reports"');
    expect(renderToStaticMarkup(<PhoneCallChatCard approvalId={uuid(1)} initialState={{ call: { ...real, state: 'ringing' } }} />)).not.toContain('data-testid="phone-callback-reports"');
    expect(renderToStaticMarkup(<PhoneCallChatCard approvalId={uuid(1)} initialState={{ call: record }} />)).not.toContain('data-testid="phone-callback-reports"');
  });
  it('shows and accepts the five-minute bound live default but never substitutes an explicit duration', () => {
    const liveDraft={...draft,mode:'live' as const,providerBindingHash:'b'.repeat(64),maxDurationSeconds:300};
    const value={...prepared,draft:liveDraft,liveCallingEnabled:true};
    const asked={contactQuery:'Ram',purpose:draft.purpose,language:draft.language};
    expect(pc.isPhoneCallingPrepared(value,asked)).toBe(true);
    expect(pc.isPhoneCallingPrepared(value,{...asked,maxDurationSeconds:120})).toBe(false);
    const html=renderToStaticMarkup(<PhoneCallChatCard approvalId={uuid(1)} initialState={{request:{approvalId:uuid(1),status:'pending',expiresAt:'2026-10-31T00:00:00Z',draft:liveDraft}}} />);
    expect(html).toContain('Maximum length: 5 minutes');
  });
  it('binds authenticated provider results to the displayed call and rejects verified or foreign data', async () => {
    const callId=uuid(4), value={callId,status:'available',outcome:'completed',responses:['Tomorrow.'],verified:false,source:'provider_api'};
    vi.stubGlobal('fetch',respond(value));
    await expect(pc.readPhoneCallProviderResult(callId)).resolves.toEqual(value);
    for(const bad of [{...value,callId:uuid(5)},{...value,verified:true},{...value,responses:['x'.repeat(1001)]}]) {
      vi.stubGlobal('fetch',respond(bad));await expect(pc.readPhoneCallProviderResult(callId)).rejects.toThrow();
    }
  });
  it('accepts a bounded Sarvam interaction id without accepting URL or traversal inputs', () => {
    const live = { ...record, simulated: false, draft: { ...draft, mode: 'live' }, report: { ...report, simulated: false }, dispatchStatus: 'unverified' };
    expect(pc.isPhoneCallingRecord({ ...live, providerCallId: '20261030/int_ram' })).toBe(true);
    for (const id of ['20261030/../x', '20261030/a/b', 'https://evil.test/id']) expect(pc.isPhoneCallingRecord({ ...live, providerCallId: id })).toBe(false);
  });
  it('does not claim no call was made after an uncertain transport failure', () => {
    expect(pc.phoneCallStartError(0)).toContain('unknown');
    expect(pc.phoneCallStartError(500)).not.toContain('No call was made');
    const unknown = { ...record, simulated: false, state: 'queued' as const, dispatchStatus: 'unknown' as const };
    expect(pc.callReportSentence(unknown)).toContain('unknown');
    expect(pc.callReportSentence(unknown)).not.toContain('Calling Ram');
  });
  it('labels simulated and unverified reports in the sentence read to the owner', () => {
    expect(pc.callReportSentence(record)).toContain('test simulation');
    expect(pc.callReportSentence({ ...record, simulated: false, report: { ...report, simulated: false } })).toContain('unverified');
    expect(pc.callReportSentence({ ...record, state: 'failed' })).not.toContain('Ram said');
  });
  it('shows the exact recipient, purpose and disclosure before a live confirmation, with no simulation dial button', () => {
    const state = { loaded: true, request: { approvalId: uuid(1), status: 'pending' as const, expiresAt: '2026-10-30T00:00:00Z', draft } };
    const offline = renderToStaticMarkup(<PhoneCallChatCard approvalId={uuid(1)} initialState={state} />);
    expect(offline).not.toContain('data-testid="phone-call-now"');
    const html = renderToStaticMarkup(<PhoneCallChatCard approvalId={uuid(1)} initialState={{ ...state, request: { ...state.request, draft: { ...draft, mode: 'live' } } }} />);
    for (const value of ['Ram', '+91 ******0002', draft.purpose, draft.aiDisclosure, 'Call Ram now']) expect(html).toContain(value);
    expect(renderToStaticMarkup(<PhoneCallChatCard approvalId={uuid(1)} initialState={{ call: record }} />)).toContain('Play report');
  });
});

beforeEach(() => vi.stubGlobal('document', { cookie: 'thaara_csrf=synthetic-phone-csrf' }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Step 110 phone AI calling client (synthetic server responses only)', () => {
  it('loads truthful status and rejects any response claiming live calling, recording or verified speech', async () => {
    vi.stubGlobal('fetch', respond(status()));
    await expect(pc.loadPhoneCallingStatus()).resolves.toMatchObject({ status: 'not_configured', liveCallingEnabled: false });
    for (const bad of [status({ liveCallingEnabled: true }), status({ recordingEnabled: true }), status({ speechVerified: true }), status({ status: 'connected' }), status({ languages: ['fr-FR'] })]) {
      vi.stubGlobal('fetch', respond(bad));
      await expect(pc.loadPhoneCallingStatus()).rejects.toThrow(/No call was made/);
    }
  });

  it('prepares with CSRF and only the owner-chosen contact; rejects substituted contact, language, unmasked phone or live flags', async () => {
    const call = respond(prepared); vi.stubGlobal('fetch', call);
    const asked = { contactQuery: ' Ram ', selectedContactId: 'ram', purpose: ' Can you attend tomorrow? ', language: 'kn-en' as const };
    await expect(pc.preparePhoneCall(asked)).resolves.toEqual(prepared);
    const [url, init] = call.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/connectors/phone/ai/drafts');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('synthetic-phone-csrf');
    expect(JSON.parse(String(init.body))).toEqual({ contactQuery: 'Ram', selectedContactId: 'ram', purpose: 'Can you attend tomorrow?', language: 'kn-en' });
    const bads = [
      { ...prepared, draft: { ...draft, contactId: 'other' } },
      { ...prepared, draft: { ...draft, language: 'en-IN' } },
      { ...prepared, draft: { ...draft, recipient: { displayName: 'Ram', maskedPhone: '+919000000002' } } },
      { ...prepared, liveCallingEnabled: true },
      { ...prepared, status: 'approved' },
      { ...prepared, draft: { ...draft, mode: 'live' } },
      { ...prepared, phoneE164: '+919000000002' },
    ];
    for (const bad of bads) {
      vi.stubGlobal('fetch', respond(bad));
      await expect(pc.preparePhoneCall(asked)).rejects.toThrow();
    }
  });

  it('refuses empty input before any network request and surfaces server refusals', async () => {
    const call = respond(prepared); vi.stubGlobal('fetch', call);
    await expect(pc.preparePhoneCall({ contactQuery: ' ', purpose: 'x', language: 'en-IN' })).rejects.toThrow();
    await expect(pc.resolvePhoneCallingContact('  ')).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', respond({ error: { code: 'PHONE_CONTACTS_NOT_CONFIGURED', message: 'Phone contacts are not configured. No call was made.' } }, false, 503));
    await expect(pc.preparePhoneCall({ contactQuery: 'Ram', purpose: 'x', language: 'en-IN' })).rejects.toThrow(/not configured/);
  });

  it('validates contact resolution consistency and history records as simulated, unverified, without provider IDs', async () => {
    vi.stubGlobal('fetch', respond({ status: 'ambiguous', candidates: [{ id: 'a', displayName: 'Ram', maskedPhone: '+91 ******0001' }, { id: 'b', displayName: 'Ram', maskedPhone: '+91 ******0002' }] }));
    await expect(pc.resolvePhoneCallingContact('Ram')).resolves.toMatchObject({ status: 'ambiguous' });
    for (const bad of [{ status: 'matched', candidates: [] }, { status: 'matched', candidates: [{ id: 'a', displayName: 'Ram', maskedPhone: '+919000000001' }] }]) {
      vi.stubGlobal('fetch', respond(bad)); await expect(pc.resolvePhoneCallingContact('Ram')).rejects.toThrow();
    }
    vi.stubGlobal('fetch', respond({ calls: [record], durable: false, liveCallingEnabled: false }));
    await expect(pc.loadPhoneCallingHistory()).resolves.toMatchObject({ calls: [{ id: 'call-1' }] });
    vi.stubGlobal('fetch', respond({ calls: [record], durable: true, liveCallingEnabled: false }));
    await expect(pc.loadPhoneCallingHistory()).resolves.toMatchObject({ durable: true });
    // Bulk campaign outbound calls carry up to 10,000-char grounded briefs in draft.purpose and must load in Outbound Call History
    const bulkRecord = {
      ...record,
      id: 'call-bulk-10k',
      draft: {
        ...draft,
        purpose: ('CUSTOM TEAM WEAR CAMPAIGN BRIEF: ' + 'Product catalog, sizing, pricing, and lead notes. '.repeat(120)).slice(0, 9500)
      }
    };
    vi.stubGlobal('fetch', respond({ calls: [bulkRecord], durable: true, liveCallingEnabled: false }));
    await expect(pc.loadPhoneCallingHistory()).resolves.toMatchObject({ calls: [{ id: 'call-bulk-10k' }], durable: true });
    vi.stubGlobal('fetch', respond({ calls: [record], durable: 'yes', liveCallingEnabled: false }));
    await expect(pc.loadPhoneCallingHistory()).rejects.toThrow();
    for (const bad of [{ ...record, verified: true }, { ...record, providerCallId: 'real' }, { ...record, report: { ...report, simulated: false } }, { ...record, state: 'connected' }]) {
      vi.stubGlobal('fetch', respond({ calls: [bad], durable: false, liveCallingEnabled: false }));
      await expect(pc.loadPhoneCallingHistory()).rejects.toThrow();
    }
  });

  it('reads the same report aloud only when invoked, with truthful outcome when speech is unavailable', () => {
    const synth = { cancel: vi.fn(), speak: vi.fn() };
    class U { lang = ''; constructor(public text: string) {} }
    expect(pc.speakPhoneCallReport(record, synth, U)).toBe('speaking');
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    const spoken = synth.speak.mock.calls[0]![0] as U;
    expect(spoken.text).toBe(report.spokenText); expect(spoken.lang).toBe('en-IN');
    expect(pc.speakPhoneCallReport({ ...record, draft: { ...draft, language: 'kn-IN' } }, synth, U)).toBe('speaking');
    expect((synth.speak.mock.calls[1]![0] as U).lang).toBe('kn-IN');
    expect(pc.speakPhoneCallReport(record, undefined, U)).toBe('unavailable');
    expect(pc.speakPhoneCallReport({ ...record, report: { ...report, spokenText: ' ' } }, synth, U)).toBe('empty');
    expect(synth.speak).toHaveBeenCalledTimes(2);
  });
});

describe('Step 110 phone AI calling panel', () => {
  it('shows setup required without a call form or any dial/approve control when not configured', () => {
    const html = renderToStaticMarkup(<PhoneCallingPanel initialState={{ status: status() as pc.PhoneCallingStatus }} />);
    expect(html).toContain('Setup required');
    expect(html).toContain('Approving a request cannot dial a number');
    expect(html).toContain('No AI call reports yet');
    expect(html).not.toContain('data-testid="phone-ai-form"');
    expect(html).not.toMatch(/>\s*(Call now|Dial|Approve)\s*</i);
  });

  it('shows the exact recipient, purpose, language and AI introduction awaiting approval, with no auto-play', () => {
    const synth = { cancel: vi.fn(), speak: vi.fn() }; vi.stubGlobal('speechSynthesis', synth);
    const html = renderToStaticMarkup(<PhoneCallingPanel initialState={{ status: status({ status: 'simulation_only', contactDirectoryConfigured: true, simulationEnabled: true }) as pc.PhoneCallingStatus, prepared, calls: [record] }} />);
    expect(html).toContain('data-testid="phone-ai-form"');
    expect(html).toContain('Awaiting your approval');
    expect(html).toContain('Ram (+91 ******0002)');
    expect(html).toContain('Can you attend tomorrow?');
    expect(html).toContain('Kanglish');
    expect(html).toContain('AI assistant');
    expect(html).toContain('approving it will not place a call');
    expect(html).toContain('Simulation — not a real call');
    expect(html).toContain('Read report aloud');
    expect(html).not.toContain('+919000000002');
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('escapes untrusted report text and lists ambiguous contacts for an explicit choice', () => {
    const evil = { ...record, report: { ...report, text: '<img src=x onerror=alert(1)>' } };
    const html = renderToStaticMarkup(<PhoneCallingPanel initialState={{ status: status({ contactDirectoryConfigured: true }) as pc.PhoneCallingStatus, calls: [evil], candidates: [{ id: 'a', displayName: 'Ram', maskedPhone: '+91 ******0001' }, { id: 'b', displayName: 'Ram', maskedPhone: '+91 ******0002' }] }} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('Choose exactly one');
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain('phone-ai-prepare');
  });

  it('is mounted on the Phone screen for authorized users only', () => {
    const base = { workspaceId: 'w', userId: 'u', role: 'owner' };
    expect(renderToStaticMarkup(<PhoneScreen {...base} initialState={{}} aiCallingInitialState={{ status: status() as pc.PhoneCallingStatus }} />)).toContain('phone-ai-calling-panel');
    expect(renderToStaticMarkup(<PhoneScreen {...base} initialState={{ unauthorized: true }} aiCallingInitialState={{}} />)).not.toContain('phone-ai-calling-panel');
  });
});

describe('Step 110 live-mode display (synthetic responses only)', () => {
  const liveDraft = { ...draft, mode: 'live' as const };
  const liveReport = { ...report, text: 'Live call. Call state: ringing. No conversation outcome is recorded here.', spokenText: 'Live call.', quotedResponses: [], evidenceIds: [], simulated: false };
  const liveRecord = { ...record, draft: liveDraft, state: 'ringing' as const, simulated: false, providerCallId: 'cccccccc-3333-4333-8333-333333333333', dispatchStatus: 'unverified', report: liveReport };
  it('accepts live data only when every flag agrees', async () => {
    vi.stubGlobal('fetch', respond(status({ status: 'live_enabled', liveCallingEnabled: true })));
    await expect(pc.loadPhoneCallingStatus()).resolves.toMatchObject({ liveCallingEnabled: true });
    for (const bad of [status({ status: 'live_enabled', liveCallingEnabled: false }), status({ status: 'simulation_only', liveCallingEnabled: true })]) {
      vi.stubGlobal('fetch', respond(bad)); await expect(pc.loadPhoneCallingStatus()).rejects.toThrow();
    }
    vi.stubGlobal('fetch', respond({ ...prepared, draft: liveDraft, liveCallingEnabled: true }));
    await expect(pc.preparePhoneCall({ contactQuery: 'Ram', selectedContactId: 'ram', purpose: 'x', language: 'kn-en' })).resolves.toMatchObject({ draft: { mode: 'live' } });
    vi.stubGlobal('fetch', respond({ ...prepared, draft: liveDraft, liveCallingEnabled: false }));
    await expect(pc.preparePhoneCall({ contactQuery: 'Ram', selectedContactId: 'ram', purpose: 'x', language: 'kn-en' })).rejects.toThrow();
    vi.stubGlobal('fetch', respond({ calls: [liveRecord], durable: true, liveCallingEnabled: true }));
    await expect(pc.loadPhoneCallingHistory()).resolves.toMatchObject({ calls: [{ dispatchStatus: 'unverified' }] });
    for (const bad of [{ ...liveRecord, simulated: true }, { ...liveRecord, report: { ...liveReport, simulated: true } }, { ...liveRecord, dispatchStatus: undefined }, { ...liveRecord, providerCallId: 'bad id!' }, { ...record, providerCallId: 'cccccccc-3333-4333-8333-333333333333' }, { ...record, dispatchStatus: 'pending' }]) {
      vi.stubGlobal('fetch', respond({ calls: [bad], durable: true, liveCallingEnabled: true }));
      await expect(pc.loadPhoneCallingHistory()).rejects.toThrow();
    }
  });
  it('labels live calls and provider acknowledgements truthfully', () => {
    const html = renderToStaticMarkup(<PhoneCallingPanel initialState={{ status: status({ status: 'live_enabled', liveCallingEnabled: true, contactDirectoryConfigured: true }) as pc.PhoneCallingStatus, calls: [liveRecord as unknown as pc.PhoneCallingRecord] }} />);
    expect(html).toContain('LIVE calling is on');
    expect(html).toContain('LIVE call');
    expect(html).toContain('Provider accepted the request (not yet confirmed)');
    expect(html).not.toContain('Real calling is turned off');
    expect(pc.phoneDispatchLabel('unknown')).toContain('not retried');
  });
});

describe('Step 110 Start-call (synthetic responses only)', () => {
  const liveDraft = { ...draft, mode: 'live' as const };
  const livePrepared = { ...prepared, draft: liveDraft, liveCallingEnabled: true as const };
  const placed = { ...record, draft: liveDraft, state: 'queued' as const, simulated: false, providerCallId: null, dispatchStatus: 'unverified',
    report: { ...report, text: 'Live call. Call state: queued.', spokenText: 'Live call.', quotedResponses: [], evidenceIds: [], simulated: false } };
  it('sends one CSRF-protected start request for this approval and accepts only the matching live call', async () => {
    const call = respond(placed); vi.stubGlobal('fetch', call);
    await expect(pc.startPhoneCall(livePrepared)).resolves.toMatchObject({ id: 'call-1', dispatchStatus: 'unverified' });
    expect(call).toHaveBeenCalledTimes(1);
    const [url, init] = call.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/connectors/phone/ai/calls');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('synthetic-phone-csrf');
    expect(JSON.parse(String(init.body))).toEqual({ approvalId: prepared.approvalId });
    for (const bad of [{ ...placed, approvalId: uuid(9) }, { ...placed, draft: { ...liveDraft, draftId: 'other' } }, record]) {
      vi.stubGlobal('fetch', respond(bad)); await expect(pc.startPhoneCall(livePrepared)).rejects.toThrow();
    }
    const none = respond(placed); vi.stubGlobal('fetch', none);
    await expect(pc.startPhoneCall(prepared)).rejects.toThrow(/No call was made/);
    expect(none).not.toHaveBeenCalled();
  });
  it('shows Start only for live requests, asks to confirm, and hides it once started', () => {
    const s = status({ status: 'live_enabled', liveCallingEnabled: true, contactDirectoryConfigured: true }) as pc.PhoneCallingStatus;
    const sim = renderToStaticMarkup(<PhoneCallingPanel initialState={{ status: s, prepared }} />);
    expect(sim).not.toContain('phone-ai-start');
    const live = renderToStaticMarkup(<PhoneCallingPanel initialState={{ status: s, prepared: livePrepared }} />);
    expect(live).toContain('Start this call'); expect(live).toContain('Approve it in Approvals first');
    expect(renderToStaticMarkup(<PhoneCallingPanel initialState={{ status: s, prepared: livePrepared, confirmStart: prepared.approvalId }} />)).toContain('Confirm: call Ram now');
    expect(renderToStaticMarkup(<PhoneCallingPanel initialState={{ status: s, prepared: livePrepared, startedApprovalIds: [prepared.approvalId] }} />)).not.toContain('data-testid="phone-ai-start"');
  });
});

describe('Step 110 reloadable call requests (synthetic responses only)', () => {
  const liveDraft = { ...draft, mode: 'live' as const };
  const q = (over: object = {}) => ({ approvalId: uuid(1), status: 'approved', expiresAt: '2026-10-29T12:00:00.000Z', draft: liveDraft, ...over });
  it('loads only well-formed open requests', async () => {
    vi.stubGlobal('fetch', respond({ requests: [q(), q({ approvalId: uuid(2), status: 'pending', draft })] }));
    await expect(pc.loadPhoneCallingRequests()).resolves.toHaveLength(2);
    for (const bad of [{ requests: [q({ status: 'executed' })] }, { requests: [q({ approvalId: 'x' })] }, { requests: [{ ...q(), phoneE164: '+919000000002' }] }, { requests: [q()], extra: 1 }]) {
      vi.stubGlobal('fetch', respond(bad)); await expect(pc.loadPhoneCallingRequests()).rejects.toThrow();
    }
  });
  it('offers Start only for approved live requests, with per-request confirmation', () => {
    const s = status({ status: 'live_enabled', liveCallingEnabled: true, contactDirectoryConfigured: true }) as pc.PhoneCallingStatus;
    const requests = [q(), q({ approvalId: uuid(2), status: 'pending' }), q({ approvalId: uuid(3), draft })] as pc.PhoneCallingRequest[];
    const html = renderToStaticMarkup(<PhoneCallingPanel initialState={{ status: s, requests }} />);
    expect(html).toContain('Your call requests');
    expect(html.match(/data-testid="phone-ai-start"/g)).toHaveLength(1);
    expect(html).toContain('Awaiting your approval');
    expect(renderToStaticMarkup(<PhoneCallingPanel initialState={{ status: s, requests, confirmStart: uuid(1) }} />)).toContain('Confirm: call Ram now');
    expect(renderToStaticMarkup(<PhoneCallingPanel initialState={{ status: s, requests, startedApprovalIds: [uuid(1)] }} />)).not.toContain('data-testid="phone-ai-start"');
  });
});
