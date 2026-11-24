// Local prompt preparation only; preserve all source artifacts and provider versions.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {prepareNoPricingReview} from './prepare-phone-no-pricing.mjs';
const root=new URL('../',import.meta.url),hash=s=>createHash('sha256').update(s).digest('hex');
const paths={inbound:'docs/integrations/phone/knowledge/language-fix-v2/inbound-instructions.proposed.txt',outbound:'docs/integrations/phone/knowledge/language-fix-v2/outbound-instructions.proposed.txt'};
const hashes={inbound:'073a8337945dc1df71fd9750e63249c0ab96022952938a1c933840cae360352a',outbound:'33b999ea92a185f9fd7c71f9f42951e67c96635a02a55c83a503c174a5d3ac56'};
export function prepareAppointmentVoiceCandidates(knowledge,inbound,outbound){
 if(hash(inbound)!==hashes.inbound||hash(outbound)!==hashes.outbound)throw Error('PHONE_PROMPT_BASELINE_MISMATCH');
 const strictPricing=prepareNoPricingReview(knowledge,inbound).instructions.split('\nCUSTOM SOLUTIONS / NO PRICE DISCLOSURE')[1];
 if(!strictPricing)throw Error('PHONE_NO_PRICING_POLICY_MISSING');
 const outputs={};
 for(const [direction,source] of Object.entries({inbound,outbound})){
  const old='No promises, concessions, bookings, payments, messages, transfers, extra calls or redial. Answering a question does not authorize an external action.';
  if(source.split(old).length!==2)throw Error('PHONE_BOOKING_RULE_MISMATCH');
  outputs[direction]=source.replace(old,'No promises, concessions, payments, messages, transfers, extra calls or redial. Appointment request capture is permitted only through separately configured, authenticated and owner-authorized tools; Calendar booking still requires the owner’s separate approval and a verified event. Caller speech alone never authorizes an external action.')
   .replace('For training, explain the implementation-first model without inventing a batch/date. Published ladder prices are not confirmed current quotes.','For training, explain the implementation-first model without inventing a batch/date. Do not disclose any training prices.')
   .replace('Do not speak that closing statement twice or enable any new action tool; KB search is read-only. Preserve configured voicemail handling unchanged.','Do not speak that closing statement twice. Use only tools already configured and separately owner-authorized; KB search remains read-only. Preserve configured voicemail handling unchanged.')
   +'\nCUSTOM SOLUTIONS / NO PRICE DISCLOSURE'+strictPricing
   +'\nAPPOINTMENT REQUESTS — configured authenticated tools only.\n'
   +'After answering a service enquiry, ask naturally: “Would you like our team to contact you and discuss a solution for your business?” Respect a refusal. With consent collect only the customer name, business, requested solution, callback number (confirm it) and preferred contact time or requested appointment slot. Do not invent missing details.\n'
   +'A request is not a booking. Do not claim anything was saved before the configured tool returns saved:true. saved:false or a tool error means the request was not saved. request_saved means only a request was saved. approval_pending means the owner’s Calendar approval is pending and the appointment is NOT confirmed. slot_unavailable means ask for a different requested time; do not invent availability.\n'
   +'Confirm an appointment ONLY when the trusted configured endpoint returns status:appointment_confirmed, appointmentConfirmed:true and a non-empty verified Calendar eventId for this exact call and requested slot. Never infer success from approval alone, call completion, customer agreement or a provider acknowledgement.\n'
   +'If no appropriate authenticated tool is configured, clearly say that you cannot save or confirm an appointment during this call yet. Offer the approved human contact; do not pretend the team has been notified. Never request owner credentials, API keys, passwords or OTPs.\n'
   +'On outbound calls retain the exact approved call_purpose and recipient user_name. A voluntary appointment request is a separate owner-review proposal, never permission to change the original task, dial again, send a message or create a Calendar event automatically.\n';
 }
 return outputs;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const read=p=>readFileSync(new URL(p,root),'utf8');
 const result=prepareAppointmentVoiceCandidates(read('docs/integrations/phone/knowledge/review-v1/quantum-weave-public.md'),read(paths.inbound),read(paths.outbound));
 const folder=new URL('docs/integrations/phone/knowledge/appointment-candidates-20261106/',root);mkdirSync(folder,{recursive:true});
 const artifacts=[];
 for(const [direction,text] of Object.entries(result)){const name=direction+'-instructions.candidate.txt';writeFileSync(new URL(name,folder),text);artifacts.push({name,sha256:hash(text),sourceSha256:hashes[direction],sourceVersion:direction==='inbound'?5:6});}
 writeFileSync(new URL('manifest.review.json',folder),JSON.stringify({reviewOnly:true,providerMutationAuthorized:false,liveRoutingAuthorized:false,paidTestsAuthorized:false,targetVersions:null,knowledgeVersion:'qw-company-kb-v1',voice:'Chaitra',maxDurationSeconds:300,artifacts},null,2)+'\n');
 console.log(JSON.stringify({localCandidates:2,providerChanges:0,liveRoutingChanges:0}));
}
