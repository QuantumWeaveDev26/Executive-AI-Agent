"""Local copied-package approval & synthetic SSH transport tests for rate-paced Stage B v6 eval.
Covers large payloads (>64 KB), connection delays, blocked stdin, early termination, dropped connections, and timeouts.
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
base.HELPER='scripts/phone-sarvam-eval-paced.review.ps1'
base.MANIFEST='docs/integrations/phone/PHONE_SARVAM_EVAL_PACED.review.json'
base.FILES=[base.HELPER,'deploy/hostinger-pilot/phone-sarvam-eval-paced.review.py','docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json']

WRAPPER_TEXT=(base.ROOT/base.HELPER).read_text(encoding='utf-8')
FN_MATCH=re.search(r'(function Invoke-OwnedProcess[\s\S]+?\n\})',WRAPPER_TEXT)
assert FN_MATCH is not None,'Invoke-OwnedProcess not found in wrapper'
INVOKE_FN=FN_MATCH.group(1)

CLASSIFY_SNIPPET=r"""
$phase='pinned_paced_eval_ssh'
if($remote.TimedOut){
 $output=@{status='stopped';category='ssh_command_timeout';phase=$phase;sshExitCode=$remote.Code;stdinDelivered=[bool]$remote.StdinDelivered;stdinFaulted=[bool]$remote.StdinFaulted;hostRecordMatched=$true;telephoneCalls=0;providerAcceptanceVerified=$false}
}elseif([string]::IsNullOrWhiteSpace($remote.Text)){
 $sshCategory=if($remote.Code -eq 255){'ssh_transport_or_handshake_failed'}elseif($remote.StdinFaulted){'ssh_stdin_broken_pipe'}else{'ssh_empty_stdout'}
 $output=@{status='stopped';category=$sshCategory;phase=$phase;sshExitCode=$remote.Code;stdinDelivered=[bool]$remote.StdinDelivered;stdinFaulted=[bool]$remote.StdinFaulted;hostRecordMatched=$true;telephoneCalls=0;providerAcceptanceVerified=$false}
}else{
 $facts=$null
 try{$facts=$remote.Text|ConvertFrom-Json -ErrorAction Stop}catch{$facts=$null}
 if($null -eq $facts){
  $output=@{status='stopped';category='remote_json_parse_failed';phase=$phase;sshExitCode=$remote.Code;stdinDelivered=[bool]$remote.StdinDelivered;stdinFaulted=[bool]$remote.StdinFaulted;hostRecordMatched=$true;telephoneCalls=0;providerAcceptanceVerified=$false}
 }else{
  $output=@{status=$facts.status;category=$facts.category;sha256=$facts.sha256;sshExitCode=$remote.Code;stdinDelivered=[bool]$remote.StdinDelivered;stdinFaulted=[bool]$remote.StdinFaulted}
 }
}
$output|ConvertTo-Json -Compress
"""

class Tests(base.Tests):
 def run_wrapper(self,target,args):
  return super().run_wrapper(target,[a.replace('-ApprovedSyntheticEval','-ApprovedPacedEval') for a in args])

 def run_synthetic_ssh(self,py_child_code,input_size=65000,timeout_ms=10000):
  payload='X'*input_size
  expected_sha=hashlib.sha256(payload.encode('utf-8')).hexdigest()
  ps_script=(
   "$ErrorActionPreference='Stop'\n"
   + INVOKE_FN + "\n"
   + f"$payload='X'*{input_size}\n"
   + f"$remote=Invoke-OwnedProcess '{sys.executable}' @('-B','-c',@'\n{py_child_code}\n'@) $payload @{{}} {timeout_ms}\n"
   + CLASSIFY_SNIPPET
  )
  proc=subprocess.run([str(base.PS),'-NoProfile','-NonInteractive','-Command',ps_script],
   capture_output=True,text=True,timeout=15)
  self.assertEqual(proc.returncode,0,msg=proc.stderr)
  self.assertNotIn('SECRET_STDERR_LEAK',proc.stdout)
  return json.loads(proc.stdout.strip()),expected_sha

 def test_synthetic_ssh_large_payload_with_connection_delay(self):
  child=(
   "import hashlib, json, sys, time\n"
   "time.sleep(0.8)\n"
   "data = sys.stdin.buffer.read()\n"
   "print(json.dumps({'status':'completed_requires_manual_review','category':None,'sha256':hashlib.sha256(data).hexdigest()}),flush=True)\n"
  )
  out,expected_sha=self.run_synthetic_ssh(child,input_size=65000,timeout_ms=10000)
  self.assertEqual(out['status'],'completed_requires_manual_review')
  self.assertEqual(out['sha256'],expected_sha)
  self.assertTrue(out['stdinDelivered'])
  self.assertFalse(out['stdinFaulted'])
  self.assertEqual(out['sshExitCode'],0)

 def test_synthetic_ssh_blocked_stdin_and_early_exit_255(self):
  child=(
   "import sys, time\n"
   "sys.stderr.write('SECRET_STDERR_LEAK\\n'); sys.stderr.flush()\n"
   "time.sleep(0.15)\n"
   "sys.exit(255)\n"
  )
  out,_=self.run_synthetic_ssh(child,input_size=65000,timeout_ms=5000)
  self.assertEqual(out['status'],'stopped')
  self.assertEqual(out['category'],'ssh_transport_or_handshake_failed')
  self.assertEqual(out['sshExitCode'],255)
  self.assertFalse(out['stdinDelivered'])

 def test_synthetic_ssh_partial_stdin_early_termination(self):
  child=(
   "import os, sys\n"
   "os.read(0, 256)\n"
   "os.close(0)\n"
   "sys.stderr.write('SECRET_STDERR_LEAK\\n')\n"
   "sys.exit(1)\n"
  )
  out,_=self.run_synthetic_ssh(child,input_size=65000,timeout_ms=5000)
  self.assertEqual(out['status'],'stopped')
  self.assertIn(out['category'],('ssh_stdin_broken_pipe','ssh_empty_stdout'))
  self.assertEqual(out['sshExitCode'],1)
  self.assertFalse(out['stdinDelivered'])

 def test_synthetic_ssh_dropped_connection_after_stdin_delivered(self):
  child=(
   "import sys, time\n"
   "_ = sys.stdin.buffer.read()\n"
   "time.sleep(0.1)\n"
   "sys.stderr.write('SECRET_STDERR_LEAK connection reset\\n')\n"
   "sys.exit(255)\n"
  )
  out,_=self.run_synthetic_ssh(child,input_size=65000,timeout_ms=5000)
  self.assertEqual(out['status'],'stopped')
  self.assertEqual(out['category'],'ssh_transport_or_handshake_failed')
  self.assertEqual(out['sshExitCode'],255)
  self.assertTrue(out['stdinDelivered'])
  self.assertFalse(out['stdinFaulted'])

 def test_synthetic_ssh_blocked_stdin_timeout_kills_process_without_hanging(self):
  child=(
   "import time\n"
   "time.sleep(10)\n"
  )
  out,_=self.run_synthetic_ssh(child,input_size=65000,timeout_ms=700)
  self.assertEqual(out['status'],'stopped')
  self.assertEqual(out['category'],'ssh_command_timeout')
  self.assertEqual(out['sshExitCode'],-1)
  self.assertFalse(out['stdinDelivered'])

if __name__=='__main__':unittest.main()
