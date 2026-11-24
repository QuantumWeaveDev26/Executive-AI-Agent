import {it,expect,vi} from 'vitest';
import {createInboundCallWorkflow} from '../src/services/phone-inbound-workflow.js';
import {projectInboundEvents,type InboundCallEvent,type InboundEventInput} from '../src/services/phone-inbound-events.js';
const token='synthetic-callback-token-00000000000000000';
const profile={routeId:'route-a',workspaceId:'w',userId:'u',role:'owner' as const,sessionTokenHash:'synthetic',appId:'agent-a',appVersion:5,deploymentId:'deployment-a',agentPhoneNumber:'+918000000001',intakeApproved:true as const};
const body=()=>({app_id:'agent-a',app_version:5,deployment_id:'deployment-a',interaction_id:'20261103/synthetic',user_phone_number:'+919000000001',agent_phone_number:profile.agentPhoneNumber,duration:20,start_datetime:'2026-11-03T12:00:00Z',end_datetime:null,
 final_agent_variables:{customer_name:'Ram',business_type:'Retail',requested_service:'Automation',callback_preference:'yes'},
 interaction_transcript:[{role:'agent',en_text:'Would you like our team to contact you at +919000000001 and discuss a solution for your business?'},{role:'user',en_text:'Yes, please.'}]});
function fixture(failSave=false){
 const events:InboundCallEvent[]=[];
 const append=vi.fn(async(_scope:any,e:InboundEventInput)=>{
  if(failSave)throw Error('synthetic save failure');
  const existing=events.find(x=>x.eventId===e.eventId);
  if(existing&&existing.sourceDigest!==e.sourceDigest)throw Error('conflicting replay');
  if(!existing)events.push(structuredClone({...e,sequence:events.length+1}));
  return {saved:true as const,event:structuredClone(existing??events[events.length-1]!),report:projectInboundEvents(profile,events),revision:events.length,duplicate:!!existing};
 });
 return {events,append,workflow:createInboundCallWorkflow({profile,resolveSecret:async()=>token,journal:{append},now:()=>Date.parse('2026-11-03T12:01:00Z')})};
}
it('confirms one callback only after commit, then merges the final call into one report',async()=>{
 const f=fixture(),callback=await f.workflow.requestCallback('route-a','Bearer '+token,body());
 expect(callback.saved).toBe(true);expect(callback.action).toBe('callback_requested');expect(callback.callbackRequestId).toBeTruthy();
 const completion=await f.workflow.complete('route-a','Bearer '+token,{...body(),end_datetime:'2026-11-03T12:02:00Z',duration:120,final_agent_variables:{enquiry_summary:'Asked about automation',callback_preference:'unknown'},interaction_transcript:[]});
 expect(completion.reportId).toBe(callback.reportId);expect(completion.outcome).toBe('callback_requested');expect(f.events).toHaveLength(2);
 expect(projectInboundEvents(profile,f.events).callStatus).toBe('ended');
});
it('reuses callback receipt on duplicate and rejects conflicting repeat',async()=>{
 const f=fixture(),a=await f.workflow.requestCallback('route-a','Bearer '+token,body()),b=await f.workflow.requestCallback('route-a','Bearer '+token,body());
 expect(b.callbackRequestId).toBe(a.callbackRequestId);expect(f.events).toHaveLength(1);
 await expect(f.workflow.requestCallback('route-a','Bearer '+token,{...body(),duration:21})).rejects.toThrow();
});
it('does not confirm failed save, unauthenticated request, or missing consent',async()=>{
 const failed=fixture(true);await expect(failed.workflow.requestCallback('route-a','Bearer '+token,body())).rejects.toThrow();expect(failed.events).toHaveLength(0);
 const f=fixture();await expect(f.workflow.requestCallback('route-a','Bearer wrong',body())).rejects.toThrow();
 await expect(f.workflow.requestCallback('route-a','Bearer '+token,{...body(),interaction_transcript:[]})).rejects.toThrow();expect(f.events).toHaveLength(0);
});
it('withdraws a saved request and does not revive it when its original request is replayed',async()=>{
 const f=fixture();await f.workflow.requestCallback('route-a','Bearer '+token,body());
 const b=body();b.interaction_transcript.push({role:'agent',en_text:'Anything else?'},{role:'user',en_text:"Please don't call me."});
 const withdrawal=await f.workflow.requestCallback('route-a','Bearer '+token,b);expect(withdrawal.action).toBe('callback_withdrawn');
 const replay=await f.workflow.requestCallback('route-a','Bearer '+token,body());expect(replay.action).toBe('callback_withdrawn');expect(replay.callbackRequestId).toBeNull();
});
it('handles completion before callback delivery without inventing another call',async()=>{
 const f=fixture();await f.workflow.complete('route-a','Bearer '+token,{...body(),end_datetime:'2026-11-03T12:02:00Z',interaction_transcript:[],final_agent_variables:{callback_preference:'unknown'}});
 const r=await f.workflow.requestCallback('route-a','Bearer '+token,body());expect(r.action).toBe('callback_requested');expect(new Set(f.events.map(e=>e.callId)).size).toBe(1);
});
it('rejects an unbound committed receipt without confirming a callback',async()=>{
 const f=fixture();
 const workflow=createInboundCallWorkflow({profile,resolveSecret:async()=>token,journal:{append:async(scope,event)=>{
  const receipt=await f.append(scope,event);return {...receipt,event:{...receipt.event,sourceDigest:'f'.repeat(64)}};
 }}});
 await expect(workflow.requestCallback('route-a','Bearer '+token,body())).rejects.toThrow();
});
it('keeps concurrent request receipts isolated even when commits finish out of order',async()=>{
 const events=new Map<string,InboundCallEvent>();
 const workflow=createInboundCallWorkflow({profile,resolveSecret:async()=>token,journal:{append:async(scope,event)=>{
  const stored={...event,sequence:1};events.set(event.callId,stored);
  await new Promise(resolve=>setTimeout(resolve,event.report.customerName==='Ram'?20:0));
  return {saved:true,event:stored,report:projectInboundEvents(scope,[stored]),revision:1,duplicate:false};
 }}});
 const other={...body(),interaction_id:'20261103/second',final_agent_variables:{...body().final_agent_variables,customer_name:'Sita'}};
 const [a,b]=await Promise.all([workflow.requestCallback('route-a','Bearer '+token,body()),workflow.requestCallback('route-a','Bearer '+token,other)]);
 expect(a.reportId).not.toBe(b.reportId);expect(events.get(a.reportId)?.report.customerName).toBe('Ram');expect(events.get(b.reportId)?.report.customerName).toBe('Sita');
});
