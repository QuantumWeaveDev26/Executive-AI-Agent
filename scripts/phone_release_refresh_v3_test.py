"""Synthetic Docker inventory checks. No Docker or SSH invocation."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = 'deploy/hostinger-pilot/phone-release-refresh-v3-20261107.readonly.py'
MANIFEST = 'docs/integrations/phone/PHONE_RELEASE_REFRESH_V3_20261107.review.json'
SNAPSHOT = ('a' * 64, 'sha256:' + 'b' * 64, 'healthy', 'thaara-v2-pilot',
            'api', 'start', 'true')
MOUNTS = ['/run/one', '/tmp/two|three;four']


class RefreshV3Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('refresh_v3', ROOT / PAYLOAD)
        cls.probe = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.probe)

    def inspect(self, before, after, final=SNAPSHOT):
        calls = []
        data = {'status': 'verified', 'webAssetsVerified': True, 'files': []}
        for name, (path, digest) in self.probe.FILES.items():
            data['files'].append(dict(name=name, path=path, bytes=15, sha256=digest, changed=False))
        changed = b'synthetic changed code'
        data['files'][0].update(bytes=len(changed), sha256=hashlib.sha256(changed).hexdigest(),
                                changed=True, base64=base64.b64encode(changed).decode())

        def run(args):
            calls.append(args)
            if len(calls) == 1:
                return 0, '|'.join((*SNAPSHOT, json.dumps(before)))
            if len(calls) == 2:
                self.assertEqual(args[:3], ['docker', 'exec', SNAPSHOT[0]])
                return 0, json.dumps(data)
            return 0, '|'.join((*final, json.dumps(after)))

        return self.probe.inspect(run), calls

    def test_same_destinations_in_different_order_pass(self):
        result, calls = self.inspect(MOUNTS, list(reversed(MOUNTS)))
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(result['imageId'], SNAPSHOT[1])
        self.assertIn('base64', result['files'][0])
        self.assertEqual(len(calls), 3)

    def test_added_removed_or_replaced_destination_discards_code(self):
        for mounts in [MOUNTS + ['/tmp/third'], MOUNTS[:1], ['/run/new', MOUNTS[1]]]:
            with self.subTest(mounts=mounts):
                result, _ = self.inspect(MOUNTS, mounts)
                self.assertEqual(result, {'status': 'stopped',
                                         'category': 'live_baseline_changed_during_read',
                                         'changedFields': ['mounts']})

    def test_unsafe_and_malformed_destinations_fail_before_or_after_code_read(self):
        for invalid in [['/'], ['/app'], ['/app/module'], ['/tmp/../app'],
                        ['/tmp//nested'], ['relative'], ['/tmp/control\n'],
                        [MOUNTS[0], MOUNTS[0]], [7], {'mount': '/tmp'}]:
            with self.subTest(invalid=invalid):
                before, calls = self.inspect(invalid, MOUNTS)
                self.assertEqual(len(calls), 1)
                after, _ = self.inspect(MOUNTS, invalid)
                for result in [before, after]:
                    self.assertEqual(result, {'status': 'stopped',
                                             'category': 'image_file_provenance_denied'})

    def test_reordering_does_not_mask_identity_or_health_change(self):
        final = ('c' * 64, SNAPSHOT[1], 'unhealthy', *SNAPSHOT[3:])
        result, _ = self.inspect(MOUNTS, list(reversed(MOUNTS)), final)
        self.assertEqual(result, {'status': 'stopped',
                                  'category': 'live_baseline_changed_during_read',
                                  'changedFields': ['containerId', 'health']})

    def test_manifest_preserves_scope_and_pins_new_files(self):
        manifest = json.loads((ROOT / MANIFEST).read_bytes())
        prior = json.loads((ROOT / MANIFEST.replace('_V3', '_V2')).read_bytes())
        self.assertEqual(set(manifest['scope']), set(prior['scope']))
        for key in prior['scope'].keys() - {'oneRunMarker'}:
            self.assertEqual(manifest['scope'][key], prior['scope'][key])
        self.assertNotEqual(manifest['scope']['oneRunMarker'], prior['scope']['oneRunMarker'])
        for artifact in manifest['artifacts']:
            self.assertEqual(hashlib.sha256((ROOT / artifact['path']).read_bytes()).hexdigest(),
                             artifact['sha256'])

    def test_corrected_runner_preserves_reviewed_authentication(self):
        runner = 'scripts/phone-release-refresh-{}-20261107.readonly.ps1'
        v2 = (ROOT / runner.format('v2')).read_text(encoding='utf8')
        v4 = (ROOT / runner.format('v4')).read_text(encoding='utf8')
        start = '$pin='
        end = '$phase='
        self.assertEqual(v4[v4.index(start):v4.index(end)], v2[v2.index(start):v2.index(end)])
        start = " $phase='public_pin_check'"
        end = "  $receipt="
        self.assertEqual(v4[v4.index(start):v4.index(end)], v2[v2.index(start):v2.index(end)])
        manifest = json.loads((ROOT / MANIFEST.replace('_V3', '_V4')).read_bytes())
        self.assertIn('phone-release-refresh-v4-20261107.used.json', manifest['scope']['oneRunMarker'])
        for artifact in manifest['artifacts']:
            self.assertEqual(hashlib.sha256((ROOT / artifact['path']).read_bytes()).hexdigest(),
                             artifact['sha256'])


if __name__ == '__main__':
    unittest.main()
