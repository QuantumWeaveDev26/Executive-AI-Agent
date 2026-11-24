import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import {
  PGliteDatabase,
  Migrator,
  WorkspaceRepository,
  UserRepository,
  MembershipRepository,
  SessionRepository,
  AuditEventRepository,
  generateSessionToken,
  hashSessionToken
} from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME } from '../src/plugins/auth.js';

describe('Cross-Tenant API Boundary Isolation', () => {
  let app: FastifyInstance;
  let db: PGliteDatabase;

  let sessionTokenA: string;
  let sessionTokenB: string;
  let workspaceAId: string;
  let workspaceBId: string;

  beforeEach(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);
    const memberRepo = new MembershipRepository(db);
    const sessionRepo = new SessionRepository(db);

    // Workspace A & User A
    const wsA = await wsRepo.create('Tenant Alpha');
    workspaceAId = wsA.id;
    const userA = await userRepo.create('alice@alpha.com', 'hashA', 'Alice');
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

    // Workspace B & User B
    const wsB = await wsRepo.create('Tenant Beta');
    workspaceBId = wsB.id;
    const userB = await userRepo.create('bob@beta.com', 'hashB', 'Bob');
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

    // Seed private audit records into Workspace A
    await db.withScopedTransaction(scopeA, async (txClient) => {
      const auditRepo = new AuditEventRepository(txClient);
      await auditRepo.create(wsA.id, 'alpha.sensitive_report', 'doc', { classified: true });
    });

    const config = loadConfig({ NODE_ENV: 'test' });
    app = await buildApp({ db, config });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('prohibits User B from viewing User A audit logs', async () => {
    // User A can see Alpha's records
    const resA = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}`
      }
    });
    expect(resA.statusCode).toBe(200);
    const bodyA = JSON.parse(resA.body);
    expect(bodyA.events.length).toBe(1);
    expect(bodyA.events[0].action).toBe('alpha.sensitive_report');

    // User B querying audit logs receives only Workspace B records (0)
    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenB}`
      }
    });
    expect(resB.statusCode).toBe(200);
    const bodyB = JSON.parse(resB.body);
    expect(bodyB.events.length).toBe(0);
  });
});
