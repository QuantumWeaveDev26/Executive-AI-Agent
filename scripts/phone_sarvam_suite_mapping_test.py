"""Synthetic-only existing-suite mapping lookup tests. No network, credential or remote access."""
import copy,importlib.util,json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('mapping',ROOT/'deploy/hostinger-pilot/phone-sarvam-suite-mapping.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PLAN=json.loads((ROOT/'docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json').read_text())
SID='01K5T8A2MZQ4VE6XCJ0RDBHW70'
MID='01K5T9B3NZQ4VE6XCJ0RDBHW81'
class Fake:
 def __init__(self):
  self.calls=[];self.change=lambda kind,data:data
 def __call__(self,path):
  self.calls.append(path)
  if len(self.calls)==1:
   row={'test_suite_id':SID,'name':'unprinted-existing-suite-name','app_id':m.APP,'test_case_count':6,'last_run_status':'completed'}
   return self.change('list',{'items':[row],'total':1,'limit':2,'offset':0,'next_page_uri':None,'prev_page_uri':None})
  return self.change('mapping',{'map_id':MID,'test_suite_id':SID,'app_id':m.APP,**copy.deepcopy(PLAN['mappingBody'])})
class Tests(unittest.TestCase):
 def test_two_read_paths_and_full_v6_match_without_returning_identifiers_or_values(self):
  f=Fake();r=m.inspect_mapping(PLAN,f)
  self.assertEqual(len(f.calls),2);self.assertEqual(f.calls[0],m.LIST_PATH);self.assertEqual(f.calls[1],'/'+SID+m.MAPPING_SUFFIX)
  self.assertTrue(r['versionBindingChecked']);self.assertTrue(r['mappingPresent']);self.assertTrue(r['fullMappingMatchesProposedV6'])
  self.assertEqual(r['finding'],'mapping_matches_proposed_v6');self.assertEqual(r['mappedAppVersion'],6);self.assertEqual(r['caseCount'],6)
  for private in (SID,MID,m.APP,'unprinted-existing-suite-name','approved_purpose','recipient_name'):self.assertNotIn(private,json.dumps(r))
 def test_mapping_absent_404_is_reported_cleanly_as_read_only_finding(self):
  f=Fake();f.change=lambda kind,d:None if kind=='mapping' else d
  r=m.inspect_mapping(PLAN,f)
  self.assertEqual(len(f.calls),2);self.assertEqual(r['finding'],'mapping_absent');self.assertFalse(r['mappingPresent'])
  self.assertIsNone(r['mappedAppVersion']);self.assertFalse(r['fullMappingMatchesProposedV6']);self.assertTrue(r['versionBindingChecked'])
 def test_mapping_for_other_version_or_different_variables_is_distinguished(self):
  f=Fake();f.change=lambda kind,d:{**d,'app_version':5} if kind=='mapping' else d
  r=m.inspect_mapping(PLAN,f)
  self.assertEqual(r['finding'],'mapping_present_other_version');self.assertEqual(r['mappedAppVersion'],5)
  self.assertFalse(r['mappedVersionMatchesTargetV6']);self.assertTrue(r['variableMappingMatchesProposed']);self.assertFalse(r['fullMappingMatchesProposedV6'])
  f2=Fake();f2.change=lambda kind,d:{**d,'variable_mapping':{'call_purpose':'other_var'}} if kind=='mapping' else d
  r2=m.inspect_mapping(PLAN,f2)
  self.assertEqual(r2['finding'],'mapping_present_v6_different_variables');self.assertTrue(r2['mappedVersionMatchesTargetV6'])
  self.assertFalse(r2['callPurposeMappedToProposed']);self.assertFalse(r2['userNameMappedToProposed']);self.assertFalse(r2['fullMappingMatchesProposedV6'])
  self.assertNotIn('other_var',json.dumps(r2))
 def test_empty_filtered_list_never_reads_mapping(self):
  f=Fake();f.change=lambda kind,d:{**d,'items':[],'total':0} if kind=='list' else d
  r=m.inspect_mapping(PLAN,f);self.assertEqual(len(f.calls),1);self.assertEqual(r['finding'],'no_app_suite_visible');self.assertFalse(r['versionBindingChecked'])
 def test_wrong_app_multiple_rows_or_pagination_stop_before_mapping(self):
  for change in [lambda d:d['items'][0].update(app_id='other'),lambda d:d.update(total=2,items=d['items']*2),lambda d:d.update(next_page_uri='https://evil.example')]:
   f=Fake()
   def mutate(kind,d):
    if kind=='list':change(d)
    return d
   f.change=mutate
   with self.assertRaises(m.Rejected):m.inspect_mapping(PLAN,f)
   self.assertEqual(len(f.calls),1)
 def test_mapping_identity_mismatch_or_invalid_version_rejected(self):
  for change in [lambda d:d.update(app_id='other'),lambda d:d.update(test_suite_id='01K5T8A2MZQ4VE6XCJ0RDBHW71'),lambda d:d.update(map_id='bad'),lambda d:d.update(app_version=0)]:
   f=Fake()
   def mutate(kind,d):
    if kind=='mapping':change(d)
    return d
   f.change=mutate
   with self.assertRaises(m.Rejected):m.inspect_mapping(PLAN,f)
 def test_transport_rejects_other_query_origin_write_and_extra_requests(self):
  t=m.ReadOnlyMappingTransport('synthetic-secret')
  for path in ['https://evil.example','?app_id=other','/../calls','/'+SID,'/'+SID+'/mappings','/'+SID+'/runs']:
   with self.assertRaises(m.Rejected):t(path)
  t.count=2
  with self.assertRaises(m.Rejected):t(m.LIST_PATH)
 def test_tampered_plan_rejected_without_request(self):
  p=copy.deepcopy(PLAN);p['appVersion']=2;f=Fake()
  with self.assertRaises(m.Rejected):m.inspect_mapping(p,f)
  self.assertEqual(f.calls,[])
 def test_default_review_mode_is_inert(self):
  self.assertEqual(m.main([],None)['status'],'review_only')
if __name__=='__main__':unittest.main()
