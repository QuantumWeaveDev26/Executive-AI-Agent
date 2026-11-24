import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {parseSarvamKnowledgeBinding,type SarvamKnowledgeBinding} from '../src/services/phone-sarvam-knowledge-binding.js';
import {createSarvamCallProvider,type SarvamCallProviderOptions} from '../src/services/phone-sarvam-calls.js';
import {loadSarvamRuntime,parseSarvamRuntimeProfile} from '../src/services/phone-sarvam-runtime.js';

it('keeps the prepared v12/v14 profile unadmitted and binds every review artifact to unchanged source bytes',()=>{
 const dir='docs/integrations/phone/knowledge/runtime-v12-v14-20261106-review';
 const manifest=JSON.parse(fs.readFileSync(dir+'/manifest.review.json','utf8'));
 for(const artifact of manifest.artifacts)expect(createHash('sha256').update(fs.readFileSync(artifact.path)).digest('hex')).toBe(artifact.sha256);
 const candidate=JSON.parse(fs.readFileSync(dir+'/runtime-profile.candidate.json','utf8'));
 expect(candidate).toMatchObject({reviewOnly:true,runtimeProfile:false,appVersion:12,verifiedMaxCallLengthMinutes:null,companyKnowledge:{reviewOnly:true,providerAcceptanceVerified:false,appVersion:12,inboundAppVersion:14}});
 expect(parseSarvamRuntimeProfile(candidate)).toHaveProperty('reasons');
 expect(manifest.executionAuthorized).toBe(false);expect(manifest.productionAdmission).toBe(false);
 expect(createHash('sha256').update(fs.readFileSync('docs/integrations/phone/sarvam-runtime-profile.pilot.json')).digest('hex')).toBe(manifest.baselineProfileSha256);
});

it('keeps the prepared v17/v16 Linktree v3 profile unadmitted until audio acceptance and pins exact source hashes',()=>{
 const dir='docs/integrations/phone/knowledge/runtime-v17-v16-20261107-review';
 const manifest=JSON.parse(fs.readFileSync(dir+'/manifest.review.json','utf8'));
 for(const artifact of manifest.artifacts)expect(createHash('sha256').update(fs.readFileSync(artifact.path)).digest('hex')).toBe(artifact.sha256);
 const candidate=JSON.parse(fs.readFileSync(dir+'/runtime-profile.candidate.json','utf8'));
 expect(candidate).toMatchObject({reviewOnly:true,runtimeProfile:false,appVersion:17,requiredMaxCallLengthMinutes:5,verifiedMaxCallLengthMinutes:null,companyKnowledge:{reviewOnly:true,providerAcceptanceVerified:false,appVersion:17,inboundAppVersion:16,knowledgeVersion:'qw-company-kb-v3-linktree',maxDurationSeconds:300}});
 expect(parseSarvamRuntimeProfile(candidate)).toEqual({reasons:['profile_not_runtime','duration_not_verified','knowledge_binding_invalid']});
 expect(manifest).toMatchObject({reviewOnly:true,executionAuthorized:false,productionAdmission:false,rollbackVersion:15,inboundVersion:16,outboundVersion:17,workingDraftVersion:18});
 expect(createHash('sha256').update(fs.readFileSync('docs/integrations/phone/sarvam-runtime-profile.pilot.json')).digest('hex')).toBe(manifest.baselineProfileSha256);
 const admitted=parseSarvamRuntimeProfile({...candidate,reviewOnly:false,runtimeProfile:true,verifiedMaxCallLengthMinutes:5,companyKnowledge:{...candidate.companyKnowledge,reviewOnly:false,providerAcceptanceVerified:true}});
 expect('profile' in admitted).toBe(true);
});

it('keeps outbound v19 and inbound v21 blocked when version-specific evidence is missing',()=>{
 const path='docs/integrations/phone/knowledge/runtime-v19-v21-20261108-review/runtime-profile.candidate.json';
 const candidate=JSON.parse(fs.readFileSync(path,'utf8'));
 expect(candidate).toMatchObject({reviewOnly:true,runtimeProfile:false,appVersion:19,verifiedMaxCallLengthMinutes:null,
  companyKnowledge:{reviewOnly:true,providerAcceptanceVerified:false,appVersion:19,inboundAppVersion:21,
   knowledgeVersion:'qw-company-kb-v3-linktree',maxDurationSeconds:300,acceptanceEvidenceSha256:null}});
 expect(parseSarvamRuntimeProfile(candidate)).toEqual({reasons:['profile_not_runtime','duration_not_verified','knowledge_binding_invalid']});
 const withoutEvidence={...candidate,reviewOnly:false,runtimeProfile:true,verifiedMaxCallLengthMinutes:5,
  companyKnowledge:{...candidate.companyKnowledge,reviewOnly:false,providerAcceptanceVerified:true}};
 expect(parseSarvamRuntimeProfile(withoutEvidence)).toEqual({reasons:['knowledge_binding_invalid']});
});

