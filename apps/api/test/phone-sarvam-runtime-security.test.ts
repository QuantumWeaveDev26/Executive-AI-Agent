import {describe,expect,it} from 'vitest';
import {loadSarvamRuntime,type SarvamRuntimeFiles} from '../src/services/phone-sarvam-runtime.js';

// Synthetic in-memory files. No provider, filesystem, DNS or socket access.
const profile={reviewOnly:false,runtimeProfile:true,orgId:'synthetic-org',workspaceId:'synthetic-ws',appId:'synthetic-agent',appVersion:2,
 connectionId:'synthetic-connection',agentPhoneNumber:'+918000000001',requiredMaxCallLengthMinutes:5,verifiedMaxCallLengthMinutes:5,
 variableMapping:{call_purpose:'approvedDraft.purpose',user_name:'approvedDraft.recipient.displayName'}};
const env={THAARA_PHONE_LIVE_CALLING:'approved',THAARA_SARVAM_PROFILE_FILE:'/synthetic/profile',THAARA_SARVAM_API_KEY_FILE:'/synthetic/key',
 THAARA_SARVAM_WEBHOOK_SECRET_FILE:'/synthetic/hook',THAARA_PHONE_CALLBACK_ORIGIN:'https://thaara.example.com'};
function files(mode:number|null):SarvamRuntimeFiles&{secretReads:string[]}{
 const secretReads:string[]=[];
 return {secretReads,mode:async()=>mode,readText:async path=>{
  if(path==='/synthetic/profile')return JSON.stringify(profile);
  secretReads.push(path);return 'synthetic-secret-value-0123456789abcdefghij';
 }};
}
describe('Sarvam runtime permission and callback boundary regressions',()=>{
 it.each([null,NaN,-1,0o000,0o444,0o500,0o700,0o4600])('refuses unverified or non-private secret mode %s before reading secret contents',async mode=>{
  const f=files(mode);const result=await loadSarvamRuntime(env,f);
  expect(result).toMatchObject({status:'refused',reasons:['secret_file_permissions']});expect(f.secretReads).toEqual([]);
 });
 it.each([0o400,0o600,0o100400,0o100600])('accepts verified owner-only read/write modes %s',async mode=>{
  expect(await loadSarvamRuntime(env,files(mode))).toMatchObject({status:'ready',dailyCallLimit:5});
 });
 it('refuses IP literals, local aliases and single-label callback hosts without network lookups',async()=>{
  for(const origin of ['https://127.0.0.1','https://127.1','https://2130706433','https://10.0.0.1','https://169.254.169.254',
   'https://[::1]','https://[::ffff:127.0.0.1]','https://localhost.','https://pilot','https://pilot.localdomain','https://pilot.internal']){
   expect(await loadSarvamRuntime({...env,THAARA_PHONE_CALLBACK_ORIGIN:origin},files(0o600))).toMatchObject({status:'refused',reasons:['callback_origin_invalid']});
  }
 });
 it('rechecks permissions on each secret use, including when permissions become unknown',async()=>{
  let mode:number|null=0o600;const f=files(mode);f.mode=async()=>mode;
  const result=await loadSarvamRuntime(env,f);expect(result.status).toBe('ready');if(result.status!=='ready')return;
  const before=f.secretReads.length;mode=null;
  await expect(result.providerOptions.secrets.resolve()).rejects.toThrow('Sarvam secrets unavailable');
  expect(f.secretReads).toHaveLength(before);
 });
});
