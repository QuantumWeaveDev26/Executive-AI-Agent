import { describe, expect, it } from 'vitest';
import { waScope, waBinding, waDraft, waNow, waApproval } from '../../../apps/api/test/helpers/whatsapp-durable-fixture.js';
import { computeCanonicalParameterHash } from '@thaara/contracts';
const implementation = await import('../src/repositories/whatsapp-postgres.js').catch(() => null);

function harness(options: { authorize?: boolean; missing?: boolean; failAudit?: boolean; dispatch?: any; message?: any; createConflict?: boolean; staleProof?: boolean; catalogTampered?: boolean; catalogOverflow?: boolean } = {}) {
  const calls: { sql: string; params: any[] }[] = [];
  let committed = false, rolledBack = false;
  const client = { query: async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('current_authenticated_scope')) return { rows: options.authorize === false ? [] : [{ workspace_id: waScope.workspaceId, user_id: waScope.userId, role: waScope.role }] };
    if (sql.includes('FROM public.whatsapp_n8n_connections')) return { rows: options.missing ? [] : Array.from({ length: options.catalogOverflow ? 21 : 1 }, () => ({ connection_id: options.catalogTampered ? 'wrong_key' : waBinding.connectionId, binding: structuredClone(waBinding), disconnected: false, revision: '1', row_version: '1' })) };
    if (sql.includes('FROM public.whatsapp_n8n_dispatches') && options.dispatch) return { rows: [{ record: structuredClone(options.dispatch) }] };
    if (sql.includes('FROM public.whatsapp_n8n_messages') && options.message) return { rows: [structuredClone(options.message)] };
    if (sql.includes('INSERT INTO audit_events')) { if (options.failAudit) throw new Error('audit failed'); return { rows: [{ id: '77777777-7777-4777-8777-777777777777' }] }; }
    if (sql.includes('FROM public.whatsapp_n8n_audit_proofs')) return { rows: options.staleProof ? [] : [{ audit_id: '77777777-7777-4777-8777-777777777777' }] };
    if (sql.includes('UPDATE public.whatsapp_n8n_connections')) return { rows: [{ row_version: '2' }] };
    if (sql.includes('INSERT INTO public.whatsapp_n8n_connections')) return { rows: options.createConflict ? [] : [{ connection_id: waBinding.connectionId }] };
    return { rows: [] };
  } };
  const db = { ...client, withScopedTransaction: async (_scope: any, operation: any) => {
    try { const result = await operation(client); committed = true; return result; } catch (e) { rolledBack = true; throw e; }
  } };
  expect(implementation?.PostgresWhatsAppStateStore, 'PostgreSQL repository exists').toBeTypeOf('function');
  const store = new implementation!.PostgresWhatsAppStateStore(db);
  return { store, calls, result: () => ({ committed, rolledBack }) };
}
describe('Step 108.3 PostgreSQL query boundary only (not database runtime evidence)', () => {
  const media = { kind: 'image' as const, mediaId: '123456789', mimeType: 'image/jpeg', sha256: 'a'.repeat(64), downloadStatus: 'not_downloaded' as const };
  const record = { providerMessageId: 'wamid.media', recipientId: 'ram', senderMaskedPhone: '+1 ******0001', textPreview: '[Image attachment — not downloaded]', timestamp: new Date(waNow).toISOString(), mode: 'offline_test' as const, untrusted: true as const };
  it('loads attachment metadata separately without weakening the existing record shape', async () => {
    const f = harness({ message: { record, media_metadata: media } });
    const state = await f.store.transaction(waScope, waBinding.connectionId, async tx => tx.state);
    expect(state.messages).toEqual([{ ...record, media }]);
    expect(f.calls.some(c => /^\s*(INSERT|UPDATE|DELETE)\b/.test(c.sql))).toBe(false);
  });
  it('binds metadata in its own parameter while preserving scoped audited record insertion', async () => {
    const f = harness(); await f.store.transaction(waScope, waBinding.connectionId, async tx => {
      tx.state.messages.push({ ...record, media }); await tx.audit('whatsapp.durable.events', { messages: 1 });
    });
    const insert = f.calls.find(c => c.sql.includes('INSERT INTO public.whatsapp_n8n_messages'))!;
    expect(insert.params.slice(0, 3)).toEqual([waScope.workspaceId, waScope.userId, waBinding.connectionId]);
    expect(JSON.parse(insert.params[5])).toEqual(record); expect(JSON.parse(insert.params[7])).toEqual(media);
    expect(insert.sql).toContain('media_metadata'); expect(f.result().committed).toBe(true);
  });
  it('refuses corrupt metadata before exposing or rewriting a stored row', async () => {
    const f = harness({ message: { record, media_metadata: { ...media, url: 'http://127.0.0.1' } } });
    await expect(f.store.transaction(waScope, waBinding.connectionId, async tx => tx.state)).rejects.toThrow();
    expect(f.result().rolledBack).toBe(true); expect(f.calls.some(c => /^\s*(INSERT|UPDATE|DELETE)\b/.test(c.sql))).toBe(false);
  });
  it('discovers connections only inside the current owner/workspace with fresh session checks and no writes', async () => {
    const f = harness();
    expect(await (f.store as any).listOwned(waScope)).toEqual([{ connectionId: waBinding.connectionId, revision: 1, disconnected: false }]);
    const query = f.calls.find(c => c.sql.includes('FROM public.whatsapp_n8n_connections'))!;
    expect(query.sql).toContain('workspace_id = $1 AND owner_user_id = $2'); expect(query.sql).toContain('LIMIT 21');
    expect(query.params).toEqual([waScope.workspaceId, waScope.userId]);
    expect(f.calls.filter(c => c.sql.includes('current_authenticated_scope'))).toHaveLength(2);
    expect(f.calls.some(c => /INSERT|UPDATE|DELETE/.test(c.sql))).toBe(false);
  });
  it.each([{ catalogTampered: true }, { catalogOverflow: true }])('rejects invalid or incomplete connection catalogs %j', async options => {
    await expect(harness(options).store.listOwned(waScope)).rejects.toThrow();
  });
  it('denies revoked or foreign catalog access before selecting connection metadata', async () => {
    const f = harness({ authorize: false }); await expect(f.store.listOwned(waScope)).rejects.toThrow();
    expect(f.calls.some(c => c.sql.includes('FROM public.whatsapp_n8n_connections'))).toBe(false);
    await expect(harness().store.listOwned({ ...waScope, userId: 'foreign' })).rejects.toThrow();
  });
  it('locks the scoped parent before reading child records and locks scoped approval rows', async () => {
    const f = harness(); await f.store.transaction(waScope, waBinding.connectionId, async tx => { await tx.approval('approval-id'); });
    const parent = f.calls.find(c => c.sql.includes('FROM public.whatsapp_n8n_connections'))!;
    expect(parent.sql).toMatch(/workspace_id = \$1 AND owner_user_id = \$2 AND connection_id = \$3[\s\S]*FOR UPDATE/);
    expect(parent.params).toEqual([waScope.workspaceId, waScope.userId, waBinding.connectionId]);
    const child = f.calls.findIndex(c => c.sql.includes('FROM public.whatsapp_n8n_messages'));
    expect(f.calls.indexOf(parent)).toBeLessThan(child);
    const approval = f.calls.find(c => c.sql.includes('FROM public.approval_requests'))!;
    expect(approval.sql).toContain('requester_user_id = $2'); expect(approval.sql).toContain('FOR UPDATE');
    expect(approval.params).toEqual([waScope.workspaceId, waScope.userId, 'approval-id']);
    expect(f.result()).toEqual({ committed: true, rolledBack: false });
  });
  it('denies stale membership before reading connection state', async () => {
    const f = harness({ authorize: false }); await expect(f.store.transaction(waScope, waBinding.connectionId, async () => null)).rejects.toThrow();
    expect(f.calls.some(c => c.sql.includes('FROM public.whatsapp_n8n_connections'))).toBe(false);
  });
  it('denies missing or foreign scoped connections', async () => {
    const f = harness({ missing: true }); await expect(f.store.transaction(waScope, waBinding.connectionId, async () => null)).rejects.toThrow();
    expect(f.result().rolledBack).toBe(true);
  });
  it('refuses to persist mutated state without a transactional audit', async () => {
    const f = harness(); await expect(f.store.transaction(waScope, waBinding.connectionId, async tx => { tx.state.disconnected = true; tx.state.binding.revision++; })).rejects.toThrow();
    expect(f.calls.some(c => c.sql.startsWith('UPDATE'))).toBe(false);
  });
  it('rolls back instead of updating state after audit failure', async () => {
    const f = harness({ failAudit: true }); await expect(f.store.transaction(waScope, waBinding.connectionId, async tx => {
      tx.state.disconnected = true; tx.state.binding.revision++; await tx.audit('whatsapp.durable.disconnected', { revision: 2 });
    })).rejects.toThrow();
    expect(f.result()).toEqual({ committed: false, rolledBack: true });
    expect(f.calls.some(c => c.sql.startsWith('UPDATE'))).toBe(false);
  });
  it('stores an audited tombstone with optimistic version fencing', async () => {
    const f = harness(); await f.store.transaction(waScope, waBinding.connectionId, async tx => {
      tx.state.disconnected = true; tx.state.binding.revision++; await tx.audit('whatsapp.durable.disconnected', { revision: 2 });
    });
    const update = f.calls.find(c => c.sql.includes('UPDATE public.whatsapp_n8n_connections'))!;
    expect(update.sql).toContain('row_version = $4'); expect(update.params.slice(0, 4)).toEqual([waScope.workspaceId, waScope.userId, waBinding.connectionId, 1]);
    expect(update.params).toContain(true); expect(update.params).toContain('77777777-7777-4777-8777-777777777777');
  });
  it('updates an existing claim without invoking INSERT reservation guards again', async () => {
    const dispatch = { id: '88888888-8888-4888-8888-888888888888', draft: waDraft, parameterHash: computeCanonicalParameterHash(waDraft), approvalId: waApproval().id, createdAt: waNow, expiresAt: waNow + 60000, claimedAt: null,
      receipt: { dispatchId: '88888888-8888-4888-8888-888888888888', providerMessageId: null, status: 'not_configured', transport: 'n8n', mode: 'offline_test', verified: false } };
    const f = harness({ dispatch });
    await f.store.transaction(waScope, waBinding.connectionId, async tx => { tx.state.dispatches[0]!.claimedAt = waNow + 1; tx.state.dispatches[0]!.receipt.status = 'unverified'; await tx.audit('whatsapp.durable.claimed', { dispatchId: dispatch.id }); });
    expect(f.calls.some(c => c.sql.includes('INSERT INTO public.whatsapp_n8n_dispatches'))).toBe(false);
    expect(f.calls.some(c => c.sql.includes('UPDATE public.whatsapp_n8n_dispatches'))).toBe(true);
  });
  it('provisions only projected offline metadata and correlates the audit in one transaction', async () => {
    const f = harness(); await f.store.createOffline(waScope, { ...waBinding, accessToken: 'SYNTHETIC-DO-NOT-PERSIST' } as any);
    const insert = f.calls.find(c => c.sql.includes('INSERT INTO public.whatsapp_n8n_connections'))!;
    expect(insert.params.slice(0, 3)).toEqual([waScope.workspaceId, waScope.userId, waBinding.connectionId]);
    expect(JSON.parse(insert.params[3])).toEqual(waBinding);
    expect(JSON.stringify(f.calls)).not.toContain('SYNTHETIC-DO-NOT-PERSIST');
    expect(f.result().committed).toBe(true);
  });
  it('does not overwrite an existing connection or tombstone during provisioning', async () => {
    const f = harness({ createConflict: true }); await expect(f.store.createOffline(waScope, waBinding)).rejects.toThrow();
    expect(f.result().rolledBack).toBe(true);
    expect(f.calls.find(c => c.sql.includes('INSERT INTO public.whatsapp_n8n_connections'))!.sql).toContain('ON CONFLICT DO NOTHING');
  });
  it('rejects provisioning with another owner or repeated recipients', async () => {
    const f = harness();
    await expect(f.store.createOffline(waScope, { ...waBinding, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })).rejects.toThrow();
    await expect(f.store.createOffline(waScope, { ...waBinding, recipients: [waBinding.recipients[0]!, waBinding.recipients[0]!] })).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it('rechecks session expiry against the wall clock rather than transaction-start NOW', async () => {
    const f = harness(); await f.store.transaction(waScope, waBinding.connectionId, async tx => tx.assertAuthorized());
    const checks = f.calls.filter(c => c.sql.includes('current_authenticated_scope'));
    expect(checks.length).toBeGreaterThanOrEqual(3);
    for (const check of checks) {
      expect(check.sql).toContain('expires_at > clock_timestamp()');
      expect(check.sql).toContain('revoked_at IS NULL');
      expect(check.params).toEqual([waScope.sessionTokenHash]);
    }
  });
  it('refuses an unproven historical audit before persisting a protected transition', async () => {
    const f = harness({ staleProof: true });
    await expect(f.store.transaction(waScope, waBinding.connectionId, async tx => {
      await tx.audit('whatsapp.durable.disconnected', { revision: 2 }); tx.state.disconnected = true; tx.state.binding.revision++;
    })).rejects.toThrow();
    expect(f.result()).toEqual({ committed: false, rolledBack: true });
    expect(f.calls.some(c => c.sql.includes('UPDATE public.whatsapp_n8n_connections'))).toBe(false);
  });
  it('refuses missing provenance during initial offline connection creation', async () => {
    const f = harness({ staleProof: true }); await expect(f.store.createOffline(waScope, waBinding)).rejects.toThrow();
    expect(f.calls.some(c => c.sql.includes('INSERT INTO public.whatsapp_n8n_connections'))).toBe(false);
  });
  it('checks the exact owner, connection, action and full current transaction for fresh proofs', async () => {
    const f = harness(); await f.store.transaction(waScope, waBinding.connectionId, async tx => { await tx.audit('whatsapp.durable.events', { messages: 0, statuses: 0 }); });
    const proof = f.calls.find(c => c.sql.includes('FROM public.whatsapp_n8n_audit_proofs'));
    expect(proof, 'fresh provenance must be checked on the transaction client').toBeDefined();
    expect(proof!.sql).toContain('transaction_id = pg_current_xact_id()');
    expect(proof!.params).toEqual([waScope.workspaceId, waScope.userId, waBinding.connectionId, '77777777-7777-4777-8777-777777777777', 'whatsapp.durable.events', 2, null]);
    expect(proof!.sql).toContain('write_version = $6');
    expect(proof!.sql).toContain('bound_dispatch_id IS NOT DISTINCT FROM $7::uuid');
    expect(f.calls.indexOf(proof!)).toBeGreaterThan(f.calls.findIndex(c => c.sql.includes('INSERT INTO audit_events')));
  });
});