// Synthetic owner attestations only. No provider evidence is asserted by these fixtures.
const binding=():SarvamKnowledgeBinding=>({reviewOnly:false,providerAcceptanceVerified:true,direction:'outbound',appVersion:12,
 inboundAppVersion:11,maxDurationSeconds:300,knowledgeBaseId:'synthetic-kb',knowledgeVersion:'qw-company-kb-v1',
 knowledgeSha256:'a'.repeat(64),policyVersion:'qw-route-policy-v1',policySha256:'b'.repeat(64),
 commonPolicySha256:'c'.repeat(64),acceptanceEvidenceSha256:'d'.repeat(64)});
const profile=(extra:object={})=>({reviewOnly:false,runtimeProfile:true,orgId:'synthetic-org',workspaceId:'synthetic-workspace',
 appId:'synthetic-app',appVersion:12,connectionId:'synthetic-connection',agentPhoneNumber:'+918000000001',
 requiredMaxCallLengthMinutes:5,verifiedMaxCallLengthMinutes:5,
 variableMapping:{call_purpose:'approvedDraft.purpose',user_name:'approvedDraft.recipient.displayName'},...extra});
const provider=(extra:Partial<SarvamCallProviderOptions>={}):SarvamCallProviderOptions=>({liveCallingEnabled:false,
 secrets:{resolve:async()=>({apiKey:'synthetic-api-key',webhookSecret:'synthetic-hook-secret-0123456789abcdef'})},
 orgId:'synthetic-org',workspaceId:'synthetic-workspace',appId:'synthetic-app',appVersion:12,connectionId:'synthetic-connection',
 agentPhoneNumber:'+918000000001',enforcedMaxDurationSeconds:300,callbackOrigin:'https://thaara.example.com',fetch:vi.fn(),...extra});

