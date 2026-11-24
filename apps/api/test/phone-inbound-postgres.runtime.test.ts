// EXCLUDED from ordinary regression. Requires a new explicit isolated-runtime approval and owned Docker proof.
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import Fastify from 'fastify';
import {PostgresDatabase,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,generateSessionToken,hashSessionToken,type AuthenticatedScope} from '@thaara/db';
import {inboundRuntimeConfig,INBOUND_RELAY_CACHE_PATH} from '../../../scripts/phone-inbound-runtime-config.mjs';
import {inspectInboundRuntimeFixture,inspectInboundUnpublishedFixture} from '../../../scripts/phone-inbound-runtime-guard.mjs';
import {createInboundPrincipalTransactions} from '../src/services/phone-inbound-principal-postgres.js';
import {createSarvamInboundService,buildInboundServiceBinding} from '../src/services/phone-sarvam-inbound-service.js';
import {PhoneInboundEventRepository} from '../src/services/phone-inbound-event-store.js';
import {phoneInboundWorkflowRoutes} from '../src/routes/phone-inbound-workflow.js';
const enabled=process.env.THAARA_PHONE113_RUNTIME_APPROVED==='isolated-runtime-only';
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|COMSPEC|PATHEXT|DOCKER_CONFIG)$/i.test(k)));
const docker=(args:string[])=>execFileSync('docker',args,{env:safeEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,windowsHide:true}).trim();
// No files, Docker, pools or SQL touched when disabled. No provider modules or network listeners.
const proofPath=process.env.THAARA_PHONE113_RUNTIME_TRANSPORT==='owned-exec-loopback'?INBOUND_RELAY_CACHE_PATH+'/fixture.json':'node_modules/.cache/phone113-runtime/fixture.json';
const config=enabled?inboundRuntimeConfig(process.env,readFileSync(new URL('../../../'+proofPath,import.meta.url)),(proof:any)=>{
 if(proof.transport==='owned-exec-loopback')inspectInboundUnpublishedFixture((args:string[])=>docker(['--host',proof.dockerEndpoint,...args]),proof);else inspectInboundRuntimeFixture(docker,proof);return true;
}):null;
const {Pool}=createRequire(new URL('../../../packages/db/package.json',import.meta.url))('pg');
describe.skipIf(!config)('inbound PostgreSQL — nine separately approved synthetic acceptance cases',()=>{
 let adminPool:any,poolA:any,poolB:any,appPool:any,admin:PostgresDatabase,appDb:PostgresDatabase,owner:AuthenticatedScope,foreign:AuthenticatedScope,peer:AuthenticatedScope;
 let service:ReturnType<typeof createSarvamInboundService>,second:ReturnType<typeof createSarvamInboundService>,profile:any,credential:string;
 const open=(url:string,max=2,name='phone113-fixture')=>new Pool({connectionString:url,max,application_name:name,connectionTimeoutMillis:5000,query_timeout:5000,statement_timeout:3000,idle_in_transaction_session_timeout:5000});
 const createService=(pool:any)=>createSarvamInboundService({profile,transactions:createInboundPrincipalTransactions({pool})});
 const auth=()=> 'Bearer '+credential;
 function payload(suffix:string,ended=false){return {app_id:profile.appId,app_version:5,deployment_id:profile.deploymentId,agent_phone_number:profile.agentPhoneNumber,user_phone_number:'+919000000001',interaction_id:'20261104/'+suffix,start_datetime:'2026-11-04T00:00:00Z',end_datetime:ended?'2026-11-04T00:01:00Z':null,duration:60,final_agent_variables:{customer_name:'Synthetic customer',business_type:'Retail',requested_service:'Automation'},interaction_transcript:[{role:'agent',en_text:'Would you like our team to contact you at +919000000001 and discuss a solution for your business?'},{role:'user',en_text:'Yes, please.'}]};}
 beforeAll(async()=>{
  adminPool=open(config!.admin,3);poolA=open(config!.ingest,1,'phone113-ingest-a');poolB=open(config!.ingest,1,'phone113-ingest-b');appPool=open(config!.app);
  admin=new PostgresDatabase(adminPool);appDb=new PostgresDatabase(appPool);
  const target=(await admin.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS version")).rows[0];expect(target.db).toBe('thaara_phone113_review');expect(target.version).toBeGreaterThanOrEqual(160000);expect(target.version).toBeLessThan(170000);
  async function identity(name:string,workspaceId?:string){const ws=workspaceId?{id:workspaceId}:await new WorkspaceRepository(admin).create(name),user=await new UserRepository(admin).create(name+'@example.test','unused',name),token=generateSessionToken();const scope={workspaceId:ws.id,userId:user.id,role:'owner',sessionTokenHash:hashSessionToken(token)};await admin.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(ws.id,user.id,'owner');await new SessionRepository(tx).create(user.id,ws.id,token);});return scope;}
  owner=await identity('phone113-owner');foreign=await identity('phone113-foreign');peer=await identity('phone113-peer',owner.workspaceId);credential=randomBytes(32).toString('hex');
  profile={routeId:'synthetic-route',workspaceId:owner.workspaceId,ownerUserId:owner.userId,principalId:randomUUID(),revision:1,appId:'synthetic-agent',appVersion:5,deploymentId:'synthetic-inbound',agentPhoneNumber:'+918000000001',maxCallLengthSeconds:300};
  const binding=buildInboundServiceBinding(profile);
  await admin.query(`INSERT INTO public.phone_inbound_principals(principal_id,workspace_id,owner_user_id,route_id,token_hash,profile_fingerprint,revision,operations,expires_at) VALUES($1,$2,$3,$4,$5,$6,1,ARRAY['callback','completion'],clock_timestamp()+interval '1 hour')`,[profile.principalId,owner.workspaceId,owner.userId,profile.routeId,createHash('sha256').update(credential).digest('hex'),binding.profileFingerprint]);
  service=createService(poolA);second=createService(poolB);
 },30000);
 afterAll(async()=>{for(const pool of [poolA,poolB,appPool,adminPool])if(pool)await pool.end();});
 it('saves authenticated raw callback/completion with a post-commit receipt',async()=>{
  const a=await service.requestCallback(profile.routeId,auth(),payload('basic'));expect(a.saved).toBe(true);expect(a.action).toBe('callback_requested');
  expect((await service.complete(profile.routeId,auth(),payload('basic',true))).reportId).toBe(a.reportId);expect(await new PhoneInboundEventRepository(appDb).read(owner,a.reportId)).not.toBeNull();
 });
 it('deduplicates truly concurrent connections and rejects conflicting digest without extra audit',async()=>{
  expect((await poolA.query('SELECT pg_backend_pid() AS id')).rows[0].id).not.toBe((await poolB.query('SELECT pg_backend_pid() AS id')).rows[0].id);
  const p=payload('parallel'),[a,b]=await Promise.all([service.requestCallback(profile.routeId,auth(),p),second.requestCallback(profile.routeId,auth(),p)]);expect(a.reportId).toBe(b.reportId);
  expect((await admin.query('SELECT count(*)::int AS n FROM public.audit_events WHERE target_id=$1',[a.reportId])).rows[0].n).toBe(1);
  await expect(service.requestCallback(profile.routeId,auth(),{...p,duration:61})).rejects.toThrow();
 });
 it('reconciles concurrent phases and preserves withdrawal against callback replay',async()=>{
  const p=payload('phases');await Promise.all([service.complete(profile.routeId,auth(),payload('phases',true)),second.requestCallback(profile.routeId,auth(),p)]);
  expect((await service.requestCallback(profile.routeId,auth(),{...p,interaction_transcript:[{role:'user',en_text:"Please don't call me."}]})).action).toBe('callback_withdrawn');
  expect((await second.requestCallback(profile.routeId,auth(),p)).callbackRequestId).toBeNull();
 });
 it('enforces owner/workspace RLS and denies direct service reads and escalation',async()=>{
  const r=await service.complete(profile.routeId,auth(),payload('rls',true)),repo=new PhoneInboundEventRepository(appDb);expect(await repo.read(owner,r.reportId)).not.toBeNull();expect(await repo.read(foreign,r.reportId)).toBeNull();expect(await repo.read(peer,r.reportId)).toBeNull();
  for(const sql of ['SELECT * FROM public.phone_inbound_call_events','SELECT * FROM public.phone_inbound_principals','SELECT * FROM public.sessions','SELECT * FROM public.audit_events','SET ROLE thaara_phone_guard'])await expect(poolA.query(sql)).rejects.toThrow();
 });
 it('serializes concurrent revocation and rejects expiry and owner demotion',async()=>{
  const lock=await adminPool.connect();let pending:Promise<unknown>|undefined;
  try{
   await lock.query('BEGIN');const pid=(await lock.query('SELECT pg_backend_pid() AS id')).rows[0].id;await lock.query('UPDATE public.phone_inbound_principals SET revoked_at=clock_timestamp() WHERE principal_id=$1',[profile.principalId]);
   pending=service.complete(profile.routeId,auth(),payload('revoked',true)).then(()=> 'unexpected_success',()=> 'denied');
   let blocked=false;const deadline=Date.now()+2000;while(Date.now()<deadline){const q=await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='phone113-ingest-a' AND $1::int=ANY(pg_blocking_pids(pid))) AS blocked",[pid]);if(q.rows[0].blocked){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}
   expect(blocked).toBe(true);await lock.query('COMMIT');expect(await pending).toBe('denied');
  }finally{await lock.query('ROLLBACK');lock.release();if(pending)await pending;await admin.query('UPDATE public.phone_inbound_principals SET revoked_at=NULL WHERE principal_id=$1',[profile.principalId]);}
  await admin.query("UPDATE public.phone_inbound_principals SET expires_at=created_at+interval '1 millisecond' WHERE principal_id=$1",[profile.principalId]);await expect(service.complete(profile.routeId,auth(),payload('expired',true))).rejects.toThrow();
  await admin.query("UPDATE public.phone_inbound_principals SET expires_at=clock_timestamp()+interval '1 hour' WHERE principal_id=$1",[profile.principalId]);
  await admin.query("UPDATE public.memberships SET role='member' WHERE workspace_id=$1 AND user_id=$2",[owner.workspaceId,owner.userId]);try{await expect(service.complete(profile.routeId,auth(),payload('demoted',true))).rejects.toThrow();}finally{await admin.query("UPDATE public.memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2",[owner.workspaceId,owner.userId]);}
 });
 it('rolls back report and returns no saved receipt if audit insertion fails',async()=>{
  const interaction=payload('audit-fail'),id=createHash('sha256').update(profile.routeId+'\n'+interaction.interaction_id).digest('hex');
  await admin.query(`CREATE FUNCTION public.phone113_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='phone.inbound.event_saved' AND NEW.target_id='${id}' THEN RAISE EXCEPTION 'synthetic audit rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER phone113_test_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.phone113_test_audit_fail();`);
  await expect(service.complete(profile.routeId,auth(),interaction)).rejects.toThrow();expect((await admin.query('SELECT count(*)::int AS n FROM public.phone_inbound_call_events WHERE call_id=$1',[id])).rows[0].n).toBe(0);
 });
 it('keeps missing/interrupted outcomes truthful and rejects malformed bindings without retaining media',async()=>{
  const p={...payload('missing'),user_phone_number:null,interaction_transcript:[],final_agent_variables:{}};const r=await service.complete(profile.routeId,auth(),p),stored=await new PhoneInboundEventRepository(appDb).read(owner,r.reportId);expect(stored?.callerPhone).toBeNull();expect(stored?.callStatus).toBe('unknown');expect(stored?.appointment).toBeNull();expect(stored?.recordingReference).toBeNull();expect(stored?.transcript).toBeUndefined();
  await expect(service.complete(profile.routeId,auth(),{...payload('forged'),app_version:6})).rejects.toThrow();await expect(service.requestCallback(profile.routeId,auth(),{...payload('unconfirmed'),interaction_transcript:[]})).rejects.toThrow();
 });
 it('persists across pool reconnect and deduplicates replay (not database process restart)',async()=>{
  const p=payload('reconnect',true),r=await service.complete(profile.routeId,auth(),p);await poolA.end();poolA=open(config!.ingest,1,'phone113-ingest-a');service=createService(poolA);expect((await service.complete(profile.routeId,auth(),p)).reportId).toBe(r.reportId);
  expect((await admin.query('SELECT count(*)::int AS n FROM public.audit_events WHERE target_id=$1',[r.reportId])).rows[0].n).toBe(1);
 });
 it('rejects excess route traffic before parsing without creating another record',async()=>{
  const http=Fastify({logger:false});await http.register(async child=>phoneInboundWorkflowRoutes(child,service,{maxRequests:1}),{prefix:'/api/v1'});
  try{const url='/api/v1/connectors/phone/inbound/callback/'+profile.routeId;const a=await http.inject({method:'POST',url,headers:{authorization:auth()},payload:payload('ingress')});expect(a.statusCode).toBe(200);const before=(await admin.query('SELECT count(*)::int AS n FROM public.phone_inbound_call_events')).rows[0].n;
   expect((await http.inject({method:'POST',url,headers:{'content-type':'application/json'},payload:'{bad'})).statusCode).toBe(429);expect((await admin.query('SELECT count(*)::int AS n FROM public.phone_inbound_call_events')).rows[0].n).toBe(before);
  }finally{await http.close();}
 });
});
