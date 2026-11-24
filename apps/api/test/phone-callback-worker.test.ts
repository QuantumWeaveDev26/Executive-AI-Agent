import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalRepository, Migrator, PGliteDatabase, WorkspaceRepository, UserRepository, MembershipRepository,
  SessionRepository, generateSessionToken, hashSessionToken, type AuthenticatedScope } from '@thaara/db';
import { PhoneCallbackNotificationRepository } from '../src/services/phone-callback-notification-store.js';
import { projectCallbackRequest } from '../src/services/phone-callback-notification.js';
import { createPhoneCallbackWorker } from '../src/services/phone-callback-worker.js';
import { PHONE_CALLBACK_SENDER } from '../src/services/phone-callback-mail.js';
import { captureInboundFixtureAdmin } from './helpers/phone-inbound-fixture-identity.js';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { buildInboundServiceBinding, createSarvamInboundService } from '../src/services/phone-sarvam-inbound-service.js';
import { createInboundPrincipalTransactions } from '../src/services/phone-inbound-principal-postgres.js';
import { savePhoneCallbackInInboundTransaction } from '../src/services/phone-callback-inbound-store.js';
import { phoneInboundWorkflowRoutes } from '../src/routes/phone-inbound-workflow.js';

describe.skipIf(process.env.THAARA_PHONE115_SQL_TEST_APPROVED !== 'in-memory-only')('dedicated callback worker identity, isolated SQL', () => {
  let db: PGliteDatabase;
  let owner: AuthenticatedScope;
  let foreign: AuthenticatedScope;
  let store: PhoneCallbackNotificationRepository;
  let credential: string;
  let tokenHash: string;
  let fixtureAdmin: Awaited<ReturnType<typeof captureInboundFixtureAdmin>>;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const admin = async () => { await fixtureAdmin.restore(); };
  const asOwner = async () => { await admin(); await db.exec('SET ROLE thaara_app'); };
  const asWorker = async () => { await admin(); await db.exec('SET SESSION AUTHORIZATION thaara_phone_notify'); };
  const send = vi.fn(async () => ({ acceptedId: 'synthetic-worker-accepted' }));
  function worker(scope = owner, secret = credential) {
    return createPhoneCallbackWorker({ db, scope: { workspaceId: scope.workspaceId, userId: scope.userId }, credential: async () => secret, transport: { sender: PHONE_CALLBACK_SENDER, send } });
  }
  async function saveCall(scope: AuthenticatedScope, callId: string) {
    const request = projectCallbackRequest({ ...scope, callId, direction: 'inbound', occurredAt: new Date().toISOString(),
      verifiedNumber: '+919000000001', turns: [{ speaker: 'agent', text: 'Synthetic, Retail, Automation. May I record a callback request?' },
        { speaker: 'caller', text: 'Yes' }],
    }, { requested: true, name: 'Synthetic', business: 'Retail', service: 'Automation' })!;
    await new PhoneCallbackNotificationRepository(db, scope).save(request);
    return request;
  }
  async function authorize() {
    const proposal = await store.prepareNotificationGrant(owner, new Date(Date.now() + 86_400_000).toISOString());
    await db.withScopedTransaction(owner, tx => new ApprovalRepository(tx).transitionStatus(owner.workspaceId, proposal.approvalId, 'pending', 'approved', owner.userId));
    await store.activateNotificationGrant(owner, proposal.approvalId);
    return proposal.approvalId;
  }
  beforeAll(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles(root + 'packages/db/src/migrations'));
    fixtureAdmin = await captureInboundFixtureAdmin(db);
    async function identity(label: string): Promise<AuthenticatedScope> {
      const workspace = await new WorkspaceRepository(db).create(label);
      const user = await new UserRepository(db).create(label + '@example.test', 'unused', label);
      const token = generateSessionToken();
      const scope = { workspaceId: workspace.id, userId: user.id, role: 'owner' as const, sessionTokenHash: hashSessionToken(token) };
      await db.withScopedTransaction(scope, async tx => {
        await new MembershipRepository(tx).create(workspace.id, user.id, 'owner');
        await new SessionRepository(tx).create(user.id, workspace.id, token);
      });
      return scope;
    }
    owner = await identity('worker-owner');
    foreign = await identity('worker-foreign');
    for (const [step, path] of [[112, '112-phone-inbound-events.review.sql'], [113, '113-phone-inbound-principals.review.sql']] as const) {
      await db.query(`SELECT set_config('thaara.step${step}_review_approved','in-memory-only',false),set_config('thaara.step${step}_target_database',current_database(),false)`);
      await db.exec(readFileSync(root + 'docs/migrations/' + path, 'utf8'));
    }
    await db.query("SELECT set_config('thaara.step115_review_approved','in-memory-only',false),set_config('thaara.step115_target_database',current_database(),false)");
    for (const path of ['115-phone-callback-notification.review.sql', '115g-phone-callback-grants.review.sql',
      '115w-phone-callback-worker.review.sql', '115i-phone-callback-inbound-save.review.sql']) {
      await db.exec(readFileSync(root + 'docs/migrations/' + path, 'utf8'));
    }
    await asOwner();
    store = new PhoneCallbackNotificationRepository(db, owner);
    const approvalId = await authorize();
    await saveCall(owner, 'worker-first');
    await saveCall(foreign, 'foreign-first');
    await admin();
    credential = randomBytes(32).toString('hex');
    tokenHash = createHash('sha256').update(credential).digest('hex');
    await db.query(`INSERT INTO public.phone_callback_worker_principals(workspace_id,owner_user_id,approval_id,token_hash,expires_at)
      VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour')`, [owner.workspaceId, owner.userId, approvalId, tokenHash]);
  }, 60_000);
  beforeEach(asWorker);
  afterEach(admin);
  afterAll(async () => { if (db) { await admin(); await db.close(); } });

  it('uses a non-owner database session, sends once, and cannot read protected tables', async () => {
    expect((await db.query('SELECT session_user AS identity')).rows[0]?.identity).toBe('thaara_phone_notify');
    for (const table of ['phone_callback_requests', 'phone_callback_notification_grants', 'phone_callback_worker_principals', 'sessions']) {
      await expect(db.query('SELECT * FROM public.' + table)).rejects.toThrow();
    }
    expect((await worker().run()).map(result => result.result)).toEqual(['submitted']);
    expect(await worker().run()).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    await asOwner();
    const rows = await new PhoneCallbackNotificationRepository(db, foreign).list(foreign);
    expect(rows[0]).toMatchObject({ notificationStatus: 'pending', attempts: 0 });
  });

  it('rejects wrong credentials and scope without disclosing credentials or SQL', async () => {
    expect(() => createPhoneCallbackWorker({ db, scope: owner, credential: async () => credential,
      transport: { sender: PHONE_CALLBACK_SENDER, send } })).toThrow('service-only scope');
    await expect(worker(owner, 'a'.repeat(64)).run()).rejects.toThrow('Phone notification worker is unavailable.');
    await expect(worker(foreign).run()).rejects.toThrow('Phone notification worker is unavailable.');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses a worker role with unexpected direct data permissions', async () => {
    await admin();
    await db.exec('GRANT SELECT ON public.phone_callback_requests TO thaara_phone_notify');
    await asWorker();
    await expect(worker().run()).rejects.toThrow('Phone notification worker is unavailable.');
    await admin();
    await db.exec('REVOKE SELECT ON public.phone_callback_requests FROM thaara_phone_notify');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('binds result finalization to the claiming principal and permits its receipt after expiry', async () => {
    await asOwner();
    const request = await saveCall(owner, 'worker-attempt-owner');
    await asWorker();
    const sql = 'SELECT public.phone_callback_worker_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result';
    const grant = (await db.query<{ result: { data: { approvalId: string } } }>(sql,
      [tokenHash, owner.workspaceId, owner.userId, 'grant', null, null, null, null, null])).rows[0]!.result.data;
    const attempt = randomUUID();
    await db.query(sql, [tokenHash, owner.workspaceId, owner.userId, 'claim', request.id, attempt, null, null, grant.approvalId]);
    const otherHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    await admin();
    await db.query(`INSERT INTO public.phone_callback_worker_principals(workspace_id,owner_user_id,approval_id,token_hash,expires_at)
      VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour')`, [owner.workspaceId, owner.userId, grant.approvalId, otherHash]);
    await asWorker();
    await expect(db.query(sql, [otherHash, owner.workspaceId, owner.userId, 'finish', request.id, attempt, 'unverified', null, null])).rejects.toThrow('attempt changed');
    await admin();
    await db.query("UPDATE public.phone_callback_worker_principals SET expires_at=clock_timestamp()-interval '1 minute' WHERE token_hash=$1", [tokenHash]);
    await asWorker();
    await db.query(sql, [tokenHash, owner.workspaceId, owner.userId, 'finish', request.id, attempt, 'unverified', null, null]);
    await asOwner();
    expect(await store.read(owner, request.id)).toMatchObject({ notificationStatus: 'unverified' });
    await admin();
    await db.query("UPDATE public.phone_callback_worker_principals SET expires_at=clock_timestamp()+interval '1 hour' WHERE token_hash=$1", [tokenHash]);
  });

  it('rechecks principal expiry on each operation', async () => {
    await admin();
    await db.query("UPDATE public.phone_callback_worker_principals SET expires_at=clock_timestamp()-interval '1 minute' WHERE token_hash=$1", [tokenHash]);
    await asWorker();
    await expect(worker().run()).rejects.toThrow('Phone notification worker is unavailable.');
    await admin();
    await db.query("UPDATE public.phone_callback_worker_principals SET expires_at=clock_timestamp()+interval '1 hour' WHERE token_hash=$1", [tokenHash]);
  });

  it('records in-flight acceptance after revocation and blocks new work and replacement approval reuse', async () => {
    await asOwner();
    const finishing = await saveCall(owner, 'worker-finishing');
    await asWorker();
    const inFlight = createPhoneCallbackWorker({ db, scope: { workspaceId: owner.workspaceId, userId: owner.userId },
      credential: async () => credential, transport: { sender: PHONE_CALLBACK_SENDER, send: async () => {
        await asOwner();
        await store.revokeNotificationGrant(owner);
        await asWorker();
        return { acceptedId: 'accepted-before-revocation' };
      } } });
    expect((await inFlight.run()).map(result => result.result)).toEqual(['submitted']);
    await asOwner();
    expect(await store.read(owner, finishing.id)).toMatchObject({ notificationStatus: 'submitted', providerMessageId: 'accepted-before-revocation' });
    const pending = await saveCall(owner, 'worker-revoked');
    await asWorker();
    await expect(worker().run()).rejects.toThrow('Phone notification worker is unavailable.');
    await asOwner();
    expect(await store.read(owner, pending.id)).toMatchObject({ notificationStatus: 'pending', attempts: 0 });
    await authorize();
    await asWorker();
    await expect(worker().run()).rejects.toThrow('Phone notification worker is unavailable.');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('connects the inbound HTTP event, real service-role journal transaction, callback outbox and restricted worker', async () => {
    await asOwner();
    const approvalId = await authorize();
    await admin();
    credential = randomBytes(32).toString('hex');
    tokenHash = createHash('sha256').update(credential).digest('hex');
    await db.query(`INSERT INTO public.phone_callback_worker_principals(workspace_id,owner_user_id,approval_id,token_hash,expires_at)
      VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour')`, [owner.workspaceId, owner.userId, approvalId, tokenHash]);
    await asWorker();
    await worker().run();
    send.mockClear();
    await admin();
    const inboundCredential = randomBytes(32).toString('hex');
    const profile = { routeId: 'step115-inbound', workspaceId: owner.workspaceId, ownerUserId: owner.userId,
      principalId: randomUUID(), revision: 1, appId: 'synthetic-app', appVersion: 21,
      deploymentId: 'synthetic-deployment', agentPhoneNumber: '+918000000001', maxCallLengthSeconds: 300 as const };
    const binding = buildInboundServiceBinding(profile);
    await db.query(`INSERT INTO public.phone_inbound_principals(principal_id,workspace_id,owner_user_id,route_id,token_hash,
      profile_fingerprint,revision,operations,expires_at) VALUES($1,$2,$3,$4,$5,$6,1,ARRAY['callback','completion'],clock_timestamp()+interval '1 hour')`,
    [profile.principalId, owner.workspaceId, owner.userId, profile.routeId, createHash('sha256').update(inboundCredential).digest('hex'), binding.profileFingerprint]);
    const service = createSarvamInboundService({ profile, transactions: createInboundPrincipalTransactions({
      pool: { connect: async () => ({ query: db.query.bind(db), release: () => {} }) },
    }), saveCallbackInPrincipalTransaction: savePhoneCallbackInInboundTransaction });
    const app = Fastify();
    await app.register(async child => phoneInboundWorkflowRoutes(child, service), { prefix: '/api/v1' });
    const payload = { app_id: profile.appId, app_version: profile.appVersion, deployment_id: profile.deploymentId,
      agent_phone_number: profile.agentPhoneNumber, interaction_id: '20261111/synthetic-end-to-end', user_phone_number: '+919000000001',
      start_datetime: new Date(Date.now() - 20_000).toISOString(), end_datetime: new Date().toISOString(), duration: 20,
      final_agent_variables: { customer_name: 'Synthetic', business_type: 'Retail', requested_service: 'Automation', callback_preference: 'yes' },
      interaction_transcript: [{ role: 'agent', en_text: 'Synthetic, Retail, Automation. May I record a callback request for our team to contact you at +919000000001 and discuss a solution for your business?' },
        { role: 'user', en_text: 'Yes' }],
    };
    try {
      await admin();
      await db.exec('SET SESSION AUTHORIZATION thaara_phone_ingest');
      const url = '/api/v1/connectors/phone/inbound/completion/' + profile.routeId;
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(403);
      for (let index = 0; index < 2; index++) {
        const response = await app.inject({ method: 'POST', url, payload, headers: { authorization: 'Bearer ' + inboundCredential } });
        expect(response.statusCode).toBe(200);
        expect(response.json().saved).toBe(true);
      }
      await asWorker();
      await worker().run();
      await worker().run();
      expect(send).toHaveBeenCalledTimes(1);
      await asOwner();
      const rows = await store.list(owner);
      const inbound = rows.filter(row => row.callId.length === 64);
      expect(inbound).toHaveLength(1);
      expect(inbound[0]).toMatchObject({ direction: 'inbound', name: 'Synthetic', notificationStatus: 'submitted', attempts: 1 });
    } finally { await app.close(); }
  });
});
