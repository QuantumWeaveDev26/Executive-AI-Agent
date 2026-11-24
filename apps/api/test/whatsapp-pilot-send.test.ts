import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { DurableWhatsAppService, type WhatsAppSendProfile } from '../src/services/whatsapp-durable.js';
import { createPilotWhatsAppDispatcher, PILOT_N8N_ORIGIN } from '../src/services/whatsapp-pilot-dispatch.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waDraft, waApproval, waEvent, waNow } from './helpers/whatsapp-durable-fixture.js';

const secret = 's'.repeat(43);
// The transactional double models the claim caller with the owner scope (relay identity is covered by the PostgreSQL runtime tests).
const relay = waScope;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(waNow); });
afterEach(() => vi.useRealTimers());

describe('pilot-only internal dispatch transport', () => {
  it('posts only dispatch ID and revision to the fixed internal n8n webhook with the header secret, no redirects', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response);
    await createPilotWhatsAppDispatcher({ webhookPath: '/webhook/thaara-v2-dev-whatsapp-approved-1082', headerName: 'X-Thaara-Dispatch', secret, fetchImpl }).submit({ connectionId: 'wa_x', revision: 1, dispatchId: 'd-1' });
    const [url, init] = fetchImpl.mock.calls[0] as any;
    expect(url).toBe(PILOT_N8N_ORIGIN + '/webhook/thaara-v2-dev-whatsapp-approved-1082');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'X-Thaara-Dispatch': secret } });
    expect(JSON.parse(init.body)).toEqual({ dispatchId: 'd-1', connectionRevision: 1 });
  });
  it('throws on a non-2xx answer', async () => {
    const d = createPilotWhatsAppDispatcher({ webhookPath: '/webhook/x1', headerName: 'X-Thaara-Dispatch', secret, fetchImpl: vi.fn(async () => ({ ok: false }) as Response) });
    await expect(d.submit({ connectionId: 'wa_x', revision: 1, dispatchId: 'd' })).rejects.toThrow();
  });
  it.each([
    { webhookPath: 'https://evil.example/webhook/x', headerName: 'X-A', secret },
    { webhookPath: '/webhook/../admin', headerName: 'X-A', secret },
    { webhookPath: '/webhook/x', headerName: 'Authorization', secret },
    { webhookPath: '/webhook/x', headerName: 'X-A', secret: 'short' },
    { webhookPath: '/webhook/x', headerName: 'X-A', secret, timeoutMs: 120000 }
  ])('rejects unsafe configuration %#', config => expect(() => createPilotWhatsAppDispatcher(config)).toThrow('denied'));
});

