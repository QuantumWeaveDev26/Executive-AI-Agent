import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createInboundPrincipalGate,type InboundPrincipalGrant} from '../src/services/phone-inbound-principal.js';
import {createInboundPrincipalJournal} from '../src/services/phone-inbound-principal-journal.js';
import {makeInboundReport} from '../src/services/phone-inbound-reports.js';
import type {InboundCallEvent,InboundEventInput} from '../src/services/phone-inbound-events.js';
const token='synthetic-service-journal-token-000000000000';
const profile={routeId:'route-a',workspaceId:'w',ownerUserId:'u',principalId:'p',revision:1,profileFingerprint:'a'.repeat(64)};
function input(kind:InboundEventInput['kind']='callback_requested'):InboundEventInput{
 const id='a'.repeat(64),report={...makeInboundReport({id,occurredAt:'2026-11-03T12:00:00Z',callerPhone:'+919000000001',customerName:'Ram',business:'Retail',serviceNeeded:'Automation',enquirySummary:'Asked about services',callbackInterest:'unknown'},
  {workspaceId:'w',userId:'u',role:'owner',direction:'inbound',authenticatedRoute:true}),providerInteractionId:'20261103/synthetic',outcome:kind==='callback_requested'?'callback_requested' as const:'enquired' as const,
  callbackConsent:kind==='callback_requested'?'confirmed' as const:kind==='callback_withdrawn'?'declined' as const:'unknown' as const,callbackRequestId:kind==='callback_requested'?'callback-'+id:null};
 return {callId:id,eventId:kind+'-'+id,kind,sourceDigest:createHash('sha256').update(kind).digest('hex'),report};
}
function fixture(options:{commitFails?:boolean;malformed?:boolean;mutate?:(events:InboundCallEvent[])=>void}={}){
 let events:InboundCallEvent[]=[],committed=false;
 const query=vi.fn(async<R=any>(_sql:string,params?:any[])=>{
  const e=JSON.parse(params![0]) as InboundEventInput,old=events.find(x=>x.eventId===e.eventId);
  if(old&&old.sourceDigest!==e.sourceDigest)throw Error('conflict');
  if(!old)events.push({...e,sequence:events.length+1});
  const response=structuredClone(events);options.mutate?.(response);
  return {rows:[{receipt:options.malformed?{saved:false}:{saved:true,events:response,duplicate:!!old}}] as R[]};
 });
 const grant:InboundPrincipalGrant={...profile,tokenHash:createHash('sha256').update(token).digest('hex'),operations:['callback','completion'],activeOwner:true,revokedAt:null,expiresAt:'2026-11-04T00:00:00Z'};
 const gate=createInboundPrincipalGate({profile,now:()=>Date.parse('2026-11-03T12:00:00Z'),transactions:{withGrant:async(_r,fn)=>{
  const before=structuredClone(events);try{const result=await fn(grant,{query});if(options.commitFails)throw Error('commit failed');committed=true;return result;}catch(e){events=before;throw e;}
 }}});
 return {journal:createInboundPrincipalJournal(gate),query,state:()=>({events,committed})};
}
it('returns a callback saved receipt only after the enclosing transaction commits',async()=>{
 const f=fixture(),r=await f.journal.append('route-a','Bearer '+token,'callback',input());
 expect(r.saved).toBe(true);expect(f.state().committed).toBe(true);expect(r.report.outcome).toBe('callback_requested');expect(f.query.mock.calls[0]?.[0]).toContain('public.phone_inbound_append_event');
});
it('uses the shared reducer to merge completion and preserve withdrawal over old replay',async()=>{
 const f=fixture();await f.journal.append('route-a','Bearer '+token,'callback',input());await f.journal.append('route-a','Bearer '+token,'completion',input('call_completed'));
 await f.journal.append('route-a','Bearer '+token,'callback',input('callback_withdrawn'));
 const replay=await f.journal.append('route-a','Bearer '+token,'callback',input());expect(replay.duplicate).toBe(true);expect(replay.report.callbackConsent).toBe('declined');expect(replay.report.callbackRequestId).toBeNull();expect(f.state().events).toHaveLength(3);
});
it('rejects foreign ownership, incorrect phase, unsupported booking and retained media before SQL',async()=>{
 for(const e of [{...input(),report:{...input().report,ownerUserId:'other'}},input('call_completed'),{...input(),report:{...input().report,outcome:'booked_appointment' as const}},{...input(),report:{...input().report,transcript:[]}}]){
  const f=fixture();await expect(f.journal.append('route-a','Bearer '+token,'callback',e)).rejects.toThrow();expect(f.query).not.toHaveBeenCalled();
 }
});
it('does not save without service authentication or return success after a failed commit',async()=>{
 const f=fixture();await expect(f.journal.append('route-a','Bearer wrong','callback',input())).rejects.toThrow();expect(f.query).not.toHaveBeenCalled();
 const failed=fixture({commitFails:true});await expect(failed.journal.append('route-a','Bearer '+token,'callback',input())).rejects.toThrow();expect(failed.state().events).toHaveLength(0);
});
it('rejects malformed or cross-call database receipts and rolls back staged work',async()=>{
 for(const options of [{malformed:true},{mutate:(events:InboundCallEvent[])=>{events[0]!.callId='b'.repeat(64);}}]){
  const f=fixture(options);await expect(f.journal.append('route-a','Bearer '+token,'callback',input())).rejects.toThrow();expect(f.state().events).toHaveLength(0);
 }
});
it('rejects a changed source digest and never reports a different event as saved',async()=>{
 const f=fixture({mutate:events=>{events[0]!.sourceDigest='b'.repeat(64);}});await expect(f.journal.append('route-a','Bearer '+token,'callback',input())).rejects.toThrow();expect(f.state().events).toHaveLength(0);
});
