"""Synthetic receipt analysis only; no VPS, provider or credential access."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('reader',Path(__file__).resolve().parents[1]/'deploy/hostinger-pilot/phone-sarvam-409-readonly.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SID,MID,CID,RID=['01K5T8A2MZQ4VE6XCJ0RDBHW7'+str(i) for i in range(4)]
records=[{'phase':'claimed','providerAcceptanceVerified':False},{'phase':'suite_created','suiteId':SID},
 {'phase':'mapping_created','suiteId':SID,'caseId':CID,'mapId':MID},
 {'phase':'before_run','suiteId':SID,'caseId':CID,'appVersion':6,'frequency':1},
 {'phase':'run_id_received_unverified','suiteId':SID,'caseId':CID,'runId':RID},
 {'phase':'run_created','suiteId':SID,'caseId':CID,'runId':RID}]

class Tests(unittest.TestCase):
 def test_claim_only_identifies_initial_create_request(self):
  r=m.summarize(records[:1]);self.assertEqual(r['candidateOperations'],['create_suite']);self.assertFalse(r['hasSuiteId'])
 def test_suite_receipt_does_not_overclaim_which_next_endpoint_failed(self):
  self.assertEqual(m.summarize(records[:2])['candidateOperations'],['read_suite','create_mapping'])
 def test_mapping_and_run_fences_identify_next_operation(self):
  self.assertEqual(m.summarize(records[:3])['candidateOperations'],['read_mapping'])
  self.assertEqual(m.summarize(records[:4])['candidateOperations'],['submit_run'])
 def test_run_receipt_limits_to_read_operations(self):
  r=m.summarize(records);self.assertEqual(r['candidateOperations'],['poll_run','read_results']);self.assertTrue(r['hasRunId'])
 def test_private_identifiers_and_raw_record_values_never_returned(self):
  text=str(m.summarize(records));self.assertNotIn(SID,text);self.assertNotIn(RID,text);self.assertNotIn('suiteId',text)
 def test_unknown_phase_bad_sequence_mismatched_identity_or_extra_fields_rejected(self):
  for bad in [[{'phase':'synthetic-secret'}],records[1:],records[:1]+[{'phase':'suite_created','suiteId':'synthetic-secret'}],
              records[:2]+[{**records[2],'suiteId':MID}],records[:1]+[{**records[1],'token':'synthetic-secret'}]]:
   with self.assertRaises(m.Rejected):m.summarize(bad)
 def test_review_default_does_not_open_any_remote_path(self):
  self.assertEqual(m.main([])['status'],'review_only')
 def test_pending_unverified_id_is_not_mistaken_for_an_http_failure_endpoint(self):
  self.assertEqual(m.summarize(records[:5])['candidateOperations'],['inconsistent_with_http_409_sequence'])

if __name__=='__main__':unittest.main()
