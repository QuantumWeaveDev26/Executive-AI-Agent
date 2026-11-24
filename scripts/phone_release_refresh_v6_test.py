"""Synthetic Docker inventory and V6 discovery checks. No Docker or SSH invocation."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = 'deploy/hostinger-pilot/phone-release-refresh-v6-20261107.readonly.py'
MANIFEST = 'docs/integrations/phone/PHONE_RELEASE_REFRESH_V6_20261107.review.json'
SNAPSHOT = ('a' * 64, 'sha256:' + 'b' * 64, 'healthy', 'thaara-v2-pilot',
            'api', 'start', 'true')
MOUNTS = ['/run/one', '/tmp/two|three;four']


class RefreshV6Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('refresh_v6', ROOT / PAYLOAD)
        cls.probe = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.probe)

    def inspect(self, before, after, final=SNAPSHOT, web=None, wa_match=True):
        calls = []
        web_assets = web or dict(self.probe.WEB_10831)
        wa_files = {
            p: {'bytes': 120, 'sha256': h if wa_match else 'f' * 64, 'matches10831': wa_match}
            for p, h in self.probe.WHATSAPP_FILES.items()
        }
        data = {
            'status': 'verified',
            'webAssetsVerified': True,
            'webMatches10831': web_assets == self.probe.WEB_10831,
            'webAssets': web_assets,
            'whatsappFilesVerified': wa_match,
            'whatsappFiles': wa_files,
            'files': []
        }
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

    def test_v6_records_10831_and_alternate_web_assets_without_false_mismatch(self):
        result, calls = self.inspect(MOUNTS, list(reversed(MOUNTS)))
        self.assertEqual(result['status'], 'verified')
        self.assertTrue(result['webMatches10831'])
        self.assertTrue(result['whatsappFilesVerified'])
        self.assertEqual(len(calls), 3)
        alt_web = {
            '/app/apps/web/dist/index.html': '1' * 64,
            '/app/apps/web/dist/assets/index-NewHash1.js': '2' * 64,
            '/app/apps/web/dist/assets/index-Co2o2hIb.css': self.probe.WEB_10831['/app/apps/web/dist/assets/index-Co2o2hIb.css'],
        }
        result2, _ = self.inspect(MOUNTS, MOUNTS, web=alt_web, wa_match=False)
        self.assertEqual(result2['status'], 'verified')
        self.assertFalse(result2['webMatches10831'])
        self.assertEqual(result2['webAssets'], alt_web)
        self.assertFalse(result2['whatsappFilesVerified'])

    def test_v5_css_typo_is_fixed_in_v6(self):
        self.assertEqual(
            self.probe.WEB_10831['/app/apps/web/dist/assets/index-Co2o2hIb.css'],
            'ed715f21be63f91a95091267354402101c750b39666ff5f6a8b52d853ff63309'
        )
        self.assertEqual(len(self.probe.WEB_10831['/app/apps/web/dist/assets/index-Co2o2hIb.css']), 64)

    def test_added_removed_or_unsafe_mounts_fail_closed(self):
        for mounts in [MOUNTS + ['/tmp/third'], MOUNTS[:1], ['/run/new', MOUNTS[1]]]:
            with self.subTest(mounts=mounts):
                result, _ = self.inspect(MOUNTS, mounts)
                self.assertEqual(result, {'status': 'stopped',
                                         'category': 'live_baseline_changed_during_read',
                                         'changedFields': ['mounts']})
        for invalid in [['/'], ['/app'], ['/app/module'], ['/tmp/../app']]:
            with self.subTest(invalid=invalid):
                before, calls = self.inspect(invalid, MOUNTS)
                self.assertEqual(len(calls), 1)
                self.assertEqual(before, {'status': 'stopped', 'category': 'image_file_provenance_denied'})

    def test_v6_manifest_and_launcher_preserve_v2_auth(self):
        v4 = (ROOT / 'scripts/phone-release-refresh-v4-20261107.readonly.ps1').read_text(encoding='utf8').replace('\r\n', '\n')
        v6 = (ROOT / 'scripts/phone-release-refresh-v6-20261107.readonly.ps1').read_text(encoding='utf8').replace('\r\n', '\n')
        self.assertIn('.codex/credentials/thaara-ai-v2-vps1871828', v6)
        self.assertEqual(v6[v6.index('$pin='):v6.index('$phase=')], v4[v4.index('$pin='):v4.index('$phase=')])
        self.assertEqual(v6[v6.index(" $phase='public_pin_check'"):v6.index("  $receipt=")], v4[v4.index(" $phase='public_pin_check'"):v4.index("  $receipt=")])
        manifest = json.loads((ROOT / MANIFEST).read_bytes())
        for artifact in manifest['artifacts']:
            self.assertEqual(hashlib.sha256((ROOT / artifact['path']).read_bytes()).hexdigest(), artifact['sha256'])
        self.assertTrue((ROOT / manifest['scope']['oneRunMarker']).exists())
        self.assertTrue((ROOT / 'node_modules/.cache/phone-release-refresh-v6-20261107.result.json').exists())
        pwsh = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
        if pwsh.exists():
            r = subprocess.run([str(pwsh), '-NoProfile', '-NonInteractive', '-File', str(ROOT / 'scripts/phone-release-refresh-v6-20261107.readonly.ps1'), '-ReviewOnly'], capture_output=True, text=True, timeout=15)
            self.assertEqual(r.returncode, 0)
            self.assertEqual(json.loads(r.stdout)['mode'], 'review_only')


if __name__ == '__main__':
    unittest.main()
