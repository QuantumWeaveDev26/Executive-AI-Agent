import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { buildApp } from '../src/app.js';
import {
  PhoneN8nSyncService,
  createInMemoryPhoneN8nSyncStore,
  derivePhoneN8nSyncToken
} from '../src/services/phone-n8n-sync.js';

const WORKSPACE_A = '75d2f889-d3eb-4acc-861a-fada4691ecce';
const OWNER_A = '4b4cbc9c-df01-4cc2-8565-8a23a3435b9d';
const MEMBER_A = '11111111-2222-4333-8444-555555555555';
const WORKSPACE_B = '99999999-8888-4777-8666-555555555555';
const OWNER_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ROUTE_ID = 'qw-callback-dd60ce8ff4e842df8d19ab50674810c2';
const SYNC_SECRET = 'test-webhook-secret-material-0123456789abcdef';
const VALID_SYNC_TOKEN = derivePhoneN8nSyncToken(SYNC_SECRET, WORKSPACE_A, OWNER_A);
const ACTIVATED_AT = '2026-11-17T10:00:00.000Z';

function makeMockDb(sessions: Record<string, { workspaceId: string; userId: string; role: string }>) {
  const auditEvents: Array<Record<string, unknown>> = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('resolve_session_scope')) {
        const hash = String(params?.[0] ?? '');
        const found = sessions[hash];
        if (!found) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              session_id: '00000000-0000-4000-8000-000000000001',
              workspace_id: found.workspaceId,
              user_id: found.userId,
              role: found.role,
              expires_at: new Date(Date.now() + 3600_000).toISOString()
            }
          ],
          rowCount: 1
        };
      }
      if (sql.includes('INSERT INTO audit_events') || sql.includes('INSERT INTO public.audit_events')) {
        auditEvents.push({ sql, params });
        return { rows: [{ id: '00000000-0000-4000-8000-000000000099', created_at: new Date().toISOString() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async withTransaction<T>(fn: (tx: unknown) => Promise<T>) {
      return fn(client);
    },
    async withScopedTransaction<T>(_scope: unknown, fn: (tx: unknown) => Promise<T>) {
      return fn(client);
    },
    async withWhatsAppRelayTransaction<T>(_token: string, _op: unknown, fn: (tx: unknown, scope: unknown) => Promise<T>) {
      throw new Error('Unused in phone n8n test');
    },
    async close() {}
  };
  return { db: client as never, auditEvents };
}

async function createTestHarness(options?: {
  existingCallbacks?: Parameters<typeof createInMemoryPhoneN8nSyncStore>[0] extends infer P
    ? P extends { existingCallbacks?: infer E }
      ? E
      : never
    : never;
  recordingResponder?: (url: string, headers: Headers) => Promise<Response>;
}) {
  const { createHash } = await import('node:crypto');
  const ownerToken = 'owner-session-token-workspace-a-0001';
  const memberToken = 'member-session-token-workspace-a-002';
  const otherOwnerToken = 'owner-session-token-workspace-b-0003';
  const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

  const { db, auditEvents } = makeMockDb({
    [hashToken(ownerToken)]: { workspaceId: WORKSPACE_A, userId: OWNER_A, role: 'owner' },
    [hashToken(memberToken)]: { workspaceId: WORKSPACE_A, userId: MEMBER_A, role: 'member' },
    [hashToken(otherOwnerToken)]: { workspaceId: WORKSPACE_B, userId: OWNER_B, role: 'owner' }
  });

  const store = createInMemoryPhoneN8nSyncStore({
    existingCallbacks: options?.existingCallbacks,
    now: () => Date.parse('2026-11-17T10:30:00.000Z')
  });

  const wavBytes = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00', 'binary');

  const syncService = new PhoneN8nSyncService({
    store,
    policyGateway: defaultPolicyGateway,
    auditDb: db,
    activatedAtIso: ACTIVATED_AT,
    now: () => Date.parse('2026-11-17T10:30:00.000Z'),
    async resolveMachinePrincipal() {
      return {
        workspaceId: WORKSPACE_A,
        ownerUserId: OWNER_A,
        expectedToken: VALID_SYNC_TOKEN,
        inboundRouteId: ROUTE_ID
      };
    },
    async resolveSarvamCredentials() {
      return {
        orgId: '01a10103-1b5d-78a1-9902-f391242c7537',
        workspaceId: '01a10103-1b66-7123-96b1-43a6e96e016b',
        appId: 'Thaara-AI-V-db336de4-5453',
        apiKey: 'sarvam-secret-key-never-expose'
      };
    },
    fetchImpl: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const headers = new Headers(init?.headers);
      if (options?.recordingResponder) {
        return options.recordingResponder(url, headers);
      }
      if (url.includes('/recordings/')) {
        return new Response(wavBytes, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' }
        });
      }
      return new Response(null, { status: 404 });
    }
  });

  const app = await buildApp({
    config: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: 0,
      DATABASE_URL: 'postgresql://localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef',
      CSRF_SECRET: 'test-csrf-secret-0123456789abcdef',
      CORS_ORIGIN: 'http://localhost:5173',
      COOKIE_SECURE: false,
      LOG_LEVEL: 'silent',
      RATE_LIMIT_MAX: 1000,
      RATE_LIMIT_TIME_WINDOW_MS: 60000
    } as never,
    db,
    policyGateway: defaultPolicyGateway,
    phoneN8nSync: syncService,
    whatsappAsyncAutoReply: false
  });

  const signOwnerCookie = (raw: string) => `thaara_session=${raw}`;

  return {
    app,
    auditEvents,
    wavBytes,
    ownerCookie: signOwnerCookie(ownerToken),
    memberCookie: signOwnerCookie(memberToken),
    otherWorkspaceCookie: signOwnerCookie(otherOwnerToken)
  };
}

