import base64
import hashlib
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('protected_backup', ROOT / 'deploy/hostinger-pilot/phone-step115-protected-backup-20261111.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProtectedBackupTests(unittest.TestCase):
    def test_embeds_only_the_pinned_reviewed_procedure(self):
        code = base64.b64decode(module.BACKUP_B64, validate=True)
        self.assertEqual(code, (ROOT / 'deploy/hostinger-pilot/phone-backup-restore.review.py').read_bytes())
        self.assertEqual(hashlib.sha256(code).hexdigest(), module.BACKUP_SHA256)

    def test_target_drift_stops_before_creating_a_backup(self):
        with patch.object(module, 'identity', return_value=['wrong']) as inspect, patch.object(module.types, 'ModuleType') as load:
            with self.assertRaisesRegex(RuntimeError, 'target_identity_changed'):
                module.run()
            load.assert_not_called()
            self.assertEqual(inspect.call_count, 1)

    def test_changed_code_stops_before_target_access(self):
        with patch.object(module, 'BACKUP_B64', base64.b64encode(b'wrong').decode()), patch.object(module, 'identity') as inspect:
            with self.assertRaisesRegex(RuntimeError, 'backup_checksum_denied'):
                module.run()
            inspect.assert_not_called()

    def test_wrapper_has_bounded_backup_deadline_and_single_consumed_marker(self):
        script = (ROOT / 'scripts/phone-step115-protected-backup-20261111.ps1').read_text(encoding='utf-8')
        self.assertIn('$agentEnv 720000', script)
        self.assertIn('[IO.FileMode]::CreateNew', script)
        self.assertIn('phone-step115-protected-backup-20261111.used.json', script)


if __name__ == '__main__':
    unittest.main()
