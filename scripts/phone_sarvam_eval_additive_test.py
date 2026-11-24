"""Synthetic-only tests for deploy/hostinger-pilot/phone-sarvam-eval-additive.review.py."""
import copy,importlib.util,json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('eval_additive',ROOT/'deploy/hostinger-pilot/phone-sarvam-eval-additive.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PLAN=json.loads((ROOT/'docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json').read_text())

SID='01K5T8A2MZQ4VE6XCJ0RDBHW70'
MID='01K5T9B3NZQ4VE6XCJ0RDBHW81'
CID='01K5TAC4PZQ4VE6XCJ0RDBHW92'
RID='01K5TBD5QZQ4VE6XCJ0RDBHWA3'
EXISTING_IDS=[f'01K5T00000000000000000000{i}' for i in range(1,7)]

class FakeGuard:
 def __init__(self): self.claimed=False;self.records=[]
 def claim(self):
  if self.claimed: raise m.Stop('already_claimed')
  self.claimed=True;self.record({'phase':'claimed','providerAcceptanceVerified':False})
 def record(self,data): self.records.append(copy.deepcopy(data))

class FakeTransport:
 def __init__(self):
  self.calls=[]
  self.suite_name='Existing-Thaara-Suite'
  self.suite_desc='Existing description preserved'
  self.suite_guardrails=['Existing guardrail 1','Existing guardrail 2']
  self.existing_cases=[{'test_case_id':eid,'name':f'EXISTING_{idx}','category':'StageB','user_scenario':f'Scenario {idx}','expected_behaviors':[{'name':'Check','description':'Desc'}],'variable_overrides':[],'max_turns':15} for idx,eid in enumerate(EXISTING_IDS)]
  self.verdicts=['Pass']*5
  self.pre_mapping_404=True
  self.run_status='completed'
  self.mutate_after_patch=lambda d:d
  self.mutate_after_add=lambda d:d
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
  }
 def __call__(self,method,suffix,body=None,expect_status=None):
  self.calls.append((method,suffix,copy.deepcopy(body),expect_status))
  detail_gets=sum(1 for mth,sfx,_,_ in self.calls if mth=='GET' and sfx=='/'+SID)
  if method=='GET' and suffix==m.LIST_SUFFIX:
   return {'items':[{'test_suite_id':SID,'app_id':m.APP,'test_case_count':6}],'total':1,'limit':2,'offset':0,'next_page_uri':None,'prev_page_uri':None}
  if method=='GET' and suffix=='/'+SID and detail_gets==1:
   return self._base_suite([],self.existing_cases)
  if method=='GET' and suffix=='/'+SID+'/mappings?app_id='+m.APP and expect_status==404:
   return None if self.pre_mapping_404 else {'map_id':MID}
  if method=='PATCH' and suffix=='/'+SID:
   return {'test_suite_id':SID}
  if method=='GET' and suffix=='/'+SID and detail_gets==2:
   return self.mutate_after_patch(self._base_suite(m.empty_default_variables(PLAN),self.existing_cases))
  if method=='POST' and suffix=='/'+SID+'/mappings':
   return {'map_id':MID}
  if method=='GET' and suffix=='/'+SID+'/mappings?app_id='+m.APP and expect_status is None:
   return {'map_id':MID,'test_suite_id':SID,'app_id':m.APP,**copy.deepcopy(PLAN['mappingBody'])}
  if method=='POST' and suffix=='/'+SID+'/test-cases':
   return {'test_case_id':CID,'test_suite_id':SID}
  if method=='GET' and suffix=='/'+SID and detail_gets==3:
   added_case={'test_case_id':CID,**copy.deepcopy(m.additive_case_body(PLAN))}
   for b in added_case['expected_behaviors']: b['behavior_id']='server_assigned_beh_id'
   return self.mutate_after_add(self._base_suite(m.empty_default_variables(PLAN),self.existing_cases+[added_case]))
  if method=='POST' and suffix=='/'+SID+'/test-cases/'+CID+'/runs':
   return {'run_id':RID,'test_suite_id':SID,'scope':'test_case','status':'created'}
  if method=='GET' and suffix=='/'+SID+'/runs/'+RID:
   return {'run_id':RID,'test_suite_id':SID,'app_id':m.APP,'app_version':6,'scope':'test_case','status':self.run_status,'frequency':1,'total_executions':1,'completed_executions':1}
  if method=='GET' and suffix=='/'+SID+'/runs/'+RID+'/test-cases/'+CID:
   req_names=[x['name'] for x in PLAN['suiteRequest']['body']['test_cases'][0]['expected_behaviors']]
   evals=[{'name':n,'verdict':v,'reasoning':'ok'} for n,v in zip(req_names,self.verdicts)]
   return {'run_id':RID,'test_case_id':CID,'executions':[{'run_id':RID,'test_suite_id':SID,'test_case_id':CID,'frequency_index':0,'transcript':[{'role':'assistant','content':'Hi'}],'evaluation_results':evals}]}
  raise AssertionError(f'unexpected call: {method} {suffix}')

