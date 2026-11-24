import type {FastifyInstance} from 'fastify';
import {PhoneCallingProviderResultSchema,PhoneCallingSpeechRequestSchema} from '@thaara/contracts';
import {Type,type TSchema} from '@sinclair/typebox';
import {Value} from '@sinclair/typebox/value';
import {PhoneCallingPrepareSchema,PhoneCallingPreparedSchema,PhoneCallingStatusSchema,PhoneCallingHistorySchema,PhoneCallingRecordSchema,PhoneCallingSimulationSchema,PhoneContactArchiveSchema,PhoneContactCreateSchema,PhoneContactListSchema,PhoneContactUpdateSchema,PhoneContactViewSchema,PhoneCallingRequestListSchema,type PhoneCallingPrepare,type PhoneContactCreate,type PhoneContactUpdate} from '@thaara/contracts';
import {AppError} from '@thaara/observability';
import type {PhoneCallingService} from '../services/phone-calling.js';
import type {PhoneContactManagementService} from '../services/phone-contacts.js';
import type {PhoneN8nSyncService} from '../services/phone-n8n-sync.js';

export async function phoneCallingRoutes(app:FastifyInstance,service:PhoneCallingService,syncService?:PhoneN8nSyncService){
 const base='/connectors/phone/ai',tags=['PhoneCalling'];
 const noStore=async(_request:unknown,reply:{header(name:string,value:string):unknown})=>{reply.header('Cache-Control','no-store');};
 const preHandler=[app.requireAuth];
 app.get(base+'/status',{preHandler,onSend:noStore,schema:{tags,response:{200:PhoneCallingStatusSchema}}},r=>service.status(r.scope!));
 app.get(base+'/calls',{preHandler,onSend:noStore,schema:{tags,response:{200:PhoneCallingHistorySchema}}},async r=>{
  const baseHistory=await service.history(r.scope!);
  return syncService?syncService.enrichOutboundHistory(r.scope!,baseHistory):baseHistory;
 });
 app.get(base+'/requests',{preHandler,onSend:noStore,schema:{tags,response:{200:PhoneCallingRequestListSchema}}},r=>service.requests(r.scope!));
 app.post<{Body:{query:string}}>(base+'/contacts/resolve',{preHandler,onSend:noStore,schema:{tags,body:Type.Object({query:Type.String({minLength:1,maxLength:128})},{additionalProperties:false})}},r=>service.resolve(r.scope!,r.body.query));
 app.post<{Body:PhoneCallingPrepare}>(base+'/drafts',{preHandler,onSend:noStore,bodyLimit:8192,
  preValidation:async r=>{if(!Value.Check(PhoneCallingPrepareSchema,r.body))throw new AppError('Invalid phone call draft.','PHONE_CALLING_INPUT',400);},
  schema:{tags,body:PhoneCallingPrepareSchema,response:{200:PhoneCallingPreparedSchema}}},r=>service.prepare(r.scope!,r.body));
 app.post<{Body:{approvalId:string}}>(base+'/simulations',{preHandler,onSend:noStore,schema:{tags,body:PhoneCallingSimulationSchema,response:{200:PhoneCallingRecordSchema}}},r=>service.simulate(r.scope!,r.body.approvalId));
 // Places one real call for an approved live draft; 503 unless live calling was explicitly configured.
 app.post<{Body:{approvalId:string}}>(base+'/calls',{preHandler,onSend:noStore,schema:{tags,body:PhoneCallingSimulationSchema,response:{200:PhoneCallingRecordSchema}}},r=>service.placeCall(r.scope!,r.body.approvalId));
 // One-tap "Call now" from Chat: the requester's own confirmation of the exact displayed request, then one call.
 app.post<{Body:{approvalId:string}}>(base+'/calls/confirm',{preHandler,onSend:noStore,schema:{tags,body:PhoneCallingSimulationSchema,response:{200:PhoneCallingRecordSchema}}},r=>service.confirmAndPlaceCall(r.scope!,r.body.approvalId));
 app.post<{Params:{callId:string}}>(base+'/calls/:callId/result',{preHandler,onSend:noStore,config:{rateLimit:{max:5,timeWindow:'1 minute'}},schema:{tags,params:PhoneCallingSpeechRequestSchema,response:{200:PhoneCallingProviderResultSchema}}},r=>service.providerResult(r.scope!,r.params.callId));
 // The owner's call report read aloud in Thaara's voice (WAV). POST: it sends the report sentence to the voice provider.
 app.post<{Params:{callId:string}}>(base+'/calls/:callId/speech',{preHandler,onSend:noStore,schema:{tags,params:Type.Object({callId:Type.String({pattern:'^[0-9a-f-]{36}$'})},{additionalProperties:false})}},
  async(r,reply)=>reply.type('audio/wav').send(Buffer.from(await service.reportSpeech(r.scope!,r.params.callId))));
 // Provider callbacks live in phoneProviderCallbackRoutes and are registered only when live calling is configured.
 // No raw audio or transcript-ingestion route exists.
}

/** Owner contact management. Writes accept a raw +91 number once; every response carries only the masked number. */
export async function phoneContactRoutes(app:FastifyInstance,service:PhoneContactManagementService){
 const base='/connectors/phone/ai/contacts',tags=['PhoneCalling'];
 const noStore=async(_request:unknown,reply:{header(name:string,value:string):unknown})=>{reply.header('Cache-Control','no-store');};
 const preHandler=[app.requireAuth];
 const params=Type.Object({contactId:Type.String({pattern:'^[a-zA-Z0-9_-]{1,128}$'})},{additionalProperties:false});
 // Strict check before Fastify's validator, which would otherwise strip unknown fields (e.g. a forged workspaceId or consent reference).
 const strictBody=(schema:TSchema)=>async(r:{body:unknown})=>{if(!Value.Check(schema,r.body))throw new AppError('Invalid phone contact.','PHONE_CONTACT_INPUT',400);};
 app.get(base,{preHandler,onSend:noStore,schema:{tags,response:{200:PhoneContactListSchema}}},r=>service.list(r.scope!));
 app.post<{Body:PhoneContactCreate}>(base,{preHandler,onSend:noStore,bodyLimit:8192,preValidation:strictBody(PhoneContactCreateSchema),schema:{tags,body:PhoneContactCreateSchema,response:{200:PhoneContactViewSchema}}},r=>service.create(r.scope!,r.body));
 app.put<{Params:{contactId:string};Body:PhoneContactUpdate}>(base+'/:contactId',{preHandler,onSend:noStore,bodyLimit:8192,preValidation:strictBody(PhoneContactUpdateSchema),schema:{tags,params,body:PhoneContactUpdateSchema,response:{200:PhoneContactViewSchema}}},r=>service.update(r.scope!,r.params.contactId,r.body));
 app.post<{Params:{contactId:string};Body:{expectedRevision:number}}>(base+'/:contactId/archive',{preHandler,onSend:noStore,preValidation:strictBody(PhoneContactArchiveSchema),schema:{tags,params,body:PhoneContactArchiveSchema,response:{200:PhoneContactViewSchema}}},r=>service.archive(r.scope!,r.params.contactId,r.body.expectedRevision));
}
