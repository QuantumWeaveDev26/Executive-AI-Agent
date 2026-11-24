"""Database/network-free checks of fixed, allowlisted baseline inventory."""
import contextlib
import io
import json
import runpy
import subprocess
import unittest
from unittest.mock import patch
from types import SimpleNamespace

class BaselineTests(unittest.TestCase):
    def check_run(self, mutation=None):
        calls = []
        def fake(args, **kwargs):
            calls.append(args)
            self.assertNotIn('Env', ' '.join(args))
            if args[1] == 'inspect':
                if args[3] == '{{json .Mounts}}':
                    out = json.dumps([{'Destination':'/run/secrets/key'}])
                    if mutation == 'mount': out = json.dumps([{'Destination':'/app/apps/api/dist'}])
                else:
                    parts = ['a'*64, 'sha256:'+'b'*64, True, 'healthy','thaara-v2-pilot','api']
                    if mutation == 'health': parts[3] = 'unhealthy'
                    if mutation == 'drift' and len(calls)>6: parts[0] = 'c'*64
                    out = '|'.join(json.dumps(x) for x in parts)
            elif args[1:3] == ['image','inspect']:
                out = json.dumps(['sha256:'+'d'*64]) if 'RootFS' in args[4] else 'sha256:'+'b'*64
            elif args[1] == 'exec' and args[3] == 'cat':
                self.assertTrue(args[4].startswith('/app/apps/api/dist/'))
                out = 'export const preserved=true;'
            elif args[1] == 'exec' and args[3] == 'node': out = json.dumps([['/app/apps/web/dist/index.html','e'*64]])
            else: raise AssertionError('unexpected command')
            if mutation == 'timeout': raise subprocess.TimeoutExpired(args,15)
            return subprocess.CompletedProcess(args,0,out.encode(),b'')
        result=io.StringIO()
        with patch('subprocess.run',fake),patch('pathlib.Path.lstat',return_value=SimpleNamespace(st_mode=0o100600,st_uid=0)),patch('pathlib.Path.read_bytes',return_value=b'fixed reviewed file'),contextlib.redirect_stdout(result):
            try: runpy.run_path('deploy/hostinger-pilot/phone-chat-baseline.readonly.py',run_name='__main__')
            except SystemExit as exc: self.assertEqual(exc.code,1)
        return json.loads(result.getvalue())
    def test_success(self): self.assertEqual(self.check_run()['status'],'verified')
    def test_mount_override(self): self.assertEqual(self.check_run('mount')['status'],'stopped')
    def test_unhealthy(self): self.assertEqual(self.check_run('health')['status'],'stopped')
    def test_identity_drift(self): self.assertEqual(self.check_run('drift')['status'],'stopped')
    def test_timeout(self): self.assertEqual(self.check_run('timeout')['status'],'stopped')

if __name__=='__main__': unittest.main()
