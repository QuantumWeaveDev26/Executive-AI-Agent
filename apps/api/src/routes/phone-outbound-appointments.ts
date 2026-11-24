import type {FastifyInstance} from 'fastify';
import {Value} from '@sinclair/typebox/value';
import {PhoneCallingSpeechRequestSchema,PhoneOutboundAppointmentRequestSchema,PhoneOutboundAppointmentResponseSchema,PhoneAppointmentOwnerReviewSnapshotSchema} from '@thaara/contracts';
import {isExistingOwnerCalendarReview,type createOutboundAppointments} from '../services/phone-outbound-appointments.js';

/** Owner UI follow-up only. No service credential accepted; not registered in buildApp. */
export async function phoneOutboundAppointmentRoutes(app:FastifyInstance,service:ReturnType<typeof createOutboundAppointments>){
 if(process.env.NODE_ENV!=='test'&&!isExistingOwnerCalendarReview(service))throw Error('Outbound appointment routes require existing owner Calendar review admission.');
 app.get<{Params:{callId:string}}>('/connectors/phone/ai/calls/:callId/appointment-status',{
  preHandler:[app.requireAuth],logLevel:'silent',config:{rateLimit:{max:30,timeWindow:'1 minute'}},
  onRequest:async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');},
  schema:{params:PhoneCallingSpeechRequestSchema,response:{200:PhoneOutboundAppointmentResponseSchema}}
 },async(req,reply)=>{try{return await service.status(req.scope!,req.params.callId);}catch(error){return reply.code((error as {statusCode?:number})?.statusCode===403?403:503).send({appointmentConfirmed:false,code:'PHONE_APPOINTMENT_STATUS_UNAVAILABLE'});}});
 app.get<{Params:{callId:string}}>('/connectors/phone/ai/calls/:callId/appointment-review',{
  preHandler:[app.requireAuth],logLevel:'silent',
  onRequest:async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');},
  schema:{params:PhoneCallingSpeechRequestSchema,response:{200:PhoneAppointmentOwnerReviewSnapshotSchema}}
 },async(req,reply)=>{try{return await service.review(req.scope!,req.params.callId);}catch(error){return reply.code((error as {statusCode?:number})?.statusCode===403?403:503).send({appointmentConfirmed:false,code:'PHONE_APPOINTMENT_REVIEW_UNAVAILABLE'});}});
 app.post<{Params:{callId:string}}>('/connectors/phone/ai/calls/:callId/appointment-request',{
  preHandler:[app.requireAuth],bodyLimit:8192,logLevel:'silent',config:{rateLimit:{max:5,timeWindow:'1 minute'}},
  onRequest:async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');},
  preValidation:async(req,reply)=>{if(!Value.Check(PhoneOutboundAppointmentRequestSchema,req.body))return reply.code(400).send({saved:false,appointmentConfirmed:false,status:'request_not_saved'});},
  schema:{params:PhoneCallingSpeechRequestSchema,body:PhoneOutboundAppointmentRequestSchema,response:{200:PhoneOutboundAppointmentResponseSchema}}
 },async(req,reply)=>{
  try{return await service.request(req.scope!,req.params.callId,req.body);}
  catch(error){const status=(error as {statusCode?:number})?.statusCode;return reply.code(status===400?400:status===403?403:503).send({saved:false,appointmentConfirmed:false,status:'request_not_saved'});}
 });
}
