"""Local copied-package approval & synthetic SSH transport tests for minimal-request diagnostic PATCH package.
No credentials, SSH agents, or network connections are used.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest

spec=importlib.util.spec_from_file_location('base_tests',Path(__file__).with_name('phone_sarvam_eval_wrapper_test.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
base.HELPER='scripts/phone-sarvam-patch-diag.review.ps1'
base.MANIFEST='docs/integrations/phone/PHONE_SARVAM_PATCH_DIAG.review.json'
base.FILES=[base.HELPER,'deploy/hostinger-pilot/phone-sarvam-patch-diag.review.py','docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json']

WRAPPER_TEXT=(base.ROOT/base.HELPER).read_text(encoding='utf-8')
FN_MATCH=re.search(r'(function Invoke-OwnedProcess[\s\S]+?\n\})',WRAPPER_TEXT)
assert FN_MATCH is not None,'Invoke-OwnedProcess not found in wrapper'
INVOKE_FN=FN_MATCH.group(1)

class Tests(base.Tests):
 def run_wrapper(self,target,args):
  return super().run_wrapper(target,[a.replace('-ApprovedSyntheticEval','-ApprovedPatchDiag') for a in args])

 def test_wrapper_parses_sanitized_http_429_error_diagnostic_from_remote_stdout(self):
  remote_json=json.dumps({
   'status':'stopped',
   'category':'http_429',
   'lastPhase':'preconditions_verified',
   'receiptCount':3,
   'providerRequests':2,
   'providerMutations':1,
   'providerAcceptanceVerified':False,
   'telephoneCalls':0,
   'trustedReceiptsMatched':True,
   'variablesPatched':False,
   'variablesVerified':False,
   'variablesAlreadyPresent':False,
   'existingCasesPreserved':6,
   'runSubmissionFencePresent':False,
   'hasRunId':False,
   'errorDiagnostic':{
    'httpStatus':429,
    'failedOperation':'suite_patch',
    'errorBodyShape':'json_object',
    'errorCode':'rate_limit_exceeded',
    'errorMessage':'Rate limit exceeded for this caller.',
    'retryAfterSeconds':60.0,
    'rateLimitHeaders':{'retry-after':'60','x-ratelimit-remaining':'0'},
    'diagnosticClassification':'rate_limit_window_with_retry_after',
   },
  })
  child=f"import sys; print({remote_json!r}, flush=True); sys.exit(1)"
  ps_script=(
   "$ErrorActionPreference='Stop'\n"
   + INVOKE_FN + "\n"
   + f"$remote=Invoke-OwnedProcess '{sys.executable}' @('-B','-c',@'\n{child}\n'@) 'payload' @{{}} 5000\n"
   + "$facts=$remote.Text|ConvertFrom-Json\n"
   + "@{category=$facts.category;classification=$facts.errorDiagnostic.diagnosticClassification;retryAfter=$facts.errorDiagnostic.retryAfterSeconds;stdinDelivered=$remote.StdinDelivered}|ConvertTo-Json -Compress\n"
  )
  proc=subprocess.run([str(base.PS),'-NoProfile','-NonInteractive','-Command',ps_script],
   capture_output=True,text=True,timeout=15)
  self.assertEqual(proc.returncode,0,msg=proc.stderr)
  parsed=json.loads(proc.stdout.strip())
  self.assertEqual(parsed['category'],'http_429')
  self.assertEqual(parsed['classification'],'rate_limit_window_with_retry_after')
  self.assertEqual(parsed['retryAfter'],60.0)
  self.assertTrue(parsed['stdinDelivered'])

if __name__=='__main__':
 unittest.main()