describe('send profile gate on the durable service', () => {
  function setup(profile: WhatsAppSendProfile | null, submit = vi.fn(async () => {})) {
    const store = new WhatsAppTransactionalFixture(); let now = waNow;
    const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => now, { profile: () => profile, dispatcher: { submit } });
    return { store, service, submit, time: (t: number) => { now = t; } };
  }
  const profile = { connectionId: waBinding.connectionId, recipientId: 'ram', maxPerDay: 1, expiresAt: waNow + 3600000 };
  it('hands over a new reservation once, after commit; claim enables sending inside the window', async () => {
    const f = setup(profile); await f.service.ingest(waScope, waBinding.connectionId, waEvent());
    const r = await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
    expect(f.submit).toHaveBeenCalledWith({ connectionId: waBinding.connectionId, revision: 1, dispatchId: r.dispatchId });
    await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(await f.service.claim(relay, waBinding.connectionId, r.dispatchId!, 1)).toMatchObject({ authorized: true, dispatchEnabled: true });
  });
  it('keeps dispatchEnabled false with no profile, an expired profile, another recipient, or outside the 24 h window', async () => {
    for (const p of [null, { ...profile, expiresAt: waNow - 1 }, { ...profile, recipientId: 'someone_else' }]) {
      const f = setup(p); await f.service.ingest(waScope, waBinding.connectionId, waEvent());
      const r = await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
      expect(f.submit).not.toHaveBeenCalled();
      expect(await f.service.claim(relay, waBinding.connectionId, r.dispatchId!, 1)).toMatchObject({ dispatchEnabled: false });
    }
    const late = setup(profile); await late.service.ingest(waScope, waBinding.connectionId, waEvent('wamid.old', waNow - 25 * 3600000));
    // Outside Meta's 24 h customer-service window the reservation itself is refused, so nothing is handed over.
    await expect(late.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id)).rejects.toThrow();
    expect(late.submit).not.toHaveBeenCalled(); expect(late.store.state.dispatches).toHaveLength(0);
  });
  it('normal mode: "*" allows any opted-in contact, never a non-opted-in one, and the ceiling is 250/day', async () => {
    const any = { ...profile, recipientId: '*', maxPerDay: 250 };
    const f = setup(any); await f.service.ingest(waScope, waBinding.connectionId, waEvent());
    const r = await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect((await f.service.claim(relay, waBinding.connectionId, r.dispatchId!, 1)).dispatchEnabled).toBe(true);
    const over = setup({ ...any, maxPerDay: 251 }); await over.service.ingest(waScope, waBinding.connectionId, waEvent());
    const r2 = await over.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
    expect(over.submit).not.toHaveBeenCalled();
    expect((await over.service.claim(relay, waBinding.connectionId, r2.dispatchId!, 1)).dispatchEnabled).toBe(false);
    const optedOut = setup(any); optedOut.store.state.binding.recipients = optedOut.store.state.binding.recipients.map((x: any) => ({ ...x, optedIn: false }));
    await optedOut.service.ingest(waScope, waBinding.connectionId, waEvent());
    await expect(optedOut.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id)).rejects.toThrow();
    expect(optedOut.submit).not.toHaveBeenCalled();
  });
  it('unlimited (null cap): no Thaara daily count, but opt-in, window, expiry and approval still apply', async () => {
    const f = setup({ ...profile, recipientId: '*', maxPerDay: null }); await f.service.ingest(waScope, waBinding.connectionId, waEvent());
    for (let i = 0; i < 12; i++) {
      const draft = { ...waDraft, idempotencyKey: `unlimited-attempt-${String(i).padStart(4, '0')}` }; f.store.setApproval(draft);
      const r = await f.service.reserve(waScope, waBinding.connectionId, draft, waApproval().id);
      expect((await f.service.claim(relay, waBinding.connectionId, r.dispatchId!, 1)).dispatchEnabled).toBe(true);
    }
    const expired = setup({ ...profile, recipientId: '*', maxPerDay: null, expiresAt: waNow - 1 }); await expired.service.ingest(waScope, waBinding.connectionId, waEvent());
    const r = await expired.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
    expect(expired.submit).not.toHaveBeenCalled();
    expect((await expired.service.claim(relay, waBinding.connectionId, r.dispatchId!, 1)).dispatchEnabled).toBe(false);
  });
  it('reports live sending truthfully to the inbox and contacts only while the profile is active for that connection', async () => {
    const f = setup({ ...profile, recipientId: '*' }); await f.service.ingest(waScope, waBinding.connectionId, waEvent());
    expect((await f.service.inbox(waScope, waBinding.connectionId)).liveSendingEnabled).toBe(true);
    expect((await f.service.contacts(waScope, waBinding.connectionId)).liveSendingEnabled).toBe(true);
    f.time(profile.expiresAt + 1);
    expect((await f.service.inbox(waScope, waBinding.connectionId)).liveSendingEnabled).toBe(false);
    for (const p of [null, { ...profile, connectionId: 'other_connection' }]) {
      const g = setup(p); await g.service.ingest(waScope, waBinding.connectionId, waEvent());
      expect((await g.service.inbox(waScope, waBinding.connectionId)).liveSendingEnabled).toBe(false);
    }
  });
  it('enforces the daily cap across claims', async () => {
    const f = setup(profile); await f.service.ingest(waScope, waBinding.connectionId, waEvent());
    const first = await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
    expect((await f.service.claim(relay, waBinding.connectionId, first.dispatchId!, 1)).dispatchEnabled).toBe(true);
    const second = { ...waDraft, idempotencyKey: 'durable-dispatch-0002' }; f.store.setApproval(second);
    const r2 = await f.service.reserve(waScope, waBinding.connectionId, second, waApproval().id);
    expect((await f.service.claim(relay, waBinding.connectionId, r2.dispatchId!, 1)).dispatchEnabled).toBe(false);
  });
  it('a failed hand-over leaves the reservation not_configured and does not throw', async () => {
    const f = setup(profile, vi.fn(async () => { throw new Error('n8n down'); })); await f.service.ingest(waScope, waBinding.connectionId, waEvent());
    expect(await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id)).toMatchObject({ status: 'not_configured', verified: false });
  });
  it('ten-attempt allowance preserves consumed claims and never replays the same dispatch',async()=>{
    const f=setup({...profile,maxPerDay:10});await f.service.ingest(waScope,waBinding.connectionId,waEvent());
    for(let i=0;i<11;i++){
      const draft={...waDraft,idempotencyKey:`authorized-test-attempt-${i}`};f.store.setApproval(draft);
      const r=await f.service.reserve(waScope,waBinding.connectionId,draft,waApproval().id);
      expect((await f.service.claim(relay,waBinding.connectionId,r.dispatchId!,1)).dispatchEnabled).toBe(i<10);
      await expect(f.service.claim(relay,waBinding.connectionId,r.dispatchId!,1)).rejects.toThrow();
    }
    expect(f.store.state.dispatches.filter(d=>d.claimedAt!==null)).toHaveLength(11);
  });
});
