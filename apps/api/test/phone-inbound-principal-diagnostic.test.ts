// NEW SQL113: never execute without separate approval for this exact disposable-memory package.
import {describe,it,beforeAll,beforeEach,afterEach,afterAll,expect} from 'vitest';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {makeInboundDiagnostic,type InboundDiagnostic} from '../src/services/phone-inbound-diagnostics.js';
import {loadPinnedInboundFixtureSql} from './helpers/phone-inbound-pinned-sql.js';
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
describe.skipIf(process.env.THAARA_PHONE113_DIAGNOSTIC_APPROVED!=='in-memory-only')('Step113 ONE diagnostic append only — separate approval required',()=>{
 const observations:InboundDiagnostic[]=[];
 const observationPath=root+'/node_modules/.cache/phone113-diagnostic-observation-v1.json';
 let setupPhase='base_schema';
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
 beforeAll(async()=>{ try{
  const m=JSON.parse(readFileSync(root+'/docs/integrations/phone/PHONE113_DIAGNOSTIC_APPROVAL.review.json','utf8'));
  if(m.reviewOnly!==true||m.environment!=='new-in-memory-PGlite-only')throw Error('PHONE113_MANIFEST_INVALID');
  for(const [path,hash] of Object.entries(m.files))if(createHash('sha256').update(readFileSync(root+'/'+path)).digest('hex')!==hash)throw Error('PHONE113_CHECKSUM_MISMATCH');
  // Validate exact set and capture only pinned SQL BEFORE constructing any engine. Never execute added files.
  const sql=loadPinnedInboundFixtureSql(m.files,readdirSync(root+'/packages/db/src/migrations'),path=>readFileSync(root+'/'+path,'utf8'));
  db=new PGliteDatabase(); // No path, URL, network pool, external connection or environment-derived target.
  const migrator=new Migrator(db);await migrator.migrate(sql.base);
  const ws=await new WorkspaceRepository(db).create('synthetic-phone'),otherWs=await new WorkspaceRepository(db).create('synthetic-foreign');
  async function identity(name:string,workspaceId:string){
   const user=await new UserRepository(db).create(name+'@example.test','unused',name),token=generateSessionToken();
   const scope={workspaceId,userId:user.id,role:'owner',sessionTokenHash:hashSessionToken(token)};
   await db.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(workspaceId,user.id,'owner');await new SessionRepository(tx).create(user.id,workspaceId,token);});return scope;
  }
  owner=await identity('phone-owner',ws.id);foreign=await identity('foreign-owner',otherWs.id);
  for(const step of [112,113]){
   setupPhase=step===112?'journal_schema':'principal_schema';
   await db.query(`SELECT set_config('thaara.step${step}_review_approved','in-memory-only',false),set_config('thaara.step${step}_target_database',current_database(),false)`);
   await db.exec(step===112?sql.journal:sql.principal);
  }
  setupPhase='fixture_setup';
  credential=randomBytes(32).toString('hex');tokenHash=createHash('sha256').update(credential).digest('hex');
  const inserted=await db.query<{principal_id:string}>(`INSERT INTO public.phone_inbound_principals(workspace_id,owner_user_id,route_id,token_hash,profile_fingerprint,revision,operations,expires_at)
   VALUES($1,$2,'synthetic-route',$3,$4,1,ARRAY['callback','completion'],clock_timestamp()+interval '1 hour') RETURNING principal_id`,[ws.id,owner.userId,tokenHash,'a'.repeat(64)]);
  profile={routeId:'synthetic-route',workspaceId:ws.id,ownerUserId:owner.userId,principalId:inserted.rows[0]!.principal_id,revision:1,profileFingerprint:'a'.repeat(64)};
  // One embedded connection: queue whole transactions. This is NOT real multi-connection lock testing.
  let tail=Promise.resolve();const pool={async connect(){let unlock!:()=>void;const previous=tail;tail=new Promise<void>(resolve=>{unlock=resolve;});await previous;return {query:db.query.bind(db),release:()=>unlock()};}};
  gate=createInboundPrincipalGate({profile,transactions:createInboundPrincipalTransactions({pool,onDiagnostic:d=>observations.push(d)})});journal=createInboundPrincipalJournal(gate);
 }catch(error){writeFileSync(observationPath,JSON.stringify({outcome:'setup_failed',setupPhase,diagnostics:[makeInboundDiagnostic('unknown',error)]})+'\n',{flag:'wx'});throw Error('PHONE113_DIAGNOSTIC_SETUP_FAILED');}
 },60000);
 beforeEach(runtime);afterEach(async()=>{if(db)await admin();});
 afterAll(async()=>{
  const cleanupPath=root+'/node_modules/.cache/phone113-diagnostic-cleanup-v1.json';
  try{if(db)await db.close();}catch{
   writeFileSync(cleanupPath,JSON.stringify({engineCreated:!!db,closed:false})+'\n',{flag:'wx'});throw Error('PHONE113_DIAGNOSTIC_CLOSE_FAILED');
  }
  writeFileSync(cleanupPath,JSON.stringify({engineCreated:!!db,closed:!!db})+'\n',{flag:'wx'});
 });
 it('records one first-append outcome without running completion or other acceptance cases',async()=>{
  let outcome:'saved'|'failed'='failed';
  try{const receipt=await journal.append(profile.routeId,'Bearer '+credential,'callback',event('a'));if(receipt.saved===true)outcome='saved';}
  catch{/* Only the adapter's finite diagnostic records are retained; no raw exception is serialized. */}
  writeFileSync(observationPath,JSON.stringify({outcome,diagnostics:observations,appendAttempts:1,completionAttempts:0,providerRequests:0})+'\n',{flag:'wx'});
  if(outcome==='failed')expect(observations.length).toBeGreaterThan(0);
  expect(observations.every(d=>Object.keys(d).sort().join(',')==='category,check,phase,sqlState')).toBe(true);
 });
});