describe('Sarvam reviewed knowledge binding — no real network or database',()=>{
 it('admits a complete outbound attestation as an immutable copy, not authentication proof',()=>{
  const input=binding(),parsed=parseSarvamKnowledgeBinding(input,12,300);expect(parsed).toEqual(input);
  expect(parsed).not.toBe(input);expect(Object.isFrozen(parsed)).toBe(true);
 });
 it('admits the Linktree knowledge version and changes the outbound approval fingerprint',()=>{
  const legacy=binding();
  const updated={...legacy,knowledgeVersion:'qw-company-kb-v3-linktree'} as const;
  expect(parseSarvamKnowledgeBinding(updated,12,300)).toEqual(updated);
  expect(parseSarvamRuntimeProfile(profile({companyKnowledge:updated}))).toMatchObject({profile:{companyKnowledge:updated}});
  expect(createSarvamCallProvider(provider({companyKnowledge:updated})).configurationFingerprint)
   .not.toBe(createSarvamCallProvider(provider({companyKnowledge:legacy})).configurationFingerprint);
  expect(()=>parseSarvamKnowledgeBinding({...updated,providerAcceptanceVerified:false},12,300))
   .toThrow('PHONE_KNOWLEDGE_BINDING_INVALID');
 });
 it.each(['knowledgeSha256','policySha256','commonPolicySha256','acceptanceEvidenceSha256'] as const)(
  'requires well-formed %s and binds changes to approval fingerprints',key=>{
   expect(()=>parseSarvamKnowledgeBinding({...binding(),[key]:'secret-do-not-echo'},12,300)).toThrow('PHONE_KNOWLEDGE_BINDING_INVALID');
   const a=createSarvamCallProvider(provider({companyKnowledge:binding()}));
   const b=createSarvamCallProvider(provider({companyKnowledge:{...binding(),[key]:'e'.repeat(64)}}));
   expect(b.configurationFingerprint).not.toBe(a.configurationFingerprint);
  });
 it.each([{direction:'inbound'},{appVersion:11},{inboundAppVersion:12},{inboundAppVersion:null},{knowledgeBaseId:''},
  {reviewOnly:true},{providerAcceptanceVerified:false},{knowledgeVersion:'unreviewed'},{policyVersion:'unknown'},
  {maxDurationSeconds:301},{extra:'unexpected'},null])('rejects unreviewed/mixed/incomplete binding %j',patch=>{
   const raw=patch===null?null:{...binding(),...patch};expect(()=>parseSarvamKnowledgeBinding(raw,12,300)).toThrow('PHONE_KNOWLEDGE_BINDING_INVALID');
  });
 it('keeps the legacy adapter fingerprint unchanged when binding is absent',()=>{
  const p=provider();expect(createSarvamCallProvider(p).configurationFingerprint).toBe(createHash('sha256').update(JSON.stringify([
   p.orgId,p.workspaceId,p.appId,p.appVersion,p.connectionId,p.agentPhoneNumber,p.enforcedMaxDurationSeconds,'call_purpose:user_name:recipient:v1'])).digest('hex'));
  expect(createSarvamCallProvider({...p,companyKnowledge:binding()}).configurationFingerprint).not.toBe(createSarvamCallProvider(p).configurationFingerprint);
 });
 it('refuses a present invalid binding at adapter construction before any network request',()=>{
  const fetch=vi.fn();expect(()=>createSarvamCallProvider(provider({fetch,companyKnowledge:{...binding(),direction:'inbound'} as never}))).toThrow('PHONE_KNOWLEDGE_BINDING_INVALID');
  expect(fetch).not.toHaveBeenCalled();
 });
 it('includes an optional binding in runtime fingerprint; present invalid bindings never fall back to legacy',()=>{
  const p=parseSarvamRuntimeProfile(profile({companyKnowledge:binding()}));expect('profile' in p).toBe(true);
  if(!('profile' in p))throw Error('fixture denied');expect(p.profile.companyKnowledge).toEqual(binding());
  for(const value of [null,{}, {...binding(),appVersion:11}]){
   expect(parseSarvamRuntimeProfile(profile({companyKnowledge:value}))).toEqual({reasons:['knowledge_binding_invalid']});
  }
  const changed=parseSarvamRuntimeProfile(profile({companyKnowledge:{...binding(),knowledgeSha256:'e'.repeat(64)}}));
  if(!('profile' in changed))throw Error('fixture denied');expect(changed.profile.fingerprint).not.toBe(p.profile.fingerprint);
 });
 it('passes only the admitted binding through the loader; live switch remains mandatory',async()=>{
  const env={THAARA_PHONE_LIVE_CALLING:'approved',THAARA_SARVAM_PROFILE_FILE:'/synthetic/profile',THAARA_SARVAM_API_KEY_FILE:'/synthetic/key',
   THAARA_SARVAM_WEBHOOK_SECRET_FILE:'/synthetic/hook',THAARA_PHONE_CALLBACK_ORIGIN:'https://thaara.example.com'};
  const files={mode:async()=>0o600,readText:async(path:string)=>path.endsWith('profile')?JSON.stringify(profile({companyKnowledge:binding()})):
   path.endsWith('key')?'synthetic-api-key':'synthetic-hook-secret-0123456789abcdef'};
  const loaded=await loadSarvamRuntime(env,files);expect(loaded.status).toBe('ready');
  if(loaded.status!=='ready')throw Error('fixture denied');expect(loaded.providerOptions.companyKnowledge).toEqual(binding());
  expect(await loadSarvamRuntime({...env,THAARA_PHONE_LIVE_CALLING:undefined},files)).toEqual({status:'off',reasons:['live_switch_off']});
 });
 it('never sends binding/hash data as model variables or changes the approved recipient/purpose',async()=>{
  const fetch=vi.fn(async()=>new Response('{"attempt_id":"synthetic-attempt"}'));
  const p=createSarvamCallProvider(provider({liveCallingEnabled:true,fetch:fetch as typeof globalThis.fetch,companyKnowledge:binding()}));
  await p.dispatch({callId:'aaaaaaaa-1111-4111-8111-111111111111',to:'+919000000002',recipientName:'Ram',purpose:'Ask about the website.',
   language:'en-IN',maxDurationSeconds:300,aiDisclosure:'Hello, I am Thaara, an AI assistant.'});
  expect(fetch).toHaveBeenCalledTimes(1);const body=JSON.parse(String((fetch.mock.calls[0] as unknown as [string,RequestInit])[1].body));
  expect(body.app_config.agent_variables).toEqual({call_purpose:'Ask about the website.',user_name:'Ram'});
  expect(JSON.stringify(body)).not.toContain('knowledgeSha256');expect(JSON.stringify(body)).not.toContain('synthetic-kb');
 });
});
