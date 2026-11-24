import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareNoPricingReview} from './prepare-phone-no-pricing.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const kb=read('docs/integrations/phone/knowledge/review-v1/quantum-weave-public.md');
const prompt=read('docs/integrations/phone/knowledge/language-fix-v2/inbound-instructions.proposed.txt');
test('removes historical amounts while preserving service and training facts',()=>{
 const r=prepareNoPricingReview(kb,prompt);
 assert.doesNotMatch(r.knowledge,/₹|\b(?:999|9,999|14,999)\b/);
 for(const heading of ['Business focus and solutions','Implementation-first learning']){
  const section=text=>text.split('## '+heading+'\n')[1].split('\n## ')[0];
  assert.equal(section(r.knowledge),section(kb));
 }
});
test('states custom requirements and forbids quotes even when asked',()=>{
 const r=prepareNoPricingReview(kb,prompt);
 assert.match(r.knowledge,/custom solutions based on.*requirements/i);
 assert.match(r.instructions,/Never quote.*historical.*ranges.*discounts/i);
 assert.match(r.instructions,/even if the caller asks/i);
 assert.match(r.instructions,/English, Kannada, Hindi/i);
 assert.doesNotMatch(r.instructions,/Published ladder prices/);
});
test('preserves inbound direction, language switching, duration and action restrictions',()=>{
 const r=prepareNoPricingReview(kb,prompt);
 for(const line of prompt.split('\n').filter(x=>/CALL DIRECTION:|Match a caller|No promises|Keep existing owner|End politely|Never reveal/.test(x)))assert.ok(r.instructions.includes(line));
 assert.equal(r.manifest.reviewOnly,true);
 assert.equal(r.manifest.uploadAuthorized,false);
 assert.equal(r.manifest.liveIntegration,false);
 assert.equal(r.manifest.targetAgentVersion,null);
});
test('does not confuse customer no-pricing policy with telephony cost controls',()=>{
 const r=prepareNoPricingReview(kb,prompt);
 assert.match(r.instructions,/provider billing.*remain unchanged/);
 assert.match(r.instructions,/not authorize.*external action/);
});
test('rejects changed baseline rather than silently generating from different knowledge',()=>{
 assert.throws(()=>prepareNoPricingReview(kb+'changed',prompt),/BASELINE_MISMATCH/);
 assert.throws(()=>prepareNoPricingReview(kb,prompt+'changed'),/BASELINE_MISMATCH/);
});
