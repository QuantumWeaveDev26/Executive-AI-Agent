import type {AuthenticatedScope} from '@thaara/db';
import type {PhoneCallingPrepare} from '@thaara/contracts';
import {ConflictError,ForbiddenError} from '@thaara/observability';
import type {PhoneCallingService} from './phone-calling.js';
import type {ChatWhatsAppReplyOutcome} from './chat-whatsapp-assistant.js';

export async function executeChatPhoneCalling(scope:AuthenticatedScope,intent:PhoneCallingPrepare,service?:PhoneCallingService,chatContext?:{conversationId:string}):Promise<ChatWhatsAppReplyOutcome>{
 try{
  if(!service)return {handled:true,status:'not_configured',assistantResponseText:'Phone calling and contacts are not configured. No call was made.'};
  const p=await service.prepare(scope,intent,chatContext);
  const newRecipient=p.draft.newRecipient;
  const eligibilityPending=newRecipient!==undefined&&(!newRecipient.consentConfirmed||newRecipient.eligibility!=='eligible');
  const startInstructions=eligibilityPending
   ? 'Approval cannot place a call until eligibility is verified.'
   : p.draft.mode==='live'
    ? 'After approval Thaara can place this one real call, only when you start it.'
    : 'Real calling remains disabled; approval cannot dial a number.';
  return {handled:true,status:'awaiting_approval',planId:p.planId,planStatus:'awaiting_approval',approvalId:p.approvalId,
   steps:[{stepId:p.stepId,stepOrder:0,actionName:'phone.ai.calls.request',status:'awaiting_approval',receiptId:null,receiptStatus:null,verificationMethod:null,proof:null,error:null}],
   assistantResponseText:`${newRecipient?'NEW RECIPIENT preview. No contact was saved.\n':''}${eligibilityPending?'Confirm the name and recipient consent. ':''}Prepared ${p.draft.mode==='live'?'a LIVE':'a simulation-only'} call request for ${p.draft.recipient.displayName} (${p.draft.recipient.maskedPhone}).\nPurpose: ${p.draft.purpose}\nLanguage: ${p.draft.language}; maximum ${p.draft.maxDurationSeconds} seconds.\nAI introduction: ${p.draft.aiDisclosure}\nReview the exact recipient and purpose before approving. ${startInstructions}`};
 }catch(error){
  const status=error instanceof ConflictError?'ambiguous':error instanceof ForbiddenError?'denied':'not_configured';
  return {handled:true,status,assistantResponseText:status==='ambiguous'?'More than one contact matches, or no exact contact was found. Choose the correct contact on the Phone screen. No call was made.':status==='denied'?'This call request is not permitted for your account or this contact. No call was made.':'Phone contacts or calling are not configured in this environment. No call was made.'};
 }
}
