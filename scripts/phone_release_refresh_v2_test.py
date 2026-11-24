"""Check release refresh diagnostics using synthetic Docker responses only."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = 'deploy/hostinger-pilot/phone-release-refresh-v2-20261107.readonly.py'
MANIFEST = 'docs/integrations/phone/PHONE_RELEASE_REFRESH_V2_20261107.review.json'
SNAPSHOT = ('a' * 64, 'sha256:' + 'b' * 64, 'healthy', 'thaara-v2-pilot',
            'api', 'start', 'true', '/run/synthetic;')


class RefreshV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('refresh_v2', ROOT / PAYLOAD)
        cls.probe = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.probe)

    def inspect(self, final_code, final_snapshot):
        steps = iter([(0, '|'.join(SNAPSHOT)), (2, json.dumps({
            'status': 'stopped', 'category': 'public_frontend_mismatch',
        })), (final_code, final_snapshot)])
        with contextlib.redirect_stdout(io.StringIO()) as output:
            result = self.probe.inspect(lambda _: next(steps))
        self.assertEqual(output.getvalue(), '')
        with self.assertRaises(StopIteration):
            next(steps)
        return result

    def test_final_command_failure_retains_exit_code_only(self):
        self.assertEqual(self.inspect(1, 'synthetic private output'), {
            'status': 'stopped', 'category': 'final_inventory_failed', 'returnCode': 1,
        })

    def test_changed_baseline_names_fields_without_exporting_values(self):
        fields = list(SNAPSHOT)
        fields[2] = 'starting'
        fields[5] = 'private timestamp'
        self.assertEqual(self.inspect(0, '|'.join(fields)), {
            'status': 'stopped', 'category': 'live_baseline_changed_during_read',
            'changedFields': ['health', 'startedAt'],
        })

    def test_malformed_snapshot_is_distinct(self):
        self.assertEqual(self.inspect(0, 'unexpected'), {
            'status': 'stopped', 'category': 'final_inventory_invalid',
        })

    def test_stable_snapshot_preserves_probe_failure(self):
        self.assertEqual(self.inspect(0, '|'.join(SNAPSHOT)), {
            'status': 'stopped', 'category': 'public_frontend_mismatch',
        })

    def test_manifest_matches_payload_and_keeps_approval_separate(self):
        manifest = json.loads((ROOT / MANIFEST).read_bytes())
        prior = json.loads((ROOT / MANIFEST.replace('_V2', '')).read_bytes())
        self.assertEqual(manifest['scope']['publicFrontend'], {
            name.removeprefix('/app/apps/web/dist/'): digest
            for name, digest in self.probe.WEB.items()
        })
        self.assertNotEqual(manifest['scope']['oneRunMarker'], prior['scope']['oneRunMarker'])
        for artifact in manifest['artifacts']:
            self.assertEqual(hashlib.sha256((ROOT / artifact['path']).read_bytes()).hexdigest(),
                             artifact['sha256'])


if __name__ == '__main__':
    unittest.main()