class Tests(unittest.TestCase):
 def test_additive_eval_preserves_six_cases_guardrails_settings_and_runs_single_case(self):
  g=FakeGuard();t=FakeTransport()
  out=m.evaluate_additive(PLAN,t,g,sleep=lambda _:None)
  self.assertEqual(out['status'],'completed_requires_manual_review')
  self.assertEqual(out['existingCasesPreserved'],6)
  self.assertEqual(out['appVersion'],6)
  self.assertEqual(out['telephoneCalls'],0)
  self.assertFalse(out['providerAcceptanceVerified'])
  self.assertTrue(out['providerJudgePassed'])
  # 1. PATCH sends only empty-default variables; never overwrites name, description, or global_guardrails
  patch_calls=[c for c in t.calls if c[0]=='PATCH']
  self.assertEqual(len(patch_calls),1)
  self.assertEqual(patch_calls[0][2],{'variables':[{'name':'approved_purpose','value':''},{'name':'recipient_name','value':''}]})
  # 2. POST /test-cases supplies non-empty values strictly via case-scoped variable_overrides
  add_calls=[c for c in t.calls if c[0]=='POST' and c[1]=='/'+SID+'/test-cases']
  self.assertEqual(len(add_calls),1)
  self.assertEqual(add_calls[0][2]['variable_overrides'],PLAN['suiteRequest']['body']['variables'])
  # 3. Single-case run endpoint is called once; suite-wide run is never called
  run_calls=[c for c in t.calls if c[0]=='POST' and '/runs' in c[1]]
  self.assertEqual(len(run_calls),1)
  self.assertEqual(run_calls[0][1],'/'+SID+'/test-cases/'+CID+'/runs')

 def test_stops_before_mapping_if_patch_alters_guardrails_name_or_existing_cases(self):
  for mut in [
   lambda d:{**d,'global_guardrails':['changed']},
   lambda d:{**d,'name':'changed'},
   lambda d:{**d,'test_cases':d['test_cases'][:5]},
  ]:
   g=FakeGuard();t=FakeTransport();t.mutate_after_patch=mut
   with self.assertRaises(m.Stop): m.evaluate_additive(PLAN,t,g,sleep=lambda _:None)
   # Stopped right after GET-after-PATCH; never called POST /mappings, POST /test-cases, or POST /runs
   self.assertEqual([c[0] for c in t.calls],['GET','GET','GET','PATCH','GET'])

 def test_stops_before_write_if_mapping_already_exists(self):
  g=FakeGuard();t=FakeTransport();t.pre_mapping_404=False
  with self.assertRaises(m.Stop): m.evaluate_additive(PLAN,t,g,sleep=lambda _:None)
  self.assertEqual([c[0] for c in t.calls],['GET','GET','GET'])

 def test_simulation_failure_does_not_repeat_or_reverse_writes_and_blocks_second_attempt(self):
  g=FakeGuard();t=FakeTransport();t.run_status='failed'
  with self.assertRaises(m.Stop) as ctx: m.evaluate_additive(PLAN,t,g,sleep=lambda _:None)
  self.assertEqual(str(ctx.exception),'provider_run_failed')
  # Exactly 1 PATCH, 1 POST /mappings, 1 POST /test-cases, 1 POST /runs; no rollback or retry
  self.assertEqual([c[0] for c in t.calls if c[0]!='GET'],['PATCH','POST','POST','POST'])
  # Second attempt on same guard is blocked before any HTTP call
  t2=FakeTransport()
  with self.assertRaises(m.Stop) as ctx2: m.evaluate_additive(PLAN,t2,g,sleep=lambda _:None)
  self.assertEqual(str(ctx2.exception),'already_claimed')
  self.assertEqual(t2.calls,[])

 def test_transport_rejects_duplicate_writes_suite_post_suite_run_or_wrong_patch_body(self):
  tr=m.Transport('synthetic-key',PLAN)
  for method,suffix,body in [
   ('POST','',PLAN['suiteRequest']['body']),
   ('POST','/'+SID+'/runs',PLAN['runBody']),
   ('PATCH','/'+SID,{'variables':PLAN['suiteRequest']['body']['variables']}),
   ('DELETE','/'+SID,None),
  ]:
   with self.assertRaises(m.Stop): tr(method,suffix,body)
  # Simulate a write kind already attempted; second attempt of same write kind must raise duplicate_write_rejected
  tr.writes_attempted.add('run_post')
  with self.assertRaises(m.Stop) as ctx: tr('POST','/'+SID+'/test-cases/'+CID+'/runs',PLAN['runBody'])
  self.assertEqual(str(ctx.exception),'duplicate_write_rejected')

 def test_default_review_mode_is_inert(self):
  self.assertEqual(m.main([],None)['status'],'review_only')

if __name__=='__main__': unittest.main()
