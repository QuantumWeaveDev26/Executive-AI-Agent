import type {FastifyInstance} from 'fastify';
import {Type} from '@sinclair/typebox';
import {Value} from '@sinclair/typebox/value';
import {PhoneOutboundAppointmentRequestSchema,PhoneAppointmentOwnerResponseSchema,PhoneAppointmentOwnerReviewSnapshotSchema} from '@thaara/contracts';
import type {createInboundAppointmentOwnerReview} from '../services/phone-inbound-appointment-owner.js';

/** Owner UI route only. Deliberately unregistered until normal database/runtime admission. */
export async function phoneInboundAppointmentOwnerRoutes(app:FastifyInstance,service:ReturnType<typeof createInboundAppointmentOwnerReview>){
 if(process.env.NODE_ENV!=='test')throw Error('Inbound appointment review routes are test-only pending admission.');
 app.get<{Params:{reportId:string}}>('/connectors/phone/inbound/reports/:reportId/appointment-status',{
  preHandler:[app.requireAuth],logLevel:'silent',config:{rateLimit:{max:30,timeWindow:'1 minute'}},
  onRequest:async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');},
  schema:{params:Type.Object({reportId:Type.String({pattern:'^[a-f0-9]{64}$'})},{additionalProperties:false}),response:{200:PhoneAppointmentOwnerResponseSchema}}
 },async(req,reply)=>{try{return await service.status(req.scope!,req.params.reportId);}catch(error){return reply.code((error as {statusCode?:number})?.statusCode===403?403:503).send({appointmentConfirmed:false,code:'PHONE_APPOINTMENT_STATUS_UNAVAILABLE'});}});
 app.get<{Params:{reportId:string}}>('/connectors/phone/inbound/reports/:reportId/appointment-review',{
  preHandler:[app.requireAuth],logLevel:'silent',onRequest:async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');},
  schema:{params:Type.Object({reportId:Type.String({pattern:'^[a-f0-9]{64}$'})},{additionalProperties:false}),response:{200:PhoneAppointmentOwnerReviewSnapshotSchema}}
 },async(req,reply)=>{try{return await service.review(req.scope!,req.params.reportId);}catch(error){return reply.code((error as {statusCode?:number})?.statusCode===403?403:503).send({appointmentConfirmed:false,code:'PHONE_APPOINTMENT_REVIEW_UNAVAILABLE'});}});
 app.post<{Params:{reportId:string}}>('/connectors/phone/inbound/reports/:reportId/appointment-proposal',{
  preHandler:[app.requireAuth],bodyLimit:8192,logLevel:'silent',config:{rateLimit:{max:5,timeWindow:'1 minute'}},
  onRequest:async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');},
  preValidation:async(req,reply)=>{if(!Value.Check(PhoneOutboundAppointmentRequestSchema,req.body))return reply.code(400).send({appointmentConfirmed:false,code:'PHONE_APPOINTMENT_INVALID'});},
  schema:{params:Type.Object({reportId:Type.String({pattern:'^[a-f0-9]{64}$'})},{additionalProperties:false}),body:PhoneOutboundAppointmentRequestSchema,response:{200:PhoneAppointmentOwnerResponseSchema}}
 },async(req,reply)=>{
  try{return await service.request(req.scope!,req.params.reportId,req.body);}
  catch(error){const status=(error as {statusCode?:number})?.statusCode;return reply.code(status===400?400:status===403?403:503).send({appointmentConfirmed:false,code:'PHONE_APPOINTMENT_REVIEW_UNAVAILABLE'});}
 });
}
