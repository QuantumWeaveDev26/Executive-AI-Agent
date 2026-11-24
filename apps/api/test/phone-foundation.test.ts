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
import { defaultPolicyGateway } from '@thaara/policy';
import { buildApp } from '../src/app.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';
import {
  DEFAULT_SYNTHETIC_PHONE_CALLS,
  PhoneFoundation,
  PhoneProvider,
  PhoneVault,
  computePhoneWebhookSignature,
  createMockPhoneProvider,
  hashPhoneParticipant,
  maskPhoneCallNumber,
  sanitizePhoneMetadataText
} from '../src/services/phone.js';

describe('Step 95 — Phone Integration Foundation & Simulated Telephony Security', () => {
  const scopeA = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    userId: 'aaaa1111-1111-4111-8111-111111111111',
    role: 'member' as const,
    sessionTokenHash: 'sess-hash-phone-user-a'
  };
  const scopeSameWorkspaceUserB = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    userId: 'bbbb2222-2222-4222-8222-222222222222',
    role: 'member' as const,
    sessionTokenHash: 'sess-hash-phone-user-b'
  };
  const scopeWorkspace2 = {
    workspaceId: '22222222-2222-4222-8222-222222222222',
    userId: 'aaaa1111-1111-4111-8111-111111111111',
    role: 'member' as const,
    sessionTokenHash: 'sess-hash-phone-ws-2'
  };

  let db: PGliteDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let disabledApp: Awaited<ReturnType<typeof buildApp>>;
  let userA: any;
  let userSameWsB: any;
  let userOtherWs: any;
  let viewer: any;
  let revoked: any;

  const records = new Map<string, string>();
  const csrf = generateCsrfToken();
  const logger = new Logger('error');
  const webhookSecret = 'test-phone-webhook-hmac-secret-key-step-95';
  const connectPayload = {
    lineId: 'line_exec_9001',
    accountId: 'acct_exec_7001'
  };

  const baseProvider = createMockPhoneProvider(DEFAULT_SYNTHETIC_PHONE_CALLS);
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

  function headers(identity = userA) {
    return {
      cookie: `thaara_session=${identity.token}; thaara_csrf=${csrf}`,
      'x-csrf-token': csrf
    };
  }

  beforeAll(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    async function createIdentity(
      name: string,
      role: 'member' | 'viewer' = 'member',
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

    userA = await createIdentity('phone-user-a');
    userSameWsB = await createIdentity('phone-user-b-same-ws', 'member', userA.workspaceId);
    userOtherWs = await createIdentity('phone-user-other-ws');
    viewer = await createIdentity('phone-viewer', 'viewer', userA.workspaceId);
    revoked = await createIdentity('phone-revoked');
    await db.query('UPDATE sessions SET revoked_at=NOW() WHERE token_hash=$1', [
      revoked.sessionTokenHash
    ]);
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

    disabledApp = await buildApp({
      db,
      config: loadConfig({ NODE_ENV: 'test' }),
      logger
    });
    await disabledApp.ready();
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
    await disabledApp?.close();
    await db?.close();
  });

  it('masks phone numbers, hashes contact identifiers per workspace, and strips unsafe HTML/script/control characters', () => {
    expect(maskPhoneCallNumber('+91 98765-43210')).toBe('+91 ******3210');
    expect(maskPhoneCallNumber('+14155550199')).toBe('+1 ******0199');
    expect(maskPhoneCallNumber('+919876543210')).not.toContain('987654');
    expect(hashPhoneParticipant(scopeA.workspaceId, '+91 98765 43210')).toBe(
      hashPhoneParticipant(scopeA.workspaceId, '+919876543210')
    );
    expect(hashPhoneParticipant(scopeA.workspaceId, '+919876543210')).not.toBe(
      hashPhoneParticipant(scopeWorkspace2.workspaceId, '+919876543210')
    );
    expect(sanitizePhoneMetadataText('Call <script>alert(1)</script><b>summary</b>\u0000!')).toBe(
      'Call summary !'
    );
  });

  it('encrypts vault records with AES-256-GCM and isolates workspace and user partitions', () => {
    vault.set(scopeA, 'session', { accessToken: 'PHONE-SUPER-SECRET-TOKEN' });
    const rawValues = [...records.values()].join(' ');
    expect(rawValues).not.toContain('PHONE-SUPER-SECRET-TOKEN');
    expect([...records.keys()][0]).toMatch(/^phone_telephony:session:/);
    expect(vault.get(scopeA, 'session')).toEqual({ accessToken: 'PHONE-SUPER-SECRET-TOKEN' });
    expect(vault.get(scopeSameWorkspaceUserB, 'session')).toBeUndefined();
    expect(vault.get(scopeWorkspace2, 'session')).toBeUndefined();

    const firstKey = [...records.keys()][0]!;
    records.set(firstKey, records.get(firstKey)!.slice(0, -4) + 'AAAA');
    expect(() => vault.get(scopeA, 'session')).toThrow(/credentials are unavailable/i);
  });

  it('enforces authentication, CSRF, viewer role policy rules, and truthful not_configured status across API routes', async () => {
    for (const route of [
      { method: 'GET' as const, url: '/api/v1/connectors/phone/status' },
      { method: 'POST' as const, url: '/api/v1/connectors/phone/connect', payload: connectPayload },
      { method: 'POST' as const, url: '/api/v1/connectors/phone/calls/list', payload: {} },
      { method: 'GET' as const, url: '/api/v1/connectors/phone/calls/phcall_exec_001' }
    ]) {
      expect((await app.inject(route)).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            ...route,
            headers: headers(revoked)
          })
        ).statusCode
      ).toBe(401);
      expect(
        (
          await app.inject({
            ...route,
            headers: headers(viewer)
          })
        ).statusCode
      ).toBe(403);
    }

    // Missing CSRF on state-changing POST connect
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/connectors/phone/connect',
          headers: { cookie: headers(userA).cookie },
          payload: connectPayload
        })
      ).statusCode
    ).toBe(403);

    // Unconfigured app returns truthful not_configured status with recording/transcription disabled
    const disabledStatus = await disabledApp.inject({
      url: '/api/v1/connectors/phone/status',
      headers: headers(userA)
    });
    expect(disabledStatus.statusCode).toBe(200);
    expect(disabledStatus.json()).toMatchObject({
      connectorName: 'phone_telephony',
      status: 'not_configured',
      configured: false,
      connected: false,
      mode: 'disabled',
      recordingEnabled: false,
      transcriptionEnabled: false
    });
  });

  it('connects mock telephony, lists synthetic call history across all 6 lifecycle states, masks phone numbers, and isolates workspaces/users', async () => {
    const connectRes = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/phone/connect',
      headers: headers(userA),
      payload: connectPayload
    });
    expect(connectRes.statusCode).toBe(200);
    expect(connectRes.json()).toMatchObject({
      connectorName: 'phone_telephony',
      status: 'connected',
      configured: true,
      connected: true,
      mode: 'mock',
      maskedLineNumber: '+91 ******9001',
      recordingEnabled: false,
      transcriptionEnabled: false
    });

    // Same-workspace User B and other-workspace user remain disconnected
    for (const other of [userSameWsB, userOtherWs]) {
      const otherStatus = await app.inject({
        url: '/api/v1/connectors/phone/status',
        headers: headers(other)
      });
      expect(otherStatus.statusCode).toBe(200);
      expect(otherStatus.json().status).toBe('disconnected');

      const otherList = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/phone/calls/list',
        headers: headers(other),
        payload: {}
      });
      expect(otherList.statusCode).toBe(409);
    }

    // List all synthetic calls for userA and confirm all 6 lifecycle states are present
    const listRes = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/phone/calls/list',
      headers: headers(userA),
      payload: { limit: 20 }
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.recordingEnabled).toBe(false);
    expect(listBody.transcriptionEnabled).toBe(false);
    expect(listBody.untrusted).toBe(true);
    expect(listBody.mode).toBe('mock');

    const states = new Set(listBody.calls.map((c: any) => c.lifecycleState));
    expect(states).toEqual(
      new Set(['queued', 'ringing', 'answered', 'completed', 'failed', 'cancelled'])
    );

    // Raw phone numbers and provider tokens must never appear
    expect(listRes.body).not.toContain('9876543210');
    expect(listRes.body).not.toContain('4155550199');
    expect(listRes.body).not.toContain('ph_mock_tok_');

    // Read single call by ID
    const readRes = await app.inject({
      method: 'GET',
      url: '/api/v1/connectors/phone/calls/phcall_exec_001',
      headers: headers(userA)
    });
    expect(readRes.statusCode).toBe(200);
    expect(readRes.json()).toMatchObject({
      id: 'phcall_exec_001',
      lifecycleState: 'completed',
      participant: {
        displayName: 'Ananya Rao (Board Chair)',
        maskedPhone: '+91 ******3210'
      },
      recordingEnabled: false,
      transcriptionEnabled: false,
      receiptStatus: 'verified_mock',
      untrusted: true,
      mode: 'mock'
    });
  });

  it('enforces explicit consent, explicit approval, PolicyGateway, recording/transcription disablement, idempotency, and mock call lifecycle transitions on outbound call requests', async () => {
    const service = new PhoneFoundation({
      provider,
      vault,
      webhookSecret,
      policyGateway: defaultPolicyGateway
    });
    await service.connect(scopeA, connectPayload);

    const validOutboundRequest = {
      recipientMaskedPhone: '+91 98765 43210',
      recipientDisplayName: 'Ananya Rao',
      purposeSummary: '<script>evil()</script> Confirm Q4 board audit review window.',
      explicitConsentGranted: true,
      recordingRequested: false,
      transcriptionRequested: false,
      idempotencyKey: 'phone-outbound-idemp-95-001'
    };

    // 1. Recording or transcription requested -> rejected (400)
    await expect(
      service.requestOutboundCall(
        scopeA,
        { ...validOutboundRequest, recordingRequested: true },
        null
      )
    ).rejects.toThrow(/recording and transcription are strictly disabled/i);

    await expect(
      service.requestOutboundCall(
        scopeA,
        { ...validOutboundRequest, transcriptionRequested: true },
        null
      )
    ).rejects.toThrow(/recording and transcription are strictly disabled/i);

    // 2. Missing explicit consent -> rejected (403)
    await expect(
      service.requestOutboundCall(
        scopeA,
        { ...validOutboundRequest, explicitConsentGranted: false },
        null
      )
    ).rejects.toThrow(/Explicit user consent/i);

    // 3. Missing explicit approval -> rejected by PolicyGateway (403)
    await expect(
      service.requestOutboundCall(scopeA, validOutboundRequest, null)
    ).rejects.toThrow(/denied by policy/i);

    // 4. Approved request bound to exact parameters succeeds and queues simulated call
    const approvedRequest = {
      id: '33333333-3333-4333-8333-333333333333',
      workspaceId: scopeA.workspaceId,
      requesterUserId: scopeA.userId,
      approverUserId: scopeSameWorkspaceUserB.userId,
      actionName: 'phone.calls.request_outbound',
      actionParams: validOutboundRequest,
      riskLevel: 'high' as const,
      status: 'approved' as const,
      reason: 'Confirm Q4 board audit review window',
      decisionNote: 'Approved for simulated outbound call',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      decidedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    const created = await service.requestOutboundCall(
      scopeA,
      validOutboundRequest,
      approvedRequest
    );
    expect(created.idempotentReplay).toBe(false);
    expect(created.call).toMatchObject({
      direction: 'outbound_simulated',
      lifecycleState: 'queued',
      participant: {
        displayName: 'Ananya Rao',
        maskedPhone: '+91 ******3210'
      },
      purposeSummary: 'Confirm Q4 board audit review window.',
      recordingEnabled: false,
      transcriptionEnabled: false,
      consentVerified: true,
      approvalId: approvedRequest.id,
      receiptStatus: 'verified_mock'
    });
    expect(created.call.purposeSummary).not.toContain('<script>');

    // 5. Idempotent replay returns exact same simulated call; conflicting payload throws 409
    const replay = await service.requestOutboundCall(
      scopeA,
      validOutboundRequest,
      approvedRequest
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.call.id).toBe(created.call.id);

    const conflictingRequest = {
      ...validOutboundRequest,
      purposeSummary: 'Different call purpose using same idempotencyKey'
    };
    const conflictingApproval = {
      ...approvedRequest,
      actionParams: conflictingRequest
    };
    await expect(
      service.requestOutboundCall(scopeA, conflictingRequest, conflictingApproval)
    ).rejects.toThrow(/already used with different call parameters/i);

    // 6. Lifecycle transitions: queued -> ringing -> answered -> completed
    const ringing = await service.transitionSimulatedCallLifecycle(
      scopeA,
      created.call.id,
      'ringing'
    );
    expect(ringing.lifecycleState).toBe('ringing');

    const answered = await service.transitionSimulatedCallLifecycle(
      scopeA,
      created.call.id,
      'answered'
    );
    expect(answered.lifecycleState).toBe('answered');

    const completed = await service.transitionSimulatedCallLifecycle(
      scopeA,
      created.call.id,
      'completed',
      245
    );
    expect(completed.lifecycleState).toBe('completed');
    expect(completed.durationSeconds).toBe(245);
    expect(completed.endedAt).toBeTruthy();
    expect(completed.recordingEnabled).toBe(false);
    expect(completed.transcriptionEnabled).toBe(false);

    // Invalid transition from terminal state completed -> ringing is rejected (409)
    await expect(
      service.transitionSimulatedCallLifecycle(scopeA, created.call.id, 'ringing')
    ).rejects.toThrow(/Invalid phone call lifecycle transition/i);
  });

  it('verifies mocked webhook HMAC-SHA256 signatures, enforces replay windows, deduplicates events, and prepares inactive n8n context (active: false)', async () => {
    const fixedNow = 1_760_000_000_000;
    const service = new PhoneFoundation({
      provider,
      vault,
      webhookSecret,
      policyGateway: defaultPolicyGateway,
      now: () => fixedNow
    });
    await service.connect(scopeA, connectPayload);

    const validEnvelope = {
      eventId: 'ph_evt_95_001',
      timestampSeconds: Math.floor(fixedNow / 1000),
      workspaceId: scopeA.workspaceId,
      userId: scopeA.userId,
      callId: 'phcall_webhook_001',
      direction: 'inbound' as const,
      lifecycleState: 'completed' as const,
      callerPhone: '+919876543210',
      callerDisplayName: 'Ananya Rao',
      purposeSummary: '<script>evil()</script> Urgent board update call.',
      durationSeconds: 180
    };
    const rawBody = JSON.stringify(validEnvelope);
    const validSig = computePhoneWebhookSignature(rawBody, webhookSecret);

    // Invalid signature -> 401
    await expect(
      service.verifyAndIngestMockWebhookEvent(scopeA, {
        rawBody,
        signatureHeader: 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
      })
    ).rejects.toThrow(/Invalid Phone webhook signature/i);

    // Replay window exceeded -> 409
    const staleRawBody = JSON.stringify({
      ...validEnvelope,
      eventId: 'ph_evt_stale',
      timestampSeconds: Math.floor(fixedNow / 1000) - 900
    });
    await expect(
      service.verifyAndIngestMockWebhookEvent(scopeA, {
        rawBody: staleRawBody,
        signatureHeader: computePhoneWebhookSignature(staleRawBody, webhookSecret)
      })
    ).rejects.toThrow(/outside the replay protection window/i);

    // Cross-workspace scope mismatch -> 403
    await expect(
      service.verifyAndIngestMockWebhookEvent(scopeWorkspace2, {
        rawBody,
        signatureHeader: validSig
      })
    ).rejects.toThrow(/scope mismatch/i);

    // Valid webhook ingestion -> accepted, phone masked, script stripped
    const firstIngest = await service.verifyAndIngestMockWebhookEvent(scopeA, {
      rawBody,
      signatureHeader: validSig
    });
    expect(firstIngest.accepted).toBe(true);
    expect(firstIngest.deduplicated).toBe(false);
    expect(firstIngest.call.participant.maskedPhone).toBe('+91 ******3210');
    expect(firstIngest.call.purposeSummary).toBe('Urgent board update call.');
    expect(firstIngest.call.recordingEnabled).toBe(false);
    expect(firstIngest.call.transcriptionEnabled).toBe(false);

    // Duplicate delivery -> deduplicated
    const secondIngest = await service.verifyAndIngestMockWebhookEvent(scopeA, {
      rawBody,
      signatureHeader: validSig
    });
    expect(secondIngest.accepted).toBe(true);
    expect(secondIngest.deduplicated).toBe(true);

    // Prepare n8n context with active: false and recording/transcription disabled
    const listed = await service.listCalls(scopeA, { limit: 10 });
    const n8nContext = service.toN8nContext(listed);
    expect(n8nContext).toMatchObject({
      connectorName: 'phone_telephony',
      mode: 'mock',
      untrusted: true,
      active: false,
      recordingEnabled: false,
      transcriptionEnabled: false
    });
    expect(JSON.stringify(n8nContext)).not.toContain('9876543210');
  });
});
