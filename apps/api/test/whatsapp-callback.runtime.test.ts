import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PostgresDatabase, PostgresWhatsAppStateStore, WorkspaceRepository, UserRepository, MembershipRepository, SessionRepository, ApprovalRepository, AuditEventRepository, generateSessionToken, hashSessionToken, type AuthenticatedScope } from '@thaara/db';
import { defaultPolicyGateway } from '@thaara/policy';
import { getCallbackRuntimeConfig, verifyCallbackFixture } from '../../../scripts/step1085-runtime-guard.mjs';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappN8nRoutes } from '../src/routes/whatsapp-n8n.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '@thaara/config';
import { waBinding, waDraft, waEvent, waStatus } from './helpers/whatsapp-durable-fixture.js';

// No DDL/migrations/service startup here. New fixture + reviewed SQL require separate explicit approval.
const config = getCallbackRuntimeConfig(process.env); verifyCallbackFixture();
describe('Step1085 real PostgreSQL callback identity/security; separately approved only', () => {
  let admin: PostgresDatabase, app: PostgresDatabase, second: PostgresDatabase;
  let scope: AuthenticatedScope, peer: AuthenticatedScope, foreign: AuthenticatedScope, binding: typeof waBinding, draft: typeof waDraft, approvalId: string, digest: string, principalId: string, relayToken: string;
  let store: PostgresWhatsAppStateStore, service: DurableWhatsAppService;
  const privateSessions = new Map<string, string>();
  const event = () => waEvent('wamid.' + randomUUID(), Date.now());
  async function identity(workspaceId?: string): Promise<AuthenticatedScope> {
    const suffix = randomUUID(), workspace = workspaceId ?? (await new WorkspaceRepository(admin).create('Step1085 ' + suffix)).id;
    const user = await new UserRepository(admin).create(suffix + '@step1085.test', 'synthetic-unused-hash', 'Synthetic');
    await new MembershipRepository(admin).create(workspace, user.id, 'owner');
    const token = generateSessionToken(); await new SessionRepository(admin).create(user.id, workspace, token);
    privateSessions.set(user.id, token);
    return { workspaceId: workspace, userId: user.id, role: 'owner', sessionTokenHash: hashSessionToken(token) };
  }
  const resolve = (operation: 'events' | 'claim' | 'receipts') => service.resolveRelay(digest, binding.connectionId, operation);
  beforeAll(async () => {
    admin = new PostgresDatabase(config.migrationUrl); app = new PostgresDatabase(config.appUrl); second = new PostgresDatabase(config.appUrl);
    expect((await admin.query('SELECT current_database() AS db')).rows[0].db).toBe('thaara_step1085_test');
    expect((await app.query('SELECT current_user AS actor')).rows[0].actor).toBe('thaara_app');
  });
  beforeEach(async () => {
    scope = await identity(); peer = await identity(scope.workspaceId); foreign = await identity();
    binding = { ...structuredClone(waBinding), workspaceId: scope.workspaceId, userId: scope.userId, connectionId: 'wa_' + randomUUID() };
    draft = { ...waDraft, connectionId: binding.connectionId };
    store = new PostgresWhatsAppStateStore(app); service = new DurableWhatsAppService(store, defaultPolicyGateway);
    await store.createOffline(scope, binding); await service.ingest(scope, binding.connectionId, event());
    const a = await new ApprovalRepository(admin).create(scope.workspaceId, 'whatsapp.meta.messages.send', draft, scope.userId, 'high');
    await new ApprovalRepository(admin).transitionStatus(scope.workspaceId, a.id, 'pending', 'approved', scope.userId); approvalId = a.id;
    relayToken = randomBytes(32).toString('base64url'); digest = createHash('sha256').update(relayToken).digest('hex'); principalId = randomUUID();
    await admin.query(`INSERT INTO public.whatsapp_n8n_relay_principals(id,workspace_id,owner_user_id,connection_id,revision,token_hash,allowed_operations,enabled,expires_at)
      VALUES($1,$2,$3,$4,1,$5,ARRAY['events','claim','receipts'],true,clock_timestamp()+interval '30 minutes')`, [principalId, scope.workspaceId, scope.userId, binding.connectionId, digest]);
  });
  afterAll(async () => { await second?.close(); await app?.close(); await admin?.close(); });
  it('keeps principal hashes/guard role and approval mutation inaccessible to the app', async () => {
    await expect(app.query('SELECT token_hash FROM public.whatsapp_n8n_relay_principals')).rejects.toThrow();
    expect((await app.query("SELECT pg_has_role(current_user,'thaara_whatsapp_audit_guard','MEMBER') AS permitted")).rows[0].permitted).toBe(false);
    await resolve('claim');
    try {
      const result = await app.withWhatsAppRelayTransaction(digest, binding.connectionId, 'claim', tx => tx.query('UPDATE public.approval_requests SET status=$1 WHERE id=$2 RETURNING id', ['rejected', approvalId]));
      expect(result.rows).toHaveLength(0);
    } catch (error) { expect((error as { code?: string }).code).toBe('42501'); }
    expect((await admin.query('SELECT status FROM public.approval_requests WHERE id=$1', [approvalId])).rows[0].status).toBe('approved');
  });
  it('stores authenticated incoming events atomically, audits the principal and deduplicates without replying', async () => {
    const caller = await resolve('events'), incoming = event();
    expect(caller).not.toHaveProperty('sessionTokenHash');
    const http = Fastify({ logger: false }); http.decorateRequest('scope', undefined); http.decorate('requireAuth', async () => { throw Error('Browser routes not used in this machine-only fixture'); });
    http.setErrorHandler((error: any, _request, reply) => reply.code(error.statusCode ?? 500).send({ code: error.code ?? 'ERROR' }));
    try {
      await http.register(async child => whatsappN8nRoutes(child, undefined, service), { prefix: '/api/v1' });
      const call = () => http.inject({ method: 'POST', url: '/api/v1/connectors/whatsapp/n8n/relay/' + binding.connectionId + '/events', headers: { authorization: 'Bearer ' + relayToken }, payload: { event: incoming } });
      const received = await call(); expect(received.statusCode).toBe(200); expect(received.json()).toMatchObject({ acceptedMessages: 1 });
      expect((await call()).json()).toMatchObject({ acceptedMessages: 0, duplicates: 1 });
    } finally { await http.close(); }
    const audit = await admin.query("SELECT payload FROM public.audit_events WHERE workspace_id=$1 AND payload->>'principalId'=$2", [scope.workspaceId, principalId]);
    expect(audit.rows.length).toBeGreaterThan(0); expect(audit.rows.every(a => a.payload.actorKind === 'whatsapp_relay')).toBe(true);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.whatsapp_n8n_dispatches WHERE workspace_id=$1', [scope.workspaceId])).rows[0].n).toBe(0);
  });
  it('ignores forged tenant/user GUCs and preserves browser owner/workspace isolation', async () => {
    await app.withWhatsAppRelayTransaction(digest, binding.connectionId, 'events', async tx => {
      await tx.query("SELECT set_config('app.workspace_id',$1,true),set_config('app.user_id',$2,true)", [foreign.workspaceId, peer.userId]);
      const rows = await tx.query('SELECT workspace_id,owner_user_id,connection_id FROM public.whatsapp_n8n_connections');
      expect(rows.rows).toEqual([{ workspace_id: scope.workspaceId, owner_user_id: scope.userId, connection_id: binding.connectionId }]);
    });
    for (const denied of [peer, foreign]) await expect(service.inbox(denied, binding.connectionId)).rejects.toThrow();
    // Full production registration, real session resolver and restricted-role store; no listener.
    const http = await buildApp({ db: app, config: loadConfig({ NODE_ENV: 'test' }) });
    const base = '/api/v1/connectors/whatsapp/n8n/durable/' + binding.connectionId;
    const owner = { cookie: 'thaara_session=' + privateSessions.get(scope.userId) + '; thaara_csrf=fixture-csrf', 'x-csrf-token': 'fixture-csrf' };
    try {
      expect((await http.inject({ url: base + '/status' })).statusCode).toBe(401);
      const catalog = await http.inject({ url: '/api/v1/connectors/whatsapp/n8n/durable/connections', headers: owner });
      expect(catalog.statusCode).toBe(200); expect(catalog.json().connections).toEqual([{ connectionId: binding.connectionId, revision: 1, disconnected: false }]);
      expect(catalog.body).not.toContain(scope.sessionTokenHash);
      expect((await http.inject({ url: base + '/inbox', headers: owner })).json()).toMatchObject({ liveSendingEnabled: false, messages: [{ direction: 'inbound' }] });
      for (const other of [peer, foreign]) {
        const h = { cookie: 'thaara_session=' + privateSessions.get(other.userId) };
        expect((await http.inject({ url: '/api/v1/connectors/whatsapp/n8n/durable/connections', headers: h })).json().connections).toEqual([]);
        expect((await http.inject({ url: base + '/status', headers: h })).statusCode).toBe(403);
      }
      const body = { draft, approvalId };
      expect((await http.inject({ method: 'POST', url: base + '/dispatches', headers: { cookie: owner.cookie }, payload: body })).statusCode).toBe(403);
      const reservation = await http.inject({ method: 'POST', url: base + '/dispatches', headers: owner, payload: body });
      expect(reservation.statusCode).toBe(200); expect(reservation.json()).toMatchObject({ status: 'not_configured', verified: false });
      expect((await http.inject({ method: 'POST', url: '/api/v1/connectors/whatsapp/n8n/dispatches', headers: owner, payload: body })).json()).toEqual(reservation.json());
      // The default callback registration uses the durable principal, never the memory bridge.
      const relay = await http.inject({ method: 'POST', url: '/api/v1/connectors/whatsapp/n8n/relay/' + binding.connectionId + '/events', headers: { authorization: 'Bearer ' + relayToken }, payload: { event: event() } });
      expect(relay.statusCode).toBe(200); expect(relay.json().acceptedMessages).toBe(1);
      expect((await http.inject({ method: 'DELETE', url: base + '/connection', headers: owner })).json()).toEqual({ disconnected: true, revision: 2 });
      expect((await http.inject({ method: 'POST', url: base + '/dispatches', headers: owner, payload: body })).statusCode).toBe(403);
    } finally { await http.close(); }
  });
  it('rejects wrong hashes, connection IDs and disallowed operations', async () => {
    await expect(service.resolveRelay('0'.repeat(64), binding.connectionId, 'events')).rejects.toThrow();
    await expect(service.resolveRelay(digest, 'other_connection', 'events')).rejects.toThrow();
    await admin.query("UPDATE public.whatsapp_n8n_relay_principals SET allowed_operations=ARRAY['events'] WHERE id=$1", [principalId]);
    await expect(resolve('claim')).rejects.toThrow(); await expect(resolve('receipts')).rejects.toThrow();
  });
  it('denies mixed browser/callback identity and rolls back the transaction', async () => {
    await expect(app.withWhatsAppRelayTransaction(digest, binding.connectionId, 'events', async tx => {
      await tx.query("SELECT set_config('app.session_token_hash',$1,true)", [scope.sessionTokenHash]);
      expect((await tx.query('SELECT * FROM public.current_whatsapp_runtime_scope()')).rows).toHaveLength(0);
    })).rejects.toThrow();
  });
  it('revalidates a revoked principal rather than trusting a cached scope', async () => {
    const caller = await resolve('events'); await admin.query('UPDATE public.whatsapp_n8n_relay_principals SET revoked_at=clock_timestamp() WHERE id=$1', [principalId]);
    await expect(service.ingest(caller, binding.connectionId, event())).rejects.toThrow();
  });
  it('denies an expired principal using the wall clock', async () => {
    await admin.query("UPDATE public.whatsapp_n8n_relay_principals SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1", [principalId]);
    await expect(resolve('events')).rejects.toThrow();
  });
  it('fences demoted membership without a browser session fallback', async () => {
    const caller = await resolve('events'); await admin.query("UPDATE public.memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2", [scope.workspaceId, scope.userId]);
    await expect(service.ingest(caller, binding.connectionId, event())).rejects.toThrow();
  });
  it('fences callbacks after disconnect and revision change', async () => {
    const caller = await resolve('events'); await service.disconnect(scope, binding.connectionId);
    await expect(service.ingest(caller, binding.connectionId, event())).rejects.toThrow();
  });
  it('allows one callback claim across independent pools and never enables a send', async () => {
    const reserved = await service.reserve(scope, binding.connectionId, draft, approvalId), caller = await resolve('claim');
    const other = new DurableWhatsAppService(new PostgresWhatsAppStateStore(second), defaultPolicyGateway);
    const results = await Promise.allSettled([service.claim(caller, binding.connectionId, reserved.dispatchId!, 1), other.claim(caller, binding.connectionId, reserved.dispatchId!, 1)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const won = results.find(r => r.status === 'fulfilled'); expect(won?.status === 'fulfilled' && won.value).toMatchObject({ authorized: true, dispatchEnabled: false });
  });
  it('rechecks the exact fresh approval before a callback can claim', async () => {
    const reserved = await service.reserve(scope, binding.connectionId, draft, approvalId), caller = await resolve('claim');
    await new ApprovalRepository(admin).transitionStatus(scope.workspaceId, approvalId, 'approved', 'rejected', scope.userId);
    await expect(service.claim(caller, binding.connectionId, reserved.dispatchId!, 1)).rejects.toThrow();
    expect((await admin.query('SELECT claimed_at_ms FROM public.whatsapp_n8n_dispatches WHERE dispatch_id=$1', [reserved.dispatchId])).rows[0].claimed_at_ms).toBeNull();
  });
  it('correlates receipts and statuses without accepting a wrong recipient or fabricating verification', async () => {
    const reserved = await service.reserve(scope, binding.connectionId, draft, approvalId); await service.claim(await resolve('claim'), binding.connectionId, reserved.dispatchId!, 1);
    const receipt = { dispatchId: reserved.dispatchId!, providerMessageId: 'wamid.' + randomUUID(), recipientAddress: '15550000001' };
    await expect(service.receipt(await resolve('receipts'), binding.connectionId, { ...receipt, recipientAddress: '15550000002' })).rejects.toThrow();
    expect(await service.receipt(await resolve('receipts'), binding.connectionId, receipt)).toMatchObject({ status: 'unverified', verified: false });
    const status = waStatus('read', receipt.providerMessageId); status.statuses[0]!.timestamp = String(Math.floor(Date.now() / 1000));
    await service.ingest(await resolve('events'), binding.connectionId, status);
    expect((await service.inbox(scope, binding.connectionId)).messages.find(m => m.direction === 'outbound')).toMatchObject({ status: 'read', verified: false, mode: 'offline_test' });
  });
  it('rejects direct-SQL provider association by an events-only principal with a fresh audit proof', async () => {
    const reserved = await service.reserve(scope, binding.connectionId, draft, approvalId); await service.claim(scope, binding.connectionId, reserved.dispatchId!, 1);
    await admin.query("UPDATE public.whatsapp_n8n_relay_principals SET allowed_operations=ARRAY['events'] WHERE id=$1", [principalId]);
    const before = (await admin.query('SELECT count(*)::int AS n FROM public.audit_events WHERE workspace_id=$1', [scope.workspaceId])).rows[0].n;
    await expect(app.withWhatsAppRelayTransaction(digest, binding.connectionId, 'events', async tx => {
      const audit = await new AuditEventRepository(tx).create(scope.workspaceId, 'whatsapp.durable.events', 'whatsapp_connection', { actorKind: 'whatsapp_relay', principalId, relayOperation: 'events' }, scope.userId, binding.connectionId);
      await tx.query('UPDATE public.whatsapp_n8n_connections SET row_version=row_version+1,audit_id=$1 WHERE workspace_id=$2 AND owner_user_id=$3 AND connection_id=$4', [audit.id, scope.workspaceId, scope.userId, binding.connectionId]);
      await tx.query(`UPDATE public.whatsapp_n8n_dispatches SET provider_message_id='wamid.forged',record=jsonb_set(record,'{receipt,providerMessageId}','"wamid.forged"'),audit_id=$1 WHERE dispatch_id=$2`, [audit.id, reserved.dispatchId]);
    })).rejects.toThrow(/events cannot associate provider receipts/);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.audit_events WHERE workspace_id=$1', [scope.workspaceId])).rows[0].n).toBe(before);
  });
  it('rejects historical audit reuse from a new callback transaction', async () => {
    await service.ingest(await resolve('events'), binding.connectionId, event());
    await expect(app.withWhatsAppRelayTransaction(digest, binding.connectionId, 'events', tx => tx.query('UPDATE public.whatsapp_n8n_connections SET row_version=row_version+1 WHERE connection_id=$1', [binding.connectionId]))).rejects.toThrow();
  });
});
