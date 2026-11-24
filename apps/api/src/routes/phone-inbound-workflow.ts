import type {FastifyInstance} from 'fastify';
import {PhoneInboundCallbackReceiptSchema,PhoneInboundCompletionReceiptSchema} from '@thaara/contracts';
import {Type} from '@sinclair/typebox';
import type {createInboundCallWorkflow} from '../services/phone-inbound-workflow.js';
import {createInboundIngressLimiter,type InboundIngressOptions} from '../services/phone-inbound-ingress.js';
/** Unregistered test-only route factory. Tool auth is validated by the workflow, never browser/body assertions. */
export async function phoneInboundWorkflowRoutes(app:FastifyInstance,workflow:ReturnType<typeof createInboundCallWorkflow>,limits:InboundIngressOptions={}){
 if(process.env.NODE_ENV!=='test')throw new Error('Inbound workflow routes are test-only pending production admission.');
 const ingress=createInboundIngressLimiter(limits);
 for(const [path,method,response] of [['callback','requestCallback',PhoneInboundCallbackReceiptSchema],['completion','complete',PhoneInboundCompletionReceiptSchema]] as const){
  app.post<{Params:{routeId:string}}>('/connectors/phone/inbound/'+path+'/:routeId',{bodyLimit:65536,logLevel:'silent',
   onRequest:async(_request,reply)=>{
    reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');
    if(!ingress.allowRequest())return reply.header('Retry-After',ingress.retryAfterSeconds).code(429).send({saved:false,code:'PHONE_INBOUND_RATE_LIMITED'});
   },
   schema:{params:Type.Object({routeId:Type.String({pattern:'^[A-Za-z0-9_-]{1,128}$'})},{additionalProperties:false}),response:{200:response}}},async(request,reply)=>{
   const release=ingress.acquire();
   if(!release)return reply.header('Retry-After',1).code(429).send({saved:false,code:'PHONE_INBOUND_BUSY'});
   try{return await workflow[method](request.params.routeId,request.headers.authorization,request.body);}
   catch(error){const code=(error as {statusCode?:number})?.statusCode;return reply.code(code===403?403:code===409?409:503).send({saved:false,code:'PHONE_INBOUND_REQUEST_NOT_CONFIRMED'});}
   finally{release();}
  });
 }
}
