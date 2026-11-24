import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PGliteDatabase,Migrator,PhoneContactRepository,ApprovalRepository} from '@thaara/db';
import {computeCanonicalParameterHash} from '@thaara/contracts';
import {PhoneCallingService} from '../src/services/phone-calling.js';
import {createPhoneCallingStore} from '../src/services/phone-calling-store.js';
import {createPostgresPhoneContactDirectory} from '../src/services/phone-contacts-postgres.js';
import {createPostgresPhoneCallLedger} from '../src/services/phone-calls-postgres.js';
import {phoneContactsDatabase,PHONE_CALLS_SQL,approve110b} from './helpers/phone-contacts-fixture.js';

const day=86400000;
const contact=(phoneE164:string,displayName:string)=>({displayName,aliases:[],phoneE164,consent:{callingAllowed:true,reference:'consent-'+displayName,source:'recipient_verbal' as const,recordedAt:new Date(Date.now()-day).toISOString(),expiresAt:new Date(Date.now()+30*day).toISOString()}});

describe('Step 110b review SQL guard (in-memory PGlite only)',()=>{
 it('refuses without approval, without 110a, and on a second application',async()=>{
  const db=new PGliteDatabase(),m=new Migrator(db);await m.migrate(m.loadMigrationFiles());
  await expect(db.exec(PHONE_CALLS_SQL)).rejects.toThrow(/explicit approval/);await db.exec('ROLLBACK;');
  await approve110b(db);
  await expect(db.exec(PHONE_CALLS_SQL)).rejects.toThrow(/110a/);await db.exec('ROLLBACK;');
  await db.close();
  const f=await phoneContactsDatabase({calls:true});await f.db.exec('RESET ROLE;');
  await expect(f.db.exec(PHONE_CALLS_SQL)).rejects.toThrow(/already exist/);await f.db.exec('ROLLBACK;');
  await f.db.close();
 },60000);
});

