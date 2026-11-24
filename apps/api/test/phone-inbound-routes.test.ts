import Fastify from 'fastify';
import {it,expect} from 'vitest';
import {phoneInboundReportRoutes} from '../src/routes/phone-inbound-reports.js';
import {makeInboundReport} from '../src/services/phone-inbound-reports.js';
async function setup(configured=false){
 const app=Fastify();
 app.decorate('requireAuth',async(request:any,reply:any)=>{
  if(!request.headers['x-test-role'])return reply.code(401).send({error:'Unauthorized'});
  request.scope={workspaceId:'w',userId:'u',role:request.headers['x-test-role']};
 });
 const row=makeInboundReport({id:'call-a',occurredAt:'2026-11-03T12:00:00Z',callerPhone:'+919000000001',customerName:'Ram',business:'Retail',serviceNeeded:'Automation',enquirySummary:'Asked about services',callbackInterest:'no'},
  {workspaceId:'w',userId:'u',role:'owner',authenticatedRoute:true,direction:'inbound'});
 await app.register(async v1=>phoneInboundReportRoutes(v1,configured?async()=>[row]:undefined),{prefix:'/api/v1'});
 return app;
}
it('requires a session and owner before exposing report configuration or PII',async()=>{
 const app=await setup(true);try{
  expect((await app.inject('/api/v1/connectors/phone/inbound/reports')).statusCode).toBe(401);
  expect((await app.inject({url:'/api/v1/connectors/phone/inbound/reports',headers:{'x-test-role':'member'}})).statusCode).toBe(403);
 }finally{await app.close();}
});
it('returns explicit not-configured state with private caching disabled',async()=>{
 const app=await setup();try{
  const response=await app.inject({url:'/api/v1/connectors/phone/inbound/reports',headers:{'x-test-role':'owner'}});
  expect(response.json()).toEqual({status:'not_configured',reports:[]});expect(response.headers['cache-control']).toBe('no-store');
 }finally{await app.close();}
});
it('masks lists, returns owner details and exposes no public import or booking action',async()=>{
 const app=await setup(true);try{
  const headers={'x-test-role':'owner'},base='/api/v1/connectors/phone/inbound/reports';
  expect((await app.inject({url:base,headers})).body).not.toContain('+919000000001');
  expect((await app.inject({url:base+'/call-a',headers})).json().report.callerPhone).toBe('+919000000001');
  expect((await app.inject({url:base,method:'POST',headers,payload:{}})).statusCode).toBe(404);
 }finally{await app.close();}
});
