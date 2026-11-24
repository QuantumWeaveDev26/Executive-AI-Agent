import fs from 'node:fs';
import {describe,expect,it,vi,afterAll,beforeAll} from 'vitest';
import {loadConfig} from '@thaara/config';
import {Logger} from '@thaara/observability';
import {buildApp} from '../src/app.js';
import {createPhoneStartup,isRuntimeLoadedPhoneProvider} from '../src/services/phone-pilot-startup.js';
import {createSarvamCallProvider} from '../src/services/phone-sarvam-calls.js';
import type {SarvamRuntimeFiles} from '../src/services/phone-sarvam-runtime.js';
import {phoneContactsDatabase} from './helpers/phone-contacts-fixture.js';

const PROFILE=JSON.parse(fs.readFileSync(new URL('../../../docs/integrations/phone/sarvam-runtime-profile.pilot.json',import.meta.url),'utf8'));
const SYNTHETIC_KEY='synthetic-api-key-value',SYNTHETIC_HOOK='w'.repeat(40);
const paths={profile:'/run/secrets/sarvam_profile',key:'/run/secrets/sarvam_api_key',hook:'/run/secrets/sarvam_webhook_secret'};
const liveEnv={THAARA_PHONE_DURABLE:'approved',THAARA_PHONE_LIVE_CALLING:'approved',THAARA_SARVAM_PROFILE_FILE:paths.profile,THAARA_SARVAM_API_KEY_FILE:paths.key,
 THAARA_SARVAM_WEBHOOK_SECRET_FILE:paths.hook,THAARA_PHONE_CALLBACK_ORIGIN:'https://thaara-v2.quantumweaveai.io'};
const files=(over:Record<string,string>={},mode:number|null=0o400):SarvamRuntimeFiles=>({
 readText:vi.fn(async(p:string)=>{const v=({[paths.profile]:JSON.stringify(PROFILE),[paths.key]:SYNTHETIC_KEY,[paths.hook]:SYNTHETIC_HOOK,...over} as Record<string,string>)[p];if(v===undefined)throw new Error('missing');return v;}),
 mode:vi.fn(async()=>mode)});

describe('phone startup wiring',()=>{
 it('stays completely off by default and reads no files',async()=>{
  const f=files(),network=vi.fn();
  expect(await createPhoneStartup({},f,network as unknown as typeof fetch)).toEqual({status:'off',reasons:[]});
  expect(f.readText).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
 });
 it('uses the durable schema with calling disabled when only the durable switch is on',async()=>{
  const f=files(),result=await createPhoneStartup({THAARA_PHONE_DURABLE:'approved'},f);
  expect(result.status).toBe('durable');expect(result.phoneCalling).toEqual({durableContacts:true,durableCalls:true});
  expect(f.readText).not.toHaveBeenCalled();
 });
 it('prepares existing owner Calendar review only behind the exact switch and never enables dialing',async()=>{
  const f=files(),network=vi.fn();
  const result=await createPhoneStartup({THAARA_PHONE_DURABLE:'approved',THAARA_PHONE_OWNER_CALENDAR_REVIEW:'approved'},f,network as unknown as typeof fetch);
  expect(result).toEqual({status:'durable',reasons:[],phoneCalling:{durableContacts:true,durableCalls:true},phoneOwnerCalendarReview:true});
  expect(f.readText).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
  for(const value of [undefined,'true','approved ','APPROVED'])expect((await createPhoneStartup({THAARA_PHONE_DURABLE:'approved',THAARA_PHONE_OWNER_CALENDAR_REVIEW:value},f)).phoneOwnerCalendarReview).toBeUndefined();
  expect(await createPhoneStartup({THAARA_PHONE_OWNER_CALENDAR_REVIEW:'approved'},f)).toEqual({status:'refused',reasons:['durable_not_approved']});
 });
 it('ignores near-miss switch values',async()=>{
  for(const value of ['true','APPROVED','approved ','1'])
   expect((await createPhoneStartup({THAARA_PHONE_DURABLE:value,THAARA_PHONE_LIVE_CALLING:value},files())).status).toBe('off');
 });
 it('refuses live calling without the durable schema',async()=>{
  const f=files(),result=await createPhoneStartup({...liveEnv,THAARA_PHONE_DURABLE:undefined},f);
  expect(result).toEqual({status:'refused',reasons:['durable_not_approved']});expect(f.readText).not.toHaveBeenCalled();
 });
 it('falls back to calling disabled, reporting codes only, when a live check fails',async()=>{
  for(const [f,reason] of [[files({},0o644),'secret_file_permissions'],[files({},null),'secret_file_permissions'],[files({[paths.hook]:'short'}),'webhook_secret_invalid']] as const){
   const result=await createPhoneStartup(liveEnv,f);
   expect(result.status).toBe('refused');expect(result.reasons).toContain(reason);
   expect(result.phoneCalling).toEqual({durableContacts:true,durableCalls:true});
   expect(JSON.stringify(result)).not.toContain(SYNTHETIC_KEY);
  }
 });
 it('builds a live provider from the pinned pilot profile without contacting the provider',async()=>{
  const network=vi.fn(),result=await createPhoneStartup(liveEnv,files(),network as unknown as typeof fetch);
  expect(result.status).toBe('live');
  const live=result.phoneCalling!.liveCalling!;
  expect(live.provider).toMatchObject({name:'sarvam',liveCallingEnabled:true,enforcedMaxDurationSeconds:300});
  expect(live.dailyCallLimit).toBe(5);expect(isRuntimeLoadedPhoneProvider(live.provider)).toBe(true);
  expect(await live.sarvamWebhook.webhookSecret()).toBe(SYNTHETIC_HOOK);
  expect(network).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain(SYNTHETIC_KEY);
 });
 it('fails closed on use when a secret file later becomes unreadable by policy',async()=>{
  const f=files(),result=await createPhoneStartup(liveEnv,f);
  (f.mode as ReturnType<typeof vi.fn>).mockResolvedValue(0o644);
  await expect(result.phoneCalling!.liveCalling!.sarvamWebhook.webhookSecret()).rejects.toThrow('Sarvam secrets unavailable');
 });
 it('keeps the committed review profile refused and the pilot profile pinned to the existing agent',async()=>{
  const review=fs.readFileSync(new URL('../../../docs/integrations/phone/sarvam-existing-agent.review.json',import.meta.url),'utf8');
  const result=await createPhoneStartup(liveEnv,files({[paths.profile]:review}));
  expect(result.status).toBe('refused');expect(result.reasons).toEqual(expect.arrayContaining(['profile_not_runtime','duration_not_verified']));
  const reviewed=JSON.parse(review);
  for(const k of ['orgId','workspaceId','appId','appVersion','connectionId','agentPhoneNumber','variableMapping'])expect(PROFILE[k]).toEqual(reviewed[k]);
  expect(PROFILE.requiredMaxCallLengthMinutes).toBe(5);
 });
});

