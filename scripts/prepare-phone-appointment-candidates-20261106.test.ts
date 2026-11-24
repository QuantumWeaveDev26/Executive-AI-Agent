import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {prepareAppointmentVoiceCandidates} from './prepare-phone-appointment-candidates-20261106.mjs';
const read=(p:string)=>readFileSync('docs/integrations/phone/knowledge/'+p,'utf8');
const args=[read('review-v1/quantum-weave-public.md'),read('language-fix-v2/inbound-instructions.proposed.txt'),read('language-fix-v2/outbound-instructions.proposed.txt')] as const;
it('reuses the existing no-price policy and requires durable save plus owner-approved verified event before any confirmation',()=>{
 const result=prepareAppointmentVoiceCandidates(...args);
 for(const text of Object.values(result) as string[]){
  expect(text).toContain('Never provide prices, historical package amounts');expect(text).toContain('approval_pending');expect(text).toContain('appointmentConfirmed:true');expect(text).toContain('eventId');expect(text).toContain('cannot save or confirm');expect(text).toContain('Knowledge: qw-company-kb-v1.');expect(text).not.toContain('₹');
 }
 expect(result.outbound).toContain('CALL DIRECTION: OUTBOUND.');expect(result.outbound).toContain('{{call_purpose}}');expect(result.outbound).toContain('{{user_name}}');expect(result.inbound).toContain('CALL DIRECTION: INBOUND.');
});
it('rejects changed source prompts rather than overwriting another version',()=>{
 expect(()=>prepareAppointmentVoiceCandidates(args[0],args[1]+'changed',args[2])).toThrow('BASELINE_MISMATCH');
});
