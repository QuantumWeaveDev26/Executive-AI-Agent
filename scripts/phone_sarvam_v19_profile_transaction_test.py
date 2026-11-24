"""Simulated profile changes. No Docker, network, or provider calls."""
from hashlib import sha256
import json
from pathlib import Path
import runpy
import unittest


ROOT = Path(__file__).resolve().parents[1]
SWITCH = runpy.run_path(ROOT / 'deploy/hostinger-pilot/phone-sarvam-v19-profile-transaction.review.py')['switch_profile']
PREVIOUS = (ROOT / 'docs/integrations/phone/sarvam-runtime-profile.pilot.json').read_bytes()
EVIDENCE = 'a' * 64


def fixture():
    path = ROOT / 'docs/integrations/phone/knowledge/runtime-v19-v21-20261108-review/runtime-profile.candidate.json'
    profile = json.loads(path.read_bytes())
    profile.update(reviewOnly=False, runtimeProfile=True, verifiedMaxCallLengthMinutes=5)
    profile['companyKnowledge'].update(reviewOnly=False, providerAcceptanceVerified=True, acceptanceEvidenceSha256=EVIDENCE)
    return profile


class TransactionTests(unittest.TestCase):
    def simulate(self, failure=None, candidate=None):
        requested = json.dumps(candidate if candidate is not None else fixture()).encode()
        current = PREVIOUS
        actions = []

        def backup(content):
            actions.append('backup')
            self.assertEqual(content, PREVIOUS)
            if failure == 'backup':
                raise OSError()

        def replace(old, new):
            nonlocal current
            actions.append('replace')
            if current != old:
                raise OSError('compare failed')
            current = new
            if failure == 'replace_uncertain' and new == requested:
                raise OSError()

        def verify(digest, version):
            nonlocal current
            actions.append(f'verify{version}')
            self.assertEqual(sha256(current).hexdigest(), digest)
            if version == 19 and failure in ('postcheck', 'concurrent'):
                if failure == 'concurrent':
                    current = b'another release'
                raise OSError()

        result = SWITCH(requested, sha256(requested).hexdigest(), EVIDENCE, read_profile=lambda: current,
                        backup_profile=backup, replace_profile=replace,
                        recreate_api=lambda: actions.append('recreate'), verify_api=verify)
        return result, actions, current

    def test_switch_backs_up_before_restart_and_verifies_v19(self):
        result, actions, _ = self.simulate()
        self.assertEqual(result['outboundVersion'], 19)
        self.assertEqual(actions, ['verify2', 'backup', 'replace', 'recreate', 'verify19'])

    def test_wrong_identity_and_evidence_never_write(self):
        for change in ('identity', 'evidence'):
            candidate = fixture()
            if change == 'identity':
                candidate['connectionId'] = 'another-connection'
            else:
                candidate['companyKnowledge']['acceptanceEvidenceSha256'] = 'b' * 64
            result, actions, current = self.simulate(candidate=candidate)
            self.assertEqual(result, {'status': 'stopped', 'stage': 'preflight'})
            self.assertEqual((actions, current), ([], PREVIOUS))

    def test_backup_failure_never_replaces_profile(self):
        result, actions, current = self.simulate('backup')
        self.assertEqual(result, {'status': 'stopped', 'stage': 'backup'})
        self.assertEqual((actions, current), (['verify2', 'backup'], PREVIOUS))

    def test_failed_postcheck_or_uncertain_replace_rolls_back_and_verifies_v2(self):
        for failure in ('postcheck', 'replace_uncertain'):
            result, actions, current = self.simulate(failure)
            self.assertEqual(result['status'], 'rolled_back')
            self.assertEqual(result['outboundVersion'], 2)
            self.assertEqual(actions[-3:], ['replace', 'recreate', 'verify2'])
            self.assertEqual(current, PREVIOUS)

    def test_does_not_overwrite_a_concurrent_release(self):
        result, actions, current = self.simulate('concurrent')
        self.assertEqual(result['status'], 'rollback_unverified')
        self.assertEqual(actions.count('recreate'), 1)
        self.assertEqual(current, b'another release')


if __name__ == '__main__':
    unittest.main()
