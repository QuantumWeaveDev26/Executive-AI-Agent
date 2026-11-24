"""Local copied-package approval tests for paced receipt reader; no credentials/agents/provider access."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('base_tests',Path(__file__).with_name('phone_sarvam_eval_wrapper_test.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
base.HELPER='scripts/phone-sarvam-paced-readonly.review.ps1'
base.MANIFEST='docs/integrations/phone/PHONE_SARVAM_PACED_READONLY.review.json'
base.FILES=[base.HELPER,'deploy/hostinger-pilot/phone-sarvam-paced-readonly.review.py']
class Tests(base.Tests):
 def run_wrapper(self,target,args):return super().run_wrapper(target,[a.replace('-ApprovedSyntheticEval','-ApprovedReadOnlyPaced') for a in args])
if __name__=='__main__':unittest.main()
