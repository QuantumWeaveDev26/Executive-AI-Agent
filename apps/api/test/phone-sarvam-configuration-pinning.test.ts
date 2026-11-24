import {describe,expect,it,vi} from 'vitest';
import {createSarvamCallProvider,type SarvamCallProviderOptions} from '../src/services/phone-sarvam-calls.js';

const secrets={apiKey:'synthetic-api-key',webhookSecret:'synthetic-hook-secret-0123456789abcdef'};
const request={callId:'aaaaaaaa-1111-4111-8111-111111111111',to:'+919000000002',recipientName:'Ram',purpose:'Ask about the website.',
 language:'en-IN' as const,maxDurationSeconds:300,aiDisclosure:'Hello, I am Thaara, an AI assistant.'};
const options=(fetch:typeof globalThis.fetch):SarvamCallProviderOptions=>({liveCallingEnabled:true,secrets:{resolve:async()=>secrets},
 orgId:'synthetic-org',workspaceId:'synthetic-workspace',appId:'synthetic-app',appVersion:12,connectionId:'synthetic-connection',
 agentPhoneNumber:'+918000000001',enforcedMaxDurationSeconds:300,callbackOrigin:'https://thaara.example.com',fetch,
 companyKnowledge:{reviewOnly:false,providerAcceptanceVerified:true,direction:'outbound',appVersion:12,inboundAppVersion:11,
  maxDurationSeconds:300,knowledgeBaseId:'synthetic-kb',knowledgeVersion:'qw-company-kb-v1',knowledgeSha256:'a'.repeat(64),
  policyVersion:'qw-route-policy-v1',policySha256:'b'.repeat(64),commonPolicySha256:'c'.repeat(64),acceptanceEvidenceSha256:'d'.repeat(64)}});
const mutate=(o:SarvamCallProviderOptions)=>{
 o.appVersion=99;o.appId='unexpected-app';o.connectionId='unexpected-connection';o.agentPhoneNumber='+918000000003';
 o.callbackOrigin='https://unexpected.example.com';o.orgId='unexpected-org';o.workspaceId='unexpected-workspace';
};
describe('Sarvam immutable dispatch configuration (synthetic network only)',()=>{
 it.each(['after-construction','during-secret-resolution'] as const)('pins admitted route %s',async timing=>{
  const fetch=vi.fn(async()=>new Response('{"attempt_id":"synthetic-attempt"}'));
  const o=options(fetch as typeof globalThis.fetch);o.secrets.resolve=async()=>{if(timing==='during-secret-resolution')mutate(o);return secrets;};
  const p=createSarvamCallProvider(o),fingerprint=p.configurationFingerprint;
  if(timing==='after-construction')mutate(o);
  expect(await p.dispatch(request)).toEqual({status:'unverified',providerRequestId:'synthetic-attempt'});
  const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit];const body=JSON.parse(String(init.body));
  expect(url).toBe('https://apps.sarvam.ai/api/outbounds/v1/orgs/synthetic-org/workspaces/synthetic-workspace/outbounds');
  expect(body.app_config.app_id).toBe('synthetic-app');expect(body.app_config.app_version).toBe(12);
  expect(body.app_config.connection_config).toEqual({connection_id:'synthetic-connection',agent_phone_number:'+918000000001'});
  expect(body.webhook_config.url).toMatch(/^https:\/\/thaara\.example\.com\//);expect(p.configurationFingerprint).toBe(fingerprint);
 });
 it('cannot enable network access by mutating the original live switch',async()=>{
  const fetch=vi.fn(async()=>new Response('{"attempt_id":"synthetic-attempt"}')),o=options(fetch as typeof globalThis.fetch);o.liveCallingEnabled=false;
  const p=createSarvamCallProvider(o);o.liveCallingEnabled=true;
  expect(await p.dispatch(request)).toEqual({status:'not_configured'});expect(fetch).not.toHaveBeenCalled();
 });
 it('pins the original fetch and resolver identities while retaining per-use fresh secret resolution',async()=>{
  let reads=0;const fetch=vi.fn(async()=>new Response('{"attempt_id":"synthetic-attempt"}')),unexpected=vi.fn();
  const o=options(fetch as typeof globalThis.fetch);o.secrets.resolve=async()=>{reads++;return secrets;};const p=createSarvamCallProvider(o);
  o.fetch=unexpected as typeof globalThis.fetch;o.secrets.resolve=async()=>{throw Error('synthetic replaced resolver');};
  expect((await p.dispatch(request)).status).toBe('unverified');expect(reads).toBe(1);expect(fetch).toHaveBeenCalledTimes(1);expect(unexpected).not.toHaveBeenCalled();
 });
});
