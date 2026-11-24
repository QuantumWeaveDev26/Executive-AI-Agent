import {describe,it,expect} from 'vitest';
import {capturePhoneCallEvidence,phoneCallExchanges,isPhoneCallEvidence,phoneCallHighlights} from '../../../packages/contracts/src/phone-call-evidence.js';
describe('ordered call evidence without invented outcomes',()=>{
 it('rejects reordered evidence and uncertain known-speaker attribution',()=>{
  const e=capturePhoneCallEvidence([{role:'assistant',text:'Status?'},{role:'user',text:'Pending. Within 2–3 days.'}],'provider_transcript');
  expect(isPhoneCallEvidence(e)).toBe(true);expect(phoneCallHighlights(e).timeframes).toHaveLength(1);expect(phoneCallHighlights(e).blockers).toHaveLength(1);
  expect(isPhoneCallEvidence({...e,turns:[e.turns[1],e.turns[0]]})).toBe(false);
  expect(isPhoneCallEvidence({...e,turns:[{...e.turns[0],attribution:'uncertain'}]})).toBe(false);
 });
 it('bounds multilingual UTF-8 evidence and labels omitted turns',()=>{
  const e=capturePhoneCallEvidence(Array.from({length:24},()=>({role:'user',text:'ನಮಸ್ಕಾರ'.repeat(140)})),'provider_transcript');
  expect(e.truncated).toBe(true);expect(Buffer.byteLength(JSON.stringify(e))).toBeLessThan(17000);
 });
 it('retains questions, answers and their order',()=>{
  const e=capturePhoneCallEvidence([{role:'assistant',text:'Website status?'},{role:'user',text:'Pending.'},{role:'assistant',text:'When?'},{role:'user',text:'Within 2–3 days.'}],'provider_transcript');
  expect(phoneCallExchanges(e).map(x=>[x.question.text,x.answer.text])).toEqual([['Website status?','Pending.'],['When?','Within 2–3 days.']]);
  expect(e.taskOutcome).toBe('not_independently_verified');expect(e.verified).toBe(false);
 });
 it('does not attribute unknown speech or pair across missing turns',()=>{
  const e=capturePhoneCallEvidence([{role:'assistant',text:'When?'},{role:'other',text:'Unclear'},{role:'user',text:'Maybe.'}],'provider_transcript');
  expect(phoneCallExchanges(e)).toEqual([]);expect(e.turns[1]).toMatchObject({speaker:'unknown',attribution:'uncertain'});
  expect(phoneCallExchanges(capturePhoneCallEvidence([{role:'assistant',text:'When?'},{role:'user',text:''},{role:'user',text:'Sunday'}],'provider_transcript'))).toEqual([]);
 });
 it('labels translations, empty transcripts and truncation honestly',()=>{
  expect(capturePhoneCallEvidence([],'provider_transcript').turns).toEqual([]);
  const e=capturePhoneCallEvidence(Array.from({length:25},()=>({role:'user',text:'x'.repeat(1001)})),'provider_english_translation');
  expect(e.truncated).toBe(true);expect(e.turns.length).toBeLessThanOrEqual(24);expect(e.turns[0]?.text).toHaveLength(1000);expect(e.turns[0]?.source).toBe('provider_english_translation');
  expect(Buffer.byteLength(JSON.stringify(e))).toBeLessThan(65536);
 });
});
