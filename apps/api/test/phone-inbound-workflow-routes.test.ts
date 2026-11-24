import {it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import {phoneInboundWorkflowRoutes} from '../src/routes/phone-inbound-workflow.js';
const reportId='a'.repeat(64);
async function fixture(failure=false){
 const app=Fastify({logger:false});
 const requestCallback=vi.fn(async()=>{if(failure)throw Error('PRIVATE SYNTHETIC DETAILS');return {saved:true as const,reportId,callbackRequestId:'callback-'+reportId,action:'callback_requested' as const,outcome:'callback_requested' as const};});
 const complete=vi.fn(async()=>({saved:true as const,reportId,outcome:'enquired' as const}));
 await app.register(async child=>phoneInboundWorkflowRoutes(child,{requestCallback,complete}),{prefix:'/api/v1'});
 return {app,requestCallback,complete};
}
it('returns only the saved receipt with private cache headers',async()=>{
 const f=await fixture();try{
  const r=await f.app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/callback/route-a',headers:{authorization:'Bearer synthetic'},payload:{synthetic:true}});
  expect(r.statusCode).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect(r.headers['referrer-policy']).toBe('no-referrer');
  expect(r.json()).toEqual({saved:true,reportId,callbackRequestId:'callback-'+reportId,action:'callback_requested',outcome:'callback_requested'});
  expect(f.requestCallback).toHaveBeenCalledWith('route-a','Bearer synthetic',{synthetic:true});
 }finally{await f.app.close();}
});
it('sanitizes a failed save and never returns saved true',async()=>{
 const f=await fixture(true);try{
  const r=await f.app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/callback/route-a',payload:{}});
  expect(r.statusCode).toBe(503);expect(r.json()).toEqual({saved:false,code:'PHONE_INBOUND_REQUEST_NOT_CONFIRMED'});expect(r.body).not.toContain('PRIVATE');
 }finally{await f.app.close();}
});
it('bounds request size before invoking the workflow',async()=>{
 const f=await fixture();try{
  const r=await f.app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/callback/route-a',payload:{data:'x'.repeat(65536)}});
  expect(r.statusCode).toBe(413);expect(f.requestCallback).not.toHaveBeenCalled();
 }finally{await f.app.close();}
});
it('keeps completion separate from callback confirmation',async()=>{
 const f=await fixture();try{
  const r=await f.app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/completion/route-a',payload:{}});
  expect(r.statusCode).toBe(200);expect(r.json()).toEqual({saved:true,reportId,outcome:'enquired'});expect(f.requestCallback).not.toHaveBeenCalled();
 }finally{await f.app.close();}
});

it('shares rate limits across phases and route IDs before parsing the request body',async()=>{
 let time=0;const app=Fastify({logger:false}),requestCallback=vi.fn(async()=>({saved:true as const,reportId,callbackRequestId:null,action:'needs_review' as const,outcome:'needs_review' as const})),complete=vi.fn(async()=>({saved:true as const,reportId,outcome:'enquired' as const}));
 await app.register(async child=>phoneInboundWorkflowRoutes(child,{requestCallback,complete},{maxRequests:2,windowMs:1000,now:()=>time}),{prefix:'/api/v1'});
 try{
  expect((await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/callback/route-a',payload:{}})).statusCode).toBe(200);
  expect((await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/completion/route-b',payload:{}})).statusCode).toBe(200);
  const limited=await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/completion/route-c',headers:{'content-type':'application/json'},payload:'{invalid'});
  expect(limited.statusCode).toBe(429);expect(limited.json()).toEqual({saved:false,code:'PHONE_INBOUND_RATE_LIMITED'});expect(limited.headers['cache-control']).toBe('no-store');expect(limited.headers['retry-after']).toBe('1');
  expect(complete).toHaveBeenCalledTimes(1);time=1000;expect((await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/completion/route-a',payload:{}})).statusCode).toBe(200);
 }finally{await app.close();}
});

it('limits concurrent work across callback/completion and releases only after settlement',async()=>{
 const app=Fastify({logger:false});let finish!:()=>void,started!:()=>void;
 const entered=new Promise<void>(r=>{started=r;}),pending=new Promise<void>(r=>{finish=r;});
 const requestCallback=vi.fn(async()=>{started();await pending;return {saved:true as const,reportId,callbackRequestId:null,action:'needs_review' as const,outcome:'needs_review' as const};}),complete=vi.fn(async()=>({saved:true as const,reportId,outcome:'enquired' as const}));
 await app.register(async child=>phoneInboundWorkflowRoutes(child,{requestCallback,complete},{maxInFlight:1}),{prefix:'/api/v1'});
 const first=app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/callback/route-a',payload:{}}).then(r=>r);
 try{
  await entered;const busy=await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/completion/route-b',payload:{}});
  expect(busy.statusCode).toBe(429);expect(busy.json()).toEqual({saved:false,code:'PHONE_INBOUND_BUSY'});expect(complete).not.toHaveBeenCalled();
  finish();expect((await first).statusCode).toBe(200);expect((await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/completion/route-b',payload:{}})).statusCode).toBe(200);
 }finally{finish();await first;await app.close();}
});

it('releases the concurrency lease after a failed save without retrying it',async()=>{
 const app=Fastify({logger:false}),requestCallback=vi.fn(async()=>{throw Error('PRIVATE');}),complete=vi.fn(async()=>({saved:true as const,reportId,outcome:'enquired' as const}));
 await app.register(async child=>phoneInboundWorkflowRoutes(child,{requestCallback,complete},{maxInFlight:1}),{prefix:'/api/v1'});
 try{
  expect((await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/callback/route-a',payload:{}})).statusCode).toBe(503);
  expect((await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/completion/route-a',payload:{}})).statusCode).toBe(200);expect(requestCallback).toHaveBeenCalledTimes(1);
 }finally{await app.close();}
});
