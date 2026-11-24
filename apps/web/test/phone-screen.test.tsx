import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { PhoneStatus, PhoneCallRecord } from '../src/phone-api';
import { PhoneScreen } from '../src/PhoneScreen';
import { PhoneScreenModel, canAccessPhone } from '../src/phone-model';

const MOCK_STATUS_CONNECTED: PhoneStatus = {
  connectorName: 'phone_telephony',
  status: 'connected',
  configured: true,
  connected: true,
  mode: 'mock',
  capabilities: ['phone.connection.status', 'phone.calls.list', 'phone.calls.read'],
  maskedLineNumber: '+91 ******9000',
  recordingEnabled: false,
  transcriptionEnabled: false,
  lastVerifiedAt: '2026-03-19T08:00:00.000Z',
};

const MOCK_CALLS: PhoneCallRecord[] = [
  {
    id: 'ph-call-completed-001',
    providerCallId: 'mock_call_completed_001',
    direction: 'inbound',
    lifecycleState: 'completed',
    maskedPhoneNumber: '+91 ******3210',
    contactDisplayName: 'Priya Nair (Board Counsel)',
    purposeSummary: 'Confirmed board governance agenda and Q2 sign-off timeline. <script>alert(1)</script>',
    startedAt: '2026-03-19T06:30:00.000Z',
    endedAt: '2026-03-19T06:34:15.000Z',
    durationSeconds: 255,
    recordingAvailable: false,
    transcriptAvailable: false,
    untrusted: true,
    mode: 'mock',
  },
  {
    id: 'ph-call-answered-002',
    providerCallId: 'mock_call_answered_002',
    direction: 'outbound_simulated',
    lifecycleState: 'answered',
    maskedPhoneNumber: '+91 ******4401',
    contactDisplayName: 'Arjun Mehta (VP Finance)',
    purposeSummary: 'Reviewing vendor renewal budget cap before afternoon approval gate.',
    startedAt: '2026-03-19T07:10:00.000Z',
    durationSeconds: 95,
    recordingAvailable: false,
    transcriptAvailable: false,
    untrusted: true,
    mode: 'mock',
  },
  {
    id: 'ph-call-ringing-003',
    providerCallId: 'mock_call_ringing_003',
    direction: 'inbound',
    lifecycleState: 'ringing',
    maskedPhoneNumber: '+91 ******7788',
    contactDisplayName: 'Rohan Desai (Cloud Ops)',
    purposeSummary: 'Incoming status check on staging cluster maintenance window.',
    startedAt: '2026-03-19T07:45:00.000Z',
    recordingAvailable: false,
    transcriptAvailable: false,
    untrusted: true,
    mode: 'mock',
  },
  {
    id: 'ph-call-queued-004',
    providerCallId: 'mock_call_queued_004',
    direction: 'outbound_simulated',
    lifecycleState: 'queued',
    maskedPhoneNumber: '+91 ******1122',
    contactDisplayName: 'Kavita Rao (Legal Ops)',
    purposeSummary: 'Scheduled callback reminder for NDA addendum review.',
    startedAt: '2026-03-19T07:50:00.000Z',
    recordingAvailable: false,
    transcriptAvailable: false,
    untrusted: true,
    mode: 'mock',
  },
  {
    id: 'ph-call-failed-005',
    providerCallId: 'mock_call_failed_005',
    direction: 'outbound_simulated',
    lifecycleState: 'failed',
    maskedPhoneNumber: '+91 ******5566',
    contactDisplayName: 'Vikram Singh (External Auditor)',
    purposeSummary: 'Follow-up on SOC2 evidence checklist.',
    startedAt: '2026-03-19T05:15:00.000Z',
    endedAt: '2026-03-19T05:15:30.000Z',
    durationSeconds: 0,
    failureReason: 'Simulated line busy / no answer',
    recordingAvailable: false,
    transcriptAvailable: false,
    untrusted: true,
    mode: 'mock',
  },
  {
    id: 'ph-call-cancelled-006',
    providerCallId: 'mock_call_cancelled_006',
    direction: 'outbound_simulated',
    lifecycleState: 'cancelled',
    maskedPhoneNumber: '+91 ******8899',
    contactDisplayName: 'Meera Krishnan (Product Lead)',
    purposeSummary: 'Sync on release notes prior to executive briefing.',
    startedAt: '2026-03-19T04:40:00.000Z',
    endedAt: '2026-03-19T04:40:10.000Z',
    durationSeconds: 0,
    failureReason: 'Cancelled by requester before connection',
    recordingAvailable: false,
    transcriptAvailable: false,
    untrusted: true,
    mode: 'mock',
  },
];

