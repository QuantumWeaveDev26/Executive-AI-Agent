import { createHash, randomBytes } from 'node:crypto';
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
  DEFAULT_SYNTHETIC_WHATSAPP_MESSAGES,
  WHATSAPP_CAPABILITIES,
  WhatsAppFoundation,
  WhatsAppProvider,
  WhatsAppVault,
  computeWhatsAppWebhookSignature,
  createMockWhatsAppProvider,
  hashContactPhone,
  maskPhoneNumber,
  sanitizeWhatsAppText
} from '../src/services/whatsapp.js';

describe('Step 91 — WhatsApp Business integration foundation & API isolation', () => {
  const scopeA = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    userId: 'aaaa1111-1111-4111-8111-111111111111',
    role: 'member' as const,
    sessionTokenHash: 'sess-hash-user-a'
  };
  const scopeSameWorkspaceUserB = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    userId: 'bbbb2222-2222-4222-8222-222222222222',
    role: 'member' as const,
    sessionTokenHash: 'sess-hash-user-b'
  };
  const scopeWorkspace2 = {
    workspaceId: '22222222-2222-4222-8222-222222222222',
    userId: 'aaaa1111-1111-4111-8111-111111111111',
    role: 'member' as const,
    sessionTokenHash: 'sess-hash-ws-2'
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
  const webhookSecret = 'test-whatsapp-webhook-hmac-secret-key-91';
  const connectPayload = {
    phoneNumberId: '100020003000',
    businessAccountId: '900080007000'
  };

  const baseProvider = createMockWhatsAppProvider(DEFAULT_SYNTHETIC_WHATSAPP_MESSAGES);

  const provider: WhatsAppProvider = {
    mode: 'mock',
    verifyConnection: vi.fn((input) => baseProvider.verifyConnection(input)),
    listMessages: vi.fn((input) => baseProvider.listMessages(input)),
    readMessage: vi.fn((input) => baseProvider.readMessage(input))
  };

  const vault = new WhatsAppVault(randomBytes(32), {
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

    userA = await createIdentity('wa-user-a');
    userSameWsB = await createIdentity('wa-user-b-same-ws', 'member', userA.workspaceId);
    userOtherWs = await createIdentity('wa-user-other-ws');
    viewer = await createIdentity('wa-viewer', 'viewer', userA.workspaceId);
    revoked = await createIdentity('wa-revoked');
    await db.query('UPDATE sessions SET revoked_at=NOW() WHERE token_hash=$1', [
      revoked.sessionTokenHash
    ]);
    await db.exec('SET ROLE thaara_app;');

    app = await buildApp({
      db,
      config: loadConfig({ NODE_ENV: 'test' }),
      whatsapp: {
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
    vi.mocked(provider.listMessages)
      .mockReset()
      .mockImplementation((input) => baseProvider.listMessages(input));
    vi.mocked(provider.readMessage)
      .mockReset()
      .mockImplementation((input) => baseProvider.readMessage(input));
  });

  afterAll(async () => {
    await app?.close();
    await disabledApp?.close();
    await db?.close();
  });

  it('masks phone numbers, hashes contact identifiers per workspace, and strips unsafe HTML/script/control characters', () => {
    expect(maskPhoneNumber('+91 98765-43210')).toBe('+91 ******3210');
    expect(maskPhoneNumber('+14155550199')).toBe('+1 ******0199');
    expect(maskPhoneNumber('+919876543210')).not.toContain('987654');
    expect(hashContactPhone(scopeA.workspaceId, '+91 98765 43210')).toBe(
      hashContactPhone(scopeA.workspaceId, '+919876543210')
    );
    expect(hashContactPhone(scopeA.workspaceId, '+919876543210')).not.toBe(
      hashContactPhone(scopeWorkspace2.workspaceId, '+919876543210')
    );
    expect(sanitizeWhatsAppText('Hello <script>alert(1)</script><b>world</b>\u0000!')).toBe(
      'Hello world !'
    );
  });

  it('encrypts vault records with AES-256-GCM and isolates workspace and user partitions', () => {
    vault.set(scopeA, 'session', { accessToken: 'WA-SUPER-SECRET-TOKEN' });
    const rawValues = [...records.values()].join(' ');
    expect(rawValues).not.toContain('WA-SUPER-SECRET-TOKEN');
    expect([...records.keys()][0]).toMatch(/^whatsapp_business:session:/);
    expect(vault.get(scopeA, 'session')).toEqual({ accessToken: 'WA-SUPER-SECRET-TOKEN' });
    expect(vault.get(scopeSameWorkspaceUserB, 'session')).toBeUndefined();
    expect(vault.get(scopeWorkspace2, 'session')).toBeUndefined();

    const firstKey = [...records.keys()][0]!;
    records.set(firstKey, records.get(firstKey)!.slice(0, -4) + 'AAAA');
    expect(() => vault.get(scopeA, 'session')).toThrow(/credentials are unavailable/i);
  });

  it('enforces authentication, CSRF, viewer role policy rules, and truthful not_configured status across API routes', async () => {
    for (const route of [
      { method: 'GET' as const, url: '/api/v1/connectors/whatsapp/status' },
      { method: 'POST' as const, url: '/api/v1/connectors/whatsapp/connect', payload: connectPayload },
      { method: 'POST' as const, url: '/api/v1/connectors/whatsapp/messages/list', payload: {} },
      { method: 'GET' as const, url: '/api/v1/connectors/whatsapp/messages/wamid_exec_board_001' }
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
    }

    // Missing CSRF on mutating connect route
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/connectors/whatsapp/connect',
          headers: { cookie: `thaara_session=${userA.token}; thaara_csrf=${csrf}` },
          payload: connectPayload
        })
      ).statusCode
    ).toBe(403);

    // Viewer role is denied across all WhatsApp endpoints by PolicyGateway
    const viewerStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/connectors/whatsapp/status',
      headers: headers(viewer)
    });
    expect(viewerStatus.statusCode).toBe(403);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/connectors/whatsapp/connect',
          headers: headers(viewer),
          payload: connectPayload
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/connectors/whatsapp/messages/list',
          headers: headers(viewer),
          payload: {}
        })
      ).statusCode
    ).toBe(403);

    // Unconfigured app reports truthful not_configured status and 503 on connect
    const unconfiguredStatus = await disabledApp.inject({
      method: 'GET',
      url: '/api/v1/connectors/whatsapp/status',
      headers: headers(userA)
    });
    expect(unconfiguredStatus.statusCode).toBe(200);
    expect(unconfiguredStatus.json()).toEqual({
      connectorName: 'whatsapp_business',
      status: 'not_configured',
      configured: false,
      connected: false,
      mode: 'disabled',
      capabilities: [],
      maskedBusinessPhone: null,
      lastVerifiedAt: null
    });

    const unconfiguredConnect = await disabledApp.inject({
      method: 'POST',
      url: '/api/v1/connectors/whatsapp/connect',
      headers: headers(userA),
      payload: connectPayload
    });
    expect(unconfiguredConnect.statusCode).toBe(503);
    expect(unconfiguredConnect.json().error.code).toBe('WHATSAPP_NOT_CONFIGURED');

    // No live webhook route is exposed on the HTTP server
    const liveWebhookAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/whatsapp/webhook',
      payload: {}
    });
    expect(liveWebhookAttempt.statusCode).toBe(404);
  });

  it('connects mock WhatsApp Business account, isolates workspaces/users, masks PII, and strips unsafe HTML in messages', async () => {
    const initialStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/connectors/whatsapp/status',
      headers: headers(userA)
    });
    expect(initialStatus.statusCode).toBe(200);
    expect(initialStatus.json().status).toBe('disconnected');

    const connectRes = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/whatsapp/connect',
      headers: headers(userA),
      payload: connectPayload
    });
    expect(connectRes.statusCode).toBe(200);
    expect(connectRes.json()).toMatchObject({
      connectorName: 'whatsapp_business',
      status: 'connected',
      configured: true,
      connected: true,
      mode: 'mock',
      capabilities: [...WHATSAPP_CAPABILITIES],
      maskedBusinessPhone: '+91 ******9000'
    });

    // Other user in same workspace and user in another workspace remain isolated (disconnected)
    for (const otherIdentity of [userSameWsB, userOtherWs]) {
      const otherStatus = await app.inject({
        method: 'GET',
        url: '/api/v1/connectors/whatsapp/status',
        headers: headers(otherIdentity)
      });
      expect(otherStatus.json().status).toBe('disconnected');

      const otherList = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/whatsapp/messages/list',
        headers: headers(otherIdentity),
        payload: {}
      });
      expect(otherList.statusCode).toBe(409);
      expect(otherList.json().error.code).toBe('WHATSAPP_DISCONNECTED');
    }

    // List messages for connected userA
    const listRes = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/whatsapp/messages/list',
      headers: headers(userA),
      payload: { limit: 10 }
    });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json();
    expect(body.messages).toHaveLength(3);
    expect(body.threads).toHaveLength(2);
    expect(body.messages.every((m: any) => m.untrusted === true)).toBe(true);

    // Ensure raw phone numbers and script tags are never exposed in serialized response
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('9876543210');
    expect(serialized).not.toContain('9811122233');
    expect(serialized).not.toContain('<script>');
    expect(body.messages[0].sender.maskedPhone).toBe('+91 ******3210');

    // Query filtering + single message read
    const filteredRes = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/whatsapp/messages/list',
      headers: headers(userA),
      payload: { query: 'addendum' }
    });
    expect(filteredRes.statusCode).toBe(200);
    expect(filteredRes.json().messages).toHaveLength(1);
    expect(filteredRes.json().messages[0].id).toBe('wamid_exec_counsel_002');
    expect(filteredRes.json().messages[0].textPreview).toBe(
      'Updated vendor addendum clause 4.2 is ready for review.'
    );

    const singleRes = await app.inject({
      method: 'GET',
      url: '/api/v1/connectors/whatsapp/messages/wamid_exec_board_001',
      headers: headers(userA)
    });
    expect(singleRes.statusCode).toBe(200);
    expect(singleRes.json().id).toBe('wamid_exec_board_001');
    expect(singleRes.json().untrusted).toBe(true);

    // Disconnect revokes local credentials immediately
    const disconnectRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/connectors/whatsapp/connection',
      headers: headers(userA)
    });
    expect(disconnectRes.statusCode).toBe(200);
    expect(disconnectRes.json().status).toBe('disconnected');

    // Audit log check: no raw phone numbers or access tokens stored in audit_events
    const auditRows = await db.withScopedTransaction(userA, async (tx) =>
      tx.query<{ action: string; payload: Record<string, unknown> }>(
        'SELECT action, payload FROM audit_events WHERE workspace_id = $1 ORDER BY created_at ASC',
        [userA.workspaceId]
      )
    );
    const auditSerialized = JSON.stringify(auditRows.rows);
    expect(auditSerialized).toContain('whatsapp.connection.connected');
    expect(auditSerialized).toContain('whatsapp.messages.listed');
    expect(auditSerialized).not.toContain('mock-wa-token');
    expect(auditSerialized).not.toContain('9876543210');
  });

  it('verifies webhook HMAC-SHA256 signatures, blocks replay timestamps, deduplicates repeated events, and enforces scope', async () => {
    const audits: Array<{ action: string; payload: Record<string, unknown> }> = [];
    const nowMs = Date.parse('2026-10-18T08:00:00Z');
    const nowSeconds = Math.floor(nowMs / 1000);
    const service = new WhatsAppFoundation({
      provider,
      vault,
      webhookSecret,
      now: () => nowMs,
      policyGateway: defaultPolicyGateway,
      audit: async (_scope, action, payload) => {
        audits.push({ action, payload });
      }
    });

    await service.connect(scopeA, connectPayload);

    const rawEventPayload = {
      eventId: 'evt_wa_webhook_001',
      timestampSeconds: nowSeconds - 30,
      workspaceId: scopeA.workspaceId,
      userId: scopeA.userId,
      threadId: 'wa_thread_board_chair',
      messageId: 'wamid.webhook.inbound.101',
      senderPhone: '+919876543210',
      senderDisplayName: 'Priya Nair <img src=x onerror=alert(1)>',
      text: 'Approved the Q4 cap table note <script>evil()</script>'
    };
    const rawBody = JSON.stringify(rawEventPayload);
    const validSig = computeWhatsAppWebhookSignature(rawBody, webhookSecret);

    // 1. Invalid signature is rejected with 401
    await expect(
      service.verifyAndIngestMockWebhookEvent(scopeA, {
        rawBody,
        signatureHeader: 'sha256=' + '0'.repeat(64)
      })
    ).rejects.toMatchObject({
      code: 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID',
      statusCode: 401
    });

    // 2. Tampered body with original signature is rejected with 401
    await expect(
      service.verifyAndIngestMockWebhookEvent(scopeA, {
        rawBody: rawBody.replace('Approved', 'Rejected'),
        signatureHeader: validSig
      })
    ).rejects.toMatchObject({
      code: 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID',
      statusCode: 401
    });

    // 3. Stale timestamp outside replay window is rejected with 409
    const staleBody = JSON.stringify({
      ...rawEventPayload,
      eventId: 'evt_wa_webhook_stale',
      timestampSeconds: nowSeconds - 1200
    });
    await expect(
      service.verifyAndIngestMockWebhookEvent(scopeA, {
        rawBody: staleBody,
        signatureHeader: computeWhatsAppWebhookSignature(staleBody, webhookSecret),
        maxSkewSeconds: 300
      })
    ).rejects.toMatchObject({
      code: 'WHATSAPP_WEBHOOK_REPLAY_DETECTED',
      statusCode: 409
    });

    // 4. Cross-workspace scope mismatch is rejected with 403
    await expect(
      service.verifyAndIngestMockWebhookEvent(scopeWorkspace2, {
        rawBody,
        signatureHeader: validSig
      })
    ).rejects.toMatchObject({
      statusCode: 403
    });

    // 5. Valid signed event is accepted and sanitized
    const accepted = await service.verifyAndIngestMockWebhookEvent(scopeA, {
      rawBody,
      signatureHeader: validSig
    });
    expect(accepted.accepted).toBe(true);
    expect(accepted.deduplicated).toBe(false);
    expect(accepted.message.id).toBe('wamid.webhook.inbound.101');
    expect(accepted.message.sender.maskedPhone).toBe('+91 ******3210');
    expect(accepted.message.sender.displayName).toBe('Priya Nair');
    expect(accepted.message.textPreview).toBe('Approved the Q4 cap table note');
    expect(accepted.message.untrusted).toBe(true);

    // 6. Duplicate eventId or duplicate messageId is safely deduplicated
    const duplicateDelivery = await service.verifyAndIngestMockWebhookEvent(scopeA, {
      rawBody,
      signatureHeader: validSig
    });
    expect(duplicateDelivery.accepted).toBe(true);
    expect(duplicateDelivery.deduplicated).toBe(true);
    expect(duplicateDelivery.eventId).toBe('evt_wa_webhook_001');

    const duplicateMessageIdBody = JSON.stringify({
      ...rawEventPayload,
      eventId: 'evt_wa_webhook_002_same_msg'
    });
    const duplicateMsgDelivery = await service.verifyAndIngestMockWebhookEvent(scopeA, {
      rawBody: duplicateMessageIdBody,
      signatureHeader: computeWhatsAppWebhookSignature(duplicateMessageIdBody, webhookSecret)
    });
    expect(duplicateMsgDelivery.accepted).toBe(true);
    expect(duplicateMsgDelivery.deduplicated).toBe(true);
    expect(duplicateMsgDelivery.eventId).toBe('evt_wa_webhook_002_same_msg');

    // 7. Offline n8n context preparation always enforces active: false and untrusted: true
    const listed = await service.listMessages(scopeA, { limit: 10 });
    const n8nContext = service.toN8nContext(listed);
    expect(n8nContext).toMatchObject({
      connectorName: 'whatsapp_business',
      mode: 'mock',
      untrusted: true,
      active: false,
      threadCount: 2,
      messageCount: 3
    });
  });

  it('never allows WhatsApp message sending without an explicit approved ApprovalRequest and returns truthful not_configured when approved', async () => {
    const service = new WhatsAppFoundation({
      provider,
      vault,
      webhookSecret,
      policyGateway: defaultPolicyGateway,
      audit: async () => {}
    });

    await service.connect(scopeA, connectPayload);

    const draft = {
      threadId: 'wa_thread_board_chair',
      recipientMaskedPhone: '+91 ******3210',
      bodyText: 'Confirming 09:00 IST board call tomorrow.',
      idempotencyKey: 'idem-wa-send-0001'
    };

    // 1. Missing approval request is rejected by PolicyGateway
    await expect(service.sendMessage(scopeA, draft)).rejects.toThrow(
      /denied by policy/i
    );

    const baseApproval = {
      id: '99999999-9999-4999-8999-999999999999',
      workspaceId: scopeA.workspaceId,
      requesterUserId: scopeA.userId,
      approverUserId: null,
      actionName: 'whatsapp.messages.send',
      actionParams: draft,
      riskLevel: 'high' as const,
      status: 'pending' as const,
      reason: 'Send board confirmation via WhatsApp',
      decisionNote: null,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      decidedAt: null,
      createdAt: new Date().toISOString()
    };

    // 2. Pending approval request is rejected
    await expect(service.sendMessage(scopeA, draft, baseApproval)).rejects.toThrow(
      /denied by policy/i
    );

    // 3. Approved request with tampered parameters is rejected
    await expect(
      service.sendMessage(
        scopeA,
        { ...draft, bodyText: 'Tampered message body!' },
        {
          ...baseApproval,
          status: 'approved',
          approverUserId: scopeSameWorkspaceUserB.userId,
          decidedAt: new Date().toISOString()
        }
      )
    ).rejects.toThrow(/denied by policy/i);

    // 4. Explicitly approved request passes PolicyGateway and returns truthful not_configured in Step 91
    const approvedReceipt = await service.sendMessage(scopeA, draft, {
      ...baseApproval,
      status: 'approved',
      approverUserId: scopeSameWorkspaceUserB.userId,
      decidedAt: new Date().toISOString()
    });
    expect(approvedReceipt).toEqual({
      status: 'not_configured',
      mode: 'mock',
      approvalId: baseApproval.id,
      message: 'Live WhatsApp outbound message delivery is not configured in Step 91.'
    });
  });

  it('handles provider failures with 502 and expired credentials with 409 reconnect_required', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/whatsapp/connect',
      headers: headers(userA),
      payload: connectPayload
    });

    vi.mocked(provider.listMessages).mockRejectedValueOnce(
      new Error('Simulated provider timeout with secret mock-wa-token-LEAK')
    );

    const failedList = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/whatsapp/messages/list',
      headers: headers(userA),
      payload: {}
    });
    expect(failedList.statusCode).toBe(502);
    expect(failedList.json().error.code).toBe('WHATSAPP_PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(failedList.json())).not.toContain('mock-wa-token-LEAK');

    // Simulate expired vault token
    let nowMs = Date.parse('2026-10-18T08:00:00Z');
    const expiringService = new WhatsAppFoundation({
      provider: baseProvider,
      vault,
      now: () => nowMs,
      policyGateway: defaultPolicyGateway,
      audit: async () => {}
    });
    await expiringService.connect(scopeA, connectPayload);
    nowMs += 7200 * 1000;
    expect(expiringService.status(scopeA).status).toBe('reconnect_required');
    await expect(expiringService.listMessages(scopeA, {})).rejects.toMatchObject({
      code: 'WHATSAPP_RECONNECT_REQUIRED',
      statusCode: 409
    });
  });
});