describe('Thaara n8n Callback Email & Call History Integration (Tests A–I)', () => {
  it('Test A: validates both n8n workflow definitions, strict separation, zero leaked secrets, and machine auth', async () => {
    const candidateWf1 = [
      resolve(process.cwd(), 'deploy/n8n/thaara-callback-email-notifications.workflow.json'),
      resolve(process.cwd(), '../../deploy/n8n/thaara-callback-email-notifications.workflow.json'),
      resolve(__dirname, '../../../deploy/n8n/thaara-callback-email-notifications.workflow.json')
    ];
    const candidateWf2 = [
      resolve(process.cwd(), 'deploy/n8n/thaara-sarvam-call-history-sync.workflow.json'),
      resolve(process.cwd(), '../../deploy/n8n/thaara-sarvam-call-history-sync.workflow.json'),
      resolve(__dirname, '../../../deploy/n8n/thaara-sarvam-call-history-sync.workflow.json')
    ];
    const wf1Path = candidateWf1.find(p => existsSync(p)) || candidateWf1[0];
    const wf2Path = candidateWf2.find(p => existsSync(p)) || candidateWf2[0];
    const wf1Raw = readFileSync(wf1Path, 'utf8');
    const wf2Raw = readFileSync(wf2Path, 'utf8');
    const wf1 = JSON.parse(wf1Raw) as { name: string; nodes: Array<{ name: string; type: string; parameters?: Record<string, unknown> }> };
    const wf2 = JSON.parse(wf2Raw) as { name: string; nodes: Array<{ name: string; type: string; parameters?: Record<string, unknown> }> };

    expect(wf1.name).toBe('Thaara — Callback Email Notifications');
    expect(wf2.name).toBe('Thaara — Sarvam Call History Sync');

    // No Bulk Campaign mixing, no outbound call initiation, no hardcoded secrets
    for (const raw of [wf1Raw, wf2Raw]) {
      expect(raw.toLowerCase()).not.toContain('bulk-campaign');
      expect(raw.toLowerCase()).not.toContain('sk_');
      expect(raw).not.toMatch(/re_[a-zA-Z0-9]{16,}/);
      expect(raw).toContain('https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453/attempts');
    }
    expect(wf1.nodes.some(n => n.type === 'n8n-nodes-base.emailSend')).toBe(true);
    expect(wf2.nodes.some(n => n.type === 'n8n-nodes-base.emailSend')).toBe(false);
    // Workflow 2 must not download audio binaries into n8n
    expect(wf2Raw).not.toContain('/recordings/');

    const { app } = await createTestHarness();
    try {
      const missingAuth = await app.inject({
        method: 'GET',
        url: '/api/v1/connectors/phone/n8n/checkpoint'
      });
      expect(missingAuth.statusCode).toBe(401);

      const wrongAuth = await app.inject({
        method: 'GET',
        url: '/api/v1/connectors/phone/n8n/checkpoint',
        headers: { 'x-thaara-phone-sync-token': '0'.repeat(64) }
      });
      expect(wrongAuth.statusCode).toBe(403);

      const validCp = await app.inject({
        method: 'GET',
        url: '/api/v1/connectors/phone/n8n/checkpoint',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN }
      });
      expect(validCp.statusCode).toBe(200);
      expect(validCp.json()).toMatchObject({
        status: 'ready',
        backfillCompleted: false,
        overlapMinutes: 15,
        callbackCutoffDatetime: ACTIVATED_AT
      });
    } finally {
      await app.close();
    }
  });

  it('Tests B, C, D: syncs inbound & outbound calls, keeps directions strictly separate, strips legacy Manan placeholder, and preserves 90-turn complete transcripts', async () => {
    const { app, ownerCookie, memberCookie, otherWorkspaceCookie } = await createTestHarness();
    try {
      // Build a 90-turn complete conversation (>64 legacy cap)
      const longMessages = Array.from({ length: 90 }, (_, idx) => ({
        role: idx % 2 === 0 ? 'assistant' : 'user',
        content:
          idx === 0
            ? "Hello! I'm Thaara from Quantum Weave AI."
            : idx === 1
              ? "My name is Arjun Verma and I'm interested in an AI calling agent for real estate."
              : idx % 2 === 0
                ? `Thaara follow-up turn ${idx + 1}`
                : `Customer response turn ${idx + 1}`,
        language_name: 'en-IN'
      }));

      const syncRes = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/calls/sync',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: {
          calls: [
            {
              attemptId: 'att-inbound-answered-01',
              interactionId: '20261117/inb-01-aw123456',
              direction: 'inbound',
              connectivityStatus: 'connected',
              durationSeconds: 185,
              startDatetime: '2026-11-17T10:10:00Z',
              endDatetime: '2026-11-17T10:13:05Z',
              userContact: '+919876543210',
              recordingAvailable: true,
              appVersion: 24, // pre-v26 with template default "Manan"
              agentVariables: {
                user_name: 'Manan',
                business_name: 'Skyline Realty',
                service_needed: 'AI Voice Agent',
                call_purpose: 'Automated lead qualification for property enquiries',
                call_summary: 'Discussed AI calling agent for Skyline Realty property enquiries.'
              },
              messages: longMessages
            },
            {
              attemptId: 'att-inbound-missed-02',
              interactionId: null,
              direction: 'inbound',
              connectivityStatus: 'no_answer',
              durationSeconds: 0,
              attemptedAt: '2026-11-17T10:15:00Z',
              userContact: '+919876500099',
              recordingAvailable: false,
              appVersion: 26,
              messages: []
            },
            {
              attemptId: 'att-outbound-completed-01',
              interactionId: '20261117/out-01-aw654321',
              direction: 'outbound',
              connectivityStatus: 'connected',
              durationSeconds: 74,
              startDatetime: '2026-11-17T10:20:00Z',
              endDatetime: '2026-11-17T10:21:14Z',
              userContact: '+919811122233',
              recordingAvailable: true,
              appVersion: 6,
              agentVariables: {
                user_name: 'Priya Nair',
                business_name: 'Lotus Clinic',
                service_needed: 'Appointment Reminders',
                call_purpose: 'Confirm Thursday demo slot',
                call_summary: 'Priya confirmed Thursday 4 PM demo slot.'
              },
              messages: [
                { role: 'assistant', content: 'Hello Priya, I am Thaara calling from Quantum Weave AI regarding your Thursday demo.' },
                { role: 'user', content: 'Yes, Thursday at 4 PM works well for our clinic.' }
              ]
            },
            {
              attemptId: 'att-outbound-busy-02',
              interactionId: null,
              direction: 'outbound',
              connectivityStatus: 'busy',
              durationSeconds: 0,
              attemptedAt: '2026-11-17T10:22:00Z',
              userContact: '+919811122244',
              recordingAvailable: false,
              appVersion: 6,
              agentVariables: {
                user_name: 'Karan Mehta',
                call_purpose: 'Follow up on proposal'
              },
              messages: []
            }
          ],
          advanceCursorTo: '2026-11-17T10:25:00.000Z',
          markBackfillCompleted: true
        }
      });

      expect(syncRes.statusCode).toBe(200);
      expect(syncRes.json()).toMatchObject({
        status: 'synced',
        received: 4,
        created: 4,
        updated: 0,
        unchanged: 0,
        inboundCount: 2,
        outboundCount: 2
      });

      // Verify Inbound History (Test B & D)
      const inbList = await app.inject({
        method: 'GET',
        url: '/api/v1/connectors/phone/call-history/inbound',
        headers: { cookie: ownerCookie }
      });
      expect(inbList.statusCode).toBe(200);
      const inbBody = inbList.json();
      expect(inbBody.reports).toHaveLength(2);
      // Outbound calls never appear in Inbound
      expect(JSON.stringify(inbBody)).not.toContain('Priya Nair');
      expect(JSON.stringify(inbBody)).not.toContain('2233');
      // Legacy "Manan" stripped and replaced with caller-stated "Arjun Verma"
      const answeredSummary = inbBody.reports.find((r: { maskedPhone: string }) => r.maskedPhone === '•••• 3210');
      expect(answeredSummary.customerName).toBe('Arjun Verma');
      expect(answeredSummary.durationSeconds).toBe(185);
      expect(answeredSummary.recordingAvailable).toBe(true);

      const inbDetail = await app.inject({
        method: 'GET',
        url: `/api/v1/connectors/phone/call-history/inbound/${answeredSummary.id}`,
        headers: { cookie: ownerCookie }
      });
      expect(inbDetail.statusCode).toBe(200);
      const detailReport = inbDetail.json().report;
      expect(detailReport.callerPhone).toBe('+919876543210');
      expect(detailReport.business).toBe('Skyline Realty');
      expect(detailReport.serviceNeeded).toBe('AI Voice Agent');
      expect(detailReport.transcript).toHaveLength(90);
      expect(detailReport.transcript[0]).toMatchObject({
        speaker: 'agent',
        text: "Hello! I'm Thaara from Quantum Weave AI."
      });
      expect(detailReport.transcript[89]).toMatchObject({
        speaker: 'caller',
        text: 'Customer response turn 90'
      });

      // Verify Outbound History (Test C)
      const outList = await app.inject({
        method: 'GET',
        url: '/api/v1/connectors/phone/ai/calls',
        headers: { cookie: ownerCookie }
      });
      expect(outList.statusCode).toBe(200);
      const outBody = outList.json();
      expect(outBody.calls).toHaveLength(2);
      // Inbound calls never appear in Outbound
      expect(JSON.stringify(outBody)).not.toContain('Arjun Verma');
      expect(JSON.stringify(outBody)).not.toContain('3210');

      const priyaCall = outBody.calls.find((c: { draft: { recipient: { displayName: string } } }) =>
        c.draft.recipient.displayName === 'Priya Nair'
      );
      expect(priyaCall.state).toBe('completed');
      expect(priyaCall.syncedDetails).toMatchObject({
        recordingAvailable: true,
        durationSeconds: 74,
        business: 'Lotus Clinic',
        serviceNeeded: 'Appointment Reminders',
        outcomeLabel: 'Completed'
      });
      expect(priyaCall.syncedDetails.transcript).toHaveLength(2);

      const busyCall = outBody.calls.find((c: { draft: { recipient: { displayName: string } } }) =>
        c.draft.recipient.displayName === 'Karan Mehta'
      );
      expect(busyCall.state).toBe('busy');
      expect(busyCall.syncedDetails.recordingAvailable).toBe(false);

      // Non-owner and cross-workspace isolation
      const memberRes = await app.inject({
        method: 'GET',
        url: '/api/v1/connectors/phone/call-history/inbound',
        headers: { cookie: memberCookie }
      });
      expect(memberRes.statusCode).toBe(403);

      const otherWsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/connectors/phone/call-history/inbound',
        headers: { cookie: otherWorkspaceCookie }
      });
      expect(otherWsRes.statusCode).toBe(200);
      expect(otherWsRes.json().reports).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('Test E: streams authorized WAV recordings without exposing Sarvam keys and returns 404 when unavailable', async () => {
    let upstreamCalledWithKey: string | null = null;
    const sampleWav = Buffer.from('RIFF\x28\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x04\x00\x00\x00\x00\x00\x00\x00', 'binary');
    const { app, ownerCookie, memberCookie, otherWorkspaceCookie, auditEvents } = await createTestHarness({
      recordingResponder: async (url, headers) => {
        upstreamCalledWithKey = headers.get('x-api-key');
        if (url.includes(encodeURIComponent('20261117/rec-available-01'))) {
          return new Response(sampleWav, { status: 200, headers: { 'Content-Type': 'audio/wav' } });
        }
        return new Response(null, { status: 404 });
      }
    });

    try {
      await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/calls/sync',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: {
          calls: [
            {
              attemptId: 'att-rec-yes',
              interactionId: '20261117/rec-available-01',
              direction: 'inbound',
              connectivityStatus: 'connected',
              durationSeconds: 40,
              endDatetime: '2026-11-17T10:18:00Z',
              userContact: '+919900112233',
              recordingAvailable: true,
              appVersion: 26,
              messages: [{ role: 'assistant', content: 'Hello!' }]
            },
            {
              attemptId: 'att-rec-no',
              interactionId: null,
              direction: 'inbound',
              connectivityStatus: 'no_answer',
              attemptedAt: '2026-11-17T10:19:00Z',
              userContact: '+919900112244',
              recordingAvailable: false,
              appVersion: 26,
              messages: []
            }
          ]
        }
      });

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/connectors/phone/call-history/inbound',
        headers: { cookie: ownerCookie }
      });
      const reports = listRes.json().reports as Array<{ id: string; recordingAvailable: boolean }>;
      const withRec = reports.find(r => r.recordingAvailable)!;
      const withoutRec = reports.find(r => !r.recordingAvailable)!;

      // Authorized owner playback
      const playRes = await app.inject({
        method: 'GET',
        url: `/api/v1/connectors/phone/recordings/inbound/${withRec.id}`,
        headers: { cookie: ownerCookie }
      });
      expect(playRes.statusCode).toBe(200);
      expect(playRes.headers['content-type']).toContain('audio/wav');
      expect(playRes.headers['cache-control']).toBe('private, no-store');
      expect(playRes.rawPayload.equals(sampleWav)).toBe(true);
      expect(upstreamCalledWithKey).toBe('sarvam-secret-key-never-expose');
      expect(JSON.stringify(playRes.headers)).not.toContain('sarvam-secret-key-never-expose');
      expect(auditEvents.length).toBeGreaterThanOrEqual(1);

      // Unavailable recording returns truthful 404
      const missingRes = await app.inject({
        method: 'GET',
        url: `/api/v1/connectors/phone/recordings/inbound/${withoutRec.id}`,
        headers: { cookie: ownerCookie }
      });
      expect(missingRes.statusCode).toBe(404);

      // Member & cross-tenant blocked
      const memberPlay = await app.inject({
        method: 'GET',
        url: `/api/v1/connectors/phone/recordings/inbound/${withRec.id}`,
        headers: { cookie: memberCookie }
      });
      expect(memberPlay.statusCode).toBe(403);

      const crossWsPlay = await app.inject({
        method: 'GET',
        url: `/api/v1/connectors/phone/recordings/inbound/${withRec.id}`,
        headers: { cookie: otherWorkspaceCookie }
      });
      expect(crossWsPlay.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('Tests F, G, H, I: verifies confirmed vs declined/withdrawn/ambiguous callbacks, email payload formatting, duplicate prevention with Phone115 worker overlap, and retry recovery', async () => {
    const { createHash } = await import('node:crypto');
    const alreadySentInteraction = '20261117/worker-sent-01';
    const alreadySentCallId = createHash('sha256').update(`${ROUTE_ID}\n${alreadySentInteraction}`).digest('hex');

    const { app, ownerCookie } = await createTestHarness({
      existingCallbacks: [
        {
          requestId: 'a'.repeat(64),
          callId: alreadySentCallId,
          requestStatus: 'requested',
          notificationStatus: 'submitted',
          providerMessageId: 'resend_msg_12345',
          name: 'Already Notified User',
          business: 'Retail',
          service: 'Voice AI',
          phoneNumber: '+919888777666',
          discussionDetails: 'Already sent by Step 115 worker'
        }
      ]
    });

    try {
      // 1. Confirmed callback (post-activation) -> sendAllowed: true + exact formatted email payload (Tests F & G)
      const confirmedPayload = {
        call: {
          attemptId: 'att-cb-confirmed-01',
          interactionId: '20261117/cb-confirmed-01',
          direction: 'inbound' as const,
          connectivityStatus: 'connected' as const,
          durationSeconds: 112,
          startDatetime: '2026-11-17T10:20:00Z',
          endDatetime: '2026-11-17T10:21:52Z',
          userContact: '+919845012345',
          recordingAvailable: true,
          appVersion: 26,
          agentVariables: {
            user_name: 'Krishna',
            business_name: 'Real Estate',
            service_needed: 'AI Voice Agent',
            call_purpose: 'Wants an AI assistant to manage customer enquiries.',
            preferred_callback_time: 'Tomorrow at 11 AM',
            call_summary: 'Krishna requested a callback tomorrow at 11 AM regarding an AI Voice Agent for Real Estate.'
          },
          messages: [
            { role: 'assistant', content: "Hello! I'm Thaara from Quantum Weave AI." },
            { role: 'user', content: 'Hi, I am Krishna from Real Estate. I want an AI Voice Agent to manage customer enquiries. Please call me back tomorrow at 11 AM.' },
            { role: 'assistant', content: 'Let me confirm your details: Krishna from Real Estate, interested in an AI Voice Agent, callback tomorrow at 11 AM on +919845012345. Shall I go ahead and book this callback request for you?' },
            { role: 'user', content: 'Yes, please go ahead and book it.' }
          ]
        }
      };

      const claim1 = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/callbacks/evaluate-and-claim',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: confirmedPayload
      });
      expect(claim1.statusCode).toBe(200);
      const claim1Body = claim1.json();
      expect(claim1Body.sendAllowed).toBe(true);
      expect(claim1Body.eligibility).toBe('confirmed');
      expect(claim1Body.email).toMatchObject({
        fromEmail: 'Thaara AI Notifications <team.quantumweaveai@gmail.com>',
        toEmail: 'connect@brandmintai.io',
        subject: 'New Callback Request — Thaara AI',
        fields: {
          customerName: 'Krishna',
          phoneNumber: '+919845012345',
          businessName: 'Real Estate',
          requiredService: 'AI Voice Agent',
          customerRequirement: 'Wants an AI assistant to manage customer enquiries.',
          preferredCallbackTime: 'Tomorrow at 11 AM',
          callId: '20261117/cb-confirmed-01',
          callbackStatus: 'Confirmed',
          callStatus: 'Completed'
        }
      });
      expect(claim1Body.email.textBody).toContain('Customer: Krishna');
      expect(claim1Body.email.textBody).toContain('Preferred Callback: Tomorrow at 11 AM');

      // Concurrent duplicate run while claim is active -> blocked (Test H)
      const duplicateWhileClaimed = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/callbacks/evaluate-and-claim',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: confirmedPayload
      });
      expect(duplicateWhileClaimed.json()).toMatchObject({
        sendAllowed: false,
        eligibility: 'already_claimed'
      });

      // Simulate transient SMTP failure -> release claim as 'pending', then succeed on retry (Test I)
      const retryRelease = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/callbacks/receipt',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: {
          callId: claim1Body.callId,
          claimAttemptId: claim1Body.claimAttemptId,
          outcome: 'pending',
          errorSummary: 'Temporary SMTP timeout'
        }
      });
      expect(retryRelease.statusCode).toBe(200);
      expect(retryRelease.json().status).toBe('pending');

      // Retry claim succeeds
      const claimRetry = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/callbacks/evaluate-and-claim',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: confirmedPayload
      });
      expect(claimRetry.json().sendAllowed).toBe(true);

      // Record final delivery receipt with angle-bracketed SMTP Message-ID
      const receiptOk = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/callbacks/receipt',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: {
          callId: claimRetry.json().callId,
          claimAttemptId: claimRetry.json().claimAttemptId,
          outcome: 'submitted',
          providerMessageId: '<smtp-msg-998877@brandmintai.io>'
        }
      });
      expect(receiptOk.statusCode).toBe(200);
      expect(receiptOk.json()).toMatchObject({
        recorded: true,
        status: 'submitted',
        sanitizedProviderMessageId: 'smtp-msg-998877_brandmintai_io'
      });

      // Subsequent rerun after delivery -> permanently deduplicated (`already_sent`, Test H)
      const afterSent = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/callbacks/evaluate-and-claim',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: confirmedPayload
      });
      expect(afterSent.json()).toMatchObject({
        sendAllowed: false,
        eligibility: 'already_sent'
      });

      // Overlap with Step 115 worker (`alreadySentInteraction`) -> blocked (`already_sent`, Test H)
      const workerOverlap = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/callbacks/evaluate-and-claim',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: {
          call: {
            ...confirmedPayload.call,
            attemptId: 'att-worker-overlap',
            interactionId: alreadySentInteraction,
            userContact: '+919888777666'
          }
        }
      });
      expect(workerOverlap.json()).toMatchObject({
        sendAllowed: false,
        eligibility: 'already_sent'
      });

      // 2. Declined / withdrawn callback -> never emailed (Test F)
      const declinedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/callbacks/evaluate-and-claim',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: {
          call: {
            ...confirmedPayload.call,
            attemptId: 'att-declined-02',
            interactionId: '20261117/cb-declined-02',
            messages: [
              { role: 'assistant', content: 'Shall I go ahead and book a callback request for you?' },
              { role: 'user', content: 'No, do not call me back. Cancel the callback.' }
            ]
          }
        }
      });
      expect(declinedRes.json()).toMatchObject({
        sendAllowed: false,
        eligibility: 'declined'
      });

      // 3. Ambiguous / unconfirmed callback -> marked needs_review in Dashboard, never emailed (Test F)
      const ambiguousRes = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/callbacks/evaluate-and-claim',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: {
          call: {
            ...confirmedPayload.call,
            attemptId: 'att-ambiguous-03',
            interactionId: '20261117/cb-ambiguous-03',
            messages: [
              { role: 'user', content: 'Maybe someone can call me back later, let me check my schedule.' },
              { role: 'assistant', content: 'Shall I save your callback details so our team can reach out?' }
              // Call ended before caller confirmed!
            ]
          }
        }
      });
      expect(ambiguousRes.json()).toMatchObject({
        sendAllowed: false,
        eligibility: 'needs_review'
      });

      // Verify ambiguous call is visible as needs_review in Inbound Dashboard
      const listCheck = await app.inject({
        method: 'GET',
        url: '/api/v1/connectors/phone/call-history/inbound',
        headers: { cookie: ownerCookie }
      });
      const ambiguousRow = listCheck.json().reports.find((r: { id: string }) => r.id === ambiguousRes.json().callId);
      expect(ambiguousRow.outcome).toBe('needs_review');

      // 4. Late transcript enrichment (Test I): first sync empty transcript, second sync full transcript -> updates in place without duplicates
      const beforeCount = listCheck.json().reports.length;
      const late1 = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/calls/sync',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: {
          calls: [
            {
              attemptId: 'att-late-tx',
              interactionId: '20261117/late-tx-01',
              direction: 'inbound',
              connectivityStatus: 'connected',
              durationSeconds: 30,
              endDatetime: '2026-11-17T10:28:00Z',
              userContact: '+919700011122',
              recordingAvailable: false,
              appVersion: 26,
              messages: []
            }
          ]
        }
      });
      expect(late1.json().created).toBe(1);

      const late2 = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/calls/sync',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: {
          calls: [
            {
              attemptId: 'att-late-tx',
              interactionId: '20261117/late-tx-01',
              direction: 'inbound',
              connectivityStatus: 'connected',
              durationSeconds: 30,
              endDatetime: '2026-11-17T10:28:00Z',
              userContact: '+919700011122',
              recordingAvailable: true,
              appVersion: 26,
              messages: [
                { role: 'assistant', content: 'Welcome to Quantum Weave AI.' },
                { role: 'user', content: 'Just checking your working hours, thank you!' }
              ]
            }
          ]
        }
      });
      expect(late2.json()).toMatchObject({ created: 0, updated: 1 });

      const afterList = await app.inject({
        method: 'GET',
        url: '/api/v1/connectors/phone/call-history/inbound',
        headers: { cookie: ownerCookie }
      });
      expect(afterList.json().reports.length).toBe(beforeCount + 1);
    } finally {
      await app.close();
    }
  });

  it('accepts outbound bulk-campaign calls whose agentVariables.call_purpose exceeds 1,000 characters (up to 12,000)', async () => {
    const { app } = await createTestHarness();
    try {
      const longCallPurpose =
        'CUSTOM TEAM WEAR CAMPAIGN BRIEF: ' + 'Product catalog, sizing chart, pricing tiers, and lead sheet notes. '.repeat(145);
      expect(longCallPurpose.length).toBeGreaterThan(8000);
      expect(longCallPurpose.length).toBeLessThan(12000);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/n8n/calls/sync',
        headers: { 'x-thaara-phone-sync-token': VALID_SYNC_TOKEN },
        payload: {
          calls: [
            {
              attemptId: 'att-long-purpose-10k',
              interactionId: '20261126/long-purpose-01',
              direction: 'outbound',
              connectivityStatus: 'connected',
              durationSeconds: 45,
              endDatetime: '2026-11-26T08:00:00Z',
              userContact: '+919700011122',
              recordingAvailable: true,
              appVersion: 34,
              agentVariables: {
                user_name: 'krishna',
                call_purpose: longCallPurpose
              },
              messages: [
                { role: 'assistant', content: 'Hello krishna, I am Thaara from Custom Team Wear.' },
                { role: 'user', content: 'Yes, tell me about custom jerseys.' }
              ]
            }
          ]
        }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'synced', received: 1, created: 1, outboundCount: 1 });
    } finally {
      await app.close();
    }
  });
});
