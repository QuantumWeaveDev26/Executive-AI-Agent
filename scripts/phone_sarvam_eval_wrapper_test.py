"""Local approval-boundary tests. A true gate exists only in a copied, checksum-invalid fixture; no keys/agents are accessed."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import uuid
import unittest

ROOT=Path(__file__).resolve().parents[1]
PS=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
HELPER='scripts/phone-sarvam-eval.review.ps1'
MANIFEST='docs/integrations/phone/PHONE_SARVAM_EVAL_EXECUTION.review.json'
FILES=[HELPER,'deploy/hostinger-pilot/phone-sarvam-eval.review.py','docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json']

class Tests(unittest.TestCase):
    def fixture(self):
        parent=ROOT/'node_modules/.cache';parent.mkdir(parents=True,exist_ok=True)
        target=parent/('eval-wrapper-test-'+uuid.uuid4().hex)
        target.mkdir() # Public synthetic fixtures; inherit workspace ACL, no credentials.
        def cleanup():
            resolved=target.resolve()
            self.assertEqual(resolved.parent,parent.resolve())
            self.assertTrue(resolved.name.startswith('eval-wrapper-test-'))
            self.assertFalse(target.is_symlink())
            shutil.rmtree(resolved)
        self.addCleanup(cleanup)
        for path in FILES:
            dest=target/path;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/path,dest)
        self.manifest={'reviewOnly':True,'remoteExecutionAllowed':False,'artifacts':[{'path':p,'sha256':hashlib.sha256((target/p).read_bytes()).hexdigest()} for p in FILES]}
        (target/MANIFEST).parent.mkdir(parents=True,exist_ok=True)
        return target
    def run_wrapper(self,target,args):
        (target/MANIFEST).write_text(json.dumps(self.manifest))
        p=subprocess.run([str(PS),'-NoProfile','-NonInteractive','-File',str(target/HELPER),*args],capture_output=True,text=True,timeout=10)
        return p.returncode,json.loads(p.stdout)
    def test_missing_artifact_set_rejected_before_authentication(self):
        target=self.fixture();self.manifest['artifacts']=[]
        code,result=self.run_wrapper(target,['-ReviewOnly'])
        self.assertNotEqual(code,0);self.assertEqual(result['phase'],'review');self.assertTrue(result['cleanupVerified'])
    def test_review_only_never_authenticates(self):
        code,result=self.run_wrapper(self.fixture(),['-ReviewOnly'])
        self.assertEqual(code,0);self.assertEqual(result['mode'],'review_only');self.assertFalse(result['plaintextPrivateKeyFiles'])
    def test_execution_denied_with_false_gate(self):
        code,result=self.run_wrapper(self.fixture(),['-ApprovedSyntheticEval'])
        self.assertNotEqual(code,0);self.assertEqual(result['phase'],'review');self.assertTrue(result['cleanupVerified'])
    def test_hash_mismatch_denied_before_authentication(self):
        target=self.fixture();self.manifest['artifacts'][0]['sha256']='0'*64
        code,result=self.run_wrapper(target,['-ReviewOnly'])
        self.assertNotEqual(code,0);self.assertEqual(result['phase'],'review')
    def test_wrong_artifact_and_nonboolean_gate_rejected(self):
        for mutate in [lambda m:m['artifacts'][0].update(path='unexpected'),lambda m:m.update(remoteExecutionAllowed='true')]:
            target=self.fixture();mutate(self.manifest)
            code,result=self.run_wrapper(target,['-ApprovedSyntheticEval'])
            self.assertNotEqual(code,0);self.assertEqual(result['phase'],'review')
    def test_conflicting_modes_denied_before_authentication(self):
        code,result=self.run_wrapper(self.fixture(),['-ReviewOnly','-ApprovedSyntheticEval'])
        self.assertNotEqual(code,0);self.assertEqual(result['phase'],'review')
    def test_approved_gate_is_reset_even_when_checksum_validation_stops_before_authentication(self):
        target=self.fixture();self.manifest['remoteExecutionAllowed']=True
        self.manifest['artifacts'][0]['sha256']='0'*64
        code,result=self.run_wrapper(target,['-ApprovedSyntheticEval'])
        self.assertNotEqual(code,0);self.assertEqual(result['phase'],'review')
        self.assertIs(json.loads((target/MANIFEST).read_text())['remoteExecutionAllowed'],False)

if __name__=='__main__':unittest.main()
