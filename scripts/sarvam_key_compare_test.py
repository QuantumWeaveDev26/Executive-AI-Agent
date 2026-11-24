"""Pure tests for the keyed Sarvam key comparison. Synthetic keys only; never reads a real key, never connects anywhere."""
import base64
import hashlib
import hmac
import importlib.util
import json
import os
import pathlib
import stat
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('sarvam_key_compare', ROOT / 'deploy/hostinger-pilot/sarvam-key-compare.review.py')
K = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(K)
REGULAR = lambda: SimpleNamespace(st_mode=stat.S_IFREG | 0o400)
PWSH = pathlib.Path(os.environ['USERPROFILE']) / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'


def supplied(key, nonce=os.urandom(32)):
    return {'nonce': base64.b64encode(nonce).decode(), 'tag': hmac.new(nonce, key, hashlib.sha256).hexdigest()}


class CompareTests(unittest.TestCase):
    def test_match_and_mismatch_return_only_a_boolean(self):
        self.assertIs(K.compare(supplied(b'synthetic-key-AAAA'), read=lambda: b'synthetic-key-AAAA', info=REGULAR), True)
        self.assertIs(K.compare(supplied(b'synthetic-key-AAAA'), read=lambda: b'synthetic-key-BBBB', info=REGULAR), False)

    def test_bad_input_missing_file_and_unknown_errors_are_categorised(self):
        for bad in [None, {'nonce': 'x'}, {'nonce': base64.b64encode(b'short').decode(), 'tag': '00' * 32}]:
            with self.assertRaises(Exception):
                K.compare(bad, read=lambda: b'k', info=REGULAR)
        def missing():
            raise FileNotFoundError()
        with self.assertRaisesRegex(RuntimeError, 'key_file_missing'):
            K.compare(supplied(b'k' * 10), read=lambda: b'k', info=missing)
        with patch.object(K.sys, 'argv', ['x', '--approved-sarvam-key-compare']), patch.object(K.os, 'getuid', return_value=0, create=True), \
                patch.object(K, 'compare', side_effect=RuntimeError('synthetic-key-AAAA')), patch('builtins.print') as out:
            self.assertEqual(K.main(), 1)
        self.assertNotIn('synthetic-key-AAAA', out.call_args[0][0])

    @unittest.skipUnless(PWSH.exists(), 'reviewed pwsh not installed')
    def test_runner_prefix_round_trips_without_containing_the_key(self):
        key = 'synthetic-sarvam-key-0123456789abcdef'
        with tempfile.TemporaryDirectory(prefix='thaara-keycmp-test-') as tmp:
            env = pathlib.Path(tmp) / 'keys.env'
            env.write_text('# synthetic\nSARVAM_API_KEY=' + key + '\n', encoding='utf-8')
            script = (ROOT / 'scripts/phone-backup-restore.review.ps1').as_posix()
            load = ("$t=$null;$e=$null;$a=[System.Management.Automation.Language.Parser]::ParseFile('" + script + "',[ref]$t,[ref]$e);"
                    "$f=$a.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-KeyComparePrefix'},$true);"
                    ". ([scriptblock]::Create($f.Extent.Text));[Console]::Out.Write((Get-KeyComparePrefix '" + env.as_posix() + "'))")
            prefix = subprocess.run([str(PWSH), '-NoProfile', '-NonInteractive', '-Command', load], capture_output=True, text=True, timeout=60).stdout
        self.assertNotIn(key, prefix)
        scope = {}
        exec(prefix, scope)
        self.assertIs(K.compare(scope['KEY_COMPARE'], read=lambda: key.encode(), info=REGULAR), True)
        self.assertIs(K.compare(scope['KEY_COMPARE'], read=lambda: (key + 'x').encode(), info=REGULAR), False)


if __name__ == '__main__':
    unittest.main()
