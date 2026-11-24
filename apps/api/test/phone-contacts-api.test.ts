import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {loadConfig} from '@thaara/config';
import {Logger} from '@thaara/observability';
import {buildApp} from '../src/app.js';
import {generateCsrfToken} from '../src/crypto/csrf.js';
import {phoneContactsDatabase} from './helpers/phone-contacts-fixture.js';

describe('Step 110 A2 phone contact management HTTP (in-memory PGlite with reviewed 110a schema)',()=>{
 let f:Awaited<ReturnType<typeof phoneContactsDatabase>>,app:Awaited<ReturnType<typeof buildApp>>,off:Awaited<ReturnType<typeof buildApp>>;
 const csrf=generateCsrfToken(),base='/api/v1/connectors/phone/ai/contacts';
 const headers=(s:{token:string})=>({cookie:`thaara_session=${s.token}; thaara_csrf=${csrf}`,'x-csrf-token':csrf});
 const ram={displayName:'Ram',aliases:['ರಾಮ್',' ರಾಮ್ '],phoneE164:'+919000000002',consent:{callingAllowed:true,source:'recipient_verbal',validDays:90}};
 beforeAll(async()=>{
  f=await phoneContactsDatabase();const config=loadConfig({NODE_ENV:'test'}),logger=new Logger('error');
  app=await buildApp({db:f.db,config,logger,phoneCalling:{durableContacts:true}});await app.ready();
  off=await buildApp({db:f.db,config,logger});await off.ready();
 },60000);
 afterAll(async()=>{await app?.close();await off?.close();await f?.db.close();});

 it('is not configured by default and saves nothing',async()=>{
  const r=await off.inject({method:'GET',url:base,headers:headers(f.owner)});expect(r.statusCode).toBe(503);expect(r.json().error.code).toBe('PHONE_CONTACTS_NOT_CONFIGURED');
  expect((await off.inject({method:'POST',url:base,headers:headers(f.owner),payload:ram})).statusCode).toBe(503);
 });

 it('requires authentication, CSRF, member role and strict payloads',async()=>{
  expect((await app.inject({method:'GET',url:base})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:base,headers:{cookie:headers(f.owner).cookie},payload:ram})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:base,headers:headers(f.viewer),payload:ram})).statusCode).toBe(403);
  for(const bad of [{...ram,workspaceId:f.owner.workspaceId},{...ram,phoneE164:'+14155550100'},{...ram,displayName:'<script>'},{...ram,consent:{...ram.consent,validDays:366}},{...ram,consent:{...ram.consent,reference:'forged'}},{...ram,consent:{...ram.consent,source:'owner_guess'}}])
   expect((await app.inject({method:'POST',url:base,headers:headers(f.owner),payload:bad})).statusCode).toBe(400);
 });

 it('creates, lists masked only, edits with revision fence and keeps the number, archives one-way',async()=>{
  const created=await app.inject({method:'POST',url:base,headers:headers(f.owner),payload:ram});expect(created.statusCode,created.body).toBe(200);
  const c=created.json();
  expect(c).toMatchObject({revision:1,displayName:'Ram',aliases:['ರಾಮ್'],maskedPhone:'+91 ******0002',archived:false,consent:{callingAllowed:true,source:'recipient_verbal',expired:false}});
  expect(c.contactId).toMatch(/^pc-/);expect(created.headers['cache-control']).toBe('no-store');
  expect(Date.parse(c.consent.expiresAt)-Date.parse(c.consent.recordedAt)).toBe(90*86400000);
  const list=await app.inject({method:'GET',url:base,headers:headers(f.owner)});
  expect(list.json().contacts).toHaveLength(1);expect(list.body).not.toContain('9000000002');expect(created.body).not.toContain('+919000000002');
  expect((await app.inject({method:'GET',url:base,headers:headers(f.member)})).json().contacts).toEqual([]);
  expect((await app.inject({method:'GET',url:base,headers:headers(f.foreign)})).json().contacts).toEqual([]);
  const edit={expectedRevision:1,displayName:'Ram Kumar',consent:{callingAllowed:true,source:'recipient_written',validDays:30}};
  expect((await app.inject({method:'PUT',url:`${base}/${c.contactId}`,headers:headers(f.member),payload:edit})).statusCode).toBe(409);
  const v2=await app.inject({method:'PUT',url:`${base}/${c.contactId}`,headers:headers(f.owner),payload:edit});expect(v2.statusCode,v2.body).toBe(200);
  expect(v2.json()).toMatchObject({revision:2,displayName:'Ram Kumar',maskedPhone:'+91 ******0002',consent:{source:'recipient_written'}});
  expect((await app.inject({method:'PUT',url:`${base}/${c.contactId}`,headers:headers(f.owner),payload:edit})).statusCode).toBe(409);
  const dup=await app.inject({method:'POST',url:base,headers:headers(f.owner),payload:{...ram,displayName:'Other'}});expect(dup.statusCode).toBe(409);
  expect((await app.inject({method:'POST',url:`${base}/${c.contactId}/archive`,headers:headers(f.owner),payload:{expectedRevision:1}})).statusCode).toBe(409);
  const archived=await app.inject({method:'POST',url:`${base}/${c.contactId}/archive`,headers:headers(f.owner),payload:{expectedRevision:2}});
  expect(archived.json()).toMatchObject({archived:true,revision:3});
  expect((await app.inject({method:'GET',url:base,headers:headers(f.owner)})).json().contacts).toEqual([]);
  expect((await app.inject({method:'PUT',url:`${base}/${c.contactId}`,headers:headers(f.owner),payload:{...edit,expectedRevision:3}})).statusCode).toBe(409);
  expect((await app.inject({method:'PUT',url:`${base}/bad%20id`,headers:headers(f.owner),payload:edit})).statusCode).toBe(400);
 });

 it('saved contacts drive call preparation; consent off blocks it and no call is placed',async()=>{
  const sita=(await app.inject({method:'POST',url:base,headers:headers(f.owner),payload:{...ram,displayName:'Sita',aliases:[],phoneE164:'+919000000003'}})).json();
  expect((await app.inject({method:'GET',url:'/api/v1/connectors/phone/ai/status',headers:headers(f.owner)})).json()).toMatchObject({contactDirectoryConfigured:true,liveCallingEnabled:false});
  const draft=await app.inject({method:'POST',url:'/api/v1/connectors/phone/ai/drafts',headers:headers(f.owner),payload:{contactQuery:'Sita',purpose:'Can you attend tomorrow?',language:'en-IN'}});
  expect(draft.statusCode,draft.body).toBe(200);expect(draft.json()).toMatchObject({status:'awaiting_approval',liveCallingEnabled:false,draft:{contactId:sita.contactId,contactRevision:1}});
  await app.inject({method:'PUT',url:`${base}/${sita.contactId}`,headers:headers(f.owner),payload:{expectedRevision:1,displayName:'Sita',consent:{callingAllowed:false,source:'recipient_verbal',validDays:30}}});
  expect((await app.inject({method:'POST',url:'/api/v1/connectors/phone/ai/drafts',headers:headers(f.owner),payload:{contactQuery:'Sita',purpose:'Again?',language:'en-IN'}})).statusCode).toBe(403);
 });
});
