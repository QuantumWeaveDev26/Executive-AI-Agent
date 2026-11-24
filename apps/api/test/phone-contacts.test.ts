import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PGliteDatabase,Migrator,PhoneContactRepository,ApprovalRepository,ConflictError,ValidationError,ForbiddenError,type PhoneContactInput} from '@thaara/db';
import {PhoneCallingService} from '../src/services/phone-calling.js';
import {createPhoneCallingStore} from '../src/services/phone-calling-store.js';
import {createPostgresPhoneContactDirectory} from '../src/services/phone-contacts-postgres.js';
import {phoneContactsDatabase,PHONE_CONTACTS_SQL,approve110a} from './helpers/phone-contacts-fixture.js';

const day=86400000;
const input=(over:Partial<PhoneContactInput>={}):PhoneContactInput=>({displayName:'Ram',aliases:['ರಾಮ್'],phoneE164:'+919000000002',
 consent:{callingAllowed:true,reference:'consent-ram-1',source:'recipient_verbal',recordedAt:new Date(Date.now()-day).toISOString(),expiresAt:new Date(Date.now()+30*day).toISOString()},...over});

describe('Step 110a review SQL guard (in-memory PGlite only)',()=>{
 it('refuses to run without explicit approval/target database and refuses a second application',async()=>{
  const db=new PGliteDatabase(),m=new Migrator(db);await m.migrate(m.loadMigrationFiles());
  await expect(db.exec(PHONE_CONTACTS_SQL)).rejects.toThrow(/explicit approval/);await db.exec('ROLLBACK;');
  await db.query("SELECT set_config('thaara.step110a_review_approved','yes',false),set_config('thaara.step110a_target_database','other_db',false)");
  await expect(db.exec(PHONE_CONTACTS_SQL)).rejects.toThrow(/explicit approval/);await db.exec('ROLLBACK;');
  await approve110a(db);await db.exec(PHONE_CONTACTS_SQL);
  await expect(db.exec(PHONE_CONTACTS_SQL)).rejects.toThrow(/already exist/);await db.exec('ROLLBACK;');
  await db.close();
 });
});

