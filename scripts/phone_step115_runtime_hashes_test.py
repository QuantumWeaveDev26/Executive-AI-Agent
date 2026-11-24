import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('hashes', ROOT / 'deploy/hostinger-pilot/phone-step115-runtime-hashes-20261111.readonly.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RuntimeHashesTests(unittest.TestCase):
    def test_nine_paths_exclude_secrets_and_database(self):
        self.assertEqual(len(set(module.PATHS)), 9)
        self.assertTrue(all(path.startswith('/app/') and path.endswith(('.js', '.mjs', '.html')) for path in module.PATHS))
        self.assertTrue(all('secret' not in path and '.env' not in path for path in module.PATHS))

    def test_drift_stops_before_reading_files(self):
        calls = []
        def fake(*args):
            calls.append(args)
            return 'wrong'
        self.assertEqual(module.check(fake)['category'], 'baseline_identity_mismatch')
        self.assertEqual(len(calls), 1)

    def test_exports_only_nine_hashes_after_stability_check(self):
        fields = '|'.join([module.CONTAINER_ID, module.IMAGE, 'healthy', 'thaara-v2-pilot', 'api', 'stable-start', 'true', '[]'])
        def fake(*args):
            return fields if args[0] == 'inspect' else json.dumps({path: 'a' * 64 for path in module.PATHS})
        result = module.check(fake)
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(len(result['hashes']), 9)
        self.assertEqual(set(result), {'status', 'imageId', 'containerId', 'hashes'})


if __name__ == '__main__':
    unittest.main()
