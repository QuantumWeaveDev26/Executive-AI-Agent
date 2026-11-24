import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import {
  PGliteDatabase, Migrator, WorkspaceRepository, UserRepository,
  MembershipRepository, SessionRepository, generateSessionToken, hashSessionToken
} from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME } from '../src/plugins/auth.js';

describe('Step 71 read-only automation dashboard API', () => {
  let db: PGliteDatabase;
  let app: FastifyInstance;
  let workspaceId: string;
  let userId: string;
  let token: string;
  let otherToken: string;
  let revokedToken: string;
  let planId: string;
  let unverifiedId: string;
  let stepId: string;
  const enqueue = vi.fn();

  const headers = () => ({ cookie: `${SESSION_COOKIE_NAME}=${token}` });
  beforeAll(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());
    async function identity(name: string, role: 'owner' | 'viewer' = 'owner') {
      const workspace = await new WorkspaceRepository(db).create(name);
      const user = await new UserRepository(db).create(`${name}@example.test`, 'unused-test-hash', name);
      const sessionToken = generateSessionToken();
      const scope = { workspaceId: workspace.id, userId: user.id, role, sessionTokenHash: hashSessionToken(sessionToken) };
      await db.withScopedTransaction(scope, async (tx) => {
        await new MembershipRepository(tx).create(workspace.id, user.id, role);
        await new SessionRepository(tx).create(user.id, workspace.id, sessionToken);
      });
      return { workspace, user, sessionToken };
    }
    const a = await identity('dashboard-a', 'viewer');
    workspaceId = a.workspace.id;
    userId = a.user.id;
    token = a.sessionToken;
    otherToken = (await identity('dashboard-b')).sessionToken;
    revokedToken = (await identity('dashboard-revoked')).sessionToken;
    await db.query('UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1', [hashSessionToken(revokedToken)]);

    async function plan(title: string, status: string, stepStatus: string, action = 'automation.email.compose_workflow') {
      const p = await db.query<{id: string}>(`INSERT INTO plans (workspace_id, created_by_user_id, title, status, metadata)
        VALUES ($1,$2,$3,$4,'{"private":"private-sentinel","source":"chat_automation_orchestrator"}') RETURNING id`,
        [workspaceId, userId, title, status]);
      const id = p.rows[0]!.id;
      const s = await db.query<{id: string}>(`INSERT INTO plan_steps
        (workspace_id,plan_id,step_index,action_name,action_class,risk_level,approval_mode,parameters,parameter_hash,status)
        VALUES ($1,$2,0,$3,'write','low','explicit','{"secret":"private-sentinel"}',$4,$5) RETURNING id`,
        [workspaceId, id, action, 'a'.repeat(64), stepStatus]);
      return { id, step: s.rows[0]!.id };
    }
    const awaiting = await plan('Waiting automation', 'awaiting_approval', 'awaiting_approval');
    planId = awaiting.id;
    stepId = awaiting.step;
    const approval = await db.query<{id: string}>(`INSERT INTO approval_requests
      (workspace_id,action_name,action_params,requester_user_id,status,risk_level,expires_at)
      VALUES ($1,'automation.email.compose_workflow','{"secret":"private-sentinel"}',$2,'pending','low',NOW()+interval '1 day') RETURNING id`,
      [workspaceId, userId]);
    await db.query(`INSERT INTO plan_step_approval_bindings
      (workspace_id,plan_id,step_id,approval_request_id,parameter_hash) VALUES ($1,$2,$3,$4,$5)`,
      [workspaceId, planId, stepId, approval.rows[0]!.id, 'a'.repeat(64)]);
    unverifiedId = (await plan('Uncertain automation', 'failed', 'unverified')).id;
    const verified = await plan('Completed automation', 'completed', 'verified');
    await db.query(`INSERT INTO receipts
      (workspace_id,plan_id,plan_step_id,action_name,status,proof,verification_method,verified_at)
      VALUES ($1,$2,$3,'automation.email.compose_workflow','verified',
      '{"stagedArtifact":{"secret":"private-sentinel"},"accessToken":"private-sentinel"}','offline_schema_validation',NOW())`,
      [workspaceId, verified.id, verified.step]);
    // Unrelated plans must not be mislabelled as automations even when metadata is supplied by a caller.
    await plan('Unrelated plan', 'draft', 'blocked', 'system.read_status');
    // Exercise the routes as the non-superuser runtime role, with RLS enabled.
    await db.exec('SET ROLE thaara_app;');
    app = await buildApp({ db, config: loadConfig({ NODE_ENV: 'test' }), queueService: { enqueue } });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.close(); });

  it('runs reads under thaara_app with RLS rather than a superuser', async () => {
    expect((await db.query<{ current_user: string }>('SELECT current_user')).rows[0]!.current_user).toBe('thaara_app');
    expect((await db.query('SELECT id FROM plans')).rows).toEqual([]);
  });

  it('lists only real automations in the authenticated workspace with bounded pagination', async () => {
    const res = await app.inject({ url: '/api/v1/automations?limit=2', headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(2);
    expect(res.json().nextOffset).toBe(2);
    const next = await app.inject({ url: '/api/v1/automations?limit=2&offset=2', headers: headers() });
    expect(next.json().items).toHaveLength(1);
    expect(next.json().nextOffset).toBeNull();
    expect(new Set([...res.json().items, ...next.json().items].map((p: any) => p.id)).size).toBe(3);
    expect(res.body + next.body).not.toContain('Unrelated plan');
    expect(res.body + next.body).not.toContain('private-sentinel');
  });

  it('filters persisted plan status and truthful unverified outcomes before pagination', async () => {
    const res = await app.inject({ url: '/api/v1/automations?status=unverified&limit=1', headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((p: any) => p.id)).toEqual([unverifiedId]);
    expect(res.json().items[0]).toMatchObject({ status: 'failed', display_status: 'unverified' });
    const completed = await app.inject({ url: '/api/v1/automations?status=completed', headers: headers() });
    expect(completed.json().items[0]).toMatchObject({ status: 'completed', display_status: 'completed' });
  });

  it('returns bound approvals and ordered steps without action parameters or raw proof', async () => {
    const res = await app.inject({ url: `/api/v1/automations/${planId}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().steps[0]).toMatchObject({ id: stepId, status: 'awaiting_approval' });
    expect(res.json().approvals[0]).toMatchObject({ step_id: stepId, status: 'pending', requester_user_id: userId });
    expect(res.json().approvals[0].expires_at).toBeDefined();
    expect(res.body).not.toContain('private-sentinel');
    expect(res.json()).not.toHaveProperty('metadata');
    expect(res.json().steps[0]).not.toHaveProperty('parameters');
  });

  it('exposes verified receipt evidence without bypassing the protected artifact endpoint', async () => {
    const list = await app.inject({ url: '/api/v1/automations?status=completed', headers: headers() });
    const id = list.json().items[0].id;
    const res = await app.inject({ url: `/api/v1/automations/${id}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().receipts[0]).toMatchObject({ status: 'verified', verification_method: 'offline_schema_validation' });
    expect(res.json().receipts[0].verified_at).toBeTruthy();
    expect(res.json().receipts[0]).not.toHaveProperty('proof');
    expect(res.body).not.toContain('private-sentinel');
    const artifact = await app.inject({ url: `/api/v1/plans/${id}/workflow-artifact`, headers: headers() });
    expect(artifact.statusCode).toBe(404);
  });

  it('isolates another workspace listing and detail including forged workspace query input', async () => {
    const otherHeaders = { cookie: `${SESSION_COOKIE_NAME}=${otherToken}` };
    const list = await app.inject({ url: '/api/v1/automations', headers: otherHeaders });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toEqual([]);
    const detail = await app.inject({ url: `/api/v1/automations/${planId}`, headers: otherHeaders });
    expect(detail.statusCode).toBe(404);
    const forged = await app.inject({ url: `/api/v1/automations?workspaceId=${workspaceId}`, headers: otherHeaders });
    expect(forged.body).not.toContain('Waiting automation');
  });

  it('requires authentication and rejects revoked sessions on list and detail', async () => {
    for (const url of ['/api/v1/automations', `/api/v1/automations/${planId}`]) {
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect((await app.inject({ url, headers: { cookie: `${SESSION_COOKIE_NAME}=${revokedToken}` } })).statusCode).toBe(401);
    }
  });

  it('rejects invalid filters and pagination rather than silently returning misleading results', async () => {
    for (const query of ['status=made_up', 'limit=101', 'limit=0', 'offset=-1', 'status=verified']) {
      expect((await app.inject({ url: `/api/v1/automations?${query}`, headers: headers() })).statusCode).toBe(400);
    }
    expect((await app.inject({ url: '/api/v1/automations/not-a-uuid', headers: headers() })).statusCode).toBe(400);
  });

  it('refreshes current persisted state without reconciliation, queue submission or version changes', async () => {
    const scope = { workspaceId, userId, role: 'viewer' as const, sessionTokenHash: hashSessionToken(token) };
    const before = await db.withScopedTransaction(scope, (tx) => tx.query('SELECT id, status, version FROM plans ORDER BY id'));
    expect(before.rows).toHaveLength(4);
    for (let i = 0; i < 2; i++) {
      expect((await app.inject({ url: '/api/v1/automations', headers: headers() })).statusCode).toBe(200);
      expect((await app.inject({ url: `/api/v1/automations/${planId}`, headers: headers() })).statusCode).toBe(200);
    }
    const after = await db.withScopedTransaction(scope, (tx) => tx.query('SELECT id, status, version FROM plans ORDER BY id'));
    expect(after.rows).toEqual(before.rows);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
