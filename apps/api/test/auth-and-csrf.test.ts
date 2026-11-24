import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import {
  PGliteDatabase,
  Migrator,
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

describe('API Auth, Sessions, and CSRF Protection', () => {
  let app: FastifyInstance;
  let db: PGliteDatabase;

  beforeEach(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const config = loadConfig({ NODE_ENV: 'test' });
    app = await buildApp({ db, config });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests to protected routes with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me'
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('allows initial bootstrap, but rejects second bootstrap call with 403', async () => {
    // 1. Initial bootstrap
    const bootstrapRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bootstrap',
      payload: {
        workspaceName: 'Alpha Corp',
        displayName: 'Alpha Founder',
        email: 'founder@alphacorp.com',
        password: 'SuperSecurePassword123!'
      }
    });

    expect(bootstrapRes.statusCode).toBe(201);
    const body = JSON.parse(bootstrapRes.body);
    expect(body.email).toBe('founder@alphacorp.com');
    expect(body.role).toBe('owner');

    // 2. Second bootstrap attempt fails
    const secondBootstrapRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bootstrap',
      payload: {
        workspaceName: 'Beta Corp',
        displayName: 'Intruder',
        email: 'intruder@betacorp.com',
        password: 'SuperSecurePassword123!'
      }
    });

    expect(secondBootstrapRes.statusCode).toBe(403);
    const errBody = JSON.parse(secondBootstrapRes.body);
    expect(errBody.error.code).toBe('FORBIDDEN');
  });

  it('enforces CSRF on mutating requests and allows execution with valid CSRF header', async () => {
    // Bootstrap first
    const bootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bootstrap',
      payload: {
        workspaceName: 'Alpha Corp',
        displayName: 'Alpha Founder',
        email: 'founder@alphacorp.com',
        password: 'SuperSecurePassword123!'
      }
    });

    const bootCookies = bootRes.cookies;
    const sessionCookie = bootCookies.find((c) => c.name === SESSION_COOKIE_NAME)!;
    const csrfCookie = bootCookies.find((c) => c.name === CSRF_COOKIE_NAME)!;

    // Mutating request WITHOUT CSRF token header fails with 403 CSRF_INVALID
    const withoutCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}; ${CSRF_COOKIE_NAME}=${csrfCookie.value}`
      },
      payload: {
        actionName: 'system.reset_connector',
        actionParams: {},
        riskLevel: 'high'
      }
    });

    expect(withoutCsrf.statusCode).toBe(403);
    expect(JSON.parse(withoutCsrf.body).error.code).toBe('CSRF_INVALID');

    // Mutating request WITH valid CSRF token header succeeds
    const withCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}; ${CSRF_COOKIE_NAME}=${csrfCookie.value}`,
        'x-csrf-token': csrfCookie.value
      },
      payload: {
        actionName: 'system.reset_connector',
        actionParams: {},
        riskLevel: 'high'
      }
    });

    expect(withCsrf.statusCode).toBe(201);
    const createdApproval = JSON.parse(withCsrf.body);
    expect(createdApproval.actionName).toBe('system.reset_connector');
  });

  it('revokes session on logout, causing subsequent requests to fail immediately', async () => {
    // Bootstrap
    const bootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bootstrap',
      payload: {
        workspaceName: 'Alpha Corp',
        displayName: 'Alpha Founder',
        email: 'founder@alphacorp.com',
        password: 'SuperSecurePassword123!'
      }
    });

    const sessionCookie = bootRes.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!;
    const csrfCookie = bootRes.cookies.find((c) => c.name === CSRF_COOKIE_NAME)!;

    // Authenticated request works
    const meRes1 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}`
      }
    });
    expect(meRes1.statusCode).toBe(200);

    // Logout
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}; ${CSRF_COOKIE_NAME}=${csrfCookie.value}`,
        'x-csrf-token': csrfCookie.value
      }
    });
    expect(logoutRes.statusCode).toBe(200);

    // Attempting to reuse old session token fails immediately with 401
    const meRes2 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}`
      }
    });
    expect(meRes2.statusCode).toBe(401);
  });

  it('rejects tampered or non-existent session tokens with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=invalid_or_tampered_token_string_here`
      }
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED');
  });

  it('enforces RBAC and two-person rule on approval decisions', async () => {
    // 1. Bootstrap workspace with Owner
    const bootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bootstrap',
      payload: {
        workspaceName: 'Secure Org',
        displayName: 'Owner User',
        email: 'owner@secureorg.com',
        password: 'SuperSecurePassword123!'
      }
    });
    const ownerSessionCookie = bootRes.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!;
    const ownerCsrfCookie = bootRes.cookies.find((c) => c.name === CSRF_COOKIE_NAME)!;
    const bootData = JSON.parse(bootRes.body);
    const workspaceId = bootData.workspaceId;

    // 2. Owner creates a critical-risk approval request
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${ownerSessionCookie.value}; ${CSRF_COOKIE_NAME}=${ownerCsrfCookie.value}`,
        'x-csrf-token': ownerCsrfCookie.value
      },
      payload: {
        actionName: 'database.drop_replica',
        actionParams: { target: 'us-east-replica' },
        riskLevel: 'critical'
      }
    });
    expect(createRes.statusCode).toBe(201);
    const approvalId = JSON.parse(createRes.body).id;

    // 3. Owner attempts to approve their own critical-risk request -> 403 (two-person rule)
    const selfApproveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${ownerSessionCookie.value}; ${CSRF_COOKIE_NAME}=${ownerCsrfCookie.value}`,
        'x-csrf-token': ownerCsrfCookie.value
      },
      payload: { status: 'approved' }
    });
    expect(selfApproveRes.statusCode).toBe(403);
    expect(JSON.parse(selfApproveRes.body).error.message).toContain('Two-person rule violation');

    // 4. Create a second user with 'member' role (not admin/owner)
    const userRepo = new UserRepository(db);
    const memberRepo = new MembershipRepository(db);
    const sessionRepo = new SessionRepository(db);

    const memberUser = await userRepo.create('member@secureorg.com', 'hashed_pass', 'Regular Member');
    await db.withScopedTransaction(
      {
        workspaceId,
        userId: bootData.userId,
        role: 'owner',
        sessionTokenHash: hashSessionToken(ownerSessionCookie.value)
      },
      async (txClient) => {
        const mRepo = new MembershipRepository(txClient);
        await mRepo.create(workspaceId, memberUser.id, 'member');
      }
    );

    const memberToken = generateSessionToken();
    await db.withScopedTransaction(
      {
        workspaceId,
        userId: memberUser.id,
        role: 'member',
        sessionTokenHash: hashSessionToken(memberToken)
      },
      async (txClient) => {
        const sRepo = new SessionRepository(txClient);
        await sRepo.create(memberUser.id, workspaceId, memberToken);
      }
    );
    const memberCsrf = generateCsrfToken();

    // 5. Member tries to approve -> 403 (RBAC restriction)
    const memberApproveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${memberToken}; ${CSRF_COOKIE_NAME}=${memberCsrf}`,
        'x-csrf-token': memberCsrf
      },
      payload: { status: 'approved' }
    });
    expect(memberApproveRes.statusCode).toBe(403);
    expect(JSON.parse(memberApproveRes.body).error.message).toContain('Only workspace owners and admins');

    // 6. Create a third user with 'admin' role
    const adminUser = await userRepo.create('admin@secureorg.com', 'hashed_pass', 'Admin User');
    await db.withScopedTransaction(
      {
        workspaceId,
        userId: bootData.userId,
        role: 'owner',
        sessionTokenHash: hashSessionToken(ownerSessionCookie.value)
      },
      async (txClient) => {
        const mRepo = new MembershipRepository(txClient);
        await mRepo.create(workspaceId, adminUser.id, 'admin');
      }
    );

    const adminToken = generateSessionToken();
    await db.withScopedTransaction(
      {
        workspaceId,
        userId: adminUser.id,
        role: 'admin',
        sessionTokenHash: hashSessionToken(adminToken)
      },
      async (txClient) => {
        const sRepo = new SessionRepository(txClient);
        await sRepo.create(adminUser.id, workspaceId, adminToken);
      }
    );
    const adminCsrf = generateCsrfToken();

    // 7. Admin approves the owner's request -> succeeds with 200
    const adminApproveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${adminToken}; ${CSRF_COOKIE_NAME}=${adminCsrf}`,
        'x-csrf-token': adminCsrf
      },
      payload: { status: 'approved' }
    });
    expect(adminApproveRes.statusCode).toBe(200);
    expect(JSON.parse(adminApproveRes.body).status).toBe('approved');
    expect(JSON.parse(adminApproveRes.body).approverUserId).toBe(adminUser.id);

    // 8. Retrying the same approved decision is safely idempotent (200), while a conflicting rejection fails with 403
    const duplicateApproveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${adminToken}; ${CSRF_COOKIE_NAME}=${adminCsrf}`,
        'x-csrf-token': adminCsrf
      },
      payload: { status: 'approved' }
    });
    expect(duplicateApproveRes.statusCode).toBe(200);
    expect(JSON.parse(duplicateApproveRes.body).status).toBe('approved');
    expect(JSON.parse(duplicateApproveRes.body).approverUserId).toBe(adminUser.id);

    const conflictingRejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${adminToken}; ${CSRF_COOKIE_NAME}=${adminCsrf}`,
        'x-csrf-token': adminCsrf
      },
      payload: { status: 'rejected' }
    });
    expect(conflictingRejectRes.statusCode).toBe(403);
    expect(JSON.parse(conflictingRejectRes.body).error.message).toContain('already in status');
  });
});
