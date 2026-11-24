import type {FastifyInstance} from 'fastify';
import {computeCanonicalParameterHash} from '@thaara/contracts';
import {admitSarvamWebhook} from '../services/phone-sarvam-calls.js';
import type {PhoneCallbackStore} from './phone-provider-callbacks.js';
import type {PhoneStructuredCompletion} from '../services/phone-structured-callback-store.js';
import type {AdmittedCallbackCall,CallbackRequest} from '../services/phone-callback-notification.js';
import {projectSarvamCallbackCompletion} from '../services/phone-sarvam-callback-completion.js';

export interface PhoneSarvamWebhookOptions{
 webhookSecret:()=>Promise<string>;store:PhoneCallbackStore;
 /** The admitted store must verify this attempt and persist both records in one transaction. */
 completeWithCallback?(completion:PhoneStructuredCompletion,
  project:(binding:Omit<AdmittedCallbackCall,'callId'|'direction'|'turns'>)=>CallbackRequest|null):Promise<void>;
}

/**
 * Session-free Sarvam post-call webhook, registered only when live Sarvam calling is configured. Results are applied through
 * the reviewed SECURITY DEFINER functions: provider-reported states in order, then the recipient's lines as the provider's
 * English rendering (never claimed as exact words), all idempotent by event id. Always unverified: Sarvam signs nothing.
 */
export async function phoneSarvamWebhookRoutes(app:FastifyInstance,options:PhoneSarvamWebhookOptions){
 if(options.completeWithCallback&&process.env.NODE_ENV!=='test')throw Error('Sarvam callback notification storage requires production admission.');
 app.post<{Params:{callId:string;token:string}}>('/connectors/phone/sarvam/calls/:callId/:token',{bodyLimit:65536},async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  const decision=await admitSarvamWebhook({callId:request.params.callId,token:request.params.token,body:request.body},
   {webhookSecret:options.webhookSecret,binding:async id=>{const b=await options.store.binding(id);return b&&{providerRequestId:b.providerRequestId};}});
  if(decision.status==='not_configured')return reply.code(503).send();
  if(decision.status==='rejected'){request.log.warn({reason:decision.reason},'sarvam webhook rejected');return reply.code(403).send();}
  // Keep the attempt admitted above; the database rechecks it atomically at write time.
  const apply=(state:typeof decision.states[number])=>{
   const event={eventId:`${decision.eventIdBase}-${state}`,state,providerCallId:decision.providerCallId};
   return options.store.apply({callId:decision.callId,providerRequestId:decision.providerRequestId,providerCallId:decision.providerCallId,state,eventId:event.eventId,eventHash:computeCanonicalParameterHash(event)});
  };
  try{
   const completion={callId:decision.callId,providerRequestId:decision.providerRequestId,
    providerCallId:decision.providerCallId,eventId:decision.eventIdBase+'-report',conversation:decision.conversation};
   if(decision.states.includes('completed')&&options.completeWithCallback){
    await options.completeWithCallback(completion,binding=>projectSarvamCallbackCompletion({
     ...binding,callId:decision.callId,direction:'outbound',
    },request.body));
   }else if(decision.states.includes('completed')&&options.store.completeReport){
    await options.store.completeReport(completion);
   }else{
   for(const state of decision.states){
    // Recipient evidence goes in while the call is answered, before it is closed as completed.
    if(state==='completed')for(const line of decision.recipientLines)
     await options.store.transcript({callId:decision.callId,providerCallId:decision.providerCallId,eventId:line.eventId,text:line.text,source:'provider_english',eventHash:computeCanonicalParameterHash(line)});
    await apply(state);
   }
   }
  }catch{
   request.log.warn('sarvam webhook could not be applied');
   return reply.code(409).send();
  }
  return reply.code(200).send({received:true});
 });
}
