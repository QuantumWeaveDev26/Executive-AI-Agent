import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresDatabase, PostgresWhatsAppStateStore, WorkspaceRepository, UserRepository, MembershipRepository, SessionRepository, ApprovalRepository, AuditEventRepository, generateSessionToken, hashSessionToken, type AuthenticatedScope } from '@thaara/db';
import { computeCanonicalParameterHash } from '@thaara/contracts';
import { defaultPolicyGateway } from '@thaara/policy';
import { getIsolatedRuntimeConfig } from '../../../scripts/step74-runtime-guard.mjs';
import { getCallbackRuntimeConfig, verifyCallbackFixture } from '../../../scripts/step1085-runtime-guard.mjs';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { waBinding, waDraft, waEvent, waStatus } from './helpers/whatsapp-durable-fixture.js';

// NOT RUN in Step 108.3/108.4 preflight. No migrations/DDL/grants/service startup in this suite.
// Future owner authorization + pre-applied SQL + verified disposable runtime are mandatory.
// Step 108.4 runbook uses a NEW tmpfs container with the existing Step74 endpoint guard.
if (process.env.THAARA_STEP1083_RUNTIME_APPROVED !== 'yes') throw new Error('Step 108.3 isolated runtime requires separate authorization.');
const isolated = process.env.THAARA_STEP1085_RUNTIME_APPROVED === 'yes'
  ? (verifyCallbackFixture(), getCallbackRuntimeConfig(process.env)) : getIsolatedRuntimeConfig(process.env);
