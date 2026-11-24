import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('inspection', ROOT / 'deploy/hostinger-pilot/phone-step115-source-inspection-20261111.readonly.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourceInspectionTests(unittest.TestCase):
    def test_target_drift_prevents_file_access(self):
        with patch.object(module, 'docker', return_value='wrong') as run:
            with self.assertRaisesRegex(RuntimeError, 'target_drift'):
                module.main()
            self.assertEqual(run.call_count, 1)

    def test_only_the_six_pinned_application_modules(self):
        self.assertEqual(len(module.EXPECTED), 6)
        self.assertTrue(all(path.startswith('/app/') and path.endswith(('.js', '.mjs')) for path in module.EXPECTED))

    def run_probe(self, text):
        expected = {'/app/synthetic.js': hashlib.sha256(text.encode()).hexdigest()}
        probe = module.PROBE.replace(json.dumps(module.EXPECTED, separators=(',', ':')), json.dumps(expected))
        script = """const vm=require('node:vm'),crypto=require('node:crypto');
const text=TEXT,stat={isFile:()=>true,size:Buffer.byteLength(text),ino:1,dev:1,ctimeMs:1,mtimeMs:1};
const fake={realpathSync:p=>p,openSync:()=>1,closeSync:()=>{},fstatSync:()=>stat,readFileSync:()=>Buffer.from(text),constants:{O_RDONLY:0,O_NOFOLLOW:1}};
try{vm.runInNewContext(PROBE,{require:n=>n==='node:fs'?fake:crypto,console:{log:()=>{}},Buffer});process.stdout.write('allowed');}
catch{process.stdout.write('refused');}
""".replace('TEXT', json.dumps(text)).replace('PROBE', json.dumps(probe))
        result = subprocess.run(['node', '-e', script], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0)
        return result.stdout.decode()

    def test_regular_code_is_allowed_in_mock_filesystem(self):
        self.assertEqual(self.run_probe('export const ready = true;'), 'allowed')

    def test_apparent_secrets_are_refused_before_export(self):
        for text in ['const key="sk-proj-' + 'a' * 30 + '";', '-----BEGIN PRIVATE KEY-----', 'const password="' + 'a' * 32 + '";']:
            self.assertEqual(self.run_probe(text), 'refused')

    def test_authenticated_database_url_is_refused(self):
        self.assertEqual(self.run_probe('const database="postgresql://synthetic:synthetic-password@localhost/db";'), 'refused')


if __name__ == '__main__':
    unittest.main()
