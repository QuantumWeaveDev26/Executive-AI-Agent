import {afterEach,it,expect,vi} from 'vitest';
import {capturePhoneCallEvidence} from '@thaara/contracts';
import Fastify from 'fastify';
import {phoneSarvamWebhookRoutes} from '../src/routes/phone-sarvam-webhook.js';
import {sarvamWebhookToken} from '../src/services/phone-sarvam-calls.js';
import {createPhoneStructuredCallbackStoreForReview} from '../src/services/phone-structured-callback-store.js';
const callId='aaaaaaaa-1111-4111-8111-111111111111';
const event=()=>({callId,providerRequestId:'attempt',providerCallId:'20261106/call',eventId:'report-event',conversation:capturePhoneCallEvidence([{role:'assistant',text:'When will it be ready?'},{role:'user',text:'Sunday afternoon.'}],'provider_english_translation')});
afterEach(()=>vi.unstubAllEnvs());
it('refuses production construction before reading storage',()=>{vi.stubEnv('NODE_ENV','production');expect(()=>createPhoneStructuredCallbackStoreForReview({} as any)).toThrow('test-only');});
it('uses only the reviewed atomic function and preserves actual speaker order',async()=>{
 const query=vi.fn(async()=>({rows:[{result:'applied'}]}));const store=createPhoneStructuredCallbackStoreForReview({query} as any);
 expect(await store.completeReport(event())).toBe('applied');expect(query).toHaveBeenCalledOnce();
 const [sql,args]=query.mock.calls[0] as any;expect(sql).toBe('SELECT public.complete_phone_provider_report($1,$2,$3,$4,$5,$6::jsonb) AS result');
 expect(args.slice(0,4)).toEqual([callId,'attempt','20261106/call','report-event']);expect(args[4]).toMatch(/^[a-f0-9]{64}$/);
 expect(JSON.parse(args[5]).turns.map((t:any)=>t.speaker)).toEqual(['thaara','customer']);
});
it('rejects bad binding, unordered turns and fabricated verification before any query',async()=>{
 const query=vi.fn(),store=createPhoneStructuredCallbackStoreForReview({query} as any);
 for(const bad of [null,{...event(),callId:'invalid'},{...event(),ownerApproved:true},{...event(),conversation:{...event().conversation,verified:true}},{...event(),conversation:{...event().conversation,turns:[event().conversation.turns[1],event().conversation.turns[0]]}}])await expect(store.completeReport(bad as any)).rejects.toThrow();
 expect(query).not.toHaveBeenCalled();
});
it('uses the optional atomic path only after call-capability admission and never falls back after a save failure',async()=>{
 const secret='synthetic-structured-webhook-secret-00000000',completeReport=vi.fn(async()=> 'applied' as 'applied'|'duplicate'|'ignored'),apply=vi.fn(),transcript=vi.fn();
 const binding=vi.fn(async()=>({callId,providerRequestId:'attempt',providerCallId:null,language:'en-IN' as const,aiDisclosure:'AI assistant',purpose:'Website status',maxDurationSeconds:300,state:'queued' as const}));
 const app=Fastify({logger:false});await app.register(async a=>phoneSarvamWebhookRoutes(a,{webhookSecret:async()=>secret,store:{binding,apply,transcript,completeReport}}),{prefix:'/api/v1'});
 const payload={attempt_id:'attempt',status:'connected',interaction_id:'20261106/call',webhook_config:{metadata:{thaara_call_id:callId}},interaction_transcript:[{role:'agent',en_text:'When will it be ready?'},{role:'user',en_text:'Sunday afternoon.'}]};
 const url='/api/v1/connectors/phone/sarvam/calls/'+callId+'/'+sarvamWebhookToken(secret,callId);
 try{
  expect((await app.inject({method:'POST',url:url.slice(0,-64)+'0'.repeat(64),payload})).statusCode).toBe(403);expect(completeReport).not.toHaveBeenCalled();
  expect((await app.inject({method:'POST',url,payload})).statusCode).toBe(200);expect(completeReport.mock.calls[0]![0].conversation.turns.map((t:any)=>t.speaker)).toEqual(['thaara','customer']);
  completeReport.mockResolvedValueOnce('duplicate');expect((await app.inject({method:'POST',url,payload})).statusCode).toBe(200);
  completeReport.mockRejectedValueOnce(Error('private transaction error'));const failed=await app.inject({method:'POST',url,payload});expect(failed.statusCode).toBe(409);expect(failed.body).not.toContain('private');
  expect(completeReport).toHaveBeenCalledTimes(3);expect(apply).not.toHaveBeenCalled();expect(transcript).not.toHaveBeenCalled();
 }finally{await app.close();}
});
it('does not hide failed transactions or accept an unknown receipt',async()=>{
 const query=vi.fn(async()=>({rows:[{result:'unknown'}]})),store=createPhoneStructuredCallbackStoreForReview({query} as any);
 await expect(store.completeReport(event())).rejects.toThrow();
 query.mockRejectedValueOnce(Error('private database detail'));await expect(store.completeReport(event())).rejects.toThrow('could not be saved');expect(query).toHaveBeenCalledTimes(2);
});
it('keeps the authenticated dispatch binding instead of substituting a later lookup',async()=>{
 const secret='synthetic-structured-webhook-secret-00000000';
 const binding=vi.fn().mockResolvedValueOnce({providerRequestId:'attempt'}).mockResolvedValue({providerRequestId:'different-attempt'});
 const completeReport=vi.fn(async()=> 'applied' as const),apply=vi.fn(),transcript=vi.fn();
 const app=Fastify({logger:false});await app.register(async a=>phoneSarvamWebhookRoutes(a,{webhookSecret:async()=>secret,store:{binding,apply,transcript,completeReport}}),{prefix:'/api/v1'});
 try{
  const response=await app.inject({method:'POST',url:'/api/v1/connectors/phone/sarvam/calls/'+callId+'/'+sarvamWebhookToken(secret,callId),payload:{attempt_id:'attempt',status:'connected',interaction_id:'20261106/call',webhook_config:{metadata:{thaara_call_id:callId}},interaction_transcript:[]}});
  expect(response.statusCode).toBe(200);expect(completeReport).toHaveBeenCalledWith(expect.objectContaining({providerRequestId:'attempt'}));expect(binding).toHaveBeenCalledOnce();
 }finally{await app.close();}
});
