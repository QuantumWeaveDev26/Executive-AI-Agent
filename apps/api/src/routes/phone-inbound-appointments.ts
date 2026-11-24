import type {FastifyInstance} from 'fastify';
import {PhoneAppointmentRequestSchema,PhoneAppointmentResponseSchema} from '@thaara/contracts';
import {Value} from '@sinclair/typebox/value';
import type {createInboundAppointments} from '../services/phone-inbound-appointments.js';
import {createInboundIngressLimiter} from '../services/phone-inbound-ingress.js';
/** Deliberately unregistered in buildApp; database/runtime admission must be reviewed before production. */
export async function phoneInboundAppointmentRoutes(app:FastifyInstance,service:ReturnType<typeof createInboundAppointments>){
 if(process.env.NODE_ENV!=='test')throw Error('Inbound appointment routes are test-only pending production admission.');
 const limits=createInboundIngressLimiter();
 app.post<{Params:{routeId:string}}>('/connectors/phone/inbound/appointment-requests/:routeId',{
  bodyLimit:65536,logLevel:'silent',schema:{body:PhoneAppointmentRequestSchema,response:{200:PhoneAppointmentResponseSchema}},
  // Reject extra authority fields before Fastify's default AJV may remove additional properties.
  preValidation:async(req,reply)=>{if(!Value.Check(PhoneAppointmentRequestSchema,req.body))return reply.code(400).send({saved:false,code:'PHONE_APPOINTMENT_INVALID'});},
  onRequest:async(_req,reply)=>{reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');
   if(!limits.allowRequest())return reply.code(429).send({saved:false,code:'PHONE_APPOINTMENT_RATE_LIMITED'});}
 },async(req,reply)=>{
  const release=limits.acquire();if(!release)return reply.code(429).send({saved:false,code:'PHONE_APPOINTMENT_BUSY'});
  try{return await service.request(req.params.routeId,req.headers.authorization,req.body);}
  catch(error){const status=(error as {statusCode?:number})?.statusCode;return reply.code(status===400?400:status===403?403:status===409?409:503).send({saved:false,code:'PHONE_APPOINTMENT_REQUEST_NOT_SAVED'});}
  finally{release();}
 });
}
