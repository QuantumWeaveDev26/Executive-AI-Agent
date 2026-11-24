import {it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import {createHash} from 'node:crypto';
import {createInboundAppointments,buildAppointmentBinding} from '../src/services/phone-inbound-appointments.js';
import {createInboundPrincipalTransactions} from '../src/services/phone-inbound-principal-postgres.js';
import {phoneInboundAppointmentRoutes} from '../src/routes/phone-inbound-appointments.js';

// Query-function mocks ONLY: no PostgreSQL/PGlite client, database, SQL engine, Docker or credentials.
const token='synthetic-case5-token-0000000000000000000000',time=Date.parse('2026-11-04T12:00:00Z');
const profile={routeId:'case5',workspaceId:'workspace-a',ownerUserId:'owner-a',principalId:'principal-a',revision:1,appId:'synthetic',appVersion:5,deploymentId:'inbound',agentPhoneNumber:'+918000000001',maxCallLengthSeconds:300 as const};
const interactionId='20261104/case5';
async function fixture(state:'active'|'revoked'|'expired'='active'){
 const calls:string[]=[],release=vi.fn(),ownerSession=vi.fn(async()=>null);
 const query=vi.fn(async(sql:string,args?:any[])=>{
  calls.push(sql);
  if(sql.includes('phone_inbound_role_preflight'))return {rows:[{role_name:'thaara_phone_ingest',session_role_name:'thaara_phone_ingest',schema_create:false,rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,rolinherit:false,elevated_membership:false,owns_protected:false,journal_rls:true,journal_force_rls:true,direct_journal_access:false,direct_protected_access:false}]};
  if(sql.includes('phone_inbound_resolve_grant')){
   // Model unchanged113h resolver: absent/wrong/revoked/expired identities raise42501.
   if(state!=='active'||args?.[0]!==createHash('sha256').update(token).digest('hex'))throw Object.assign(Error('PRIVATE fixture resolver detail'),{code:'42501'});
   return {rows:[{grant_record:{...buildAppointmentBinding(profile,interactionId),tokenHash:args[0],activeOwner:true,revokedAt:null,expiresAt:'2026-11-05T00:00:00Z',operations:['callback']}}]};
  }
  if(sql.includes('phone_inbound_append_event')){const e=JSON.parse(args![0]);return {rows:[{receipt:{saved:true,duplicate:false,events:[{...e,sequence:1}]}}]};}
  return {rows:[]};
 });
 const connect=vi.fn(async()=>({query,release}));
 const transactions=createInboundPrincipalTransactions({pool:{connect},now:()=>time});
 const never=vi.fn(async()=>{throw Error('Unexpected Calendar access');});
 const service=createInboundAppointments({profile,interactionId,transactions,now:()=>time,resolveProposalOwnerSession:ownerSession,db:{} as any,calendar:{writeReadiness:never,findConflicts:never,listEvents:never,readEvent:never}});
 const body={payload:{app_id:'synthetic',app_version:5,deployment_id:'inbound',interaction_id:interactionId,agent_phone_number:profile.agentPhoneNumber,user_phone_number:'+919000000001',start_datetime:'2026-11-04T00:00:00Z',duration:20,
  final_agent_variables:{customer_name:'Synthetic customer',callback_preference:'yes'},interaction_transcript:[{role:'agent',en_text:'Would you like our team to contact you at +919000000001 and discuss a solution for your business?'},{role:'user',en_text:'Yes, please.'}]},slot:{startAt:'2090-11-05T09:00:00Z',endAt:'2090-11-05T09:30:00Z',timeZone:'Asia/Kolkata'}};
 const app=Fastify({logger:false});await app.register(async child=>phoneInboundAppointmentRoutes(child,service),{prefix:'/api/v1'});
 const post=(value:unknown=body,authorization='Bearer '+token)=>app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/appointment-requests/case5',headers:{authorization},payload:value as any});
 return {app,body,post,calls,connect,release,ownerSession,never};
}
it('wrong short credentials return403 before acquiring a database connection',async()=>{
 const f=await fixture();try{const r=await f.post(f.body,'Bearer invalid');expect(r.statusCode).toBe(403);expect(r.json().saved).toBe(false);expect(f.connect).not.toHaveBeenCalled();}finally{await f.app.close();}
});
it('wrong well-formed credentials fail closed with sanitized503 after resolver refusal',async()=>{
 const f=await fixture();try{const r=await f.post(f.body,'Bearer '+'w'.repeat(43));expect(r.statusCode).toBe(503);expect(r.json().saved).toBe(false);expect(f.calls).toContain('ROLLBACK');expect(f.calls.some(q=>q.includes('phone_inbound_append_event'))).toBe(false);expect(r.body).not.toContain('PRIVATE');}finally{await f.app.close();}
});
it('the original case5 call-identity assertion expects403 after a successful rollback',async()=>{
 const f=await fixture();try{const r=await f.post({...f.body,payload:{...f.body.payload,interaction_id:'20261104/another-call'}});
  expect(r.statusCode).toBe(403);expect(r.json().saved).toBe(false);expect(f.calls).toContain('ROLLBACK');expect(f.calls).not.toContain('COMMIT');expect(f.calls.some(q=>q.includes('phone_inbound_append_event'))).toBe(false);expect(f.ownerSession).not.toHaveBeenCalled();expect(f.never).not.toHaveBeenCalled();
 }finally{await f.app.close();}
});
for(const state of ['revoked','expired'] as const)it(state+' identity fails closed before journal work and never reaches Calendar',async()=>{
 const f=await fixture(state);try{const r=await f.post();expect(r.statusCode).toBe(503);expect(r.json().saved).toBe(false);expect(f.calls).toContain('ROLLBACK');expect(f.calls.some(q=>q.includes('phone_inbound_append_event'))).toBe(false);expect(f.ownerSession).not.toHaveBeenCalled();expect(f.release).toHaveBeenCalledOnce();expect(r.body).not.toContain('PRIVATE');}finally{await f.app.close();}
});
it('control fixture reaches journal commit only for the correct active call identity',async()=>{
 const f=await fixture();try{const r=await f.post();expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({saved:true,status:'request_saved',appointmentConfirmed:false});expect(f.calls).toContain('COMMIT');expect(f.calls.some(q=>q.includes('phone_inbound_append_event'))).toBe(true);expect(f.never).not.toHaveBeenCalled();}finally{await f.app.close();}
});
