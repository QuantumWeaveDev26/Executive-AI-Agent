// Image-build acceptance only. Pure synthetic inputs; no secret reads, SQL or provider requests.
import {strict as assert} from 'node:assert';
import {pilotSendSettings} from './pilot-config.mjs';
import {sanitizeWorkflowAnswer} from './pilot-send-cli.mjs';
const now=Date.parse('2026-10-28T10:00:00Z');
const profile={connectionId:'wa_pilot_meta_test_10813b',recipientId:'owner_test_phone',maxPerDay:10,expiresAt:'2026-10-29T10:00:00Z',webhookPath:'/webhook/thaara-v2-dev-whatsapp-approved-1082',headerName:'X-Thaara-Dispatch'};
const read=p=>p.endsWith('send_profile')?JSON.stringify(profile):'synthetic_test_only_'.repeat(3);
assert.equal(pilotSendSettings({THAARA_WHATSAPP_SEND_ENABLED:'false'},()=>{throw Error('must not read');},now),null);
assert.equal(pilotSendSettings({THAARA_WHATSAPP_SEND_ENABLED:'true'},read,now).profile.maxPerDay,10);
profile.maxPerDay=251;assert.throws(()=>pilotSendSettings({THAARA_WHATSAPP_SEND_ENABLED:'true'},read,now));
assert.deepEqual(sanitizeWorkflowAnswer({status:'sent',verified:true,providerErrorCode:'unknown',providerErrorMessage:'Authorization failed EAA_SYNTHETIC'}),{verified:false,providerErrorCode:'unknown',providerErrorMessage:'Provider authentication failed.'});
console.log('WhatsApp overlay acceptance: send-off, cap 10, deny 251, safe error output PASS; no provider requests.');
