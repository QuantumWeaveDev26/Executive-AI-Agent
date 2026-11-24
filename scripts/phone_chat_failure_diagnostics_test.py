"""Synthetic command failures only; no Docker/SSH/database/provider access."""
import importlib.util
import json
import subprocess
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('candidate','deploy/hostinger-pilot/phone-chat-deploy.v2.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DiagnosticsTests(unittest.TestCase):
    def test_build_error_retains_operation_and_exit(self):
        with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1,b'',b'pull access denied for sha256, repository does not exist')):
            with self.assertRaises(m.CommandFailure) as caught:m.run(['docker','build','--network','none','synthetic'])
        self.assertEqual(caught.exception.diagnostic,{'operation':'docker_build','returnCode':1,'error':'pull access denied for sha256','timedOut':False})
    def test_unrecognized_stderr_never_escapes(self):
        secret='SYNTHETIC_SECRET_NOT_FOR_REPORT'
        with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],42,b'',secret.encode())):
            with self.assertRaises(m.CommandFailure) as caught:m.run(['docker','image','inspect','synthetic'])
        self.assertNotIn(secret,json.dumps(caught.exception.diagnostic));self.assertEqual(caught.exception.diagnostic['returnCode'],42)
    def test_allowlisted_phrase_does_not_leak_surrounding_text(self):
        e=m.CommandFailure(['docker','build'],1,b'password=SYNTHETIC permission denied token=SYNTHETIC')
        self.assertEqual(e.diagnostic['error'],'permission denied');self.assertNotIn('SYNTHETIC',json.dumps(e.diagnostic))
    def test_timeout_retains_stage_without_claiming_exitcode(self):
        with patch.object(m.subprocess,'run',side_effect=subprocess.TimeoutExpired('synthetic',1,stderr=b'SYNTHETIC_SECRET')):
            with self.assertRaises(m.CommandFailure) as caught:m.run(['docker','build'],timeout=1)
        self.assertTrue(caught.exception.diagnostic['timedOut']);self.assertIsNone(caught.exception.diagnostic['returnCode'])
    def test_success_unmodified(self):
        with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'normal output',b'')):
            self.assertEqual(m.run(['docker','inspect','synthetic']),b'normal output')
    def test_output_bound_preserved(self):
        with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'x'*1048577,b'')):
            with self.assertRaisesRegex(RuntimeError,'output_limit'):m.run(['docker','inspect','synthetic'])

if __name__=='__main__':unittest.main()
