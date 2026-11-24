import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waEvent, waStatus, waNow } from './helpers/whatsapp-durable-fixture.js';

// Synthetic only: Meta's failed-status reason is written to the operator log after a committed ingest.
const original = DurableWhatsAppService.deliveryFailureSink;
let logged: any[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(waNow); logged = []; DurableWhatsAppService.deliveryFailureSink = f => { logged.push(f); }; });
afterEach(() => { vi.useRealTimers(); DurableWhatsAppService.deliveryFailureSink = original; });
const failed = (errors: unknown) => { const e = waStatus('failed'); return { ...e, statuses: [{ ...e.statuses[0], errors }] }; };

describe('Meta delivery failure reason (operator log)', () => {
  it('logs code, title and details with phone-like numbers masked and only the message ID tail', async () => {
    const service = new DurableWhatsAppService(new WhatsAppTransactionalFixture(), defaultPolicyGateway, () => waNow);
    await service.ingest(waScope, waBinding.connectionId, waEvent());
    const result = await service.ingest(waScope, waBinding.connectionId, failed([{ code: 131042, title: 'Business eligibility payment issue', error_data: { details: 'Message failed to send to +15550000001 because of payment' } }]));
    expect(result).toMatchObject({ statusUpdates: expect.any(Number) });
    expect(logged).toEqual([{ event: 'whatsapp_delivery_failed', connectionId: waBinding.connectionId, messageRef: 'wamid.outbound'.slice(-10), code: 131042, title: 'Business eligibility payment issue', details: 'Message failed to send to [number] because of payment' }]);
    expect(JSON.stringify(logged)).not.toContain('15550000001');
  });
  it('logs nothing for delivered/read statuses or rejected events, and survives a broken sink', async () => {
    const service = new DurableWhatsAppService(new WhatsAppTransactionalFixture(), defaultPolicyGateway, () => waNow);
    await service.ingest(waScope, waBinding.connectionId, waStatus('delivered'));
    expect(logged).toHaveLength(0);
    await expect(service.ingest(waScope, waBinding.connectionId, { ...failed([{ code: 1 }]), metadata: { phone_number_id: '999999999' } })).rejects.toThrow();
    expect(logged).toHaveLength(0);
    DurableWhatsAppService.deliveryFailureSink = () => { throw new Error('log down'); };
    await expect(service.ingest(waScope, waBinding.connectionId, failed([{ code: 131049, title: 'x' }]))).resolves.toBeTruthy();
  });
  it('handles missing or malformed error details truthfully', async () => {
    const service = new DurableWhatsAppService(new WhatsAppTransactionalFixture(), defaultPolicyGateway, () => waNow);
    await service.ingest(waScope, waBinding.connectionId, failed(undefined));
    expect(logged.at(-1)).toMatchObject({ code: null, title: '', details: '' });
    await service.ingest(waScope, waBinding.connectionId, failed([{ code: '131026', message: 'Message undeliverable\u0000' }]));
    expect(logged.at(-1)).toMatchObject({ code: null, title: 'Message undeliverable' });
  });
});
