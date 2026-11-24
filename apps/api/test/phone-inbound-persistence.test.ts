import {it,expect,vi} from 'vitest';
import {PhoneInboundReportRepository} from '../src/services/phone-inbound-persistence.js';
const scope={workspaceId:'workspace-a',userId:'owner-a',role:'owner',sessionTokenHash:'synthetic-session'};
const input={id:'call-a',occurredAt:'2026-11-03T12:00:00Z',callerPhone:'+919000000001',customerName:'Ram',business:'Retail',serviceNeeded:'Automation',enquirySummary:'Asked about services',callbackInterest:'yes' as const};
function fixture({auditFailure=false,existing=null as any}={}){
 let committed=false,rolledBack=false,saved:any=null;
 const query=vi.fn(async(sql:string,p:any[]=[])=>{
  if(sql.includes('resolve_session_scope'))return {rows:[{workspace_id:scope.workspaceId,user_id:scope.userId,role:'owner'}]};
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(sql.includes('INSERT INTO public.phone_inbound_reports')){saved=p;return {rows:[{report:JSON.parse(p[6])}]};}
  if(sql.includes('INSERT INTO audit_events')){if(auditFailure)throw Error('synthetic audit failure');return {rows:[{id:'audit-a'}]};}
  if(sql.includes('FROM public.phone_inbound_reports'))return {rows:existing?[existing]:[]};
  throw Error('Unexpected test query');
 });
 const db={query,withScopedTransaction:vi.fn(async(_s:any,fn:any)=>{try{const r=await fn({query});committed=true;return r;}catch(e){rolledBack=true;saved=null;throw e;}})};
 return {repo:new PhoneInboundReportRepository(db as never),query,db,state:()=>({committed,rolledBack,saved})};
}
it('saves only review-needed callback interest and audits without customer data',async()=>{
 const f=fixture();const r=await f.repo.save(scope,'event-a',input);
 expect(r.outcome).toBe('needs_review');expect(r.callbackRequestId).toBeNull();expect(f.state().committed).toBe(true);
 const audit=f.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO audit_events'))!;
 expect(JSON.stringify(audit)).not.toContain(input.callerPhone);expect(JSON.stringify(audit)).not.toContain('Retail');
});
it('refuses non-owner or missing session before a database transaction',async()=>{
 const f=fixture();await expect(f.repo.save({...scope,role:'member'},'event-a',input)).rejects.toThrow();
 await expect(f.repo.save({...scope,sessionTokenHash:''},'event-a',input)).rejects.toThrow();expect(f.db.withScopedTransaction).not.toHaveBeenCalled();
});
it('rolls back saving if transactional audit fails',async()=>{
 const f=fixture({auditFailure:true});await expect(f.repo.save(scope,'event-a',input)).rejects.toThrow();expect(f.state()).toEqual({committed:false,rolledBack:true,saved:null});
});
it('uses explicit workspace/owner query parameters on reads',async()=>{
 const f=fixture();await f.repo.list(scope);
 const read=f.query.mock.calls.find(([sql])=>sql.includes('FROM public.phone_inbound_reports'))!;
 expect(read[0]).toContain('workspace_id=$1 AND owner_user_id=$2');expect(read[1]?.slice(0,2)).toEqual([scope.workspaceId,scope.userId]);
});
it('validates source fields and rejects a caller-supplied booked status',async()=>{
 const f=fixture();await expect(f.repo.save(scope,'bad event',input)).rejects.toThrow();
 const r=await f.repo.save(scope,'event-a',{...input,outcome:'callback_requested',callbackRequestId:'forged'} as never);
 expect(r.outcome).toBe('needs_review');
});
it('does not return expired raw transcript or recording references on repository reads',async()=>{
 const report={...input,workspaceId:scope.workspaceId,ownerUserId:scope.userId,maskedPhone:'•••• 0001',outcome:'needs_review',callbackRequestId:null,providerVerified:false,
  providerInteractionId:'20261103/test',transcript:[{speaker:'caller',text:'Expired customer words',languageBasis:'provider_english'}],transcriptExpiresAt:'2000-01-01T00:00:00Z',recordingReference:{interactionId:'20261103/test',expiresAt:'2000-01-01T00:00:00Z',noticeConfirmed:true}};
 const f=fixture({existing:{event_id:'event-a',report_hash:'0'.repeat(64),report}});
 const detail=await f.repo.read(scope,'call-a'),list=await f.repo.list(scope);
 expect(detail?.transcript).toBeUndefined();expect(detail?.recordingReference).toBeNull();expect(list[0]?.transcript).toBeUndefined();
});
