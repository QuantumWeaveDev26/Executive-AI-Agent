import {describe,expect,it} from 'vitest';
import {loadSarvamRuntime,parseSarvamRuntimeProfile,type SarvamRuntimeFiles} from '../src/services/phone-sarvam-runtime.js';

// In-memory files only; synthetic identifiers and secrets. Nothing is read from disk or sent anywhere.
const KEY='synthetic-sarvam-api-key-123',HOOK='synthetic-webhook-secret-0123456789abcdefghij';
const profile=(over:object={})=>({reviewOnly:false,runtimeProfile:true,orgId:'org-1',workspaceId:'ws-1',appId:'Thaara-AI-V-synthetic',appVersion:2,
 connectionId:'conn-1',agentPhoneNumber:'+918000000001',requiredMaxCallLengthMinutes:5,verifiedMaxCallLengthMinutes:5,
 variableMapping:{call_purpose:'approvedDraft.purpose',user_name:'approvedDraft.recipient.displayName'},...over});
function fs(entries:Record<string,{text:string;mode:number|null}>):SarvamRuntimeFiles&{reads:string[]}{
 const reads:string[]=[];
 return {reads,async readText(p){reads.push(p);const e=entries[p];if(!e)throw new Error('ENOENT');return e.text;},async mode(p){const e=entries[p];if(!e)throw new Error('ENOENT');return e.mode;}};
}
const env={THAARA_PHONE_LIVE_CALLING:'approved',THAARA_SARVAM_PROFILE_FILE:'/etc/thaara/sarvam-profile.json',THAARA_SARVAM_API_KEY_FILE:'/run/secrets/sarvam_api_key',
 THAARA_SARVAM_WEBHOOK_SECRET_FILE:'/run/secrets/sarvam_webhook_secret',THAARA_PHONE_CALLBACK_ORIGIN:'https://thaara-v2.example.com'};
const files=(over:Record<string,{text:string;mode:number|null}>={})=>fs({'/etc/thaara/sarvam-profile.json':{text:JSON.stringify(profile()),mode:0o644},
 '/run/secrets/sarvam_api_key':{text:KEY+'\n',mode:0o400},'/run/secrets/sarvam_webhook_secret':{text:HOOK,mode:0o600},...over});

