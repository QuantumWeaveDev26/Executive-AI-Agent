import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import {
  PGliteDatabase,
  Migrator,
  WorkspaceRepository,
  UserRepository,
  MembershipRepository,
  SessionRepository,
  generateSessionToken,
  hashSessionToken
} from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME } from '../src/plugins/auth.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';

describe('Executive Memory, Privacy & Inspection API (/api/v1/memories, /api/v1/privacy, /api/v1/admin)', () => {
  let app: FastifyInstance;
  let db: PGliteDatabase;

  let workspaceAId: string;
  let workspaceBId: string;
  let userAId: string;
  let memberAId: string;
  let userBId: string;
  let sessionTokenA: string;
  let sessionTokenMemberA: string;
  let sessionTokenB: string;
  let csrfTokenA: string;
  let csrfTokenMemberA: string;
  let csrfTokenB: string;

  beforeEach(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);

    // Tenant A - Owner
    const wsA = await wsRepo.create('Tenant Alpha Corp');
    workspaceAId = wsA.id;
    const userA = await userRepo.create('alice.owner@alpha.com', 'hashA', 'Alice Owner');
    userAId = userA.id;
    sessionTokenA = generateSessionToken();
    const scopeA = {
      workspaceId: wsA.id,
      userId: userA.id,
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken(sessionTokenA)
    };
    await db.withScopedTransaction(scopeA, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(wsA.id, userA.id, 'owner');
      await sRepo.create(userA.id, wsA.id, sessionTokenA);
    });
    csrfTokenA = generateCsrfToken();

    // Tenant A - Regular Member (for RBAC testing)
    const memberA = await userRepo.create('charlie.member@alpha.com', 'hashM', 'Charlie Member');
    memberAId = memberA.id;
    sessionTokenMemberA = generateSessionToken();
    const scopeMemberA = {
      workspaceId: wsA.id,
      userId: memberA.id,
      role: 'member' as const,
      sessionTokenHash: hashSessionToken(sessionTokenMemberA)
    };
    await db.withScopedTransaction(scopeMemberA, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(wsA.id, memberA.id, 'member');
      await sRepo.create(memberA.id, wsA.id, sessionTokenMemberA);
    });
    csrfTokenMemberA = generateCsrfToken();

    // Tenant B - Owner
    const wsB = await wsRepo.create('Tenant Beta Corp');
    workspaceBId = wsB.id;
    const userB = await userRepo.create('bob.owner@beta.com', 'hashB', 'Bob Owner');
    userBId = userB.id;
    sessionTokenB = generateSessionToken();
    const scopeB = {
      workspaceId: wsB.id,
      userId: userB.id,
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken(sessionTokenB)
    };
    await db.withScopedTransaction(scopeB, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(wsB.id, userB.id, 'owner');
      await sRepo.create(userB.id, wsB.id, sessionTokenB);
    });
    csrfTokenB = generateCsrfToken();

    const config = loadConfig({ NODE_ENV: 'test' });
    app = await buildApp({ db, config });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates, retrieves, consents, revokes, and supersedes memory items', async () => {
    // 1. Create user-scoped memory item
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      },
      payload: {
        scope: 'user',
        category: 'preference',
        key: 'preferred_greeting',
        value: 'Good morning, Executive Director',
        confidence: 0.95,
        provenance: 'explicit_user_input'
      }
    });

    expect(createRes.statusCode).toBe(201);
    const mem1 = JSON.parse(createRes.body);
    expect(mem1.id).toBeDefined();
    expect(mem1.workspace_id).toBe(workspaceAId);
    expect(mem1.user_id).toBe(userAId);
    expect(mem1.key).toBe('preferred_greeting');
    expect(mem1.consent_status).toBe('pending_consent');

    // 2. Retrieve memory item
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/memories/${mem1.id}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}`
      }
    });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.body).id).toBe(mem1.id);

    // 3. Grant consent
    const consentRes = await app.inject({
      method: 'POST',
      url: `/api/v1/memories/${mem1.id}/consent`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      }
    });
    expect(consentRes.statusCode).toBe(200);
    const consentedMem = JSON.parse(consentRes.body);
    expect(consentedMem.success).toBe(true);
    expect(consentedMem.memory.consent_status).toBe('consented');

    // 4. Supersede memory item with updated value
    const supersedeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/memories/${mem1.id}/supersede`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      },
      payload: {
        value: 'Good morning, Managing Partner',
        confidence: 0.98,
        provenance: 'explicit_user_input'
      }
    });
    expect(supersedeRes.statusCode).toBe(200);
    const superseded = JSON.parse(supersedeRes.body);
    expect(superseded.success).toBe(true);
    expect(superseded.memory.key).toBe('preferred_greeting');
    expect(superseded.memory.value).toBe('Good morning, Managing Partner');
    expect(superseded.memory.id).not.toBe(mem1.id);

    // 5. Revoke consent on successor
    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/memories/${superseded.memory.id}/consent`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      }
    });
    expect(revokeRes.statusCode).toBe(200);
    expect(JSON.parse(revokeRes.body).memory.consent_status).toBe('revoked');
  });

  it('initiates and retrieves status of self-service privacy purge', async () => {
    // 1. Initiate privacy purge
    const purgeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy/purge',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      },
      payload: {
        mode: 'history_and_memory'
      }
    });

    expect(purgeRes.statusCode).toBe(202);
    const purge = JSON.parse(purgeRes.body);
    expect(purge.operation_id).toBeDefined();
    expect(purge.status).toBe('pending');

    // 2. Get purge operation status
    const statusRes = await app.inject({
      method: 'GET',
      url: `/api/v1/privacy/purge/${purge.operation_id}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}`
      }
    });

    expect(statusRes.statusCode).toBe(200);
    const statusBody = JSON.parse(statusRes.body);
    expect(statusBody.id).toBe(purge.operation_id);
    expect(statusBody.mode).toBe('history_and_memory');
    expect(statusBody.status).toBe('pending');
  });

  it('exports user conversation history and consented memories', async () => {
    // 1. Create conversation and memory for Alice
    await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      },
      payload: { title: 'Alice Project Alpha' }
    });

    const memRes = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      },
      payload: {
        scope: 'user',
        category: 'fact',
        key: 'project_role',
        value: 'Project Lead',
        provenance: 'explicit_user_input'
      }
    });
    const mem = JSON.parse(memRes.body);

    // Consent to memory
    await app.inject({
      method: 'POST',
      url: `/api/v1/memories/${mem.id}/consent`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      }
    });

    // 2. Export user history
    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/v1/privacy/export',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}`
      }
    });

    expect(exportRes.statusCode).toBe(200);
    const exportData = JSON.parse(exportRes.body);
    expect(exportData.conversations).toBeDefined();
    expect(exportData.memories).toBeDefined();
    expect(exportData.exported_at).toBeDefined();
  });

  it('enforces RBAC and justification requirements for administrative inspection', async () => {
    // Create conversation in Tenant A by Alice
    const convRes = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      },
      payload: { title: 'Confidential Executive Strategy' }
    });
    const conv = JSON.parse(convRes.body);

    // 1. Charlie (member role) attempts to inspect -> 403 Forbidden
    const memberInspectRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/inspect',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenMemberA}; ${CSRF_COOKIE_NAME}=${csrfTokenMemberA}`,
        'x-csrf-token': csrfTokenMemberA
      },
      payload: {
        conversation_id: conv.id,
        justification: 'Auditing conversation for compliance verification'
      }
    });
    expect(memberInspectRes.statusCode).toBe(403);

    // 2. Alice (owner role) attempts inspection with empty/short justification -> 400 Validation Error
    const shortJustifyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/inspect',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      },
      payload: {
        conversation_id: conv.id,
        justification: 'why'
      }
    });
    expect(shortJustifyRes.statusCode).toBe(400);

    // 3. Alice (owner role) provides valid justification -> 200 with audited inspection result
    const validInspectRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/inspect',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      },
      payload: {
        conversation_id: conv.id,
        justification: 'Mandatory quarterly audit review #4092'
      }
    });
    expect(validInspectRes.statusCode).toBe(200);
    const inspected = JSON.parse(validInspectRes.body);
    expect(inspected.conversation_id).toBe(conv.id);
  });

  it('enforces cross-tenant isolation: Tenant B cannot access Tenant A memories, purges, or inspection', async () => {
    // Tenant A creates memory
    const memRes = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      },
      payload: {
        scope: 'user',
        category: 'fact',
        key: 'secret_key',
        value: 'secret_value',
        provenance: 'explicit_user_input'
      }
    });
    const memA = JSON.parse(memRes.body);

    // Tenant B attempts to read Tenant A memory -> 404
    const getMemRes = await app.inject({
      method: 'GET',
      url: `/api/v1/memories/${memA.id}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenB}`
      }
    });
    expect(getMemRes.statusCode).toBe(404);

    // Tenant B attempts to consent to Tenant A memory -> 404 / 403
    const consentRes = await app.inject({
      method: 'POST',
      url: `/api/v1/memories/${memA.id}/consent`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenB}; ${CSRF_COOKIE_NAME}=${csrfTokenB}`,
        'x-csrf-token': csrfTokenB
      }
    });
    expect([403, 404]).toContain(consentRes.statusCode);

    // Tenant A creates purge operation
    const purgeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy/purge',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA
      },
      payload: { mode: 'history_and_memory' }
    });
    const purgeA = JSON.parse(purgeRes.body);

    // Tenant B attempts to read Tenant A purge status -> 404
    const getPurgeRes = await app.inject({
      method: 'GET',
      url: `/api/v1/privacy/purge/${purgeA.operation_id}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenB}`
      }
    });
    expect(getPurgeRes.statusCode).toBe(404);
  });
});
