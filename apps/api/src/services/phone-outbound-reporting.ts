import type {PhoneCallingRecord} from '@thaara/contracts';
/** Unwired reporting projection of an already owner-scoped ledger row. No dispatch, provider lookup or new success claim. */
export function projectOutboundCallReport(call:PhoneCallingRecord){
 return Object.freeze({id:call.id,direction:'outbound' as const,providerInteractionId:call.providerCallId,
  maskedPhone:call.draft.recipient.maskedPhone,customerName:call.draft.recipient.displayName,
  occurredAt:call.createdAt,callStatus:call.state,durationSeconds:null,
  enquirySummary:call.report.text,simulated:call.simulated,providerVerified:false as const,
  transcriptReference:null,recordingReference:null});
}
