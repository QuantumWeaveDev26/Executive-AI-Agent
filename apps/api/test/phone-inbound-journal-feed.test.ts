import {it,expect,vi} from 'vitest';
import {createInboundJournalReportFeed} from '../src/services/phone-inbound-journal-feed.js';
import {makeInboundReport} from '../src/services/phone-inbound-reports.js';
const scope={workspaceId:'w',userId:'u',role:'owner',sessionTokenHash:'synthetic-session'},id='a'.repeat(64);
function row(){return {...makeInboundReport({id,occurredAt:'2026-11-04T00:00:00Z',callerPhone:'+919000000001',customerName:'Synthetic customer',business:'Retail',serviceNeeded:'Automation',enquirySummary:'Asked about services',callbackInterest:'no'}, {...scope,direction:'inbound',authenticatedRoute:true}),providerInteractionId:'20261104/synthetic',appointment:null,recordingReference:null};}
function fixture(extra:Record<string,unknown>={}){const repository={list:vi.fn(async()=>[row()]),read:vi.fn(async()=>row())};return {repository,feed:createInboundJournalReportFeed({repository,...extra} as never)};}
it('shows a saved callback as booked only after the matching durable Calendar receipt is verified, without rewriting the journal',async()=>{
 const saved={...row(),outcome:'callback_requested' as const,callbackRequestId:'saved-request',callbackConsent:'confirmed' as const};
 const receipt={workspaceId:'w',ownerUserId:'u',interactionId:saved.providerInteractionId,callerPhone:saved.callerPhone!,eventId:'calendar-event',startsAt:'2090-11-06T09:00:00Z',endsAt:'2090-11-06T09:30:00Z',timezone:'Asia/Kolkata',verified:true as const};
 const verifyAppointment=vi.fn(async()=>receipt),f=fixture({verifyAppointment});f.repository.read.mockResolvedValue(saved as never);f.repository.list.mockResolvedValue([saved] as never);
 expect((await f.feed.detail(scope,id)).report).toMatchObject({outcome:'booked_appointment',appointment:{eventId:'calendar-event',verification:'verified'}});
 expect((await f.feed.list(scope)).reports[0]?.outcome).toBe('booked_appointment');expect(saved.outcome).toBe('callback_requested');expect(saved.appointment).toBeNull();
 verifyAppointment.mockResolvedValueOnce(null as never);expect((await f.feed.detail(scope,id)).report?.outcome).toBe('callback_requested');
 verifyAppointment.mockRejectedValueOnce(Error('PRIVATE calendar issue'));expect((await f.feed.detail(scope,id)).report?.outcome).toBe('callback_requested');
 verifyAppointment.mockResolvedValueOnce({...receipt,callerPhone:'+919000000002'});await expect(f.feed.detail(scope,id)).rejects.toMatchObject({statusCode:503});
});
it('passes the captured authenticated owner scope and exposes masked summaries only',async()=>{
 const f=fixture(),result=await f.feed.list(scope);expect(result.status).toBe('ready');expect(f.repository.list).toHaveBeenCalledWith(scope);
 expect(result.reports).toHaveLength(1);expect(JSON.stringify(result)).not.toContain('Synthetic customer');expect(JSON.stringify(result)).not.toContain('+919000000001');expect(JSON.stringify(result)).not.toContain('synthetic-session');
});
it('uses direct detail lookup instead of searching a bounded list and strips internal scope',async()=>{
 const f=fixture();f.repository.list.mockResolvedValue([]);const result=await f.feed.detail(scope,id);expect(result.status).toBe('ready');expect(result.report?.customerName).toBe('Synthetic customer');expect(f.repository.list).not.toHaveBeenCalled();expect(f.repository.read).toHaveBeenCalledWith(scope,id);expect(result.report).not.toHaveProperty('workspaceId');expect(result.report).not.toHaveProperty('ownerUserId');
});
it('rejects missing sessions and non-owners before touching storage',async()=>{
 const f=fixture();for(const changed of [{role:'member'},{role:'viewer'},{sessionTokenHash:''},{workspaceId:''}])await expect(f.feed.list({...scope,...changed})).rejects.toMatchObject({statusCode:403});expect(f.repository.list).not.toHaveBeenCalled();
 await expect(f.feed.detail(scope,'invalid')).rejects.toMatchObject({statusCode:403});expect(f.repository.read).not.toHaveBeenCalled();
});
it('fails closed for foreign records and mismatched detail IDs without leaking storage errors',async()=>{
 const f=fixture();f.repository.read.mockResolvedValue({...row(),ownerUserId:'other'});await expect(f.feed.detail(scope,id)).rejects.toThrow();
 f.repository.read.mockResolvedValue({...row(),id:'b'.repeat(64)});await expect(f.feed.detail(scope,id)).rejects.toMatchObject({statusCode:503});
 f.repository.read.mockRejectedValue(Error('PRIVATE DATABASE CREDENTIALS'));try{await f.feed.detail(scope,id);throw Error('Expected failure');}catch(e){expect((e as Error).message).not.toContain('PRIVATE');expect((e as any).statusCode).toBe(503);}
});
it('rejects unexpected persisted fields instead of exposing internal metadata in a direct feed response',async()=>{
 const f=fixture();f.repository.read.mockResolvedValue({...row(),sessionTokenHash:'PRIVATE INTERNAL VALUE'} as never);
 await expect(f.feed.detail(scope,id)).rejects.toMatchObject({statusCode:503});
});
it('rejects unexpected nested media metadata before exposing detail',async()=>{
 const f=fixture();for(const extra of [{recordingReference:{interactionId:'20261104/synthetic',expiresAt:'2099-01-01T00:00:00Z',noticeConfirmed:true,secret:'PRIVATE'}},{transcript:[{speaker:'caller',text:'Hello',languageBasis:'provider_original',secret:'PRIVATE'}],transcriptExpiresAt:'2099-01-01T00:00:00Z'}]){
  f.repository.read.mockResolvedValue({...row(),...extra} as never);await expect(f.feed.detail(scope,id)).rejects.toMatchObject({statusCode:503});
 }
});
it('keeps missing reports truthful and removes expired media references',async()=>{
 const f=fixture();f.repository.read.mockResolvedValue(null as never);expect(await f.feed.detail(scope,id)).toEqual({status:'not_found',report:null});
 f.repository.read.mockResolvedValue({...row(),transcript:[{speaker:'caller',text:'Private transcript',languageBasis:'provider_original'}],transcriptExpiresAt:'2000-01-01T00:00:00Z',recordingReference:{interactionId:'20261104/synthetic',noticeConfirmed:true,expiresAt:'2000-01-01T00:00:00Z'}} as never);
 const result=await f.feed.detail(scope,id);expect(result.report?.transcript).toBeUndefined();expect(result.report?.recordingReference).toBeNull();
});
it('does not expose an appointment as booked without an exact backend-owned Calendar receipt',async()=>{
 const appointment={eventId:'calendar-event',startsAt:'2026-11-05T10:00:00Z',endsAt:'2026-11-05T10:30:00Z',timezone:'Asia/Kolkata',verification:'verified' as const};
 const report={...row(),outcome:'booked_appointment' as const,appointment};const f=fixture();f.repository.read.mockResolvedValue(report);await expect(f.feed.detail(scope,id)).rejects.toMatchObject({statusCode:503});
 const receipt={interactionId:report.providerInteractionId,workspaceId:'w',ownerUserId:'u',callerPhone:report.callerPhone!,eventId:appointment.eventId,startsAt:appointment.startsAt,endsAt:appointment.endsAt,timezone:appointment.timezone,verified:true as const};
 const verifyAppointment=vi.fn(async()=>receipt),g=fixture({verifyAppointment});g.repository.read.mockResolvedValue(report);expect((await g.feed.detail(scope,id)).report?.outcome).toBe('booked_appointment');
 for(const changed of [{workspaceId:'foreign'},{eventId:'other'},{callerPhone:'+919000000002'},{verified:false}]){verifyAppointment.mockResolvedValueOnce({...receipt,...changed} as never);await expect(g.feed.detail(scope,id)).rejects.toMatchObject({statusCode:503});}
});
it('captures scope before asynchronous storage work and keeps production registration gated',async()=>{
 let finish!:(value:any)=>void;const repository={list:vi.fn(()=>new Promise<any[]>(r=>{finish=r;})),read:vi.fn()};
 const feed=createInboundJournalReportFeed({repository}),mutable={...scope},pending=feed.list(mutable);mutable.userId='other';finish([row()]);expect((await pending).reports).toHaveLength(1);expect(repository.list.mock.calls[0]?.[0].userId).toBe('u');
 const original=process.env.NODE_ENV;try{process.env.NODE_ENV='production';expect(()=>fixture()).toThrow('test-only');}finally{process.env.NODE_ENV=original;}
});