describe('Step 110a phone contacts: RLS, owner isolation, revision fence, consent and audit',()=>{
 let f:Awaited<ReturnType<typeof phoneContactsDatabase>>,repo:PhoneContactRepository;
 beforeAll(async()=>{f=await phoneContactsDatabase();repo=new PhoneContactRepository(f.db);},60000);
 afterAll(async()=>{await f?.db.close();});

 it('creates and lists only the caller’s contacts; audit carries no phone number or name',async()=>{
  const c=await repo.create(f.owner,'ram',input());
  expect(c).toMatchObject({contactId:'ram',revision:1,archived:false,phoneE164:'+919000000002',aliases:['ರಾಮ್'],consent:{source:'recipient_verbal',callingAllowed:true}});
  expect((await repo.listActive(f.owner)).map(x=>x.contactId)).toEqual(['ram']);
  expect(await repo.listActive(f.member)).toEqual([]);
  expect(await repo.listActive(f.foreign)).toEqual([]);
  // RLS itself, not only the repository WHERE clause, hides other owners' rows.
  for(const s of [f.member,f.foreign,f.viewer])expect((await f.db.withScopedTransaction(s,tx=>tx.query('SELECT contact_id FROM public.phone_contacts'))).rows).toEqual([]);
  expect((await f.db.withScopedTransaction(f.owner,tx=>tx.query('SELECT contact_id FROM public.phone_contacts'))).rows).toHaveLength(1);
  const audit=await f.db.withScopedTransaction(f.owner,tx=>tx.query<{action:string;payload:unknown}>("SELECT action,payload FROM audit_events WHERE target_type='phone_contact'"));
  expect(audit.rows.map(r=>r.action)).toEqual(['phone.contacts.created']);
  expect(JSON.stringify(audit.rows)).not.toMatch(/9000000002|Ram|ರಾಮ್/);
 });

 it('denies viewers, foreign scope writes and revoked sessions at the database',async()=>{
  await expect(repo.create(f.viewer,'x',input({phoneE164:'+919000000009'}))).rejects.toBeInstanceOf(ForbiddenError);
  const raw=(s:typeof f.owner,ws:string,user:string)=>f.db.withScopedTransaction(s,tx=>tx.query(`INSERT INTO public.phone_contacts (workspace_id,owner_user_id,contact_id,revision,display_name,phone_e164,consent_calling_allowed,consent_reference,consent_source,consent_recorded_at,consent_expires_at)
   VALUES ($1,$2,'forged',1,'Forged','+919000000008',true,'c','recipient_verbal',now(),now()+interval '1 day')`,[ws,user]));
  await expect(raw(f.viewer,f.viewer.workspaceId,f.viewer.userId)).rejects.toThrow();
  await expect(raw(f.member,f.owner.workspaceId,f.owner.userId)).rejects.toThrow();
  await expect(raw(f.foreign,f.owner.workspaceId,f.owner.userId)).rejects.toThrow();
  await expect(f.db.withScopedTransaction(f.owner,tx=>tx.query("DELETE FROM public.phone_contacts WHERE contact_id='ram'"))).rejects.toThrow();
  const temp=await repo.create(f.member,'m1',input({phoneE164:'+919000000007'}));expect(temp.revision).toBe(1);
  await f.db.withScopedTransaction(f.member,tx=>tx.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[f.member.sessionTokenHash]));
  expect(await repo.listActive(f.member)).toEqual([]);
 });

 it('enforces database checks even when application validation is bypassed',async()=>{
  const bad=[["'+14155550100'","now()+interval '1 day'"],["'+919000000006'","now()+interval '400 days'"],["'+919000000006'","now()-interval '1 day'"]];
  for(const [phone,expires] of bad){
   await expect(f.db.withScopedTransaction(f.owner,tx=>tx.query(`INSERT INTO public.phone_contacts (workspace_id,owner_user_id,contact_id,revision,display_name,phone_e164,consent_calling_allowed,consent_reference,consent_source,consent_recorded_at,consent_expires_at)
    VALUES ($1,$2,'bad',1,'Bad',${phone},true,'c','recipient_verbal',now(),${expires})`,[f.owner.workspaceId,f.owner.userId]))).rejects.toThrow();
  }
  for(const over of [{phoneE164:'9000000002'},{displayName:'<b>x</b>'},{aliases:Array(21).fill('a')},{consent:{...input().consent,expiresAt:new Date(Date.now()+400*day).toISOString()}},{consent:{...input().consent,source:'owner_guess' as never}}])
   await expect(repo.create(f.owner,'bad2',input(over))).rejects.toBeInstanceOf(ValidationError);
 });

 it('fences revisions, keeps one active contact per number, and archiving is one-way',async()=>{
  await expect(repo.create(f.owner,'ram-dup',input())).rejects.toBeInstanceOf(ConflictError);
  const v2=await repo.update(f.owner,'ram',1,input({displayName:'Ram Kumar'}));expect(v2.revision).toBe(2);
  await expect(repo.update(f.owner,'ram',1,input())).rejects.toBeInstanceOf(ConflictError);
  await expect(f.db.withScopedTransaction(f.owner,tx=>tx.query("UPDATE public.phone_contacts SET revision=revision+5 WHERE contact_id='ram'"))).rejects.toThrow(/revision fence/);
  const sita=await repo.create(f.owner,'sita',input({displayName:'Sita',aliases:[],phoneE164:'+919000000003'}));
  await expect(repo.update(f.owner,'sita',sita.revision,input({displayName:'Sita',phoneE164:'+919000000002'}))).rejects.toBeInstanceOf(ConflictError);
  const archived=await repo.archive(f.owner,'sita',1);expect(archived).toMatchObject({revision:2,archived:true});
  expect((await repo.listActive(f.owner)).map(c=>c.contactId)).toEqual(['ram']);
  await expect(repo.update(f.owner,'sita',2,input({displayName:'Sita',phoneE164:'+919000000003'}))).rejects.toBeInstanceOf(ConflictError);
  await expect(f.db.withScopedTransaction(f.owner,tx=>tx.query("UPDATE public.phone_contacts SET revision=revision+1, archived=false WHERE contact_id='sita'"))).rejects.toThrow(/revision fence/);
  expect((await repo.create(f.owner,'sita2',input({displayName:'Sita',aliases:[],phoneE164:'+919000000003'}))).revision).toBe(1);
 });

 it('feeds PhoneCallingService; a contact change after preparation invalidates the approval',async()=>{
  const service=new PhoneCallingService({contacts:createPostgresPhoneContactDirectory(f.db),store:createPhoneCallingStore(f.db),simulation:true});
  expect(await service.status(f.owner)).toMatchObject({contactDirectoryConfigured:true,liveCallingEnabled:false});
  expect(await service.resolve(f.owner,'Ram Kumar')).toMatchObject({status:'matched',candidates:[{id:'ram',maskedPhone:'+91 ******0002'}]});
  expect(await service.resolve(f.foreign,'Ram Kumar')).toMatchObject({status:'not_found'});
  const p=await service.prepare(f.owner,{contactQuery:'ರಾಮ್',purpose:'Can you attend tomorrow?',language:'kn-IN'});
  expect(p.draft).toMatchObject({contactId:'ram',contactRevision:2,mode:'simulation'});
  await f.db.withScopedTransaction(f.owner,tx=>new ApprovalRepository(tx).transitionStatus(f.owner.workspaceId,p.approvalId,'pending','approved',f.owner.userId));
  await repo.update(f.owner,'ram',2,input({displayName:'Ram Kumar',phoneE164:'+919000000005'}));
  await expect(service.simulate(f.owner,p.approvalId)).rejects.toBeInstanceOf(Error);
  expect((await service.history(f.owner)).calls).toEqual([]);
  const q=await service.prepare(f.owner,{contactQuery:'Ram Kumar',purpose:'Can you attend tomorrow?',language:'en-IN'});
  await f.db.withScopedTransaction(f.owner,tx=>new ApprovalRepository(tx).transitionStatus(f.owner.workspaceId,q.approvalId,'pending','approved',f.owner.userId));
  expect(await service.simulate(f.owner,q.approvalId)).toMatchObject({state:'queued',simulated:true,verified:false,providerCallId:null});
  // Withdrawn consent blocks the next call even with an existing approval-shaped request.
  await repo.update(f.owner,'ram',3,input({displayName:'Ram Kumar',phoneE164:'+919000000005',consent:{...input().consent,callingAllowed:false}}));
  await expect(service.prepare(f.owner,{contactQuery:'Ram Kumar',purpose:'Again?',language:'en-IN'})).rejects.toThrow();
 });
});
