"""Reuse local copied-package approval tests; never authenticate or read credentials."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('base_tests',Path(__file__).with_name('phone_sarvam_eval_wrapper_test.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
base.HELPER='scripts/phone-sarvam-409-readonly.review.ps1'
base.MANIFEST='docs/integrations/phone/PHONE_SARVAM_409_READONLY.review.json'
base.FILES=[base.HELPER,'deploy/hostinger-pilot/phone-sarvam-409-readonly.review.py']
class Tests(base.Tests):
 def run_wrapper(self,target,args):
  return super().run_wrapper(target,[a.replace('-ApprovedSyntheticEval','-ApprovedReadOnly409') for a in args])
if __name__=='__main__':unittest.main()
