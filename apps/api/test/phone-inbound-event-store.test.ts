import {it,expect,vi} from 'vitest';
import {PhoneInboundEventRepository} from '../src/services/phone-inbound-event-store.js';
import {makeInboundReport} from '../src/services/phone-inbound-reports.js';
import type {InboundEventInput,InboundCallEvent} from '../src/services/phone-inbound-events.js';
const scope={workspaceId:'w',userId:'u',role:'owner',sessionTokenHash:'synthetic-session'},id='a'.repeat(64);
function event(kind:InboundEventInput['kind']='callback_requested'):InboundEventInput{
 const report={...makeInboundReport({id,occurredAt:'2026-11-03T12:00:00Z',callerPhone:'+919000000001',customerName:'Ram',business:'Retail',serviceNeeded:'Automation',enquirySummary:'Asked about services',callbackInterest:'unknown'},
  {...scope,direction:'inbound',authenticatedRoute:true}),providerInteractionId:'20261103/synthetic',outcome:kind==='callback_requested'?'callback_requested' as const:'enquired' as const,
  callbackConsent:kind==='callback_requested'?'confirmed' as const:kind==='callback_withdrawn'?'declined' as const:'unknown' as const,callbackRequestId:kind==='callback_requested'?'callback-'+id:null};
 return {eventId:kind+'-'+id,callId:id,kind,sourceDigest:'0'.repeat(64),report};
}
function fixture({auditFailure=false,initial=[] as InboundCallEvent[],activeRole='owner'}={}){
 let stored=structuredClone(initial),rolledBack=false;
 const query=vi.fn(async(sql:string,p:any[]=[])=>{
  if(sql.includes('resolve_session_scope'))return {rows:[{workspace_id:'w',user_id:'u',role:activeRole}]};
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(sql.includes('INSERT INTO public.phone_inbound_call_events')){
   const e={eventId:p[3],callId:p[2],kind:p[4],sourceDigest:p[5],sequence:p[6],report:JSON.parse(p[7])};stored.push(e);return {rows:[{event:e}]};
  }
  if(sql.includes('FROM public.phone_inbound_call_events'))return {rows:stored.map(e=>({event:e}))};
  if(sql.includes('INSERT INTO audit_events')){if(auditFailure)throw Error('synthetic audit failure');return {rows:[{id:'audit-a'}]};}
  throw Error('Unexpected test query');
 });
 const db={withScopedTransaction:vi.fn(async(_s:any,fn:any)=>{const before=structuredClone(stored);try{return await fn({query});}catch(e){stored=before;rolledBack=true;throw e;}})};
 return {repo:new PhoneInboundEventRepository(db as never),query,db,state:()=>({stored,rolledBack})};
}
it('persists callback then completion as two events and one projected call',async()=>{
 const f=fixture(),first=await f.repo.append(scope,event());const final=await f.repo.append(scope,event('call_completed'));
 expect(first.revision).toBe(1);expect(final.revision).toBe(2);expect(final.report.outcome).toBe('callback_requested');expect(final.report.id).toBe(first.report.id);expect(f.state().stored.length).toBe(2);
});
it('deduplicates identical event and rejects conflicting payload fingerprint',async()=>{
 const f=fixture();await f.repo.append(scope,event());expect((await f.repo.append(scope,event())).duplicate).toBe(true);expect(f.state().stored.length).toBe(1);
 await expect(f.repo.append(scope,{...event(),sourceDigest:'1'.repeat(64)})).rejects.toThrow();expect(f.state().stored.length).toBe(1);
});
it('rolls back new event if audit insertion fails, returning no saved receipt',async()=>{
 const f=fixture({auditFailure:true});await expect(f.repo.append(scope,event())).rejects.toThrow();expect(f.state()).toEqual({stored:[],rolledBack:true});
});
it('rechecks active owner session and scopes every event query',async()=>{
 const f=fixture({activeRole:'member'});await expect(f.repo.append(scope,event())).rejects.toThrow();expect(f.state().stored).toHaveLength(0);
 const safe=fixture();await safe.repo.read(scope,id);
 const q=safe.query.mock.calls.find(([sql])=>sql.includes('FROM public.phone_inbound_call_events'))!;expect(q[0]).toContain('workspace_id=$1 AND owner_user_id=$2');expect(q[1]?.slice(0,2)).toEqual(['w','u']);
});
it('rejects malformed event and cross-owner snapshots before a transaction',async()=>{
 const f=fixture();await expect(f.repo.append(scope,{...event(),report:{...event().report,ownerUserId:'other'}})).rejects.toThrow();expect(f.db.withScopedTransaction).not.toHaveBeenCalled();
});
it('filters expired raw media from owner reads without changing stored history',async()=>{
 const e={...event(),sequence:1};e.report={...e.report,transcript:[{speaker:'caller',text:'Expired private words',languageBasis:'provider_english'}],transcriptExpiresAt:'2000-01-01T00:00:00Z'};
 const f=fixture({initial:[e]});expect((await f.repo.read(scope,id))?.transcript).toBeUndefined();expect(f.state().stored[0]?.report.transcript?.length).toBe(1);
});
