import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MembershipRepository,
  Migrator,
  PGliteDatabase,
  SessionRepository,
  UserRepository,
  WorkspaceRepository,
  generateSessionToken,
  hashSessionToken
} from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { Logger } from '@thaara/observability';
import { validateN8nWorkflowBlueprint } from '@thaara/policy';
import { buildApp } from '../src/app.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';
import {
  detectPhoneBriefingChatRequest,
  executeChatPhoneBriefingPlan
} from '../src/services/chat-automation-orchestrator.js';
import {
  PhoneProvider,
  PhoneRawCallRecord,
  PhoneVault,
  createMockPhoneProvider
} from '../src/services/phone.js';

describe('Step 97 — Phone Briefing & Offline n8n Automation', () => {
  let db: PGliteDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let ownerA: any;
  let memberSameWs: any;
  let otherWsUser: any;
  let viewer: any;

  const records = new Map<string, string>();
  const csrf = generateCsrfToken();
  const logger = new Logger('error');
  const webhookSecret = 'test-phone-webhook-hmac-secret-key-step-97';
  const connectPayload = {
    lineId: 'line_exec_97',
    accountId: 'acct_exec_97'
  };

  const PRIVATE_CALL_DETAIL_SECRET = 'CONFIDENTIAL_BRIDGE_FINANCING_TERM_SHEET_880M';
  const RAW_PHONE_A = '+919876543210';
  const RAW_PHONE_B = '+14155550199';
  const RAW_PHONE_C = '+919820112233';

  const syntheticCalls: PhoneRawCallRecord[] = [
    {
      id: 'phcall_board_001',
      direction: 'inbound',
      lifecycleState: 'completed',
      participantPhone: RAW_PHONE_A,
      participantDisplayName: 'Ananya Rao (Board Chair)',
      purposeSummary: `<script>evil()</script> Urgent: Please confirm ${PRIVATE_CALL_DETAIL_SECRET} before 11 AM board call.`,
      startedAt: '2026-10-19T09:15:00.000Z',
      endedAt: '2026-10-19T09:22:00.000Z',
      durationSeconds: 420,
      consentVerified: true,
      approvalId: null,
      receiptStatus: 'verified_mock'
    },
    {
      id: 'phcall_advisory_002',
      direction: 'outbound_simulated',
      lifecycleState: 'failed',
      participantPhone: RAW_PHONE_B,
      participantDisplayName: 'External Advisory Desk',
      purposeSummary: 'Simulated line busy failure during schedule confirmation.',
      startedAt: '2026-10-19T08:30:00.000Z',
      endedAt: '2026-10-19T08:30:30.000Z',
      durationSeconds: 0,
      consentVerified: true,
      approvalId: 'appr_synth_002',
      receiptStatus: 'failed'
    },
    {
      id: 'phcall_investor_003',
      direction: 'outbound_simulated',
      lifecycleState: 'cancelled',
      participantPhone: RAW_PHONE_C,
      participantDisplayName: 'Investor Relations Lead',
      purposeSummary: 'Simulated call cancelled prior to connection.',
      startedAt: '2026-10-19T07:45:00.000Z',
      endedAt: '2026-10-19T07:45:10.000Z',
      durationSeconds: 0,
      consentVerified: true,
      approvalId: 'appr_synth_003',
      receiptStatus: 'cancelled'
    }
  ];

  const baseProvider = createMockPhoneProvider(syntheticCalls);
  const provider: PhoneProvider = {
    mode: 'mock',
    verifyConnection: vi.fn((input) => baseProvider.verifyConnection(input)),
    listCalls: vi.fn((input) => baseProvider.listCalls(input)),
    readCall: vi.fn((input) => baseProvider.readCall(input))
  };

  const vault = new PhoneVault(randomBytes(32), {
    get: (k) => records.get(k),
    set: (k, v) => {
      records.set(k, v);
    },
    delete: (k) => {
      records.delete(k);
    }
  });

  function headers(identity = ownerA) {
    return {
      cookie: `thaara_session=${identity.token}; thaara_csrf=${csrf}`,
      'x-csrf-token': csrf
    };
  }

  async function connectPhone(identity = ownerA) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/phone/connect',
      headers: headers(identity),
      payload: connectPayload
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('connected');
  }

  beforeAll(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    async function createIdentity(
      name: string,
      role: 'owner' | 'member' | 'viewer' = 'member',
      existingWorkspaceId?: string
    ) {
      const workspaceId =
        existingWorkspaceId ?? (await new WorkspaceRepository(db).create(name)).id;
      const user = await new UserRepository(db).create(
        `${name}@example.test`,
        'unused-hash',
        name
      );
      const token = generateSessionToken();
      const scope = {
        workspaceId,
        userId: user.id,
        role,
        sessionTokenHash: hashSessionToken(token)
      };
      await db.withScopedTransaction(scope, async (tx) => {
        await new MembershipRepository(tx).create(workspaceId, user.id, role);
        await new SessionRepository(tx).create(user.id, workspaceId, token);
      });
      return { ...scope, token };
    }

    ownerA = await createIdentity('phone-briefing-owner-a', 'owner');
    memberSameWs = await createIdentity('phone-briefing-member-b', 'member', ownerA.workspaceId);
    otherWsUser = await createIdentity('phone-briefing-other-ws', 'owner');
    viewer = await createIdentity('phone-briefing-viewer', 'viewer', ownerA.workspaceId);
    await db.exec('SET ROLE thaara_app;');

    app = await buildApp({
      db,
      config: loadConfig({ NODE_ENV: 'test' }),
      phone: {
        provider,
        vault,
        webhookSecret
      },
      logger
    });
    await app.ready();
  });

  beforeEach(() => {
    records.clear();
    vi.mocked(provider.verifyConnection)
      .mockReset()
      .mockImplementation((input) => baseProvider.verifyConnection(input));
    vi.mocked(provider.listCalls)
      .mockReset()
      .mockImplementation((input) => baseProvider.listCalls(input));
    vi.mocked(provider.readCall)
      .mockReset()
      .mockImplementation((input) => baseProvider.readCall(input));
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  it('generates Phone call briefings with incoming/outgoing breakdown, missed/failed calls, follow-up items, masked phone numbers, and an inactive n8n blueprint free of raw phone numbers or private call details', async () => {
    await connectPhone(ownerA);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/phone/briefing',
      headers: headers(ownerA),
      payload: {
        limit: 20,
        workflowName: 'Morning Executive Phone Call Briefing'
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toMatchObject({
      totalCalls: 3,
      inboundCount: 1,
      outboundSimulatedCount: 2,
      missedOrFailedCount: 2,
      followUpCount: 3,
      headline:
        '3 phone calls (1 incoming, 2 outgoing simulated, 2 missed/failed, 3 follow-up items).',
      recordingEnabled: false,
      transcriptionEnabled: false,
      untrusted: true,
      mode: 'mock'
    });

    expect(body.recentCalls).toHaveLength(3);
    expect(body.recentCalls[0]).toMatchObject({
      callId: 'phcall_board_001',
      direction: 'inbound',
      lifecycleState: 'completed',
      participant: {
        displayName: 'Ananya Rao (Board Chair)',
        maskedPhone: '+91 ******3210'
      },
      durationSeconds: 420,
      needsFollowUp: true,
      untrusted: true
    });

    expect(body.missedOrFailedCalls).toHaveLength(2);
    expect(body.missedOrFailedCalls.map((c: any) => c.callId)).toEqual([
      'phcall_advisory_002',
      'phcall_investor_003'
    ]);

    expect(body.followUpItems).toHaveLength(3);
    expect(body.followUpItems[0]).toMatchObject({
      callId: 'phcall_board_001',
      reason: 'follow_up_action_noted',
      untrusted: true
    });
    expect(body.followUpItems[1]).toMatchObject({
      callId: 'phcall_advisory_002',
      reason: 'failed_call_retry_or_review',
      untrusted: true
    });
    expect(body.followUpItems[2]).toMatchObject({
      callId: 'phcall_investor_003',
      reason: 'cancelled_call_reschedule_check',
      untrusted: true
    });

    // Raw phone numbers and untrusted HTML/script tags must never leak
    expect(res.body).not.toContain(RAW_PHONE_A);
    expect(res.body).not.toContain(RAW_PHONE_B);
    expect(res.body).not.toContain(RAW_PHONE_C);
    expect(res.body).not.toContain('<script>');
    expect(res.body).not.toContain('evil()');

    // Verify offline n8n blueprint validity, active: false, and zero raw private call details embedded
    expect(body.n8nBlueprint).toBeDefined();
    expect(body.n8nBlueprint.active).toBe(false);
    expect(body.n8nBlueprint.meta.externallyVerifiedWithLiveN8n).toBe(false);
    expect(validateN8nWorkflowBlueprint(body.n8nBlueprint)).toMatchObject({
      valid: true,
      offlineSchemaValid: true,
      graphIntegrityValid: true
    });
    expect(body.n8nContext).toMatchObject({
      connector: 'phone_telephony',
      operation: 'read_call_history_briefing_metadata',
      readOnly: true,
      active: false,
      recordingEnabled: false,
      transcriptionEnabled: false,
      callIds: ['phcall_board_001', 'phcall_advisory_002', 'phcall_investor_003'],
      missedOrFailedCallIds: ['phcall_advisory_002', 'phcall_investor_003'],
      followUpCallIds: ['phcall_board_001', 'phcall_advisory_002', 'phcall_investor_003'],
      totalCalls: 3,
      inboundCount: 1,
      outboundSimulatedCount: 2,
      missedOrFailedCount: 2
    });

    const serializedBlueprint = JSON.stringify(body.n8nBlueprint);
    expect(serializedBlueprint).not.toContain(PRIVATE_CALL_DETAIL_SECRET);
    expect(serializedBlueprint).not.toContain(RAW_PHONE_A);
    expect(serializedBlueprint).not.toContain(RAW_PHONE_B);
    expect(serializedBlueprint).not.toContain(RAW_PHONE_C);
    expect(serializedBlueprint).not.toContain('Ananya Rao');
    expect(serializedBlueprint).not.toContain('External Advisory Desk');
    expect(body.workflowHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('enforces CSRF, viewer PolicyGateway denial, user/workspace isolation, and rejects unsafe workflow names', async () => {
    await connectPhone(ownerA);

    // Missing CSRF rejected
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/connectors/phone/briefing',
          headers: { cookie: headers(ownerA).cookie },
          payload: { limit: 10 }
        })
      ).statusCode
    ).toBe(403);

    // Viewer denied by PolicyGateway
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/connectors/phone/briefing',
          headers: headers(viewer),
          payload: { limit: 10 }
        })
      ).statusCode
    ).toBe(403);

    // Same-workspace other user and cross-workspace user cannot access ownerA's Phone briefing
    for (const caller of [memberSameWs, otherWsUser]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/connectors/phone/briefing',
            headers: headers(caller),
            payload: { limit: 10 }
          })
        ).statusCode
      ).toBe(409);
    }

    // Unsafe workflowName with script/code expression is rejected with 400
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/connectors/phone/briefing',
          headers: headers(ownerA),
          payload: {
            limit: 10,
            workflowName: 'Phone Briefing <script>alert(1)</script>'
          }
        })
      ).statusCode
    ).toBe(400);
  });

  it('keeps phone briefing chat detection strictly separate from outbound-call intents', () => {
    // Positive briefing requests match
    const summaryProposal = detectPhoneBriefingChatRequest('Summarize my recent calls.');
    expect(summaryProposal).not.toBeNull();
    expect(summaryProposal?.workflowKind).toBe('phone_briefing');
    expect(summaryProposal?.requireApprovalGate).toBe(false);

    const stagedProposal = detectPhoneBriefingChatRequest(
      'Summarize my recent phone calls and stage for approval a phone call briefing workflow'
    );
    expect(stagedProposal).not.toBeNull();
    expect(stagedProposal?.workflowKind).toBe('phone_briefing');
    expect(stagedProposal?.requireApprovalGate).toBe(true);

    // Outbound-call intents MUST NOT match phone briefing detection
    expect(
      detectPhoneBriefingChatRequest('Place an outbound phone call to +919876543210')
    ).toBeNull();
    expect(
      detectPhoneBriefingChatRequest('Make a phone call to Ananya Rao right now')
    ).toBeNull();
    expect(detectPhoneBriefingChatRequest('Please call Priya Nair at 3 PM')).toBeNull();
    expect(detectPhoneBriefingChatRequest('Dial +14155550199 immediately')).toBeNull();
  });

  it('routes Phone briefing chat requests through POST /conversations/:id/stream with approval gating, PolicyGateway, PII masking, idempotency, and active: false offline n8n artifacts', async () => {
    await connectPhone(ownerA);

    // 1. Create a conversation for ownerA
    const convRes = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: headers(ownerA),
      payload: { title: 'Daily Phone Call Briefing Automation' }
    });
    expect(convRes.statusCode).toBe(201);
    const conversationId = convRes.json().id;

    // 2. Viewer is denied by PolicyGateway when attempting executeChatPhoneBriefingPlan
    const prompt =
      'Summarize my recent calls and stage for approval a phone call briefing workflow';
    const proposal = detectPhoneBriefingChatRequest(prompt)!;
    expect(proposal).not.toBeNull();
    expect(proposal.workflowKind).toBe('phone_briefing');
    expect(proposal.requireApprovalGate).toBe(true);

    await expect(
      executeChatPhoneBriefingPlan(db, viewer, proposal, {
        idempotencyKey: 'viewer-denied-phone-briefing'
      })
    ).rejects.toThrow(/PolicyGateway denied 'phone\.briefing\.prepare'/i);

    // 3. Stream the Phone briefing request over POST /api/v1/conversations/:id/stream
    const streamRes = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/stream`,
      headers: headers(ownerA),
      payload: {
        content: prompt,
        idempotency_key: 'stream-phone-briefing-step97-1'
      }
    });
    expect(streamRes.statusCode).toBe(200);
    expect(streamRes.body).toContain('Phone call briefing workflow plan');
    expect(streamRes.body).toContain(
      'Authorized Phone Call History Briefing (`phone.briefing.prepare`)'
    );
    expect(streamRes.body).toContain('+91 ******3210');
    expect(streamRes.body).not.toContain(RAW_PHONE_A);
    expect(streamRes.body).not.toContain(RAW_PHONE_B);
    expect(streamRes.body).not.toContain(RAW_PHONE_C);
    expect(streamRes.body).not.toContain('<script>');
    expect(streamRes.body).not.toContain('evil()');

    // Parse the done SSE event to extract plan_id and approval_id
    const doneMatch = streamRes.body.match(/event:\s*done\s*\nid:\s*\d+\s*\ndata:\s*(\{[^\n]+\})/);
    expect(doneMatch).not.toBeNull();
    const doneData = JSON.parse(doneMatch![1]!);
    expect(doneData.plan_status).toBe('awaiting_approval');
    expect(doneData.plan_id).toBeTruthy();
    expect(doneData.approval_id).toBeTruthy();

    // 4. Idempotent replay returns exact same events; conflicting payload returns 409
    const replayStreamRes = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/stream`,
      headers: headers(ownerA),
      payload: {
        content: prompt,
        idempotency_key: 'stream-phone-briefing-step97-1'
      }
    });
    expect(replayStreamRes.statusCode).toBe(200);
    expect(replayStreamRes.body).toContain(doneData.plan_id);

    const conflictStreamRes = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/stream`,
      headers: headers(ownerA),
      payload: {
        content: 'Different Phone briefing request payload',
        idempotency_key: 'stream-phone-briefing-step97-1'
      }
    });
    expect(conflictStreamRes.statusCode).toBe(409);

    // 5. Approve the pending staging step and verify GET /api/v1/conversations/:id/messages reflects completed status
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${doneData.approval_id}/decide`,
      headers: headers(ownerA),
      payload: { status: 'approved' }
    });
    expect(approveRes.statusCode).toBe(200);

    const messagesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: headers(ownerA)
    });
    expect(messagesRes.statusCode).toBe(200);
    const messages = messagesRes.json();
    const assistantMsg = messages.find((m: any) => m.sender_type === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.metadata.plan_id).toBe(doneData.plan_id);
    expect(assistantMsg.metadata.plan_status).toBe('completed');
    expect(assistantMsg.metadata.staged_artifact_id).toBeTruthy();

    // 6. Inspect the verified workflow artifact and confirm active: false and zero raw phone numbers or private call details in exported n8n blueprint
    const planRes = await app.inject({
      method: 'GET',
      url: `/api/v1/plans/${doneData.plan_id}`,
      headers: headers(ownerA)
    });
    expect(planRes.statusCode).toBe(200);
    const planJson = planRes.json();
    expect(planJson.metadata.workflowKind).toBe('phone_briefing');

    const artifactRes = await app.inject({
      method: 'GET',
      url: `/api/v1/plans/${doneData.plan_id}/workflow-artifact`,
      headers: headers(ownerA)
    });
    expect(artifactRes.statusCode).toBe(200);
    const artifact = artifactRes.json();
    expect(artifact.active).toBe(false);
    expect(artifact.stagingStatus).toBe('staged_offline_inactive');
    expect(artifact.workflowDefinition.n8nBlueprint.active).toBe(false);
    expect(
      validateN8nWorkflowBlueprint(artifact.workflowDefinition.n8nBlueprint).valid
    ).toBe(true);
    const exportedBlueprintStr = JSON.stringify(artifact.workflowDefinition.n8nBlueprint);
    expect(exportedBlueprintStr).not.toContain(PRIVATE_CALL_DETAIL_SECRET);
    expect(exportedBlueprintStr).not.toContain(RAW_PHONE_A);
    expect(exportedBlueprintStr).not.toContain(RAW_PHONE_B);
    expect(exportedBlueprintStr).not.toContain(RAW_PHONE_C);

    // Cross-workspace user cannot access conversation or workflow artifact
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/plans/${doneData.plan_id}/workflow-artifact`,
          headers: headers(otherWsUser)
        })
      ).statusCode
    ).toBe(404);
  });
});