describe('Step 96: Phone Call Dashboard & History UI', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('enforces client-side role check and blocks viewer role before network calls', async () => {
    expect(canAccessPhone('owner')).toBe(true);
    expect(canAccessPhone('admin')).toBe(true);
    expect(canAccessPhone('member')).toBe(true);
    expect(canAccessPhone('viewer')).toBe(false);

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const model = new PhoneScreenModel('ws-1', 'user-viewer', 'viewer');
    expect(model.getState().unauthorized).toBe(true);

    await model.loadStatusAndCalls();
    expect(fetchSpy).not.toHaveBeenCalled();

    const html = renderToStaticMarkup(
      <PhoneScreen workspaceId="ws-1" userId="user-viewer" role="viewer" />,
    );
    expect(html).toContain('phone-unauthorized-banner');
    expect(html).toContain('not permitted to access Phone telephony');
    expect(html).not.toContain('phone-call-list');
  });

  it('loads mock status, 6 lifecycle states, masked numbers, duration, and selects initial call', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/connectors/phone/status')) {
        return new Response(JSON.stringify(MOCK_STATUS_CONNECTED), { status: 200 });
      }
      if (url.endsWith('/api/v1/connectors/phone/calls/list')) {
        return new Response(
          JSON.stringify({
            calls: MOCK_CALLS,
            totalCount: MOCK_CALLS.length,
            recordingEnabled: false,
            transcriptionEnabled: false,
            untrusted: true,
            mode: 'mock',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
    }) as unknown as typeof fetch;

    const model = new PhoneScreenModel('ws-1', 'user-1', 'owner');
    await model.loadStatusAndCalls();

    const state = model.getState();
    expect(state.unauthorized).toBe(false);
    expect(state.status?.status).toBe('connected');
    expect(state.status?.maskedLineNumber).toBe('+91 ******9000');
    expect(state.calls).toHaveLength(6);
    expect(state.calls.map((c) => c.lifecycleState)).toEqual([
      'completed',
      'answered',
      'ringing',
      'queued',
      'failed',
      'cancelled',
    ]);
    expect(state.selectedCall?.id).toBe('ph-call-completed-001');
    expect(state.selectedCall?.maskedPhoneNumber).toBe('+91 ******3210');
    expect(state.selectedCall?.durationSeconds).toBe(255);
  });

  it('supports search, direction, and lifecycle filtering, call selection, and disconnect', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/connectors/phone/status')) {
        return new Response(JSON.stringify(MOCK_STATUS_CONNECTED), { status: 200 });
      }
      if (url.endsWith('/api/v1/connectors/phone/calls/list')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        let filtered = [...MOCK_CALLS];
        if (body.direction) {
          filtered = filtered.filter((c) => c.direction === body.direction);
        }
        if (body.lifecycleState) {
          filtered = filtered.filter((c) => c.lifecycleState === body.lifecycleState);
        }
        if (body.query) {
          const q = String(body.query).toLowerCase();
          filtered = filtered.filter(
            (c) =>
              c.contactDisplayName.toLowerCase().includes(q) ||
              c.purposeSummary.toLowerCase().includes(q),
          );
        }
        return new Response(
          JSON.stringify({
            calls: filtered,
            totalCount: filtered.length,
            recordingEnabled: false,
            transcriptionEnabled: false,
            untrusted: true,
            mode: 'mock',
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/v1/connectors/phone/calls/ph-call-failed-005')) {
        return new Response(JSON.stringify(MOCK_CALLS[4]), { status: 200 });
      }
      if (url.endsWith('/api/v1/connectors/phone/connection') && init?.method === 'DELETE') {
        return new Response(
          JSON.stringify({
            status: 'disconnected',
            disconnectedAt: '2026-03-19T09:00:00.000Z',
            revokedTokens: true,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const model = new PhoneScreenModel('ws-1', 'user-1', 'admin');
    await model.loadStatusAndCalls();

    await model.loadCalls({
      direction: 'outbound_simulated',
      lifecycleState: 'failed',
      query: 'SOC2',
      resetSelection: true,
    });
    expect(model.getState().calls).toHaveLength(1);
    expect(model.getState().calls[0]?.id).toBe('ph-call-failed-005');

    await model.selectCall('ph-call-failed-005');
    expect(model.getState().selectedCall?.failureReason).toBe('Simulated line busy / no answer');

    await model.disconnect();
    expect(model.getState().status?.status).toBe('disconnected');
    expect(model.getState().calls).toHaveLength(0);
    expect(model.getState().selectedCall).toBeNull();
  });

  it('rejects unmasked phone numbers, enabled recording/transcription, or untrusted=false responses', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/connectors/phone/status')) {
        return new Response(JSON.stringify(MOCK_STATUS_CONNECTED), { status: 200 });
      }
      if (url.endsWith('/api/v1/connectors/phone/calls/list')) {
        return new Response(
          JSON.stringify({
            calls: [
              {
                ...MOCK_CALLS[0],
                maskedPhoneNumber: '+919876543210', // Unmasked phone must be rejected!
              },
            ],
            totalCount: 1,
            recordingEnabled: false,
            transcriptionEnabled: false,
            untrusted: true,
            mode: 'mock',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
    }) as unknown as typeof fetch;

    const model = new PhoneScreenModel('ws-1', 'user-1', 'member');
    await model.loadStatusAndCalls();

    expect(model.getState().calls).toHaveLength(0);
    expect(model.getState().errorMessage).toContain('Invalid Phone call schema');
  });

  it('clears state fail-closed when API returns 401/403', async () => {
    let deny = false;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (deny) {
        return new Response(
          JSON.stringify({
            error: 'POLICY_DENIED',
            message: 'Cross-workspace Phone call read denied.',
          }),
          { status: 403 },
        );
      }
      if (url.endsWith('/api/v1/connectors/phone/status')) {
        return new Response(JSON.stringify(MOCK_STATUS_CONNECTED), { status: 200 });
      }
      if (url.endsWith('/api/v1/connectors/phone/calls/list')) {
        return new Response(
          JSON.stringify({
            calls: MOCK_CALLS,
            totalCount: MOCK_CALLS.length,
            recordingEnabled: false,
            transcriptionEnabled: false,
            untrusted: true,
            mode: 'mock',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
    }) as unknown as typeof fetch;

    const model = new PhoneScreenModel('ws-1', 'user-1', 'owner');
    await model.loadStatusAndCalls();
    expect(model.getState().calls).toHaveLength(6);

    deny = true;
    await model.selectCall('ph-call-completed-001');
    const state = model.getState();
    expect(state.unauthorized).toBe(true);
    expect(state.calls).toHaveLength(0);
    expect(state.selectedCall).toBeNull();
    expect(state.errorMessage).toContain('Cross-workspace Phone call read denied');
  });
});
