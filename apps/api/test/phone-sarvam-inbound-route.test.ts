import {it,expect} from 'vitest';
import Fastify from 'fastify';
import {phoneSarvamInboundIntakeRoutes} from '../src/routes/phone-sarvam-inbound-intake.js';
it('returns only a minimal saved receipt, without customer data',async()=>{
 const app=Fastify();try{
  await phoneSarvamInboundIntakeRoutes(app,{ingest:async()=>({id:'call-a',outcome:'enquired',callerPhone:'+919000000001',customerName:'Private'})} as never);
  const r=await app.inject({method:'POST',url:'/connectors/phone/inbound/intake/route-a',payload:{},headers:{authorization:'Bearer synthetic-token'}});
  expect(r.json()).toEqual({saved:true,reportId:'call-a',outcome:'enquired'});expect(r.body).not.toContain('Private');expect(r.headers['cache-control']).toBe('no-store');
 }finally{await app.close();}
});
it('sanitizes failures and never confirms a failed save',async()=>{
 const app=Fastify();try{
  await phoneSarvamInboundIntakeRoutes(app,{ingest:async()=>{throw Error('private credential or SQL details');}} as never);
  const r=await app.inject({method:'POST',url:'/connectors/phone/inbound/intake/route-a',payload:{}});
  expect(r.statusCode).toBe(503);expect(r.json().saved).toBe(false);expect(r.body).not.toContain('credential');
 }finally{await app.close();}
});
