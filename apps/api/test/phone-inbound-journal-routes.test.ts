import {expect,it,vi} from 'vitest';
import Fastify from 'fastify';
import {createInboundJournalReportFeed} from '../src/services/phone-inbound-journal-feed.js';
import {phoneInboundReportRoutes} from '../src/routes/phone-inbound-reports.js';
import {makeInboundReport} from '../src/services/phone-inbound-reports.js';
const scope={workspaceId:'w',userId:'u',role:'owner',sessionTokenHash:'synthetic-session'},id='a'.repeat(64),url='/api/v1/connectors/phone/inbound/reports';
async function fixture(){
 const app=Fastify({logger:false});app.decorate('requireAuth',async(request:any,reply:any)=>{if(!request.headers['x-test-role'])return reply.code(401).send({error:'Unauthorized'});request.scope={...scope,role:request.headers['x-test-role']};});
 const row={...makeInboundReport({id,occurredAt:'2026-11-04T00:00:00Z',callerPhone:'+919000000001',customerName:'Private customer',business:'Retail',serviceNeeded:'Automation',enquirySummary:'Asked about services',callbackInterest:'no'}, {...scope,direction:'inbound',authenticatedRoute:true}),providerInteractionId:'20261104/synthetic',appointment:null};
 const repository={list:vi.fn(async()=>[row]),read:vi.fn(async()=>row)},feed=createInboundJournalReportFeed({repository});
 await app.register(async child=>phoneInboundReportRoutes(child,undefined,feed),{prefix:'/api/v1'});return {app,repository};
}
it('reuses existing owner GET contracts with private summaries and no live startup change',async()=>{
 const f=await fixture();try{
  expect((await f.app.inject(url)).statusCode).toBe(401);expect((await f.app.inject({url,headers:{'x-test-role':'member'}})).statusCode).toBe(403);expect(f.repository.list).not.toHaveBeenCalled();
  const r=await f.app.inject({url,headers:{'x-test-role':'owner'}});expect(r.statusCode).toBe(200);expect(r.json().status).toBe('ready');expect(r.json().reports).toHaveLength(1);expect(r.body).not.toContain('Private customer');expect(r.body).not.toContain('+919000000001');expect(r.body).not.toContain('synthetic-session');expect(r.headers['cache-control']).toBe('no-store');
 }finally{await f.app.close();}
});
it('loads detail directly and sanitizes storage failures instead of claiming success/not-found',async()=>{
 const f=await fixture();try{
  f.repository.list.mockResolvedValue([]);const r=await f.app.inject({url:url+'/'+id,headers:{'x-test-role':'owner'}});expect(r.statusCode).toBe(200);expect(r.json().report.customerName).toBe('Private customer');expect(r.body).not.toContain('ownerUserId');expect(f.repository.list).not.toHaveBeenCalled();
  f.repository.read.mockRejectedValueOnce(Error('PRIVATE DATABASE SECRET'));const failed=await f.app.inject({url:url+'/'+id,headers:{'x-test-role':'owner'}});expect(failed.statusCode).toBe(503);expect(failed.body).not.toContain('PRIVATE');expect(failed.headers['cache-control']).toBe('no-store');
 }finally{await f.app.close();}
});