describe('Step 108.3 restricted PostgreSQL runtime (separately authorized only)', () => {
  let admin: PostgresDatabase, app: PostgresDatabase, second: PostgresDatabase;
  let scope: AuthenticatedScope, other: AuthenticatedScope, peer: AuthenticatedScope;
  let binding: typeof waBinding, draft: typeof waDraft, approvalId: string;
  let store: PostgresWhatsAppStateStore, service: DurableWhatsAppService;
  const quietEvent = () => waEvent('wamid.' + randomUUID(), Date.now());
  async function identity(workspaceId?: string): Promise<AuthenticatedScope> {
    const suffix = randomUUID(), workspace = workspaceId ?? (await new WorkspaceRepository(admin).create('Step1083 ' + suffix)).id;
    const user = await new UserRepository(admin).create(suffix + '@step1083.test', 'unused-synthetic-hash', 'Synthetic');
    await new MembershipRepository(admin).create(workspace, user.id, 'owner');
    const token = generateSessionToken(); await new SessionRepository(admin).create(user.id, workspace, token);
    return { workspaceId: workspace, userId: user.id, role: 'owner', sessionTokenHash: hashSessionToken(token) };
  }
  beforeAll(async () => {
    admin = new PostgresDatabase(isolated.migrationUrl); app = new PostgresDatabase(isolated.appUrl); second = new PostgresDatabase(isolated.appUrl);
    expect((await admin.query('SELECT current_database() AS db')).rows[0].db).toBe(isolated.databaseName);
    expect((await app.query('SELECT current_user AS actor')).rows[0].actor).toBe('thaara_app');
    const role = (await app.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
    const { rows } = await admin.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE oid IN (to_regclass('public.whatsapp_n8n_connections'),to_regclass('public.whatsapp_n8n_messages'),to_regclass('public.whatsapp_n8n_dispatches'),to_regclass('public.whatsapp_n8n_status_events'),to_regclass('public.whatsapp_n8n_audit_proofs'))`);
    expect(rows).toHaveLength(5); expect(rows.every(r => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  });
  beforeEach(async () => {
    scope = await identity(); other = await identity(); peer = await identity(scope.workspaceId);
    binding = { ...structuredClone(waBinding), workspaceId: scope.workspaceId, userId: scope.userId, connectionId: 'wa_' + randomUUID() };
    draft = { ...waDraft, connectionId: binding.connectionId };
    const approval = await new ApprovalRepository(admin).create(scope.workspaceId, 'whatsapp.meta.messages.send', draft, scope.userId, 'high');
    await new ApprovalRepository(admin).transitionStatus(scope.workspaceId, approval.id, 'pending', 'approved', scope.userId); approvalId = approval.id;
    store = new PostgresWhatsAppStateStore(app); service = new DurableWhatsAppService(store, defaultPolicyGateway);
    await store.createOffline(scope, binding); await service.ingest(scope, binding.connectionId, quietEvent());
  });
  afterAll(async () => { await second?.close(); await app?.close(); await admin?.close(); });
  it('isolates workspace and owner using actual RLS and repeated repository scope', async () => {
    for (const denied of [other, peer]) {
      await expect(service.history(denied, binding.connectionId)).rejects.toThrow();
      const result = await app.withScopedTransaction(denied, tx => tx.query('SELECT * FROM public.whatsapp_n8n_connections WHERE connection_id=$1', [binding.connectionId]));
      expect(result.rows).toHaveLength(0);
    }
  });
  it('allows one atomic claim across independent database pools', async () => {
    const r = await service.reserve(scope, binding.connectionId, draft, approvalId);
    const another = new DurableWhatsAppService(new PostgresWhatsAppStateStore(second), defaultPolicyGateway);
    const claims = await Promise.allSettled([service.claim(scope, binding.connectionId, r.dispatchId!, 1), another.claim(scope, binding.connectionId, r.dispatchId!, 1)]);
    expect(claims.filter(c => c.status === 'fulfilled')).toHaveLength(1);
    const success = claims.find(c => c.status === 'fulfilled');
    expect(success?.status === 'fulfilled' && success.value).toMatchObject({ authorized: true, dispatchEnabled: false });
    await expect(another.claim(scope, binding.connectionId, r.dispatchId!, 1)).rejects.toThrow();
    const rows = await admin.query('SELECT claimed_at_ms FROM public.whatsapp_n8n_dispatches WHERE workspace_id=$1 AND dispatch_id=$2', [scope.workspaceId, r.dispatchId]);
    expect(rows.rows[0].claimed_at_ms).not.toBeNull();
  });
  it('retains deduplication and unknown claimed outcomes after pool recreation', async () => {
    const event = quietEvent(); await service.ingest(scope, binding.connectionId, event);
    const r = await service.reserve(scope, binding.connectionId, draft, approvalId); await service.claim(scope, binding.connectionId, r.dispatchId!, 1);
    const freshPool = new PostgresDatabase(isolated.appUrl);
    try {
      const fresh = new DurableWhatsAppService(new PostgresWhatsAppStateStore(freshPool), defaultPolicyGateway);
      expect(await fresh.ingest(scope, binding.connectionId, event)).toMatchObject({ duplicates: 1 });
      expect(await fresh.reserve(scope, binding.connectionId, draft, approvalId)).toMatchObject({ status: 'unverified', dispatchId: r.dispatchId });
      await expect(fresh.claim(scope, binding.connectionId, r.dispatchId!, 1)).rejects.toThrow();
    } finally { await freshPool.close(); }
  });
  it('fences disconnected revisions and forbids tombstone deletion by the app', async () => {
    const r = await service.reserve(scope, binding.connectionId, draft, approvalId); await service.disconnect(scope, binding.connectionId);
    await expect(service.claim(scope, binding.connectionId, r.dispatchId!, 1)).rejects.toThrow();
    await expect(store.createOffline(scope, binding)).rejects.toThrow();
    await expect(app.withScopedTransaction(scope, tx => tx.query('DELETE FROM public.whatsapp_n8n_connections WHERE connection_id=$1', [binding.connectionId]))).rejects.toThrow();
    expect(await service.status(scope, binding.connectionId)).toMatchObject({ revision: 2, disconnected: true });
  });
  it('rechecks revoked approval under the real transaction', async () => {
    const r = await service.reserve(scope, binding.connectionId, draft, approvalId);
    await new ApprovalRepository(admin).transitionStatus(scope.workspaceId, approvalId, 'approved', 'rejected', scope.userId);
    await expect(service.claim(scope, binding.connectionId, r.dispatchId!, 1)).rejects.toThrow();
  });
  it('correlates early provider statuses across pool instances', async () => {
    const r = await service.reserve(scope, binding.connectionId, draft, approvalId); await service.claim(scope, binding.connectionId, r.dispatchId!, 1);
    const status = waStatus('read', 'wamid.' + randomUUID()); status.statuses[0]!.timestamp = String(Math.floor(Date.now() / 1000));
    await service.ingest(scope, binding.connectionId, status);
    const fresh = new DurableWhatsAppService(new PostgresWhatsAppStateStore(second), defaultPolicyGateway);
    expect(await fresh.receipt(scope, binding.connectionId, { dispatchId: r.dispatchId!, providerMessageId: status.statuses[0]!.id, recipientAddress: '15550000001' })).toMatchObject({ status: 'read', verified: false });
  });
  it('rejects a session that expires while waiting for the connection lock', async () => {
    // Separate admin transaction holds the parent; app's transaction starts before expiry.
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { locked = resolve; });
    const blocker = admin.withScopedTransaction(scope, async tx => {
      await tx.query('SELECT connection_id FROM public.whatsapp_n8n_connections WHERE workspace_id=$1 AND connection_id=$2 FOR UPDATE', [scope.workspaceId, binding.connectionId]); locked(); await held;
    });
    await ready;
    const waiting = service.history(scope, binding.connectionId);
    // Observe the real lock wait before expiring the session; no timing-only assumption.
    const outcome = waiting.then(() => 'allowed', () => 'denied');
    try {
      let blocked = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        blocked = (await admin.query(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND usename='thaara_app' AND wait_event_type='Lock' AND query LIKE '%FROM public.whatsapp_n8n_connections%') AS blocked`)).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await admin.query("UPDATE public.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1", [scope.sessionTokenHash]);
    } finally { release(); await blocker; }
    expect(await outcome).toBe('denied');
  });
  it('rolls back reservation state when the audit SQL statement fails', async () => {
    const before = await admin.query('SELECT count(*)::int AS n FROM public.audit_events WHERE workspace_id=$1', [scope.workspaceId]);
    const faultStore = new PostgresWhatsAppStateStore({ withScopedTransaction: (caller, operation) => app.withScopedTransaction(caller, client => operation({
      query: async (sql, params) => sql.includes('INSERT INTO audit_events') ? client.query('SELECT 1/0') : client.query(sql, params)
    })) });
    const fault = new DurableWhatsAppService(faultStore, defaultPolicyGateway);
    await expect(fault.reserve(scope, binding.connectionId, draft, approvalId)).rejects.toThrow();
    expect((await admin.query('SELECT count(*)::int AS n FROM public.whatsapp_n8n_dispatches WHERE workspace_id=$1', [scope.workspaceId])).rows[0].n).toBe(0);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.audit_events WHERE workspace_id=$1', [scope.workspaceId])).rows).toEqual(before.rows);
  });
  it('rolls back both audit and dispatch INSERT after a database failure', async () => {
    const before = await admin.query('SELECT count(*)::int AS n FROM public.audit_events WHERE workspace_id=$1', [scope.workspaceId]);
    const faultStore = new PostgresWhatsAppStateStore({ withScopedTransaction: (caller, operation) => app.withScopedTransaction(caller, client => operation({
      query: async (sql, params) => { const result = await client.query(sql, params); if (sql.includes('INSERT INTO public.whatsapp_n8n_dispatches')) await client.query('SELECT 1/0'); return result; }
    })) });
    const fault = new DurableWhatsAppService(faultStore, defaultPolicyGateway);
    await expect(fault.reserve(scope, binding.connectionId, draft, approvalId)).rejects.toThrow();
    expect((await admin.query('SELECT count(*)::int AS n FROM public.whatsapp_n8n_dispatches WHERE workspace_id=$1', [scope.workspaceId])).rows[0].n).toBe(0);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.audit_events WHERE workspace_id=$1', [scope.workspaceId])).rows).toEqual(before.rows);
    expect(await service.reserve(scope, binding.connectionId, draft, approvalId)).toMatchObject({ status: 'not_configured', verified: false });
  });
  it('restricts effective app/worker privileges and privileged role membership', async () => {
    const tables = ['whatsapp_n8n_connections','whatsapp_n8n_messages','whatsapp_n8n_dispatches','whatsapp_n8n_status_events'];
    for (const table of tables) {
      const acl = (await admin.query(`SELECT has_table_privilege('thaara_app',$1,'SELECT') AS read,
        has_table_privilege('thaara_app',$1,'INSERT') AS insert,
        has_table_privilege('thaara_app',$1,'UPDATE') AS update,
        has_table_privilege('thaara_app',$1,'DELETE') AS delete,
        has_table_privilege('thaara_app',$1,'TRUNCATE') AS truncate,
        has_table_privilege('thaara_app',$1,'TRIGGER') AS trigger,
        has_table_privilege('thaara_app',$1,'REFERENCES') AS references,
        has_table_privilege('thaara_worker',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') AS worker`, ['public.' + table])).rows[0];
      expect(acl).toEqual({ read: true, insert: true, update: ['whatsapp_n8n_connections','whatsapp_n8n_dispatches'].includes(table), delete: false, truncate: false, trigger: false, references: false, worker: false });
    }
    const memberships = await admin.query(`SELECT r.rolname FROM pg_roles r WHERE
      (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolname IN ('thaara_admin','thaara_worker','thaara_seeder','thaara_definer','thaara_whatsapp_audit_guard'))
      AND pg_has_role('thaara_app',r.oid,'MEMBER')`);
    expect(memberships.rows).toHaveLength(0);
    const publicAcl = await admin.query(`SELECT c.relname FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid=ANY($1::regclass[]) AND a.grantee=0`, [tables.map(t => 'public.' + t)]);
    expect(publicAcl.rows).toHaveLength(0);
    await expect(admin.withScopedTransaction(scope, async tx => {
      await tx.query('SET LOCAL ROLE thaara_worker');
      return tx.query('SELECT * FROM public.whatsapp_n8n_connections');
    })).rejects.toThrow();
  });
  it('rejects a historical audit reused for a new inbound insert', async () => {
    // Original attack assertion retained. Revised SQL must pass after separate approval; NOT RUN yet.
    const old = (await admin.query(`SELECT a.id FROM public.audit_events a WHERE a.workspace_id=$1 AND a.target_id=$2
      AND a.action='whatsapp.durable.created'`, [scope.workspaceId, binding.connectionId])).rows[0];
    const record = { providerMessageId: 'wamid.' + randomUUID(), recipientId: 'ram', senderMaskedPhone: '***0001', textPreview: 'Synthetic replay', timestamp: new Date().toISOString(), mode: 'offline_test', untrusted: true };
    await expect(app.withScopedTransaction(scope, tx => tx.query(`INSERT INTO public.whatsapp_n8n_messages
      (workspace_id,owner_user_id,connection_id,provider_message_id,recipient_id,record,audit_id)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [scope.workspaceId, scope.userId, binding.connectionId, record.providerMessageId, record.recipientId, JSON.stringify(record), old.id]))).rejects.toThrow();
  });
  it('rejects a committed same-action events proof and alternating historical audit IDs', async () => {
    const old = (await admin.query(`SELECT audit_id FROM public.whatsapp_n8n_messages WHERE workspace_id=$1 AND connection_id=$2`, [scope.workspaceId, binding.connectionId])).rows[0];
    const record = { providerMessageId: 'wamid.' + randomUUID(), recipientId: 'ram', senderMaskedPhone: '***0001', textPreview: 'Synthetic replay', timestamp: new Date().toISOString(), mode: 'offline_test', untrusted: true };
    await expect(app.withScopedTransaction(scope, tx => tx.query(`INSERT INTO public.whatsapp_n8n_messages
      (workspace_id,owner_user_id,connection_id,provider_message_id,recipient_id,record,audit_id)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [scope.workspaceId, scope.userId, binding.connectionId, record.providerMessageId, record.recipientId, JSON.stringify(record), old.audit_id]))).rejects.toThrow(/fresh audit proof missing/);
    const audits = (await admin.query(`SELECT id FROM public.audit_events WHERE workspace_id=$1 AND target_id=$2 AND action LIKE 'whatsapp.durable.%' ORDER BY created_at`, [scope.workspaceId, binding.connectionId])).rows;
    expect(audits.length).toBeGreaterThanOrEqual(2);
    for (const audit of [audits[0], audits[1], audits[0]]) await expect(app.withScopedTransaction(scope, tx => tx.query(`UPDATE public.whatsapp_n8n_connections SET row_version=row_version+1,audit_id=$3
      WHERE workspace_id=$1 AND connection_id=$2`, [scope.workspaceId,binding.connectionId,audit.id]))).rejects.toThrow(/fresh audit proof missing/);
  });
  it('prevents application proof forgery, mutation and issuer-role assumption', async () => {
    const acl = (await admin.query(`SELECT has_table_privilege('thaara_app','public.whatsapp_n8n_audit_proofs','SELECT') AS read,
      has_table_privilege('thaara_app','public.whatsapp_n8n_audit_proofs','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') AS write,
      has_table_privilege('thaara_worker','public.whatsapp_n8n_audit_proofs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') AS worker,
      pg_has_role('thaara_app','thaara_whatsapp_audit_guard','MEMBER') AS member`)).rows[0];
    expect(acl).toEqual({ read: true, write: false, worker: false, member: false });
    await expect(app.withScopedTransaction(scope, tx => tx.query('UPDATE public.whatsapp_n8n_audit_proofs SET transaction_id=pg_current_xact_id()'))).rejects.toThrow(/permission denied/);
    await expect(app.withScopedTransaction(scope, tx => tx.query('INSERT INTO public.whatsapp_n8n_audit_proofs SELECT * FROM public.whatsapp_n8n_audit_proofs'))).rejects.toThrow(/permission denied/);
    await expect(app.withScopedTransaction(scope, tx => tx.query('SET LOCAL ROLE thaara_whatsapp_audit_guard'))).rejects.toThrow(/permission denied/);
  });
  it('binds each reserved audit to the exact dispatch even within one transaction', async () => {
    const intended = randomUUID(), other = randomUUID(), created = Date.now();
    const record = { id: other, draft, parameterHash: computeCanonicalParameterHash(draft), approvalId, createdAt: created, expiresAt: created+60000, claimedAt: null,
      receipt: { transport: 'n8n', mode: 'offline_test', dispatchId: other, providerMessageId: null, status: 'not_configured', verified: false } };
    await expect(app.withScopedTransaction(scope, async tx => {
      const audit = await new AuditEventRepository(tx).create(scope.workspaceId,'whatsapp.durable.reserved','whatsapp_connection',{dispatchId:intended},scope.userId,binding.connectionId);
      await tx.query('UPDATE public.whatsapp_n8n_connections SET row_version=row_version+1,audit_id=$3 WHERE workspace_id=$1 AND connection_id=$2',[scope.workspaceId,binding.connectionId,audit.id]);
      await tx.query(`INSERT INTO public.whatsapp_n8n_dispatches (workspace_id,owner_user_id,connection_id,dispatch_id,idempotency_key,parameter_hash,approval_id,created_at_ms,expires_at_ms,claimed_at_ms,provider_message_id,record,audit_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,$10::jsonb,$11)`, [scope.workspaceId,scope.userId,binding.connectionId,other,draft.idempotencyKey,record.parameterHash,approvalId,created,created+60000,JSON.stringify(record),audit.id]);
    })).rejects.toThrow(/reservation audit binding denied/);
  });
  it('rejects mixed proof identities for the same connection version', async () => {
    const record = { providerMessageId: 'wamid.'+randomUUID(), recipientId:'ram', senderMaskedPhone:'***0001', textPreview:'Synthetic mixed batch', timestamp:new Date().toISOString(), mode:'offline_test', untrusted:true };
    await expect(app.withScopedTransaction(scope, async tx => {
      const audit = new AuditEventRepository(tx);
      const first = await audit.create(scope.workspaceId,'whatsapp.durable.events','whatsapp_connection',{messages:1,statuses:0},scope.userId,binding.connectionId);
      const second = await audit.create(scope.workspaceId,'whatsapp.durable.events','whatsapp_connection',{messages:1,statuses:0},scope.userId,binding.connectionId);
      await tx.query('UPDATE public.whatsapp_n8n_connections SET row_version=row_version+1,audit_id=$3 WHERE workspace_id=$1 AND connection_id=$2',[scope.workspaceId,binding.connectionId,first.id]);
      await tx.query(`INSERT INTO public.whatsapp_n8n_messages (workspace_id,owner_user_id,connection_id,provider_message_id,recipient_id,record,audit_id)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,[scope.workspaceId,scope.userId,binding.connectionId,record.providerMessageId,record.recipientId,JSON.stringify(record),second.id]);
    })).rejects.toThrow(/audit batch version or identity denied/);
  });
  it('rejects a fresh audit with a forged actor and an event using a reservation audit', async () => {
    await expect(app.withScopedTransaction(scope, tx => new AuditEventRepository(tx).create(scope.workspaceId,'whatsapp.durable.events','whatsapp_connection',{},peer.userId,binding.connectionId))).rejects.toThrow(/audit issuance denied/);
    const record = { providerMessageId:'wamid.'+randomUUID(),recipientId:'ram',senderMaskedPhone:'***0001',textPreview:'Synthetic action replay',timestamp:new Date().toISOString(),mode:'offline_test',untrusted:true };
    await expect(app.withScopedTransaction(scope, async tx => {
      const audit = await new AuditEventRepository(tx).create(scope.workspaceId,'whatsapp.durable.reserved','whatsapp_connection',{dispatchId:randomUUID()},scope.userId,binding.connectionId);
      await tx.query('UPDATE public.whatsapp_n8n_connections SET row_version=row_version+1,audit_id=$3 WHERE workspace_id=$1 AND connection_id=$2',[scope.workspaceId,binding.connectionId,audit.id]);
      await tx.query(`INSERT INTO public.whatsapp_n8n_messages (workspace_id,owner_user_id,connection_id,provider_message_id,recipient_id,record,audit_id)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,[scope.workspaceId,scope.userId,binding.connectionId,record.providerMessageId,record.recipientId,JSON.stringify(record),audit.id]);
    })).rejects.toThrow(/event audit action denied/);
  });
  it('keeps WhatsApp source audits immutable and prevents relabeling another audit as WhatsApp', async () => {
    const audit = (await admin.query(`SELECT id FROM public.audit_events WHERE workspace_id=$1 AND target_id=$2 AND action='whatsapp.durable.created'`,[scope.workspaceId,binding.connectionId])).rows[0];
    await expect(app.withScopedTransaction(scope, tx => tx.query("UPDATE public.audit_events SET payload='{}'::jsonb WHERE id=$1",[audit.id]))).rejects.toThrow(/WhatsApp audit records are immutable/);
    await expect(app.withScopedTransaction(scope, tx => tx.query('DELETE FROM public.audit_events WHERE id=$1',[audit.id]))).rejects.toThrow(/WhatsApp audit records are immutable/);
    const approvalAudit = (await admin.query("SELECT id FROM public.audit_events WHERE workspace_id=$1 AND action='approval.created'",[scope.workspaceId])).rows[0];
    await expect(app.withScopedTransaction(scope, tx => tx.query("UPDATE public.audit_events SET action='whatsapp.durable.events' WHERE id=$1",[approvalAudit.id]))).rejects.toThrow(/WhatsApp audit records are immutable/);
  });
  it('does not reuse an audit proof rolled back to a savepoint in the same transaction', async () => {
    const before = (await admin.query('SELECT count(*)::int AS n FROM public.whatsapp_n8n_audit_proofs WHERE workspace_id=$1',[scope.workspaceId])).rows;
    await expect(app.withScopedTransaction(scope, async tx => {
      await tx.query('SAVEPOINT before_audit');
      const audit = await new AuditEventRepository(tx).create(scope.workspaceId,'whatsapp.durable.events','whatsapp_connection',{messages:0,statuses:0},scope.userId,binding.connectionId);
      await tx.query('ROLLBACK TO SAVEPOINT before_audit');
      await tx.query('UPDATE public.whatsapp_n8n_connections SET row_version=row_version+1,audit_id=$3 WHERE workspace_id=$1 AND connection_id=$2',[scope.workspaceId,binding.connectionId,audit.id]);
    })).rejects.toThrow(/fresh audit proof missing/);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.whatsapp_n8n_audit_proofs WHERE workspace_id=$1',[scope.workspaceId])).rows).toEqual(before);
  });
  it('allows one current events batch to persist multiple related rows without an automatic reply', async () => {
    const one = quietEvent(), two = quietEvent(), status = waStatus('sent','wamid.'+randomUUID());
    status.statuses[0]!.timestamp = String(Math.floor(Date.now()/1000));
    const result = await service.ingest(scope,binding.connectionId,{ ...one,messages:[...one.messages,...two.messages],statuses:status.statuses });
    expect(result).toMatchObject({ acceptedMessages:2,duplicates:0 });
    expect(await service.history(scope,binding.connectionId)).toHaveLength(3);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.whatsapp_n8n_dispatches WHERE workspace_id=$1',[scope.workspaceId])).rows[0].n).toBe(0);
  });
  it('rejects an approval that expires after reservation', async () => {
    const reservation = await service.reserve(scope,binding.connectionId,draft,approvalId);
    await admin.query("UPDATE public.approval_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[approvalId]);
    await expect(service.claim(scope,binding.connectionId,reservation.dispatchId!,1)).rejects.toThrow();
  });
  it('keeps sent/failed receipt evidence stable across out-of-order reload and replay', async () => {
    const reservation = await service.reserve(scope,binding.connectionId,draft,approvalId);
    await service.claim(scope,binding.connectionId,reservation.dispatchId!,1);
    const providerId = 'wamid.'+randomUUID(), sent = waStatus('sent',providerId), failed = waStatus('failed',providerId);
    const timestamp = Math.floor(Date.now()/1000); sent.statuses[0]!.timestamp=String(timestamp); failed.statuses[0]!.timestamp=String(timestamp+1);
    await service.ingest(scope,binding.connectionId,failed); await service.ingest(scope,binding.connectionId,sent);
    const receipt = { dispatchId:reservation.dispatchId!,providerMessageId:providerId,recipientAddress:'15550000001' };
    expect(await service.receipt(scope,binding.connectionId,receipt)).toMatchObject({ status:'failed',verified:false });
    const fresh = new DurableWhatsAppService(new PostgresWhatsAppStateStore(second),defaultPolicyGateway);
    expect(await fresh.receipt(scope,binding.connectionId,receipt)).toMatchObject({ status:'failed',verified:false });
  });
});
