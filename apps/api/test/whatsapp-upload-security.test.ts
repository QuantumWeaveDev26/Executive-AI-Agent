import { describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { WhatsAppMediaUploadService } from '../src/services/whatsapp-media-upload.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waNow, waApproval, waEvent, waDraft } from './helpers/whatsapp-durable-fixture.js';
import { createHash } from 'node:crypto';
const bytes = Buffer.from([0xff,0xd8,0xff,0xe0,0,16,0xff,0xd9]);
const file = { bytes, mimeType: 'image/jpeg', filename: 'photo.jpg' };
const intent = { connectionId: waBinding.connectionId, connectionRevision: 1, senderPhoneNumberId: waBinding.phoneNumberId, filename: 'photo.jpg', mimeType: 'image/jpeg', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), idempotencyKey: 'upload-fixture-12345678' };
const authorization = { approvalId: '11111111-1111-4111-8111-111111111111', idempotencyKey: intent.idempotencyKey };
function fixture(patches: object = {}) {
  const store = new WhatsAppTransactionalFixture(), durable = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
  const audit = vi.fn(async () => undefined), uploader = { upload: vi.fn(async () => '123456') };
  const admission = { begin: vi.fn(async () => ({ fresh: true })), complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined), ...patches };
  const service = new WhatsAppMediaUploadService(durable, audit, uploader, () => waNow, admission as any);
  return { store, service, uploader, admission, audit };
}
describe('explicit upload admission; simulated provider only', () => {
  it('requires a durable admission before any provider write', async () => {
    const f = fixture({ begin: vi.fn(async () => { throw new Error('audit or policy denied'); }) });
    await expect((f.service as any).upload(waScope, waBinding.connectionId, file, authorization)).rejects.toThrow();
    expect(f.uploader.upload).not.toHaveBeenCalled();
  });
  it('requires explicit approval and idempotency headers', async () => {
    const f = fixture();
    await expect(f.service.upload(waScope, waBinding.connectionId, file)).rejects.toThrow();
    expect(f.uploader.upload).not.toHaveBeenCalled();
  });
  it('binds admission to the actual fingerprint and current connection', async () => {
    const f = fixture(); await (f.service as any).upload(waScope, waBinding.connectionId, file, authorization);
    expect(f.admission.begin).toHaveBeenCalledWith(waScope, expect.objectContaining(intent), authorization.approvalId);
    expect(f.admission.complete).toHaveBeenCalledTimes(1); expect(f.uploader.upload).toHaveBeenCalledTimes(1);
  });
  it('returns an authorized cached result without uploading again', async () => {
    const result = { media: { kind: 'image', mediaId: '123456', mimeType: 'image/jpeg', sha256: intent.sha256 } };
    const f = fixture({ begin: vi.fn(async () => ({ fresh: false, result })) });
    expect(await (f.service as any).upload(waScope, waBinding.connectionId, file, authorization)).toEqual(result); expect(f.uploader.upload).not.toHaveBeenCalled();
  });
  it('fences disconnect during transfer and does not return a receipt', async () => {
    const f = fixture(); f.uploader.upload.mockImplementationOnce(async () => { f.store.state.disconnected = true; return '123456'; });
    await expect((f.service as any).upload(waScope, waBinding.connectionId, file, authorization)).rejects.toThrow();
    expect(f.admission.complete).not.toHaveBeenCalled(); expect(f.admission.fail).toHaveBeenCalled();
  });
  it('does not report success when completion audit fails', async () => {
    const f = fixture({ complete: vi.fn(async () => { throw new Error('audit unavailable'); }) });
    await expect((f.service as any).upload(waScope, waBinding.connectionId, file, authorization)).rejects.toThrow(); expect(f.admission.fail).toHaveBeenCalled();
  });
  it('validates personal upload decisions against the exact binding without approving or transferring anything', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(waNow);
    try {
      const f = fixture(), durable = new DurableWhatsAppService(f.store, defaultPolicyGateway, () => waNow);
      const approval = { ...waApproval(), actionName: 'whatsapp.meta.media.upload', actionParams: intent, status: 'pending' as const, approverUserId: null };
      f.store.approvals.set(approval.id, approval);
      await expect(durable.authorizePersonalApproval(waScope, waBinding.connectionId, approval.id)).resolves.toBeUndefined();
      expect(f.store.approvals.get(approval.id)?.status).toBe('pending'); expect(f.uploader.upload).not.toHaveBeenCalled();
      for (const change of [{ actionParams: { ...intent, connectionRevision: 2 } }, { actionParams: { ...intent, senderPhoneNumberId: '999999' } }, { requesterUserId: 'other' }, { status: 'rejected' }, { riskLevel: 'low' }, { actionName: 'other.high.risk' }]) {
        f.store.approvals.set(approval.id, { ...approval, ...change } as any);
        await expect(durable.authorizePersonalApproval(waScope, waBinding.connectionId, approval.id)).rejects.toThrow();
      }
    } finally { vi.useRealTimers(); }
  });
  it('permits a personal send decision only after binding, consent and window checks, without sending', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(waNow);
    try {
      const f = fixture(), durable = new DurableWhatsAppService(f.store, defaultPolicyGateway, () => waNow);
      await durable.ingest(waScope, waBinding.connectionId, waEvent());
      const approval = { ...waApproval(waDraft), status: 'pending' as const, approverUserId: null }; f.store.approvals.set(approval.id, approval);
      await durable.authorizePersonalApproval(waScope, waBinding.connectionId, approval.id);
      expect(f.store.state.dispatches).toHaveLength(0); expect(f.store.approvals.get(approval.id)?.status).toBe('pending');
      f.store.state.binding.recipients[0]!.optedIn = false;
      await expect(durable.authorizePersonalApproval(waScope, waBinding.connectionId, approval.id)).rejects.toThrow();
    } finally { vi.useRealTimers(); }
  });
});
