// NEW SQL113: never execute without separate approval for this exact disposable-memory package.
import {describe,it,beforeAll,beforeEach,afterEach,afterAll,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {PGliteDatabase,Migrator,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,generateSessionToken,hashSessionToken,type AuthenticatedScope,type DbClient} from '@thaara/db';
import {createInboundPrincipalTransactions} from '../src/services/phone-inbound-principal-postgres.js';
import {createInboundPrincipalGate} from '../src/services/phone-inbound-principal.js';
import {createInboundPrincipalJournal} from '../src/services/phone-inbound-principal-journal.js';
import {PhoneInboundEventRepository} from '../src/services/phone-inbound-event-store.js';
import {makeInboundReport} from '../src/services/phone-inbound-reports.js';
import type {InboundEventInput} from '../src/services/phone-inbound-events.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
describe.skipIf(process.env.THAARA_PHONE113_SQL_TEST_APPROVED!=='in-memory-only')('Step113 NEW principal SQL — separately approved memory only',()=>{
 let db:PGliteDatabase,owner:AuthenticatedScope,foreign:AuthenticatedScope;
 let journal:ReturnType<typeof createInboundPrincipalJournal>,gate:ReturnType<typeof createInboundPrincipalGate<DbClient>>;
 let credential:string,tokenHash:string,profile:{routeId:string;workspaceId:string;ownerUserId:string;principalId:string;revision:number;profileFingerprint:string};
 const admin=async()=>{await db.exec('RESET ROLE; RESET SESSION AUTHORIZATION');};
 const runtime=async()=>{await admin();await db.exec('SET SESSION AUTHORIZATION thaara_phone_ingest');};
 function event(char:string,kind:InboundEventInput['kind']='callback_requested'):InboundEventInput{
  const id=char.repeat(64),report={...makeInboundReport({id,occurredAt:'2026-11-03T12:00:00Z',callerPhone:'+919000000001',customerName:'Synthetic customer',business:'Synthetic retail',serviceNeeded:'Automation',enquirySummary:'Synthetic enquiry',callbackInterest:'unknown'},
   {...owner,direction:'inbound',authenticatedRoute:true}),providerInteractionId:'20261103/'+id,
   outcome:kind==='callback_requested'?'callback_requested' as const:'enquired' as const,
   callbackConsent:kind==='callback_requested'?'confirmed' as const:kind==='callback_withdrawn'?'declined' as const:'unknown' as const,
   callbackRequestId:kind==='callback_requested'?'callback-'+id:null};
  return {callId:id,eventId:kind+'-'+id,kind,sourceDigest:createHash('sha256').update(id+kind).digest('hex'),report};
 }
 beforeAll(async()=>{
  const m=JSON.parse(readFileSync(root+'/docs/integrations/phone/PHONE113_IN_MEMORY_APPROVAL.review.json','utf8'));
  if(m.reviewOnly!==true||m.environment!=='new-in-memory-PGlite-only')throw Error('PHONE113_MANIFEST_INVALID');
  for(const [path,hash] of Object.entries(m.files))if(createHash('sha256').update(readFileSync(root+'/'+path)).digest('hex')!==hash)throw Error('PHONE113_CHECKSUM_MISMATCH');
  db=new PGliteDatabase(); // No path, URL, network pool, external connection or environment-derived target.
  const migrator=new Migrator(db);await migrator.migrate(migrator.loadMigrationFiles(root+'/packages/db/src/migrations'));
  const ws=await new WorkspaceRepository(db).create('synthetic-phone'),otherWs=await new WorkspaceRepository(db).create('synthetic-foreign');
  async function identity(name:string,workspaceId:string){
   const user=await new UserRepository(db).create(name+'@example.test','unused',name),token=generateSessionToken();
   const scope={workspaceId,userId:user.id,role:'owner',sessionTokenHash:hashSessionToken(token)};
   await db.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(workspaceId,user.id,'owner');await new SessionRepository(tx).create(user.id,workspaceId,token);});return scope;
  }
  owner=await identity('phone-owner',ws.id);foreign=await identity('foreign-owner',otherWs.id);
  for(const step of [112,113]){
   await db.query(`SELECT set_config('thaara.step${step}_review_approved','in-memory-only',false),set_config('thaara.step${step}_target_database',current_database(),false)`);
   await db.exec(readFileSync(root+`/docs/migrations/${step===112?'112-phone-inbound-events':'113-phone-inbound-principals'}.review.sql`,'utf8'));
  }
  credential=randomBytes(32).toString('hex');tokenHash=createHash('sha256').update(credential).digest('hex');
  const inserted=await db.query<{principal_id:string}>(`INSERT INTO public.phone_inbound_principals(workspace_id,owner_user_id,route_id,token_hash,profile_fingerprint,revision,operations,expires_at)
   VALUES($1,$2,'synthetic-route',$3,$4,1,ARRAY['callback','completion'],clock_timestamp()+interval '1 hour') RETURNING principal_id`,[ws.id,owner.userId,tokenHash,'a'.repeat(64)]);
  profile={routeId:'synthetic-route',workspaceId:ws.id,ownerUserId:owner.userId,principalId:inserted.rows[0]!.principal_id,revision:1,profileFingerprint:'a'.repeat(64)};
  // One embedded connection: queue whole transactions. This is NOT real multi-connection lock testing.
  let tail=Promise.resolve();const pool={async connect(){let unlock!:()=>void;const previous=tail;tail=new Promise<void>(resolve=>{unlock=resolve;});await previous;return {query:db.query.bind(db),release:()=>unlock()};}};
  gate=createInboundPrincipalGate({profile,transactions:createInboundPrincipalTransactions({pool})});journal=createInboundPrincipalJournal(gate);
 },60000);
 beforeEach(runtime);afterEach(async()=>{if(db)await admin();});afterAll(async()=>{if(db)await db.close();});
 it('saves callback and completion under the exact non-owner service identity',async()=>{
  const a=await journal.append(profile.routeId,'Bearer '+credential,'callback',event('a'));
  const b=await journal.append(profile.routeId,'Bearer '+credential,'completion',event('a','call_completed'));
  expect(a.saved).toBe(true);expect(b.report.outcome).toBe('callback_requested');expect(b.revision).toBe(2);
 });
 it('deduplicates same phase with no extra audit and rejects changed fingerprint',async()=>{
  const e=event('b');await journal.append(profile.routeId,'Bearer '+credential,'callback',e);
  expect((await journal.append(profile.routeId,'Bearer '+credential,'callback',e)).duplicate).toBe(true);
  await expect(journal.append(profile.routeId,'Bearer '+credential,'callback',{...e,sourceDigest:'f'.repeat(64)})).rejects.toThrow();
  await admin();const count=await db.query<{n:string}>('SELECT count(*)::text AS n FROM public.audit_events WHERE target_id=$1',[e.callId]);expect(count.rows[0]?.n).toBe('1');
 });
 it('denies direct table reads/writes, privilege escalation and browser identity claims',async()=>{
  for(const sql of ['SELECT * FROM public.phone_inbound_call_events','SELECT * FROM public.phone_inbound_principals','SELECT * FROM public.sessions','SELECT * FROM public.audit_events','SET ROLE thaara_phone_guard',"DELETE FROM public.phone_inbound_call_events"]){await expect(db.exec(sql)).rejects.toThrow();}
  await db.query("SELECT set_config('app.workspace_id',$1,false),set_config('app.user_id',$2,false),set_config('app.role','owner',false)",[foreign.workspaceId,foreign.userId]);
  await expect(journal.append(profile.routeId,'Bearer '+credential,'callback',{...event('c'),report:{...event('c').report,workspaceId:foreign.workspaceId,ownerUserId:foreign.userId}})).rejects.toThrow();
 });
 it('rejects wrong token, route and operation before accepting an event',async()=>{
  await expect(journal.append(profile.routeId,'Bearer '+randomBytes(32).toString('hex'),'callback',event('c'))).rejects.toThrow();
  await expect(journal.append('other','Bearer '+credential,'callback',event('c'))).rejects.toThrow();
  await expect(journal.append(profile.routeId,'Bearer '+credential,'completion',event('c'))).rejects.toThrow();
 });
 it('preserves completion-first order and withdrawal across old callback replay',async()=>{
  await journal.append(profile.routeId,'Bearer '+credential,'completion',event('d','call_completed'));
  await journal.append(profile.routeId,'Bearer '+credential,'callback',event('d'));
  await journal.append(profile.routeId,'Bearer '+credential,'callback',event('d','callback_withdrawn'));
  const result=await journal.append(profile.routeId,'Bearer '+credential,'callback',event('d'));expect(result.report.callbackConsent).toBe('declined');expect(result.report.callbackRequestId).toBeNull();
 });
 it('rolls back the event when audit insertion fails',async()=>{
  await admin();await db.exec(`CREATE FUNCTION public.fail_phone113_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='phone.inbound.event_saved' AND NEW.target_id=repeat('e',64) THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER phone113_test_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_phone113_audit();`);await runtime();
  await expect(journal.append(profile.routeId,'Bearer '+credential,'callback',event('e'))).rejects.toThrow();
  await admin();expect((await db.query('SELECT call_id FROM public.phone_inbound_call_events WHERE call_id=$1',['e'.repeat(64)])).rows).toHaveLength(0);
 });
 it('rejects malformed customer fields, forged bookings and raw retained media at the direct function boundary',async()=>{
  for(const extra of [{customerName:{nested:true}},{appointment:{eventId:'forged'},outcome:'booked_appointment'},{transcript:[]},{unexpected:'not permitted'}]){
   const e={...event('f'),report:{...event('f').report,...extra}};
   await expect(gate.run(profile.routeId,'Bearer '+credential,'callback',async(_s,tx)=>tx.query('SELECT public.phone_inbound_append_event($1::jsonb)',[JSON.stringify(e)]))).rejects.toThrow();
  }
 });
 it('rejects revoked/expired grants and owner demotion without changing unrelated data',async()=>{
  for(const change of ["revoked_at=clock_timestamp()","expires_at=created_at+interval '1 millisecond'","operations=ARRAY['completion']"]){
   await admin();await db.exec(`UPDATE public.phone_inbound_principals SET ${change}`);await runtime();await expect(journal.append(profile.routeId,'Bearer '+credential,'callback',event('1'))).rejects.toThrow();
   await admin();await db.exec("UPDATE public.phone_inbound_principals SET revoked_at=NULL,expires_at=created_at+interval '1 hour',operations=ARRAY['callback','completion']");
  }
  await db.query("UPDATE public.memberships SET role='member' WHERE workspace_id=$1 AND user_id=$2",[owner.workspaceId,owner.userId]);await runtime();
  await expect(journal.append(profile.routeId,'Bearer '+credential,'callback',event('1'))).rejects.toThrow();
  await admin();await db.query("UPDATE public.memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2",[owner.workspaceId,owner.userId]);
 });
 it('preserves existing owner/app access and foreign-workspace isolation after the new policy',async()=>{
  await admin();await db.exec('SET ROLE thaara_app');const repo=new PhoneInboundEventRepository(db);
  expect((await repo.read(owner,'a'.repeat(64)))?.outcome).toBe('callback_requested');expect(await repo.read(foreign,'a'.repeat(64))).toBeNull();
 });
 it('deduplicates queued service transactions without implying multi-connection concurrency proof',async()=>{
  const e=event('2'),results=await Promise.all([journal.append(profile.routeId,'Bearer '+credential,'callback',e),journal.append(profile.routeId,'Bearer '+credential,'callback',e)]);
  expect(results.map(r=>r.duplicate)).toEqual([false,true]);expect(results[0]?.report.id).toBe(results[1]?.report.id);
 });
});