describe('buildApp live guard outside tests',()=>{
 let f:Awaited<ReturnType<typeof phoneContactsDatabase>>;
 const config=()=>loadConfig({NODE_ENV:'development',SESSION_SECRET:'s'.repeat(40),CSRF_SECRET:'c'.repeat(40)});
 beforeAll(async()=>{f=await phoneContactsDatabase({live:true});await f.db.exec('RESET ROLE;');},60000);
 afterAll(async()=>{await f.db.close();});
 it('refuses a live provider that did not come from the runtime loader',async()=>{
  const provider=createSarvamCallProvider({liveCallingEnabled:true,secrets:{resolve:async()=>({apiKey:SYNTHETIC_KEY,webhookSecret:SYNTHETIC_HOOK})},orgId:'o',workspaceId:'w',appId:'a',appVersion:2,connectionId:'c',
   enforcedMaxDurationSeconds:300,agentPhoneNumber:'+918064269780',callbackOrigin:'https://thaara-v2.quantumweaveai.io',fetch:vi.fn() as unknown as typeof fetch});
  await expect(buildApp({db:f.db,config:config(),logger:new Logger('error'),phoneCalling:{durableContacts:true,durableCalls:true,liveCalling:{provider}}})).rejects.toThrow(/not approved/);
 });
 it('accepts the runtime-loaded provider, still without provider traffic, and keeps report voice refused',async()=>{
  const network=vi.fn(),startup=await createPhoneStartup(liveEnv,files(),network as unknown as typeof fetch);
  const app=await buildApp({db:f.db,config:config(),logger:new Logger('error'),phoneCalling:startup.phoneCalling});
  try{
   const hook=await app.inject({method:'POST',url:'/api/v1/connectors/phone/sarvam/calls/00000000-0000-4000-8000-000000000001/'+'0'.repeat(64),payload:{}});
   expect(hook.statusCode).toBeGreaterThanOrEqual(400);expect(hook.statusCode).not.toBe(404);
   expect(network).not.toHaveBeenCalled();
  }finally{await app.close();}
  await expect(buildApp({db:f.db,config:config(),logger:new Logger('error'),phoneCalling:{...startup.phoneCalling,reportVoice:{} as never}})).rejects.toThrow(/not approved/);
 });
});
