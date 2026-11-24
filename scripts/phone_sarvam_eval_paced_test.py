"""Synthetic-only tests for deploy/hostinger-pilot/phone-sarvam-eval-paced.review.py.
Covers:
1. Post-PATCH & post-mapping flow reusing trusted (suiteId, mapId), skipping PATCH and POST /mappings,
   appending the 7th case if absent without redundant readback GET, and running only the 7th case once.
2. >=22s inter-request pacing, <=3 requests per 62s rolling window, and 30s run-polling intervals.
3. Rate-limit header compliance up to 65s (Retry-After: 60) and HTTP 429 immediate stop with sanitized diagnostics.
4. Partial-completion idempotent recovery when the 7th test case is already present.
5. Duplicate-write prevention, PATCH/POST-mappings/list endpoint exclusion, and failure/unknown-outcome recovery.
"""
import copy
import email.message
import importlib.util
import io
import json
from pathlib import Path
import urllib.error
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('eval_paced',ROOT/'deploy/hostinger-pilot/phone-sarvam-eval-paced.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PLAN=json.loads((ROOT/'docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json').read_text())

SID='01K5T8A2MZQ4VE6XCJ0RDBHW70'
MID='01K5T9B3NZQ4VE6XCJ0RDBHW81'
CID='01K5TAC4PZQ4VE6XCJ0RDBHW92'
RID='01K5TBD5QZQ4VE6XCJ0RDBHWA3'
EXISTING_IDS=[f'01K5T00000000000000000000{i}' for i in range(1,7)]

class FakeGuard:
 def __init__(self):
  self.fd=1;self.claimed=False;self.records=[];self.sequence=0;self.last_phase=None;self.last_output=None;self.last_error_diag=None
  self.summary={
   'trustedReceiptsMatched':False,
   'variablesPatched':False,
   'variablesAlreadyPresent':False,
   'mappingCreated':False,
   'mappingAlreadyPresent':False,
   'caseAdded':False,
   'caseAlreadyPresent':False,
   'runSubmissionFencePresent':False,
   'hasRunId':False,
  }
 def claim(self):
  if self.claimed: raise m.Stop('already_claimed')
  self.claimed=True;self.record({'phase':'claimed','providerAcceptanceVerified':False})
 def record(self,data):
  self.sequence+=1
  phase=data.get('phase') or data.get('status')
  if isinstance(phase,str): self.last_phase=phase
  if phase=='preconditions_verified':
   self.summary['trustedReceiptsMatched']=bool(data.get('trustedReceiptsMatched'))
   self.summary['variablesAlreadyPresent']=bool(data.get('variablesAlreadyPresent'))
  elif phase=='variables_already_present_verified':
   self.summary['variablesAlreadyPresent']=True
  elif phase=='mapping_created':
   self.summary['mappingCreated']=True
  elif phase=='mapping_already_present_verified':
   self.summary['mappingAlreadyPresent']=True
  elif phase=='case_added':
   self.summary['caseAdded']=True
  elif phase=='case_already_present_verified':
   self.summary['caseAlreadyPresent']=True
  elif phase=='before_run':
   self.summary['runSubmissionFencePresent']=True
  elif phase in ('run_id_received_unverified','run_created'):
   self.summary['hasRunId']=True
  elif phase=='error_diagnostic_recorded':
   self.last_error_diag=data.get('errorDiagnostic')
  elif data.get('status')=='completed_requires_manual_review':
   self.last_output=data
  self.records.append(copy.deepcopy(data))
 def close(self):
  self.fd=None

class FakeTransport:
 def __init__(self):
  self.calls=[]
  self.suite_name='Existing-Thaara-Suite'
  self.suite_desc='Existing description preserved'
  self.suite_guardrails=['Existing guardrail 1','Existing guardrail 2']
  self.existing_cases=[
   {
    'test_case_id':eid,
    'name':f'EXISTING_{idx}',
    'category':'StageB',
    'user_scenario':f'Scenario {idx}',
    'expected_behaviors':[{'name':'Check','description':'Desc'}],
    'variable_overrides':[],
    'max_turns':15,
   }
   for idx,eid in enumerate(EXISTING_IDS)
  ]
  self.initial_variables=m.empty_default_variables(PLAN)
  self.initial_mapping={'map_id':MID,'test_suite_id':SID,'app_id':m.APP,**copy.deepcopy(PLAN['mappingBody'])}
  self.initial_seventh_case=False
  self.last_run_status='completed'
  self.last_run_scope=None
  self.active_run_id=None
  self.verdicts=['Pass']*5
  self.poll_statuses=['running','completed']
  self.fail_429_on=None
 def _added_case(self):
  c={'test_case_id':CID,**copy.deepcopy(m.additive_case_body(PLAN))}
  for b in c['expected_behaviors']: b['behavior_id']='server_assigned_beh_id'
  return c
 def _base_suite(self,variables,cases):
  return {
   'test_suite_id':SID,
   'app_id':m.APP,
   'name':self.suite_name,
   'description':self.suite_desc,
   'global_guardrails':copy.deepcopy(self.suite_guardrails),
   'test_case_count':len(cases),
   'variables':copy.deepcopy(variables),
   'test_cases':copy.deepcopy(cases),
   'last_run_status':self.last_run_status,
   'last_run_scope':self.last_run_scope,
   'active_run_id':self.active_run_id,
  }
 def __call__(self,method,suffix,body=None,expect_status=None,min_delay=m.MIN_PACE_SECONDS):
  self.calls.append((method,suffix,copy.deepcopy(body),expect_status,min_delay))
  if self.fail_429_on==(method,suffix):
   raise m.Stop('http_429',{'httpStatus':429,'failedOperation':'synthetic','diagnosticClassification':'rate_limit_window_with_retry_after'})
  detail_gets=sum(1 for mth,sfx,_,_,_ in self.calls if mth=='GET' and sfx=='/'+SID)
  init_cases=self.existing_cases+([self._added_case()] if self.initial_seventh_case else [])
  if method=='GET' and suffix=='/'+SID and detail_gets==1:
   return self._base_suite(self.initial_variables,init_cases)
  if method=='GET' and suffix=='/'+SID+'/mappings?app_id='+m.APP and expect_status==200:
   return copy.deepcopy(self.initial_mapping)
  if method=='POST' and suffix=='/'+SID+'/test-cases':
   return {'test_case_id':CID,'test_suite_id':SID}
  if method=='POST' and suffix=='/'+SID+'/test-cases/'+CID+'/runs':
   return {'run_id':RID,'test_suite_id':SID,'scope':'test_case','status':'created'}
  if method=='GET' and suffix=='/'+SID+'/runs/'+RID:
   poll_idx=sum(1 for mth,sfx,_,_,_ in self.calls if mth=='GET' and sfx=='/'+SID+'/runs/'+RID)-1
   st=self.poll_statuses[min(poll_idx,len(self.poll_statuses)-1)]
   return {'run_id':RID,'test_suite_id':SID,'app_id':m.APP,'app_version':6,'scope':'test_case','status':st,'frequency':1,'total_executions':1,'completed_executions':1 if st=='completed' else 0}
  if method=='GET' and suffix=='/'+SID+'/runs/'+RID+'/test-cases/'+CID:
   req_names=[x['name'] for x in PLAN['suiteRequest']['body']['test_cases'][0]['expected_behaviors']]
   evals=[{'name':n,'verdict':v,'reasoning':'verified'} for n,v in zip(req_names,self.verdicts)]
   return {'run_id':RID,'test_case_id':CID,'executions':[{'run_id':RID,'test_suite_id':SID,'test_case_id':CID,'frequency_index':0,'transcript':[{'role':'assistant','content':'Hello Ram'},{'role':'user','content':'Sunday afternoon'}],'evaluation_results':evals}]}
  raise AssertionError(f'unexpected call: {method} {suffix} {expect_status}')

class FakeHTTPResponse:
 def __init__(self,status,payload,headers=None):
  self.status=status;self._raw=json.dumps(payload).encode()
  msg=email.message.Message();msg['Content-Type']='application/json'
  for k,v in (headers or {}).items(): msg[k]=str(v)
  self.headers=msg
 def read(self,limit): return self._raw[:limit]
 def __enter__(self): return self
 def __exit__(self,*args): return False

class Tests(unittest.TestCase):
 def test_post_mapping_paced_flow_skips_patch_and_mapping_post_and_uses_22s_and_30s_pacing(self):
  g=FakeGuard();t=FakeTransport()
  out=m.evaluate_paced(PLAN,t,g,ids_resolver=lambda:(SID,MID))
  self.assertEqual(out['status'],'completed_requires_manual_review')
  self.assertEqual(out['existingCasesPreserved'],6)
  self.assertTrue(out['trustedReceiptsMatched'])
  self.assertFalse(out['variablesPatched'])
  self.assertTrue(out['variablesAlreadyPresent'])
  self.assertFalse(out['mappingCreated'])
  self.assertTrue(out['mappingAlreadyPresent'])
  self.assertTrue(out['caseAdded'])
  self.assertFalse(out['caseAlreadyPresent'])
  self.assertEqual(len(out['evaluationChecks']),5)
  self.assertEqual(len(out['transcriptTurns']),2)
  # Zero PATCH, POST /mappings, or redundant readback GET /{sid} after POST /test-cases
  self.assertEqual([c for c in t.calls if c[0]=='PATCH'],[])
  self.assertEqual([c for c in t.calls if c[0]=='POST' and c[1].endswith('/mappings')],[])
  self.assertEqual(sum(1 for c in t.calls if c[0]=='GET' and c[1]=='/'+SID),1)
  # Setup/result calls use 22.0s min_delay; run poll calls use 30.0s min_delay
  poll_calls=[c for c in t.calls if c[0]=='GET' and c[1]=='/'+SID+'/runs/'+RID]
  non_poll_calls=[c for c in t.calls if not (c[0]=='GET' and c[1]=='/'+SID+'/runs/'+RID)]
  self.assertEqual([c[4] for c in poll_calls],[30.0,30.0])
  self.assertTrue(all(c[4]==22.0 for c in non_poll_calls))

 def test_stops_if_suite_variables_missing_and_rejects_patch_mapping_post_or_list_endpoints(self):
  g=FakeGuard();t=FakeTransport();t.initial_variables=[]
  with self.assertRaises(m.Stop) as ctx:
   m.evaluate_paced(PLAN,t,g,ids_resolver=lambda:(SID,MID))
  self.assertEqual(ctx.exception.category,'variables_not_present')
  # Transport rejects GET list, PATCH, and POST /mappings endpoints
  tr=m.Transport('synthetic-key',PLAN,sleep=lambda _:None)
  for method,suffix,body in [
   ('GET','?app_id='+m.APP+'&limit=2&offset=0',None),
   ('PATCH','/'+SID,{'variables':m.empty_default_variables(PLAN)}),
   ('POST','/'+SID+'/mappings',PLAN['mappingBody']),
  ]:
   with self.assertRaises(m.Stop) as ctx2:
    tr(method,suffix,body)
   self.assertEqual(ctx2.exception.category,'endpoint_or_body_rejected')

 def test_rate_limit_headers_up_to_65s_rolling_window_and_transport_pacing(self):
  self.assertEqual(m.rate_limit_delay({'Retry-After':'60'},22.0),60.0)
  self.assertEqual(m.rate_limit_delay({'X-RateLimit-Reset-After':'25.5'},22.0),25.5)
  self.assertEqual(m.rate_limit_delay({'X-RateLimit-Remaining':'0','RateLimit-Reset':'45'},22.0),45.0)
  self.assertEqual(m.rate_limit_delay({'X-RateLimit-Remaining':'5','RateLimit-Reset':'45'},22.0),22.0)
  with self.assertRaises(m.Stop) as ctx:
   m.rate_limit_delay({'Retry-After':'90'},22.0)
  self.assertEqual(ctx.exception.category,'rate_limit_delay_exceeded')
  # Rolling window check: if 3 requests occurred at t=0, 15, 30 and now=45, 4th request must wait 17s (62 - 45)
  self.assertEqual(m.rolling_window_delay([0.0,15.0,30.0],45.0),17.0)
  self.assertEqual(m.rolling_window_delay([0.0,22.0,44.0],66.0),0.0)
  # Transport enforces both min_delay and rolling_window_delay
  clock=[0.0]
  sleeps=[]
  def fake_sleep(sec):
   sleeps.append(round(sec,2))
   clock[0]+=sec
  tr=m.Transport('synthetic-key',PLAN,sleep=fake_sleep,clock=lambda:clock[0])
  responses=[
   FakeHTTPResponse(200,{'test_suite_id':SID},{'Retry-After':'25'}),
   FakeHTTPResponse(200,{'test_suite_id':SID},{}),
   FakeHTTPResponse(200,{'test_suite_id':SID},{}),
   FakeHTTPResponse(200,{'test_suite_id':SID},{}),
  ]
  tr.opener.open=lambda req,timeout=None:responses.pop(0)
  tr('GET','/'+SID) # t=0.0
  tr('GET','/'+SID) # sleeps 25.0 -> t=25.0
  tr('GET','/'+SID) # sleeps 22.0 -> t=47.0
  tr('GET','/'+SID) # 4th request: min_delay=22.0 -> t=69.0 (>= 62.0s after t=0.0)
  self.assertEqual(sleeps,[25.0,22.0,22.0])

 def test_http_429_stops_immediately_without_retry_and_captures_sanitized_diagnostics(self):
  for target in [
   ('GET','/'+SID+'/mappings?app_id='+m.APP),
   ('POST','/'+SID+'/test-cases'),
   ('POST','/'+SID+'/test-cases/'+CID+'/runs'),
  ]:
   g=FakeGuard();t=FakeTransport();t.fail_429_on=target
   with self.assertRaises(m.Stop) as ctx:
    m.evaluate_paced(PLAN,t,g,ids_resolver=lambda:(SID,MID))
   self.assertEqual(ctx.exception.category,'http_429')
   matching=[c for c in t.calls if (c[0],c[1])==target]
   self.assertEqual(len(matching),1)
  sleeps=[]
  secret_key='sk_live_SECRET_KEY_VALUE'
  tr=m.Transport(secret_key,PLAN,sleep=sleeps.append)
  def raise_429(req,timeout=None):
   body=json.dumps({'error':{'code':'rate_limit_exceeded','message':f'Limit hit for {secret_key} on {SID}'}}).encode()
   msg=email.message.Message();msg['Retry-After']='60'
   raise urllib.error.HTTPError(req.full_url,429,'Too Many Requests',msg,io.BytesIO(body))
  tr.opener.open=raise_429
  with self.assertRaises(m.Stop) as ctx:
   tr('POST','/'+SID+'/test-cases',m.additive_case_body(PLAN))
  self.assertEqual(ctx.exception.category,'http_429')
  self.assertEqual(sleeps,[])
  self.assertEqual(ctx.exception.diag['diagnosticClassification'],'rate_limit_window_with_retry_after')
  self.assertEqual(ctx.exception.diag['retryAfterSeconds'],60.0)
  self.assertNotIn(secret_key,ctx.exception.diag['errorMessage'])
  self.assertNotIn(SID,ctx.exception.diag['errorMessage'])

 def test_partial_completion_recovery_when_seventh_case_already_present(self):
  g=FakeGuard();t=FakeTransport()
  t.initial_seventh_case=True
  out=m.evaluate_paced(PLAN,t,g,ids_resolver=lambda:(SID,MID))
  self.assertEqual(out['status'],'completed_requires_manual_review')
  self.assertFalse(out['mappingCreated'])
  self.assertTrue(out['mappingAlreadyPresent'])
  self.assertFalse(out['caseAdded'])
  self.assertTrue(out['caseAlreadyPresent'])
  writes=[c for c in t.calls if c[0]!='GET']
  self.assertEqual(len(writes),1)
  self.assertEqual(writes[0][1],'/'+SID+'/test-cases/'+CID+'/runs')

 def test_stops_on_conflicting_mapping_active_run_poll_exhaustion_or_duplicate_write(self):
  g=FakeGuard();t=FakeTransport()
  t.initial_mapping={'map_id':MID,'test_suite_id':SID,'app_id':m.APP,**copy.deepcopy(PLAN['mappingBody']),'app_version':5}
  with self.assertRaises(m.Stop) as ctx:
   m.evaluate_paced(PLAN,t,g,ids_resolver=lambda:(SID,MID))
  self.assertEqual(ctx.exception.category,'mapping_mismatch')
  self.assertEqual([c for c in t.calls if c[0]!='GET'],[])

  g=FakeGuard();t=FakeTransport();t.last_run_status='running'
  with self.assertRaises(m.Stop) as ctx:
   m.evaluate_paced(PLAN,t,g,ids_resolver=lambda:(SID,MID))
  self.assertEqual(ctx.exception.category,'run_state_unverified')
  self.assertFalse(g.summary['runSubmissionFencePresent'])

  g=FakeGuard();t=FakeTransport();t.poll_statuses=['running']*10
  with self.assertRaises(m.Stop) as ctx:
   m.evaluate_paced(PLAN,t,g,ids_resolver=lambda:(SID,MID))
  self.assertEqual(ctx.exception.category,'poll_limit_outcome_unverified')
  run_posts=[c for c in t.calls if c[0]=='POST' and c[1].endswith('/runs')]
  self.assertEqual(len(run_posts),1)

  tr=m.Transport('synthetic-key',PLAN,sleep=lambda _:None)
  tr.opener.open=lambda req,timeout=None:FakeHTTPResponse(201,{'test_case_id':CID,'test_suite_id':SID},{})
  tr('POST','/'+SID+'/test-cases',m.additive_case_body(PLAN))
  with self.assertRaises(m.Stop) as ctx:
   tr('POST','/'+SID+'/test-cases',m.additive_case_body(PLAN))
  self.assertEqual(ctx.exception.category,'duplicate_write_rejected')

if __name__=='__main__':
 unittest.main()
