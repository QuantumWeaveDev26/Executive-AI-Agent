// NEW SQL112: separate exact owner approval required. Default discovery MUST skip this suite.
import {describe,it,beforeAll,afterAll,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PGliteDatabase,Migrator,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,generateSessionToken,hashSessionToken,type AuthenticatedScope} from '@thaara/db';
import {PhoneInboundEventRepository} from '../src/services/phone-inbound-event-store.js';
import {makeInboundReport} from '../src/services/phone-inbound-reports.js';
import type {InboundEventInput} from '../src/services/phone-inbound-events.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const approved=process.env.THAARA_PHONE112_SQL_TEST_APPROVED==='in-memory-only';
describe.skipIf(!approved)('Step112 separately approved NEW in-memory SQL only',()=>{
 let db:PGliteDatabase,repo:PhoneInboundEventRepository,owner:AuthenticatedScope,other:AuthenticatedScope,foreign:AuthenticatedScope,member:AuthenticatedScope;
 function event(id:string,kind:InboundEventInput['kind']='callback_requested'):InboundEventInput{
  const report={...makeInboundReport({id,occurredAt:'2026-11-03T12:00:00Z',callerPhone:'+919000000001',customerName:'Synthetic customer',business:'Synthetic retail',serviceNeeded:'Automation',enquirySummary:'Synthetic enquiry',callbackInterest:'unknown'},
   {...owner,direction:'inbound',authenticatedRoute:true}),providerInteractionId:'synthetic/'+id,
   outcome:kind==='callback_requested'?'callback_requested' as const:'enquired' as const,
   callbackConsent:kind==='callback_requested'?'confirmed' as const:kind==='callback_withdrawn'?'declined' as const:'unknown' as const,
   callbackRequestId:kind==='callback_requested'?'callback-'+id:null};
  return {eventId:kind+'-'+id,callId:id,kind,sourceDigest:createHash('sha256').update(kind+id).digest('hex'),report};
 }
 beforeAll(async()=>{
  const manifest=JSON.parse(readFileSync(root+'/docs/integrations/phone/PHONE112_IN_MEMORY_APPROVAL.review.json','utf8'));
  if(manifest.reviewOnly!==true||manifest.environment!=='new-in-memory-PGlite-only')throw Error('PHONE112_MANIFEST_INVALID');
  for(const [path,hash] of Object.entries(manifest.files))if(createHash('sha256').update(readFileSync(root+'/'+path)).digest('hex')!==hash)throw Error('PHONE112_CHECKSUM_MISMATCH');
  // No path, URL, pool or environment-derived database connection.
  db=new PGliteDatabase();const migrator=new Migrator(db);await migrator.migrate(migrator.loadMigrationFiles(root+'/packages/db/src/migrations'));
  const ws=await new WorkspaceRepository(db).create('synthetic-journal'),ws2=await new WorkspaceRepository(db).create('synthetic-foreign');
  async function identity(name:string,role:'owner'|'member',workspaceId=ws.id){
   const user=await new UserRepository(db).create(name+'@example.test','unused',name),token=generateSessionToken();
   const scope={workspaceId,userId:user.id,role,sessionTokenHash:hashSessionToken(token)};
   await db.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(workspaceId,user.id,role);await new SessionRepository(tx).create(user.id,workspaceId,token);});return scope;
  }
  owner=await identity('owner','owner');other=await identity('other','owner');foreign=await identity('foreign','owner',ws2.id);member=await identity('member','member');
  await db.query("SELECT set_config('thaara.step112_review_approved','in-memory-only',false),set_config('thaara.step112_target_database',current_database(),false)");
  await db.exec(readFileSync(root+'/docs/migrations/112-phone-inbound-events.review.sql','utf8'));await db.exec('SET ROLE thaara_app');
  let tail=Promise.resolve();const serial={withScopedTransaction:<T>(scope:AuthenticatedScope,fn:any):Promise<T>=>{
   const result=tail.then(()=>db.withScopedTransaction(scope,fn)) as Promise<T>;tail=result.then(()=>undefined,()=>undefined);return result;
  }};
  repo=new PhoneInboundEventRepository(serial as never);
 },60000);
 afterAll(async()=>{if(db)await db.close();});
 it('persists two phases and reads one merged callback through a fresh repository',async()=>{
  const id='a'.repeat(64);await repo.append(owner,event(id));await repo.append(owner,event(id,'call_completed'));
  const reopened=new PhoneInboundEventRepository(db);expect((await reopened.read(owner,id))?.outcome).toBe('callback_requested');expect((await reopened.list(owner)).filter(r=>r.id===id)).toHaveLength(1);
 });
 it('isolates owners, workspaces and members through restricted-role RLS',async()=>{
  const id='a'.repeat(64);for(const scope of [other,foreign])expect(await repo.read(scope,id)).toBeNull();await expect(repo.list(member)).rejects.toThrow();
  for(const scope of [other,foreign,member])expect((await db.withScopedTransaction(scope,tx=>tx.query('SELECT call_id FROM public.phone_inbound_call_events'))).rows).toHaveLength(0);
  const forged=event('b'.repeat(64));forged.report.ownerUserId=member.userId;
  await expect(db.withScopedTransaction(member,tx=>tx.query(`INSERT INTO public.phone_inbound_call_events(workspace_id,owner_user_id,call_id,event_id,kind,source_digest,sequence,report) VALUES($1,$2,$3,$4,$5,$6,1,$7::jsonb)`,[member.workspaceId,member.userId,forged.callId,forged.eventId,forged.kind,forged.sourceDigest,JSON.stringify(forged.report)]))).rejects.toThrow();
 });
 it('deduplicates queued callers and rejects conflicting fingerprints',async()=>{
  const e=event('c'.repeat(64));const results=await Promise.all([repo.append(owner,e),repo.append(owner,e)]);expect(results.map(r=>r.duplicate)).toEqual([false,true]);
  await expect(repo.append(owner,{...e,sourceDigest:'f'.repeat(64)})).rejects.toThrow();
 });
 it('preserves completion-first metadata and never revives withdrawn callback consent',async()=>{
  const id='d'.repeat(64),completion=event(id,'call_completed');completion.report.durationSeconds=42;completion.report.callStatus='ended';
  await repo.append(owner,completion);await repo.append(owner,event(id));await repo.append(owner,event(id,'callback_withdrawn'));
  const replay=await repo.append(owner,event(id));expect(replay.report.callbackConsent).toBe('declined');expect(replay.report.callbackRequestId).toBeNull();expect(replay.report.durationSeconds).toBe(42);
 });
 it('rolls back the journal insert when its audit insert fails',async()=>{
  const id='e'.repeat(64);
  await db.exec(`RESET ROLE; CREATE FUNCTION public.fail_phone112_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='phone.inbound.event_saved' AND NEW.target_id=repeat('e',64) THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER phone112_test_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_phone112_test_audit(); SET ROLE thaara_app;`);
  await expect(repo.append(owner,event(id))).rejects.toThrow();expect(await repo.read(owner,id)).toBeNull();
 });
 it('filters expired media on read and audits without customer data',async()=>{
  const id='f'.repeat(64),e=event(id);e.report.transcript=[{speaker:'caller',text:'Expired synthetic words',languageBasis:'provider_english'}];e.report.transcriptExpiresAt='2000-01-01T00:00:00Z';
  await repo.append(owner,e);expect((await repo.read(owner,id))?.transcript).toBeUndefined();
  const r=await db.withScopedTransaction(owner,tx=>tx.query("SELECT payload FROM public.audit_events WHERE action='phone.inbound.event_details_read'"));expect(r.rows.length).toBeGreaterThan(0);expect(JSON.stringify(r.rows)).not.toContain('+919000000001');
 });
 it('rejects changed caller binding without saving the completion phase',async()=>{
  const id='1'.repeat(64);await repo.append(owner,event(id));const changed=event(id,'call_completed');changed.report.callerPhone='+919000000002';
  await expect(repo.append(owner,changed)).rejects.toThrow();const r=await db.withScopedTransaction(owner,tx=>tx.query('SELECT call_id FROM public.phone_inbound_call_events WHERE call_id=$1',[id]));expect(r.rows).toHaveLength(1);
 });
 it('rejects runtime update/delete and revoked owner sessions',async()=>{
  await expect(db.withScopedTransaction(owner,tx=>tx.query('UPDATE public.phone_inbound_call_events SET sequence=1'))).rejects.toThrow();
  await expect(db.withScopedTransaction(owner,tx=>tx.query('DELETE FROM public.phone_inbound_call_events'))).rejects.toThrow();
  await db.exec('RESET ROLE');await db.query('UPDATE public.sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[owner.sessionTokenHash]);await db.exec('SET ROLE thaara_app');await expect(repo.list(owner)).rejects.toThrow();
 });
});
