"""Synthetic-only metadata lookup tests. No network, credential or remote access."""
import copy,importlib.util,json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('metadata',ROOT/'deploy/hostinger-pilot/phone-sarvam-suite-metadata.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PLAN=json.loads((ROOT/'docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json').read_text())
SID='01K5T8A2MZQ4VE6XCJ0RDBHW70'
class Fake:
 def __init__(self):
  self.calls=[];self.change=lambda kind,data:data
 def __call__(self,path):
  self.calls.append(path)
  if len(self.calls)==1:
   row={'test_suite_id':SID,'name':PLAN['suiteRequest']['body']['name'],'app_id':m.APP,'test_case_count':1,'last_run_status':'completed'}
   return self.change('list',{'items':[row],'total':1,'limit':2,'offset':0,'next_page_uri':None,'prev_page_uri':None})
  return self.change('detail',{'test_suite_id':SID,'test_case_count':1,**copy.deepcopy(PLAN['suiteRequest']['body'])})
class Tests(unittest.TestCase):
 def test_two_read_paths_and_full_match_without_returning_values(self):
  f=Fake();r=m.inspect_metadata(PLAN,f)
  self.assertEqual(len(f.calls),2);self.assertEqual(f.calls[0],m.LIST_PATH)
  self.assertTrue(r['fullConfigurationMatchesProposed']);self.assertFalse(r['conflictCauseConfirmed'])
  for private in (SID,m.APP,PLAN['suiteRequest']['body']['name'],PLAN['suiteRequest']['body']['variables'][0]['value']):self.assertNotIn(private,json.dumps(r))
 def test_empty_filtered_list_never_reads_details(self):
  f=Fake();f.change=lambda kind,d:{**d,'items':[],'total':0} if kind=='list' else d
  r=m.inspect_metadata(PLAN,f);self.assertEqual(len(f.calls),1);self.assertEqual(r['finding'],'no_app_suite_visible')
 def test_server_assigned_behavior_identifiers_do_not_change_semantic_configuration_match(self):
  f=Fake()
  def mutate(kind,d):
   if kind=='detail':
    d['test_cases'][0]['test_case_id']=SID
    for behavior in d['test_cases'][0]['expected_behaviors']:behavior['behavior_id']='unprinted-private-id'
   return d
  f.change=mutate;r=m.inspect_metadata(PLAN,f)
  self.assertTrue(r['fullConfigurationMatchesProposed']);self.assertNotIn('unprinted-private-id',json.dumps(r))
 def test_same_app_different_name_and_configuration_are_reported_as_differences_not_proof(self):
  f=Fake()
  def change(kind,d):
   if kind=='list':d['items'][0]['name']='unprinted-private-name'
   else:d.update(name='unprinted-private-name',variables=[],global_guardrails=[],test_cases=[],test_case_count=0)
   if kind=='list':d['items'][0]['test_case_count']=0
   return d
  f.change=change;r=m.inspect_metadata(PLAN,f)
  self.assertEqual(r['finding'],'same_app_different_name_present');self.assertFalse(r['fullConfigurationMatchesProposed']);self.assertFalse(r['conflictCauseConfirmed'])
  self.assertNotIn('unprinted-private-name',json.dumps(r))
 def test_wrong_app_multiple_rows_or_pagination_stop_before_detail(self):
  for change in [lambda d:d['items'][0].update(app_id='other'),lambda d:d.update(total=2,items=d['items']*2),lambda d:d.update(next_page_uri='https://evil.example')]:
   f=Fake()
   def mutate(kind,d):
    if kind=='list':change(d)
    return d
   f.change=mutate
   with self.assertRaises(m.Rejected):m.inspect_metadata(PLAN,f)
   self.assertEqual(len(f.calls),1)
 def test_detail_identity_mismatch_duplicate_variables_or_count_mismatch_rejected(self):
  for change in [lambda d:d.update(app_id='other'),lambda d:d.update(test_suite_id='01K5T8A2MZQ4VE6XCJ0RDBHW71'),lambda d:d['variables'].append(d['variables'][0]),lambda d:d.update(test_case_count=2)]:
   f=Fake()
   def mutate(kind,d):
    if kind=='detail':change(d)
    return d
   f.change=mutate
   with self.assertRaises(m.Rejected):m.inspect_metadata(PLAN,f)
 def test_exception_or_timeout_is_not_retried(self):
  f=Fake()
  def fail(*_):raise m.Rejected('network_failure')
  f.change=fail
  with self.assertRaises(m.Rejected):m.inspect_metadata(PLAN,f)
  self.assertEqual(len(f.calls),1)
 def test_transport_rejects_other_query_origin_write_and_extra_requests(self):
  t=m.ReadOnlyTransport('synthetic-secret')
  for path in ['https://evil.example','?app_id=other','/../calls','/'+SID+'/mappings','/'+SID+'/runs']:
   with self.assertRaises(m.Rejected):t(path)
  t.count=2
  with self.assertRaises(m.Rejected):t(m.LIST_PATH)
 def test_tampered_plan_rejected_without_request(self):
  p=copy.deepcopy(PLAN);p['appVersion']=2;f=Fake()
  with self.assertRaises(m.Rejected):m.inspect_metadata(p,f)
  self.assertEqual(f.calls,[])
 def test_default_review_mode_is_inert(self):
  self.assertEqual(m.main([],None)['status'],'review_only')
if __name__=='__main__':unittest.main()
