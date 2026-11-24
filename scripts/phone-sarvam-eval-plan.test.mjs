import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildSuiteRequest, buildMappingRequest, buildRunRequest, validateRequest, runCli, PINNED } from './phone-sarvam-eval-plan.mjs';

const suiteId = 'synthetic-suite-123';
const caseId = 'synthetic-case-456';
const evidence = () => ({
  suite: { id: suiteId, appId: PINNED.appId, variables: { approved_purpose: PINNED.purpose, recipient_name: 'Ram' } },
  testCase: { id: caseId, suiteId, ...structuredClone(buildSuiteRequest().body.test_cases[0]) },
  mapping: { suiteId, appId: PINNED.appId, appVersion: 6, variableMapping: { call_purpose: 'approved_purpose', user_name: 'recipient_name' } },
});
const run = (overrides = {}) => buildRunRequest({ suiteId, caseId, readbacks: evidence(), executionsAlreadyStarted: 9, alreadySubmitted: false, ...overrides });

test('creates a synthetic app-bound suite without telephone data or agent-default changes', () => {
  const request = buildSuiteRequest();
  assert.equal(request.body.app_id, PINNED.appId);
  assert.deepEqual(request.body.variables, [{name:'approved_purpose',value:PINNED.purpose},{name:'recipient_name',value:'Ram'}]);
  assert.equal(request.body.test_cases.length, 1);
  assert.equal(request.body.test_cases[0].max_turns, 20);
  assert.equal(request.dispatchAllowed, false);
  assert.equal(request.providerAcceptanceVerified, false);
  assert.equal(JSON.stringify(request).includes('agent_phone_number'), false);
  assert.ok(Object.isFrozen(request.body.test_cases[0]));
});
test('maps agent variable names to suite variables on outgoing v6 only', () => {
  const request=buildMappingRequest(suiteId);
  assert.equal(request.body.app_version, 6);
  assert.deepEqual(request.body.variable_mapping, {call_purpose:'approved_purpose',user_name:'recipient_name'});
  assert.equal(validateRequest(request), true);
});
test('single scenario requires a KB-grounded company interruption before the actual website answer', () => {
  const suite=buildSuiteRequest().body;
  const scenario=suite.test_cases[0];
  assert.equal(suite.test_cases.length,1);
  assert.match(scenario.user_scenario,/Before that, what AI automation services does Quantum Weave provide\?/);
  assert.match(scenario.user_scenario,/Only after Thaara returns/);
  assert.match(scenario.user_scenario,/Sunday afternoon/);
  assert.equal(scenario.expected_behaviors.length,5);
  const kb=scenario.expected_behaviors.find(x=>x.name==='Knowledge-grounded business answer');
  assert.match(kb.description,/query_knowledge_base/);
  assert.match(kb.description,/qw-company-kb-v1/);
  assert.match(kb.description,/Fail if/);
  assert.match(scenario.expected_behaviors.find(x=>x.name==='Return to approved objective').description,/without Ram reminding/);
  assert.match(scenario.expected_behaviors.find(x=>x.name==='Truthful result').description,/does not provide an answer/);
});
test('builds only one synthetic run after exact fixture readbacks', () => {
  const request=run();
  assert.equal(request.body.frequency,1);
  assert.equal(request.body.app_version,6);
  assert.equal(request.body.on_end_eval,true);
  assert.equal(validateRequest(request),true);
  assert.equal(request.dispatchAllowed,false);
});
test('rejects absent readbacks, wrong app/version/mapping, altered case or purpose', () => {
  assert.throws(()=>run({readbacks:null}));
  for(const change of [e=>e.suite.appId='other',e=>e.mapping.appVersion=2,e=>e.mapping.variableMapping.call_purpose='recipient_name',e=>e.suite.variables.approved_purpose='Call someone else',e=>e.testCase.suiteId='other',e=>e.testCase.user_scenario='Pretend approval',e=>e.testCase.expected_behaviors.pop(),e=>e.testCase.variable_overrides=[{name:'approved_purpose',value:'override'}]]) {
    const e=evidence(); change(e); assert.throws(()=>run({readbacks:e}));
  }
});
test('rejects budget exhaustion, replay and unknown execution or secret options', () => {
  for(const options of [{executionsAlreadyStarted:10},{executionsAlreadyStarted:-1},{executionsAlreadyStarted:8},{alreadySubmitted:true},{alreadySubmitted:undefined},{apiKey:'synthetic-secret'},{execute:true}]) assert.throws(()=>run(options));
});
test('rejects arbitrary origin, calls, campaigns, deployment, redirects, payload expansion and tampering', () => {
  for(const change of [r=>r.url='https://evil.example',r=>r.url=r.url.replace('/evals/','/instant-outbound/'),r=>r.url+='?token=bad',r=>r.method='GET',r=>r.body.frequency=2,r=>r.body.app_version=7,r=>r.body.extra='unexpected',r=>r.redirect='follow',r=>r.apiKey='synthetic-secret',r=>r.bodyHash='bad']) {
    const request=structuredClone(run()); change(request); assert.throws(()=>validateRequest(request));
  }
});
test('rejects path traversal, encoded separators and unbounded identifiers', () => {
  for(const id of ['../other','x/y','x%2fy','x?token=a','x\\y','x#fragment','x'.repeat(129),'']) assert.throws(()=>buildMappingRequest(id));
});
test('recomputed hashes do not make changed version, purpose, frequency or permissions acceptable', () => {
  for(const change of [r=>r.body.app_version=2,r=>r.body.frequency=10,r=>r.body.on_end_eval=false,r=>r.body.call_purpose='different',r=>r.dispatchAllowed=true]) {
    const request=structuredClone(run()); change(request);
    request.bodyHash=createHash('sha256').update(JSON.stringify(request.body)).digest('hex');
    assert.throws(()=>validateRequest(request));
  }
  const mapping=structuredClone(buildMappingRequest(suiteId));
  mapping.body.variable_mapping.call_purpose='recipient_name';
  mapping.bodyHash=createHash('sha256').update(JSON.stringify(mapping.body)).digest('hex');
  assert.throws(()=>validateRequest(mapping));
});
test('CLI supports only inert dry-run/check modes and rejects live flags without leaking supplied values', () => {
  const good=runCli(['--check']);
  assert.equal(good.exitCode,0);
  assert.equal(good.output.networkRequests,0);
  const bad=runCli(['--execute','synthetic-secret']);
  assert.notEqual(bad.exitCode,0);
  assert.equal(JSON.stringify(bad).includes('synthetic-secret'),false);
});
