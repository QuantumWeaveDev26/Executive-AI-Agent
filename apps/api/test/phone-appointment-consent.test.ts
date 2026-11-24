import {it,expect} from 'vitest';
import {normalizeSarvamInboundPayload} from '../src/services/phone-sarvam-inbound-normalize.js';
const profile={routeId:'consent-route',workspaceId:'workspace',ownerUserId:'owner',appId:'agent',appVersion:5,deploymentId:'inbound',agentPhoneNumber:'+918000000001'};
const payload=(offer:string,answer='Yes, please.')=>({app_id:'agent',app_version:5,deployment_id:'inbound',agent_phone_number:profile.agentPhoneNumber,interaction_id:'20261106/appointment-consent',user_phone_number:'+919000000001',duration:10,start_datetime:'2026-11-06T10:00:00Z',end_datetime:null,
 final_agent_variables:{customer_name:'Ram',requested_service:'Website',callback_preference:'yes'},interaction_transcript:[{role:'agent',en_text:offer},{role:'user',en_text:answer}]});
const normalize=(offer:string,answer?:string)=>normalizeSarvamInboundPayload(profile,payload(offer,answer));
it('captures explicit appointment-request consent as pending team follow-up, never a booked event',async()=>{
 const {report}=await normalize('May I save your appointment request and ask our team to contact you at +91 90000 00001?');
 expect(report.callbackConsent).toBe('confirmed');expect(report.outcome).toBe('callback_requested');expect(report.callbackRequestId).toBeTruthy();expect(report.appointment).toBeNull();
});
it.each(['+9190000000019','+1919000000001','+919000000002','+919000000001 or +919000000002'])('does not infer consent for a mismatched or ambiguous recap number: %s',number=>normalize(`Would you like our team to contact you at ${number} and discuss a solution for your business?`).then(({report})=>{expect(report.callbackConsent).not.toBe('confirmed');expect(report.callbackRequestId).toBeNull();}));
it.each(['No, thanks.','What time will you call?','Yes, but do not call me.'])('does not infer appointment-request consent from an unclear or negative response: %s',answer=>normalize('May I save your appointment request and ask our team to contact you at +919000000001?',answer).then(({report})=>{expect(report.callbackConsent).not.toBe('confirmed');expect(report.callbackRequestId).toBeNull();}));
it('preserves the existing full-number callback confirmation',async()=>{
 expect((await normalize('Would you like our team to contact you at +919000000001 and discuss a solution for your business?')).report.callbackConsent).toBe('confirmed');
});
it('does not treat merely discussing an appointment as permission to contact',async()=>{
 expect((await normalize('Our team can discuss appointment options at +919000000001.')).report.callbackConsent).not.toBe('confirmed');
});
it.each([' ext 123',' ext123',' extension123',' x123','#123','.123',' extension: 123'])('rejects an extension rather than treating it as the exact caller number: %s',suffix=>normalize(`Would you like our team to contact you at +919000000001${suffix} and discuss a solution for your business?`).then(({report})=>{expect(report.callbackConsent).not.toBe('confirmed');expect(report.callbackRequestId).toBeNull();}));
