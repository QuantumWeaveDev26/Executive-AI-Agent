import {describe,it,expect,vi} from 'vitest';
import {createSarvamInboundIntake} from '../src/services/phone-sarvam-inbound-intake.js';
const token='synthetic-inbound-token-000000000000000000';
const profile={routeId:'route-a',workspaceId:'workspace-a',userId:'owner-a',role:'owner' as const,sessionTokenHash:'test-session',appId:'synthetic-agent',appVersion:5,deploymentId:'synthetic-inbound',agentPhoneNumber:'+918000000001',intakeApproved:true as const};
const body=()=>({app_id:profile.appId,app_version:5,deployment_id:profile.deploymentId,interaction_id:'20261103/synthetic-call',user_phone_number:'+919000000001',agent_phone_number:profile.agentPhoneNumber,duration:42,start_datetime:'2026-11-03T12:00:00Z',end_datetime:'2026-11-03T12:00:42Z',final_agent_variables:{customer_name:'Ram',business_type:'Retail',requested_service:'Automation',enquiry_summary:'Asked about automation',callback_preference:'yes',preferred_contact_time:'Tomorrow afternoon'},interaction_transcript:[{role:'agent',en_text:'Would you like our team to contact you at +919000000001 and discuss a solution for your business?'},{role:'user',en_text:'Yes, please.'}]});
function fixture(extra:Record<string,unknown>={}){
 const rows=new Map<string,any>(),digests=new Map<string,string>();
 const save=vi.fn(async(_scope:any,eventId:string,r:any,sourceDigest:string)=>{
  const old=rows.get(eventId);if(old){if(digests.get(eventId)!==sourceDigest)throw Error('conflicting replay');return structuredClone(old);}
  digests.set(eventId,sourceDigest);rows.set(eventId,structuredClone(r));return structuredClone(r);
 });
 const intake=createSarvamInboundIntake({profile,resolveSecret:async()=>token,store:{saveNormalized:save},now:()=>Date.parse('2026-11-03T12:01:00Z'),...extra} as any);
 return {intake,save,rows};
}
describe('Sarvam inbound local authenticated intake — no provider calls',()=>{
 it('rejects wrong credential, route, deployment, version and number without saving',async()=>{
  const f=fixture();
  for(const [route,auth,b] of [['other','Bearer '+token,body()],['route-a','Bearer wrong',body()],['route-a','Bearer '+token,{...body(),app_version:6}],['route-a','Bearer '+token,{...body(),deployment_id:'other'}],['route-a','Bearer '+token,{...body(),agent_phone_number:'+918000000002'}]] as const){await expect(f.intake.ingest(route,auth,b)).rejects.toThrow();}
  expect(f.save).not.toHaveBeenCalled();
 });
 it('saves one callback request only after explicit recap consent and successful commit',async()=>{
  const f=fixture(),r=await f.intake.ingest('route-a','Bearer '+token,body());
  expect(r.outcome).toBe('callback_requested');expect(r.callbackRequestId).toBeTruthy();expect(r.preferredContactTime).toBe('Tomorrow afternoon');expect(r.appointment).toBeNull();expect(r.providerVerified).toBe(false);
 });
 it('does not accept model consent booleans, booking IDs or caller-selected scope',async()=>{
  const f=fixture(),b={...body(),workspaceId:'other',interaction_transcript:[],final_agent_variables:{callback_preference:'yes',consent:true,calendar_event_id:'forged'}};
  const r=await f.intake.ingest('route-a','Bearer '+token,b);expect(r.outcome).toBe('needs_review');expect(r.workspaceId).toBe(profile.workspaceId);expect(r.appointment).toBeNull();
 });
 it('handles enquiry-only, missing phone numbers and interrupted/missing-end calls honestly',async()=>{
  const f=fixture();
  const enquiry={...body(),final_agent_variables:{enquiry_summary:'Asked about services',callback_preference:'no'},interaction_transcript:[]};
  expect((await f.intake.ingest('route-a','Bearer '+token,enquiry)).outcome).toBe('enquired');
  const missing={...body(),interaction_id:'20261103/missing',user_phone_number:null,end_datetime:null};
  const r=await f.intake.ingest('route-a','Bearer '+token,missing);expect(r.callerPhone).toBeNull();expect(r.outcome).toBe('needs_review');expect(r.callStatus).toBe('unknown');
 });
 it('does not confirm on save failure and deduplicates/conflict-checks deliveries',async()=>{
  const f=fixture();await f.intake.ingest('route-a','Bearer '+token,body());await f.intake.ingest('route-a','Bearer '+token,body());expect(f.rows.size).toBe(1);
  await expect(f.intake.ingest('route-a','Bearer '+token,{...body(),duration:43})).rejects.toThrow();
  const failed=fixture({store:{saveNormalized:async()=>{throw Error('synthetic failure');}}});await expect(failed.intake.ingest('route-a','Bearer '+token,body())).rejects.toThrow();
 });
 it('never calls an appointment booked when Calendar receipt lookup fails',async()=>{
  const f=fixture({lookupVerifiedAppointment:async()=>{throw Error('synthetic Calendar failure');}});
  const r=await f.intake.ingest('route-a','Bearer '+token,body());expect(r.outcome).not.toBe('booked_appointment');expect(r.appointment).toBeNull();
 });
 it('accepts only a backend verified Calendar receipt bound to this call/customer',async()=>{
  const receipt={interactionId:body().interaction_id,workspaceId:profile.workspaceId,ownerUserId:profile.userId,callerPhone:body().user_phone_number,eventId:'verified-event',startsAt:'2026-11-04T10:00:00Z',endsAt:'2026-11-04T10:30:00Z',timezone:'Asia/Kolkata',verified:true};
  const f=fixture({lookupVerifiedAppointment:async()=>receipt});expect((await f.intake.ingest('route-a','Bearer '+token,body())).outcome).toBe('booked_appointment');
  const bad=fixture({lookupVerifiedAppointment:async()=>({...receipt,workspaceId:'other'})});await expect(bad.intake.ingest('route-a','Bearer '+token,body())).rejects.toThrow();
 });
 it('does not retain transcript/recording by default, fetch arbitrary URLs or invent missing facts',async()=>{
  const f=fixture();const b={...body(),recording_url:'https://attacker.invalid/audio',final_agent_variables:{callback_preference:'no'}};
  const r=await f.intake.ingest('route-a','Bearer '+token,b);expect(r.transcript).toBeUndefined();expect(r.recordingReference).toBeNull();expect(r.customerName).toBeNull();expect(r.serviceNeeded).toBeNull();
 });
 it('keeps original receipt time on duplicates with missing provider timestamps',async()=>{
  let time=Date.parse('2026-11-03T12:01:00Z');const f=fixture({now:()=>time}),b={...body(),start_datetime:null,end_datetime:null};
  const first=await f.intake.ingest('route-a','Bearer '+token,b);expect(first.timestampSource).toBe('received_at');time+=60000;
  expect(await f.intake.ingest('route-a','Bearer '+token,b)).toEqual(first);expect(f.rows.size).toBe(1);
 });
 it('retains media only with backend notice/availability checks and bounded expiry',async()=>{
  const f=fixture({retention:{days:7,callerNoticeVerified:async()=>true,recordingAvailable:async()=>true}});
  const r=await f.intake.ingest('route-a','Bearer '+token,body());expect(r.transcript?.length).toBe(2);expect(r.recordingReference?.noticeConfirmed).toBe(true);expect(r.recordingReference).not.toHaveProperty('url');
  const noNotice=fixture({retention:{days:7,callerNoticeVerified:async()=>false}});expect((await noNotice.intake.ingest('route-a','Bearer '+token,body())).transcript).toBeUndefined();
 });
 it('honors later callback withdrawal even after an earlier affirmative recap',async()=>{
  const f=fixture(),b=body();b.interaction_transcript.push({role:'agent',en_text:'Anything else?'},{role:'user',en_text:"Please don't call me."});
  const r=await f.intake.ingest('route-a','Bearer '+token,b);expect(r.outcome).not.toBe('callback_requested');expect(r.callbackRequestId).toBeNull();expect(r.callbackConsent).toBe('declined');
 });
 it('honors explicit withdrawal in the first caller turn',async()=>{
  const f=fixture(),b={...body(),interaction_transcript:[{role:'user',en_text:"Please don't call me."}]};
  const r=await f.intake.ingest('route-a','Bearer '+token,b);expect(r.callbackConsent).toBe('declined');expect(r.callbackRequestId).toBeNull();
 });
});
