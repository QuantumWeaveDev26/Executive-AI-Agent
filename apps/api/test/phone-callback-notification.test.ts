import { describe, expect, it, vi } from 'vitest';
import {
  callbackMissingFields, createCallbackCapture, createCallbackNotificationDispatcher, formatCallbackEmail, projectCallbackRequest,
  type AdmittedCallbackCall, type CallbackNotificationGrant, type CallbackRepository,
} from '../src/services/phone-callback-notification.js';
import { PHONE_CALLBACK_RECIPIENT } from '../src/services/phone-callback-mail.js';

const scope = { workspaceId: 'workspace', userId: 'owner' };
const details = { requested: true, name: 'Test Caller', business: 'Test Business', service: 'Automation' };
const call: AdmittedCallbackCall = { ...scope, callId: 'call-1', direction: 'inbound', verifiedNumber: '+919000000001',
  occurredAt: '2026-11-09T00:00:00Z', turns: [{ speaker: 'agent', text: 'Test Caller, Test Business, Automation. May I record a callback request?' }, { speaker: 'caller', text: 'Yes, please.' }] };

describe('confirmed callback capture', () => {
  it.each(['inbound', 'outbound'] as const)('uses the admitted %s number and structured details', direction => {
    expect(projectCallbackRequest({ ...call, direction }, details)).toMatchObject({
      direction, name: details.name, business: details.business, service: details.service,
      phoneNumber: call.verifiedNumber, numberSource: 'call_metadata', notificationStatus: 'pending',
    });
  });

  it('reuses known details and flags missing business for review', () => {
    const request = projectCallbackRequest({ ...call, known: { name: details.name, service: details.service } }, { requested: true });
    expect(request).toMatchObject({ name: details.name, service: details.service, business: null, notificationStatus: 'pending' });
    expect(callbackMissingFields(request!)).toEqual(['business']);
    expect(formatCallbackEmail(request!)).toEqual({ subject: 'Thaara AI — New Callback Request',
      bodyText: 'New Callback Request\n\nName: Test Caller\nPhone: +919000000001\nBusiness: Not provided\nService Needed: Automation' });
  });

  it('requires a full read-back before accepting an alternate number', () => {
    const alternate = { ...details, phoneNumber: '+919000000002' };
    expect(projectCallbackRequest(call, alternate)).toMatchObject({ phoneNumber: null, notificationStatus: 'pending' });
    expect(projectCallbackRequest({ ...call, turns: [
      { speaker: 'agent', text: 'Test Caller, Test Business, Automation. May I save a callback request to +91 90000 00002?' }, call.turns[1]!,
    ] }, alternate)).toMatchObject({ phoneNumber: alternate.phoneNumber, numberSource: 'caller_confirmed' });
  });

  it.each([
    ['Kannada', 'ಮರಳಿ ಕರೆ ವಿನಂತಿಯನ್ನು ದಾಖಲಿಸಬಹುದೇ?', 'ಹೌದು'],
    ['Hindi', 'क्या मैं वापस कॉल का अनुरोध दर्ज करूँ?', 'जी हाँ'],
  ])('accepts explicit consent in %s', (_, question, answer) => {
    expect(projectCallbackRequest({ ...call, turns: [{ speaker: 'agent', text: question,
      englishText: 'Test Caller, Test Business, Automation. May I record a callback request?' }, { speaker: 'caller', text: answer }] }, details)?.notificationStatus).toBe('pending');
  });

  it('blocks unconfirmed disconnects, generic assent, withdrawal and injected destination', () => {
    expect(projectCallbackRequest({ ...call, turns: call.turns.slice(0, 1) }, details)).toBeNull();
    expect(projectCallbackRequest({ ...call, turns: [{ speaker: 'agent', text: 'Any questions about the callback?' }, call.turns[1]!] }, details)).toBeNull();
    expect(projectCallbackRequest({ ...call, turns: [...call.turns, { speaker: 'caller', text: 'Please do not call me.' }] }, details)).toBeNull();
    expect(projectCallbackRequest(call, { ...details, recipient: 'injected@example.test' })).toBeNull();
  });

  it('preserves a caller-requested partial record after disconnect without queueing email', () => {
    const request = projectCallbackRequest({ ...call, turns: [{ speaker: 'caller', text: 'Could someone call me back?' }] },
      { requested: true, name: 'Test Caller' });
    expect(request).toMatchObject({ name: 'Test Caller', phoneNumber: call.verifiedNumber, notificationStatus: 'needs_review' });
    expect(callbackMissingFields(request!)).toEqual(['business', 'service']);
  });

  it('requires the corrected final details to be recapped and confirmed again', () => {
    const changed = { ...details, business: 'New Business' };
    const corrected = { ...call, turns: [...call.turns, { speaker: 'caller' as const, text: 'Actually my business is New Business.' }] };
    expect(projectCallbackRequest(corrected, changed)?.notificationStatus).toBe('needs_review');
    expect(projectCallbackRequest({ ...corrected, turns: [...corrected.turns,
      { speaker: 'agent', text: 'Test Caller, New Business, Automation. Should I share your callback request with our team?' },
      { speaker: 'caller', text: 'Yes' },
    ] }, changed)?.notificationStatus).toBe('pending');
  });

  it('holds the notification when domain verification is pending', async () => {
    const request = projectCallbackRequest(call, details)!;
    const claim = vi.fn();
    const send = vi.fn();
    const notify = createCallbackNotificationDispatcher({ repository: { read: async () => request, claim } as never,
      currentOwnerGrant: async () => grant, now: () => Date.parse(call.occurredAt),
      transport: { sender: grant.sender, ready: async () => false, send } });
    expect(await notify(scope, request.id)).toBe('not_configured');
    expect(claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('requires admission and committed storage before returning a saved receipt', async () => {
    const save = vi.fn<CallbackRepository['save']>().mockRejectedValue(new Error('transaction failed'));
    const capture = createCallbackCapture({ admit: async (token: string) => token === 'admitted' ? call : null, repository: { save } });
    await expect(capture('untrusted', details)).rejects.toThrow('admission');
    expect(save).not.toHaveBeenCalled();
    await expect(capture('admitted', details)).rejects.toThrow('transaction failed');
    save.mockImplementation(async request => request);
    await expect(capture('admitted', details)).resolves.toMatchObject({ saved: true, notificationStatus: 'pending' });
  });
});

const grant: CallbackNotificationGrant = { ...scope, enabled: true, approvedByUserId: scope.userId,
  recipient: PHONE_CALLBACK_RECIPIENT, sender: 'sender@example.test', expiresAt: '2026-11-10T00:00:00Z' };

function preview(outcome: 'submitted' | 'rejected' | 'not_submitted' | 'unknown', ownerGrant: CallbackNotificationGrant | null = grant) {
  const request = projectCallbackRequest(call, details)!;
  const repository: CallbackRepository = {
    save: async value => value,
    read: async () => ({ ...request }),
    claim: async (_, __, attempt) => {
      if (request.notificationStatus !== 'pending') return null;
      request.notificationStatus = 'sending';
      request.notificationAttemptId = attempt;
      return ++request.attempts;
    },
    finish: async (_, __, attempt, status, providerMessageId) => {
      expect(attempt).toBe(request.notificationAttemptId);
      request.notificationStatus = status;
      request.providerMessageId = providerMessageId ?? null;
    },
  };
  const sendMock = vi.fn(async () => outcome === 'submitted' ? { acceptedId: 'provider-123' } : outcome);
  const run = createCallbackNotificationDispatcher({ repository, transport: { sender: grant.sender, send: sendMock }, currentOwnerGrant: async () => ownerGrant,
    now: () => Date.parse(call.occurredAt) });
  return { notify: () => run(scope, request.id), sendMock, request };
}

describe('callback notification mock delivery', () => {
  it('submits exactly one notification under concurrent execution', async () => {
    const { notify, sendMock, request } = preview('submitted');
    expect(await Promise.all([notify(), notify()])).toEqual(['submitted', 'not_eligible']);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({ ...formatCallbackEmail(request), to: grant.recipient, from: grant.sender,
      idempotencyKey: `callback:${request.id}` });
    expect(request.status).toBe('requested');
    expect(request.providerMessageId).toBe('provider-123');
  });

  it.each([['rejected', 'failed'], ['unknown', 'unverified']] as const)('preserves a %s result without sending again', async (outcome, status) => {
    const { notify, sendMock } = preview(outcome);
    expect(await notify()).toBe(status);
    expect(await notify()).toBe('not_eligible');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('only retries known non-submission and caps it at two attempts', async () => {
    const { notify, sendMock } = preview('not_submitted');
    expect(await notify()).toBe('pending');
    expect(await notify()).toBe('failed');
    expect(await notify()).toBe('not_eligible');
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]).toEqual(sendMock.mock.calls[1]);
  });

  it.each([null, { ...grant, recipient: 'connect.brandmintai.io' }, { ...grant, approvedByUserId: 'other' }, { ...grant, expiresAt: call.occurredAt }])(
    'blocks sending when the exact grant is unavailable or invalid', async invalidGrant => {
      const { notify, sendMock } = preview('submitted', invalidGrant);
      expect(await notify()).toBe('awaiting_owner_authorization');
      expect(sendMock).not.toHaveBeenCalled();
    },
  );
});
