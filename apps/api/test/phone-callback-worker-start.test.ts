import { expect, it } from 'vitest';
import { runPhoneCallbackWorkerProcess } from '../src/phone-callback-worker-start.js';

it('keeps a separate worker disabled before approval or sender verification without reading deployed secrets', async () => {
  const signal = new AbortController().signal;
  expect(await runPhoneCallbackWorkerProcess({}, signal)).toEqual({ status: 'off' });
  expect(await runPhoneCallbackWorkerProcess({ THAARA_PHONE_CALLBACK_ENABLED: 'true' }, signal)).toEqual({ status: 'not_configured' });
  expect(await runPhoneCallbackWorkerProcess({ THAARA_PHONE_CALLBACK_ENABLED: 'true', THAARA_PHONE_CALLBACK_DOMAIN_VERIFIED: 'true',
    THAARA_PHONE_CALLBACK_SENDER: 'wrong@example.test' }, signal)).toEqual({ status: 'not_configured' });
  const controller = new AbortController();
  controller.abort();
  expect(await runPhoneCallbackWorkerProcess({ THAARA_PHONE_CALLBACK_ENABLED: 'true', THAARA_PHONE_CALLBACK_DOMAIN_VERIFIED: 'true',
    THAARA_PHONE_CALLBACK_SENDER: 'notifications@brandmintai.io' }, controller.signal)).toEqual({ status: 'stopped' });
});
