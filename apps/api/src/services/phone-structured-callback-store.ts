import {computeCanonicalParameterHash,isPhoneCallEvidence,isPhoneProviderCallId,type PhoneCallEvidence} from '@thaara/contracts';
import type {DbClient} from '@thaara/db';
import {AppError,ForbiddenError} from '@thaara/observability';
import {createPostgresPhoneCallbackStore} from './phone-calls-postgres.js';

export interface PhoneStructuredCompletion {
 callId:string;providerRequestId:string;providerCallId:string;eventId:string;conversation:PhoneCallEvidence;
}
/** Review-only implementation for new 114 SQL. Never wired to startup or permitted in production.
 * One transaction stores the ordered evidence and completion; no terminal-row repair or automatic retry.
 */
export function createPhoneStructuredCallbackStoreForReview(db:DbClient){
 if(process.env.NODE_ENV!=='test')throw Error('Structured callback store is test-only pending SQL and runtime admission.');
 return {...createPostgresPhoneCallbackStore(db),async completeReport(input:PhoneStructuredCompletion):Promise<'applied'|'duplicate'|'ignored'>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ForbiddenError('Structured call report binding was denied.');
  const e=structuredClone(input);
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(e.callId)
   ||!/^[-A-Za-z0-9_.:]{1,128}$/.test(e.providerRequestId)||!isPhoneProviderCallId(e.providerCallId)
   ||Object.keys(e).sort().join(',')!=='callId,conversation,eventId,providerCallId,providerRequestId'
   ||!/^[-A-Za-z0-9_]{1,100}$/.test(e.eventId)||!isPhoneCallEvidence(e.conversation)
   ||e.conversation.turns.some(t=>t.source!=='provider_english_translation')
   ||Buffer.byteLength(JSON.stringify(e.conversation),'utf8')>20000)throw new ForbiddenError('Structured call report binding was denied.');
  const eventHash=computeCanonicalParameterHash(e);
  try{
   const result=await db.query<{result:string}>('SELECT public.complete_phone_provider_report($1,$2,$3,$4,$5,$6::jsonb) AS result',
    [e.callId,e.providerRequestId,e.providerCallId,e.eventId,eventHash,JSON.stringify(e.conversation)]);
   if(result.rows.length!==1||!['applied','duplicate','ignored'].includes(result.rows[0]!.result))throw Error('receipt');
   return result.rows[0]!.result as 'applied'|'duplicate'|'ignored';
  }catch{throw new AppError('Structured call report could not be saved.','PHONE_STRUCTURED_REPORT_UNAVAILABLE',503);}
 }};
}
