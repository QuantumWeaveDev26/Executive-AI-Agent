"""Synthetic receipt analysis for phone-sarvam-429-readonly.review.py; no VPS, provider or credential access."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('reader429',Path(__file__).resolve().parents[1]/'deploy/hostinger-pilot/phone-sarvam-429-readonly.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SID,MID,CID,RID=['01K5T8A2MZQ4VE6XCJ0RDBHW7'+str(i) for i in range(4)]
records=[
 {'phase':'claimed','providerAcceptanceVerified':False},
 {'phase':'preconditions_verified','suiteId':SID,'existingCaseCount':6,'existingVariableCount':0,'mappingAbsent':True},
 {'phase':'variables_patched_empty_defaults','suiteId':SID},
 {'phase':'variables_verified_existing_cases_intact','suiteId':SID,'existingCasesPreserved':6},
 {'phase':'mapping_created','suiteId':SID,'mapId':MID},
 {'phase':'case_added','suiteId':SID,'caseId':CID,'mapId':MID},
 {'phase':'before_run','suiteId':SID,'caseId':CID,'appVersion':6,'frequency':1,'existingCasesPreserved':6},
 {'phase':'run_id_received_unverified','suiteId':SID,'caseId':CID,'runId':RID},
 {'phase':'run_created','suiteId':SID,'caseId':CID,'runId':RID},
]

class Tests(unittest.TestCase):
 def test_each_phase_prefix_identifies_exact_candidate_operations(self):
  for count,expected_ops in enumerate(m.CANDIDATES,start=1):
   r=m.summarize(records[:count])
   self.assertEqual(r['receiptCount'],count)
   self.assertEqual(r['lastPhase'],m.PHASES[count-1])
   self.assertEqual(r['candidateOperations'],expected_ops)
   self.assertFalse(r['providerQueried'])
   self.assertFalse(r['billingReconciled'])

 def test_private_identifiers_never_returned(self):
  text=str(m.summarize(records))
  for secret in (SID,MID,CID,RID,'suiteId','mapId','caseId','runId'):
   self.assertNotIn(secret,text)

 def test_invalid_sequence_or_mismatched_ids_rejected(self):
  for bad in [
   [{'phase':'unknown'}],
   records[1:],
   records[:1]+[{**records[1],'existingCaseCount':5}],
   records[:2]+[{**records[2],'suiteId':MID}],
  ]:
   with self.assertRaises(m.Rejected): m.summarize(bad)

 def test_default_review_mode_is_inert(self):
  self.assertEqual(m.main([])['status'],'review_only')

if __name__=='__main__': unittest.main()
