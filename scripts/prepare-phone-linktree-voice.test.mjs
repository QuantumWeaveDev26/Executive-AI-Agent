import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {prepareLinktreeVoice, listeningPolicy, knowledgeVersion} from './prepare-phone-linktree-voice.mjs';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const dir='docs/integrations/phone/knowledge/';
const inbound=read(dir+'listening-fix-20261106/inbound-listening.candidate.txt');
const outbound=read(dir+'appointment-candidates-20261106/outbound-instructions.candidate.txt');

test('both directions use the same short-turn policy and preserve approved call boundaries',()=>{
 const drafts=prepareLinktreeVoice(inbound,outbound);
 for(const [direction,prompt] of Object.entries(drafts)){
  assert.ok(prompt.startsWith(`CALL DIRECTION: ${direction.toUpperCase()}.`));
  assert.ok(prompt.includes(`Knowledge: ${knowledgeVersion}.`));
  assert.equal(prompt.split(listeningPolicy).length,2);
  assert.match(prompt,/Never provide prices/);
  assert.match(prompt,/owner’s separate approval and a verified event/);
 }
 assert.match(drafts.outbound,/\{\{user_name\}\}/);
 assert.match(drafts.outbound,/\{\{call_purpose\}\}/);
 assert.doesNotMatch(drafts.inbound,/\{\{call_purpose\}\}/);
});

test('changed source prompts fail closed before producing a candidate',()=>{
 assert.throws(()=>prepareLinktreeVoice(inbound+'changed',outbound),/PHONE_LINKTREE_BASELINE_MISMATCH/);
 assert.throws(()=>prepareLinktreeVoice(inbound,outbound+'changed'),/PHONE_LINKTREE_BASELINE_MISMATCH/);
});
