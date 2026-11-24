// GATED: NEW SQL must not execute without separate owner approval for this exact in-memory suite.
import {describe,it,beforeAll,afterAll,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PGliteDatabase,Migrator,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,generateSessionToken,hashSessionToken,type AuthenticatedScope} from '@thaara/db';
import {PhoneInboundReportRepository} from '../src/services/phone-inbound-persistence.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const approved=process.env.THAARA_PHONE111_SQL_TEST_APPROVED==='in-memory-only';
describe.skipIf(!approved)('Step111 NEW SQL — owner-approved disposable in-memory engine only',()=>{
 let db:PGliteDatabase,repo:PhoneInboundReportRepository,owner:AuthenticatedScope,other:AuthenticatedScope,foreign:AuthenticatedScope,member:AuthenticatedScope;
 const input=(id:string)=>({id,occurredAt:'2026-11-03T12:00:00Z',callerPhone:'+919000000001',customerName:'Synthetic customer',business:'Synthetic retail',serviceNeeded:'Automation',enquirySummary:'Synthetic enquiry only',callbackInterest:'yes' as const});
 beforeAll(async()=>{
  const manifest=JSON.parse(readFileSync(root+'/docs/integrations/phone/PHONE111_IN_MEMORY_APPROVAL.review.json','utf8'));
  if(manifest.reviewOnly!==true||manifest.environment!=='new-in-memory-PGlite-only')throw Error('PHONE111_MANIFEST_INVALID');
  for(const [path,hash] of Object.entries(manifest.files))if(createHash('sha256').update(readFileSync(root+'/'+path)).digest('hex')!==hash)throw Error('PHONE111_CHECKSUM_MISMATCH');
  // Constructor has NO path, URL, pool or environment-derived connection: new PGlite() is memory-only.
  db=new PGliteDatabase();const migrator=new Migrator(db);await migrator.migrate(migrator.loadMigrationFiles(root+'/packages/db/src/migrations'));
  const ws=await new WorkspaceRepository(db).create('synthetic-inbound'),ws2=await new WorkspaceRepository(db).create('synthetic-inbound-foreign');
  async function identity(name:string,role:'owner'|'member',workspaceId=ws.id){
   const user=await new UserRepository(db).create(name+'@example.test','unused',name),token=generateSessionToken();
   const scope={workspaceId,userId:user.id,role,sessionTokenHash:hashSessionToken(token)};
   await db.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(workspaceId,user.id,role);await new SessionRepository(tx).create(user.id,workspaceId,token);});return scope;
  }
  owner=await identity('inbound-owner','owner');other=await identity('inbound-other-owner','owner');foreign=await identity('inbound-foreign','owner',ws2.id);member=await identity('inbound-member','member');
  await db.query("SELECT set_config('thaara.step111_review_approved','in-memory-only',false),set_config('thaara.step111_target_database',current_database(),false)");
  await db.exec(readFileSync(root+'/docs/migrations/111-phone-inbound-reports.review.sql','utf8'));await db.exec('SET ROLE thaara_app');
  // PGlite has one connection. Serialize whole scoped transactions, never overlap nested BEGIN.
  // This checks queued concurrent callers, NOT multiple-connection PostgreSQL lock/concurrency behavior.
  let tail=Promise.resolve();const serial={...db,withScopedTransaction:<T>(scope:AuthenticatedScope,fn:any):Promise<T>=>{
   const result=tail.then(()=>db.withScopedTransaction(scope,fn)) as Promise<T>;tail=result.then(()=>undefined,()=>undefined);return result;
  }};
  repo=new PhoneInboundReportRepository(serial as never);
 },60000);
 afterAll(async()=>{if(db)await db.close();});
 it('round-trips final report through a fresh repository object without claiming a saved callback',async()=>{
  await repo.save(owner,'event-roundtrip',input('roundtrip'));
  const reopened=new PhoneInboundReportRepository(db),r=await reopened.read(owner,'roundtrip');
  expect(r?.outcome).toBe('needs_review');expect(r?.customerName).toBe('Synthetic customer');expect(r?.callbackRequestId).toBeNull();
 });
 it('enforces workspace and owner isolation in repository and restricted-role RLS',async()=>{
  expect(await repo.read(other,'roundtrip')).toBeNull();expect(await repo.read(foreign,'roundtrip')).toBeNull();
  for(const scope of [other,foreign]){
   const r=await db.withScopedTransaction(scope,tx=>tx.query('SELECT report_id FROM public.phone_inbound_reports WHERE report_id=$1',['roundtrip']));expect(r.rows).toHaveLength(0);
  }
 });
 it('rejects member access and prevents member direct INSERT',async()=>{
  await expect(repo.list(member)).rejects.toThrow();
  const original=(await repo.read(owner,'roundtrip'))!,forged={...original,id:'blocked-member',ownerUserId:member.userId};
  await expect(db.withScopedTransaction(member,tx=>tx.query(`INSERT INTO public.phone_inbound_reports(workspace_id,owner_user_id,report_id,event_id,report_hash,occurred_at,report)
   VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[member.workspaceId,member.userId,forged.id,'blocked-event','0'.repeat(64),original.occurredAt,JSON.stringify(forged)]))).rejects.toThrow();
  const r=await db.withScopedTransaction(member,tx=>tx.query('SELECT report_id FROM public.phone_inbound_reports'));expect(r.rows).toHaveLength(0);
 });
 it('makes identical replay idempotent and rejects conflicting report/event reuse',async()=>{
  const a=await repo.save(owner,'event-replay',input('replay'));expect(await repo.save(owner,'event-replay',input('replay'))).toEqual(a);
  await expect(repo.save(owner,'event-replay',{...input('replay'),enquirySummary:'Changed'})).rejects.toThrow();
  await expect(repo.save(owner,'event-new',input('replay'))).rejects.toThrow();
 });
 it('deduplicates queued concurrent callers on the single in-memory connection',async()=>{
  const results=await Promise.all([repo.save(owner,'event-queued',input('queued')),repo.save(owner,'event-queued',input('queued'))]);
  expect(results[0]).toEqual(results[1]);expect((await repo.list(owner)).filter(r=>r.id==='queued')).toHaveLength(1);
 });
 it('rolls back report INSERT when its audit INSERT fails',async()=>{
  await db.exec(`RESET ROLE; CREATE FUNCTION public.fail_phone111_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='phone.inbound.report_saved' AND NEW.target_id='audit-fail' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER phone111_test_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_phone111_test_audit(); SET ROLE thaara_app;`);
  await expect(repo.save(owner,'event-audit-fail',input('audit-fail'))).rejects.toThrow();expect(await repo.read(owner,'audit-fail')).toBeNull();
 });
 it('audits owner detail access without putting customer number/business into audit payload',async()=>{
  await repo.read(owner,'roundtrip');const r=await db.withScopedTransaction(owner,tx=>tx.query<{payload:unknown}>("SELECT payload FROM public.audit_events WHERE action='phone.inbound.details_read' AND target_id='roundtrip'"));
  expect(r.rows.length).toBeGreaterThan(0);expect(JSON.stringify(r.rows)).not.toContain('+919000000001');expect(JSON.stringify(r.rows)).not.toContain('Synthetic retail');
 });
 it('rejects runtime update/delete and invalidates revoked owner sessions',async()=>{
  await expect(db.withScopedTransaction(owner,tx=>tx.query("UPDATE public.phone_inbound_reports SET report_hash=repeat('0',64)"))).rejects.toThrow();
  await expect(db.withScopedTransaction(owner,tx=>tx.query('DELETE FROM public.phone_inbound_reports'))).rejects.toThrow();
  await db.exec('RESET ROLE');await db.query('UPDATE public.sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[owner.sessionTokenHash]);await db.exec('SET ROLE thaara_app');
  await expect(repo.list(owner)).rejects.toThrow();
 });
});
