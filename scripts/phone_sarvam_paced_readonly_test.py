"""Synthetic unit tests for deploy/hostinger-pilot/phone-sarvam-paced-readonly.review.py."""
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('paced_ro',ROOT/'deploy/hostinger-pilot/phone-sarvam-paced-readonly.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

SID='01K5T8A2MZQ4VE6XCJ0RDBHW70'
MID='01K5T9B3NZQ4VE6XCJ0RDBHW81'
CID='01K5TAC4PZQ4VE6XCJ0RDBHW92'
RID='01K5TBD5QZQ4VE6XCJ0RDBHWA3'

class Tests(unittest.TestCase):
 def test_summarize_partial_and_completed_receipts(self):
  partial=[
   {'phase':'claimed','providerAcceptanceVerified':False},
   {'phase':'preconditions_verified','suiteId':SID,'existingCaseCount':6,'variablesAlreadyPresent':False,'mappingAlreadyPresent':False,'caseAlreadyPresent':False},
  ]
  s1=m.summarize(partial)
  self.assertEqual(s1['status'],'readonly_complete')
  self.assertTrue(s1['guardDirectoryPresent'])
  self.assertEqual(s1['receiptCount'],2)
  self.assertEqual(s1['lastPhase'],'preconditions_verified')
  self.assertFalse(s1['completedRunRecorded'])
  full=partial+[
   {'phase':'variables_patched_empty_defaults','suiteId':SID},
   {'phase':'variables_verified_existing_cases_intact','suiteId':SID,'existingCasesPreserved':6},
   {'phase':'mapping_created','suiteId':SID,'mapId':MID},
   {'phase':'case_added','suiteId':SID,'caseId':CID,'mapId':MID},
   {'phase':'before_run','suiteId':SID,'caseId':CID,'appVersion':6,'frequency':1,'existingCasesPreserved':6},
   {'phase':'run_id_received_unverified','suiteId':SID,'caseId':CID,'runId':RID},
   {'phase':'run_created','suiteId':SID,'caseId':CID,'runId':RID},
   {'status':'completed_requires_manual_review','suiteId':SID,'caseId':CID,'runId':RID,'appVersion':6,
    'existingCasesPreserved':6,'providerJudgePassed':True,'passedChecks':5,'totalChecks':5,
    'evaluationChecks':[{'name':'Check','verdict':'Pass','reasoning':'ok'}],
    'transcriptTurns':[{'role':'assistant','text':'Hi'}],
    'transcriptSha256':'a'*64},
  ]
  s2=m.summarize(full)
  self.assertEqual(s2['receiptCount'],10)
  self.assertTrue(s2['completedRunRecorded'])
  self.assertTrue(s2['providerJudgePassed'])
  self.assertEqual(s2['passedChecks'],5)
  self.assertEqual(len(s2['transcriptTurns']),1)

 def test_rejects_mismatched_ids_or_unknown_phases(self):
  with self.assertRaises(m.Rejected):
   m.summarize([{'phase':'unknown_phase','providerAcceptanceVerified':False}])
  with self.assertRaises(m.Rejected):
   m.summarize([
    {'phase':'claimed','providerAcceptanceVerified':False},
    {'phase':'preconditions_verified','suiteId':SID},
    {'phase':'variables_patched_empty_defaults','suiteId':MID},
   ])

 def test_default_review_only(self):
  self.assertEqual(m.main([])['status'],'review_only')

if __name__=='__main__': unittest.main()
