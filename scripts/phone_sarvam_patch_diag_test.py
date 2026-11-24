"""Synthetic-only tests for deploy/hostinger-pilot/phone-sarvam-patch-diag.review.py.
Covers:
1. Minimal-request sequence (1 preflight GET -> >=15s interval -> 1 PATCH -> >=15s interval -> 1 readback GET).
2. Trusted suiteId verification and preservation of all 6 existing cases, metadata, global guardrails, and v6 mapping plan.
3. Idempotent partial-mutation recovery (when variables were already patched, skips PATCH: 1 GET, 0 mutations).
4. Sanitized HTTP 429 & error-response parsing (error.code, error.message, detail, Retry-After, rate-limit headers) with secret/ID redaction.
5. Distinguishing rate limits (with/without Retry-After) from quota/plan restrictions, permissions (401/403), credit exhaustion (402), and schema rejection (422).
6. Immediate stop on HTTP 429 without retry, duplicate-write prevention, and 3-request budget enforcement.
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
spec=importlib.util.spec_from_file_location('patch_diag',ROOT/'deploy/hostinger-pilot/phone-sarvam-patch-diag.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PLAN=json.loads((ROOT/'docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json').read_text())

SID='01K5T8A2MZQ4VE6XCJ0RDBHW70'
CID='01K5TAC4PZQ4VE6XCJ0RDBHW92'
EXISTING_IDS=[f'01K5T00000000000000000000{i}' for i in range(1,7)]

class FakeGuard:
 def __init__(self):
  self.fd=1;self.claimed=False;self.records=[];self.sequence=0;self.last_phase=None;self.last_error_diag=None
  self.summary={
   'trustedReceiptsMatched':False,
   'variablesPatched':False,
   'variablesVerified':False,
   'variablesAlreadyPresent':False,
   'existingCasesPreserved':0,
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
   self.summary['existingCasesPreserved']=int(data.get('existingCaseCount',0))
  elif phase=='variables_patched_empty_defaults':
   self.summary['variablesPatched']=True
  elif phase=='variables_verified_existing_cases_intact':
   self.summary['variablesVerified']=True
   self.summary['existingCasesPreserved']=int(data.get('existingCasesPreserved',6))
  elif phase=='variables_already_present_verified':
   self.summary['variablesAlreadyPresent']=True
   self.summary['variablesVerified']=True
   self.summary['existingCasesPreserved']=int(data.get('existingCasesPreserved',6))
  elif phase=='error_diagnostic_recorded':
   self.last_error_diag=data.get('errorDiagnostic')
  self.records.append(copy.deepcopy(data))
 def close(self):
  self.fd=None

class FakeHTTPResponse:
 def __init__(self,status,payload,headers=None):
  self.status=status;self._raw=json.dumps(payload).encode()
  msg=email.message.Message();msg['Content-Type']='application/json'
  for k,v in (headers or {}).items(): msg[k]=str(v)
  self.headers=msg
 def read(self,limit): return self._raw[:limit]
 def __enter__(self): return self
 def __exit__(self,*args): return False

def make_http_error(url,code,body_bytes,headers=None):
 msg=email.message.Message();msg['Content-Type']='application/json'
 for k,v in (headers or {}).items(): msg[k]=str(v)
 return urllib.error.HTTPError(url,code,'Error',msg,io.BytesIO(body_bytes))

class FakeSuiteServer:
 def __init__(self):
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
  self.initial_variables=[]
  self.last_run_status='completed'
  self.active_run_id=None
  self.mutate_after_patch=lambda d:d
 def suite_payload(self,variables):
  return {
   'test_suite_id':SID,
   'app_id':m.APP,
   'name':self.suite_name,
   'description':self.suite_desc,
   'global_guardrails':copy.deepcopy(self.suite_guardrails),
   'test_case_count':len(self.existing_cases),
   'variables':copy.deepcopy(variables),
   'test_cases':copy.deepcopy(self.existing_cases),
   'last_run_status':self.last_run_status,
   'active_run_id':self.active_run_id,
  }

class Tests(unittest.TestCase):
 def test_minimal_request_sequence_and_15s_interval_success(self):
  srv=FakeSuiteServer()
  sleeps=[]
  tr=m.Transport('sk_live_secret_key_value_123456',PLAN,sleep=sleeps.append)
  responses=[
   FakeHTTPResponse(200,srv.suite_payload([]),{'X-RateLimit-Limit':'60','X-RateLimit-Remaining':'59'}),
   FakeHTTPResponse(200,{'test_suite_id':SID},{'X-RateLimit-Limit':'60','X-RateLimit-Remaining':'58'}),
   FakeHTTPResponse(200,srv.suite_payload(m.empty_default_variables(PLAN)),{'X-RateLimit-Limit':'60','X-RateLimit-Remaining':'57'}),
  ]
  called=[]
  def open_fn(req,timeout=None):
   called.append((req.get_method(),req.full_url))
   return responses.pop(0)
  tr.opener.open=open_fn
  g=FakeGuard()
  out=m.evaluate_patch_diag(PLAN,tr,g,suite_id_resolver=lambda:SID)
  self.assertEqual(out['status'],'patch_diag_complete')
  self.assertTrue(out['trustedReceiptsMatched'])
  self.assertTrue(out['variablesPatched'])
  self.assertTrue(out['variablesVerified'])
  self.assertFalse(out['variablesAlreadyPresent'])
  self.assertEqual(out['existingCasesPreserved'],6)
  self.assertEqual(out['providerRequests'],3)
  self.assertEqual(out['providerMutations'],1)
  self.assertEqual(out['telephoneCalls'],0)
  # Exactly 1 GET before PATCH, 1 PATCH after 15.0s, and 1 readback GET after 15.0s
  self.assertEqual([c[0] for c in called],['GET','PATCH','GET'])
  self.assertEqual(sleeps,[15.0,15.0])

 def test_partial_mutation_already_applied_skips_patch_with_single_get(self):
  srv=FakeSuiteServer()
  sleeps=[]
  tr=m.Transport('sk_live_secret_key_value_123456',PLAN,sleep=sleeps.append)
  responses=[
   FakeHTTPResponse(200,srv.suite_payload(m.empty_default_variables(PLAN)),{}),
  ]
  tr.opener.open=lambda req,timeout=None:responses.pop(0)
  g=FakeGuard()
  out=m.evaluate_patch_diag(PLAN,tr,g,suite_id_resolver=lambda:SID)
  self.assertEqual(out['status'],'patch_diag_complete')
  self.assertFalse(out['variablesPatched'])
  self.assertTrue(out['variablesAlreadyPresent'])
  self.assertTrue(out['variablesVerified'])
  self.assertEqual(out['providerRequests'],1)
  self.assertEqual(out['providerMutations'],0)
  self.assertEqual(sleeps,[])

 def test_http_429_stops_immediately_without_retry_and_captures_sanitized_diagnostics(self):
  srv=FakeSuiteServer()
  sleeps=[]
  secret_key='sk_live_SUPER_SECRET_SARVAM_KEY_999'
  tr=m.Transport(secret_key,PLAN,sleep=sleeps.append)
  err_body=json.dumps({
   'error':{
    'code':'rate_limit_exceeded',
    'message':f'Rate limit exceeded for key {secret_key} on suite {SID} in app {m.APP} org 01a10103-1b5d-78a1-9902-f391242c7537',
   }
  }).encode()
  calls=[]
  def open_fn(req,timeout=None):
   calls.append(req.get_method())
   if len(calls)==1:
    return FakeHTTPResponse(200,srv.suite_payload([]),{'X-RateLimit-Limit':'60','X-RateLimit-Remaining':'59'})
   raise make_http_error(req.full_url,429,err_body,{'Retry-After':'60','X-RateLimit-Limit':'60','X-RateLimit-Remaining':'0'})
  tr.opener.open=open_fn
  g=FakeGuard()
  with self.assertRaises(m.Stop) as ctx:
   m.evaluate_patch_diag(PLAN,tr,g,suite_id_resolver=lambda:SID)
  err=ctx.exception
  self.assertEqual(err.category,'http_429')
  # Only 1 GET and 1 PATCH attempted; zero retries after 429
  self.assertEqual(calls,['GET','PATCH'])
  self.assertEqual(sleeps,[15.0])
  diag=err.diag
  self.assertIsNotNone(diag)
  self.assertEqual(diag['httpStatus'],429)
  self.assertEqual(diag['failedOperation'],'suite_patch')
  self.assertEqual(diag['errorCode'],'rate_limit_exceeded')
  self.assertEqual(diag['retryAfterSeconds'],60.0)
  self.assertEqual(diag['diagnosticClassification'],'rate_limit_window_with_retry_after')
  self.assertEqual(diag['rateLimitHeaders']['retry-after'],'60')
  self.assertEqual(diag['rateLimitHeaders']['x-ratelimit-remaining'],'0')
  # Secret key, ULID, UUID, and app_id are completely redacted from errorMessage
  self.assertNotIn(secret_key,diag['errorMessage'])
  self.assertNotIn(SID,diag['errorMessage'])
  self.assertNotIn(m.APP,diag['errorMessage'])
  self.assertNotIn('01a10103-1b5d-78a1-9902-f391242c7537',diag['errorMessage'])
  self.assertIn('[REDACTED]',diag['errorMessage'])
  self.assertIn('[ULID]',diag['errorMessage'])
  self.assertIn('[UUID]',diag['errorMessage'])

 def test_distinguishes_rate_limit_from_quota_permissions_credits_and_validation(self):
  # 1. Quota / plan restriction on HTTP 429
  d_quota=m.extract_sanitized_http_error(
   429,
   {'X-RateLimit-Limit':'60'},
   json.dumps({'error':{'code':'plan_quota_exceeded','message':'Suite variable quota exceeded for current plan tier'}}).encode(),
   'suite_patch',
  )
  self.assertEqual(d_quota['diagnosticClassification'],'quota_or_plan_restriction')
  self.assertEqual(d_quota['errorCode'],'plan_quota_exceeded')

  # 2. Rate limit message without Retry-After header on HTTP 429
  d_rate_no_hdr=m.extract_sanitized_http_error(
   429,
   {},
   json.dumps({'detail':'Rate limit exceeded for this caller.'}).encode(),
   'suite_patch',
  )
  self.assertEqual(d_rate_no_hdr['diagnosticClassification'],'rate_limit_without_retry_after_header')

  # 3. Silent endpoint/burst throttle on HTTP 429 (empty JSON, no Retry-After)
  d_burst=m.extract_sanitized_http_error(429,{},b'{}','suite_patch')
  self.assertEqual(d_burst['diagnosticClassification'],'endpoint_or_burst_throttled_without_retry_after')

  # 4. Permission / auth restriction on HTTP 403
  d_perm=m.extract_sanitized_http_error(
   403,
   {},
   json.dumps({'error':{'code':'forbidden','message':'The credential is not valid for this workspace.'}}).encode(),
   'suite_patch',
  )
  self.assertEqual(d_perm['diagnosticClassification'],'permission_or_auth_restriction')

  # 5. Credit exhaustion on HTTP 402
  d_credit=m.extract_sanitized_http_error(
   402,
   {},
   json.dumps({'details':'Insufficient credits. Please top up your wallet to continue.'}).encode(),
   'suite_patch',
  )
  self.assertEqual(d_credit['diagnosticClassification'],'quota_or_credit_exhausted')

  # 6. Validation / schema rejection on HTTP 422
  d_val=m.extract_sanitized_http_error(
   422,
   {},
   json.dumps({'detail':[{'loc':['body','variables'],'msg':'Extra inputs are not permitted','type':'extra_forbidden'}]}).encode(),
   'suite_patch',
  )
  self.assertEqual(d_val['diagnosticClassification'],'validation_or_schema_rejection')
  self.assertEqual(d_val['errorCode'],'extra_forbidden')

 def test_honors_60s_retry_after_header_from_preflight_get_and_blocks_excessive_delay(self):
  self.assertEqual(m.rate_limit_delay({'Retry-After':'60'},15.0),60.0)
  with self.assertRaises(m.Stop) as ctx:
   m.rate_limit_delay({'Retry-After':'120'},15.0)
  self.assertEqual(ctx.exception.category,'rate_limit_delay_exceeded')

 def test_prevents_duplicate_writes_unauthorized_endpoints_and_case_or_metadata_corruption(self):
  tr=m.Transport('synthetic-key',PLAN,sleep=lambda _:None)
  # Disallows list, mapping, test-case, and run endpoints in this minimal PATCH diagnostic
  for method,suffix,body in [
   ('GET','?app_id='+m.APP+'&limit=2&offset=0',None),
   ('POST','/'+SID+'/mappings',PLAN['mappingBody']),
   ('POST','/'+SID+'/test-cases',m.additive_case_body(PLAN)),
   ('POST','/'+SID+'/test-cases/'+CID+'/runs',PLAN['runBody']),
  ]:
   with self.assertRaises(m.Stop) as ctx:
    tr(method,suffix,body)
   self.assertEqual(ctx.exception.category,'endpoint_or_body_rejected')

  # Prevents duplicate PATCH even if called twice
  tr.opener.open=lambda req,timeout=None:FakeHTTPResponse(200,{'test_suite_id':SID},{})
  tr('PATCH','/'+SID,{'variables':m.empty_default_variables(PLAN)})
  with self.assertRaises(m.Stop) as ctx:
   tr('PATCH','/'+SID,{'variables':m.empty_default_variables(PLAN)})
  self.assertEqual(ctx.exception.category,'duplicate_write_rejected')

  # Detects if readback GET after PATCH shows altered existing cases or guardrails
  srv=FakeSuiteServer()
  tr2=m.Transport('synthetic-key',PLAN,sleep=lambda _:None)
  corrupted=srv.suite_payload(m.empty_default_variables(PLAN))
  corrupted['global_guardrails']=['Changed guardrail']
  responses=[
   FakeHTTPResponse(200,srv.suite_payload([]),{}),
   FakeHTTPResponse(200,{'test_suite_id':SID},{}),
   FakeHTTPResponse(200,corrupted,{}),
  ]
  tr2.opener.open=lambda req,timeout=None:responses.pop(0)
  with self.assertRaises(m.Stop) as ctx:
   m.evaluate_patch_diag(PLAN,tr2,FakeGuard(),suite_id_resolver=lambda:SID)
  self.assertEqual(ctx.exception.category,'suite_mismatch')

if __name__=='__main__':
 unittest.main()