describe('Step 110b durable call ledger: one-use claim, state fence, append-only events, RLS',()=>{
 let f:Awaited<ReturnType<typeof phoneContactsDatabase>>;
 const services=()=>new PhoneCallingService({contacts:createPostgresPhoneContactDirectory(f.db),calls:createPostgresPhoneCallLedger(f.db),store:createPhoneCallingStore(f.db),simulation:true});
 const approve=(id:string)=>f.db.withScopedTransaction(f.owner,tx=>new ApprovalRepository(tx).transitionStatus(f.owner.workspaceId,id,'pending','approved',f.owner.userId));
 const prepare=(s:PhoneCallingService,purpose='Can you attend tomorrow?')=>s.prepare(f.owner,{contactQuery:'Ram',purpose,language:'en-IN'});
 let callId='';let approvalId='';
 beforeAll(async()=>{
  f=await phoneContactsDatabase({calls:true});
  await new PhoneContactRepository(f.db).create(f.owner,'ram',contact('+919000000002','Ram'));
 },60000);
 afterAll(async()=>{await f?.db.close();});

 it('claims exactly one durable call per approved draft and reports durable history truthfully',async()=>{
  const s=services();
  expect(await s.status(f.owner)).toMatchObject({durableCallHistory:true,liveCallingEnabled:false,recordingEnabled:false});
  const p=await prepare(s);approvalId=p.approvalId;
  await expect(s.simulate(f.owner,p.approvalId)).rejects.toThrow();
  await approve(p.approvalId);
  const first=await s.simulate(f.owner,p.approvalId);callId=first.id;
  expect(first).toMatchObject({state:'queued',simulated:true,verified:false,providerCallId:null,draft:p.draft});
  expect((await s.simulate(f.owner,p.approvalId)).id).toBe(first.id);
  expect(await services().history(f.owner)).toMatchObject({durable:true,calls:[{id:first.id}]});
  expect((await s.history(f.member)).calls).toEqual([]);
  expect((await s.history(f.foreign)).calls).toEqual([]);
 });

 it('records the conversation durably, survives a restart, and keeps replays idempotent',async()=>{
  const s=services();
  await s.simulationEvent(f.owner,callId,{eventId:'e1',sequence:1,kind:'state',state:'ringing'});
  await s.simulationEvent(f.owner,callId,{eventId:'e2',sequence:2,kind:'state',state:'answered'});
  const restarted=services();
  await restarted.simulationEvent(f.owner,callId,{eventId:'e3',sequence:3,kind:'recipient_final',text:'Yes, I can attend at 11.'});
  await restarted.simulationEvent(f.owner,callId,{eventId:'e4',sequence:4,kind:'interruption'});
  expect((await restarted.simulationEvent(f.owner,callId,{eventId:'e3',sequence:3,kind:'recipient_final',text:'Yes, I can attend at 11.'})).state).toBe('answered');
  await expect(restarted.simulationEvent(f.owner,callId,{eventId:'e3',sequence:3,kind:'recipient_final',text:'No.'})).rejects.toThrow();
  await expect(restarted.simulationEvent(f.owner,callId,{eventId:'e9',sequence:9,kind:'state',state:'completed'})).rejects.toThrow();
  await expect(restarted.simulationEvent(f.owner,callId,{eventId:'e5',sequence:5,kind:'state',state:'ringing'})).rejects.toThrow();
  const done=await services().simulationEvent(f.owner,callId,{eventId:'e5',sequence:5,kind:'state',state:'completed'});
  expect(done.state).toBe('completed');
  expect(done.report).toMatchObject({quotedResponses:['Yes, I can attend at 11.'],evidenceIds:['e3'],verified:false,simulated:true});
  expect(done.report.text).toContain('Simulation only');
  await expect(services().simulationEvent(f.owner,callId,{eventId:'e6',sequence:6,kind:'state',state:'failed'})).rejects.toThrow();
  await expect(services().simulationEvent(f.member,callId,{eventId:'e6',sequence:6,kind:'interruption'})).rejects.toThrow();
  const audit=await f.db.withScopedTransaction(f.owner,tx=>tx.query<{action:string;payload:unknown}>("SELECT action,payload FROM audit_events WHERE target_type='phone_call' ORDER BY created_at"));
  expect(audit.rows.map(r=>r.action)).toEqual(['phone.ai.call_claimed','phone.ai.call_event','phone.ai.call_event','phone.ai.call_event','phone.ai.call_event','phone.ai.call_event']);
  expect(JSON.stringify(audit.rows)).not.toMatch(/9000000002|attend/);
 });

 it('enforces the claim, state fence and append-only log in the database itself',async()=>{
  const q=(s:typeof f.owner,sql:string,params:unknown[]=[])=>f.db.withScopedTransaction(s,tx=>tx.query(sql,params));
  const s=services(),pending=await prepare(s,'Second question?');
  const insert=(approval:string,draft:Record<string,unknown>,id=randomUUID(),scope=f.owner)=>q(scope,`INSERT INTO public.phone_calls (workspace_id,owner_user_id,call_id,approval_id,draft,draft_hash,idempotency_key,contact_id,contact_revision,mode,state,report)
   VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,'simulation','queued',$10::jsonb)`,[f.owner.workspaceId,f.owner.userId,id,approval,JSON.stringify(draft),computeCanonicalParameterHash(draft),draft.idempotencyKey,draft.contactId,draft.contactRevision,JSON.stringify({text:'',spokenText:'',quotedResponses:[],evidenceIds:[],verified:false,simulated:true})]);
  await expect(insert(pending.approvalId,pending.draft)).rejects.toThrow(/exact approved draft/);
  await approve(pending.approvalId);
  await expect(insert(pending.approvalId,{...pending.draft,purpose:'Tampered'})).rejects.toThrow(/exact approved draft/);
  await expect(insert(approvalId,(await s.history(f.owner)).calls[0]!.draft)).rejects.toThrow();
  await expect(insert(pending.approvalId,pending.draft,randomUUID(),f.member)).rejects.toThrow();
  const second=await s.simulate(f.owner,pending.approvalId);
  await expect(q(f.owner,"UPDATE public.phone_calls SET state='completed', event_sequence=1 WHERE call_id=$1",[second.id])).rejects.toThrow(/state fence/);
  await expect(q(f.owner,"UPDATE public.phone_calls SET state='ringing', event_sequence=1 WHERE call_id=$1",[second.id])).rejects.toThrow(/requires its event/);
  await expect(q(f.owner,"UPDATE public.phone_calls SET draft='{}'::jsonb WHERE call_id=$1",[second.id])).rejects.toThrow();
  await expect(q(f.owner,"UPDATE public.phone_calls SET provider_call_id='real' WHERE call_id=$1",[second.id])).rejects.toThrow();
  await expect(q(f.owner,'DELETE FROM public.phone_calls WHERE call_id=$1',[second.id])).rejects.toThrow();
  await expect(q(f.owner,'DELETE FROM public.phone_call_events WHERE call_id=$1',[callId])).rejects.toThrow();
  await expect(q(f.owner,"UPDATE public.phone_call_events SET text='changed' WHERE call_id=$1",[callId])).rejects.toThrow();
  for(const other of [f.member,f.foreign,f.viewer]){
   expect((await q(other,'SELECT call_id FROM public.phone_calls')).rows).toEqual([]);
   expect((await q(other,'SELECT event_id FROM public.phone_call_events')).rows).toEqual([]);
  }
  expect((await q(f.owner,'SELECT event_id FROM public.phone_call_events WHERE call_id=$1',[callId])).rows).toHaveLength(5);
 });
});