describe('Sarvam runtime profile validation',()=>{
 it('accepts only a runtime profile whose provider-side duration was verified and whose variable mapping is exact',()=>{
  const ok=parseSarvamRuntimeProfile(profile());
  expect('profile' in ok&&ok.profile).toMatchObject({appVersion:2,maxCallLengthMinutes:5,connectionId:'conn-1'});
  expect('profile' in ok&&ok.profile.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  // The checked-in review profile (reviewOnly, verified duration null) must never load as a runtime profile.
  expect(parseSarvamRuntimeProfile(profile({reviewOnly:true,runtimeProfile:undefined,verifiedMaxCallLengthMinutes:null}))).toEqual({reasons:['profile_not_runtime','duration_not_verified']});
  expect(parseSarvamRuntimeProfile(profile({verifiedMaxCallLengthMinutes:10}))).toEqual({reasons:['duration_mismatch']});
  expect(parseSarvamRuntimeProfile(profile({variableMapping:{call_purpose:'approvedDraft.purpose',user_name:'owner.name'}}))).toEqual({reasons:['variable_mapping_mismatch']});
  expect(parseSarvamRuntimeProfile(profile({agentPhoneNumber:'8064269780'}))).toEqual({reasons:['profile_invalid']});
  expect(parseSarvamRuntimeProfile(profile({appId:'a/b'}))).toEqual({reasons:['profile_invalid']});
  const other=parseSarvamRuntimeProfile(profile({appVersion:3}));
  expect('profile' in other&&'profile' in ok&&other.profile.fingerprint).not.toBe('profile' in ok&&ok.profile.fingerprint);
 });
});

describe('Sarvam runtime loading',()=>{
 it('stays off unless the live switch is explicitly approved, without reading any file',async()=>{
  for(const value of [undefined,'on','true','APPROVED']){
   const f=files();expect(await loadSarvamRuntime({...env,THAARA_PHONE_LIVE_CALLING:value},f)).toEqual({status:'off',reasons:['live_switch_off']});expect(f.reads).toEqual([]);
  }
 });
 it('loads a complete, private configuration and re-reads secrets on use (rotation without restart)',async()=>{
  const entries={'/run/secrets/sarvam_api_key':{text:KEY,mode:0o400}};
  const f=files(entries);
  const r=await loadSarvamRuntime(env,f);
  expect(r.status).toBe('ready');
  if(r.status!=='ready')return;
  expect(r).toMatchObject({dailyCallLimit:5,callbackOrigin:'https://thaara-v2.example.com',profile:{appVersion:2}});
  expect(r.providerOptions).toMatchObject({appId:'Thaara-AI-V-synthetic',appVersion:2,enforcedMaxDurationSeconds:300,agentPhoneNumber:'+918000000001'});
  expect(JSON.stringify(r)).not.toContain(KEY);expect(JSON.stringify(r)).not.toContain(HOOK);
  expect(await r.providerOptions.secrets.resolve()).toEqual({apiKey:KEY,webhookSecret:HOOK});
  entries['/run/secrets/sarvam_api_key'].text='rotated-sarvam-key-456';
  expect((await r.providerOptions.secrets.resolve()).apiKey).toBe('rotated-sarvam-key-456');
  entries['/run/secrets/sarvam_api_key'].mode=0o644;
  await expect(r.providerOptions.secrets.resolve()).rejects.toThrow('Sarvam secrets unavailable');
  expect(await r.webhookSecret().catch(e=>(e as Error).message)).toBe('Sarvam secrets unavailable');
 });
 it('refuses with reason codes only, never values',async()=>{
  const r=await loadSarvamRuntime({...env,THAARA_PHONE_CALLBACK_ORIGIN:'http://thaara.example.com',THAARA_PHONE_DAILY_CALL_LIMIT:'50'},
   files({'/run/secrets/sarvam_api_key':{text:KEY,mode:0o644},'/run/secrets/sarvam_webhook_secret':{text:'short',mode:0o600}}));
  expect(r).toEqual({status:'refused',reasons:['secret_file_permissions','webhook_secret_invalid','callback_origin_invalid','daily_limit_invalid']});
  expect(JSON.stringify(r)).not.toContain(KEY);
  expect(await loadSarvamRuntime({...env,THAARA_SARVAM_API_KEY_FILE:'secrets/key',THAARA_SARVAM_WEBHOOK_SECRET_FILE:undefined},files())).toEqual({status:'refused',reasons:['secret_file_not_absolute','webhook_secret_file_missing']});
  expect(await loadSarvamRuntime({...env,THAARA_SARVAM_PROFILE_FILE:undefined},files())).toMatchObject({status:'refused',reasons:['profile_file_missing']});
  expect(await loadSarvamRuntime(env,files({'/etc/thaara/sarvam-profile.json':{text:'{not json',mode:0o644}}))).toMatchObject({status:'refused',reasons:['profile_unreadable']});
  for(const origin of ['https://localhost','https://thaara.local','https://thaara.example.com/path','https://thaara.example.com:8443'])
   expect(await loadSarvamRuntime({...env,THAARA_PHONE_CALLBACK_ORIGIN:origin},files())).toMatchObject({status:'refused',reasons:['callback_origin_invalid']});
 });
 it('refuses the checked-in review profile as-is (duration not yet verified on the provider)',async()=>{
  const review={...profile(),reviewOnly:true,liveCallingEnabled:false,runtimeProfile:undefined,verifiedMaxCallLengthMinutes:null};
  expect(await loadSarvamRuntime(env,files({'/etc/thaara/sarvam-profile.json':{text:JSON.stringify(review),mode:0o644}}))).toEqual({status:'refused',reasons:['profile_not_runtime','duration_not_verified']});
 });
});
