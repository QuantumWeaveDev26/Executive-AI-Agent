import base64
import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer', ROOT / 'deploy/hostinger-pilot/phone-step115-disabled-install-20261111.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DisabledInstallTests(unittest.TestCase):
    def test_only_exact_approved_sql_and_metadata_verifier(self):
        install = base64.b64decode(module.INSTALL_BASE64, validate=True)
        self.assertEqual(install, (ROOT / 'docs/migrations/115-step115-hosted-install-20261111-r2.review.sql').read_bytes())
        self.assertEqual(hashlib.sha256(install).hexdigest(), module.INSTALL_SHA256)
        self.assertEqual(module.approved_payload(), install + b'\n' + base64.b64decode(module.SQL_BASE64, validate=True))

    def test_refuses_changed_image_before_database_command(self):
        with patch.object(module, 'inspect', return_value=['a' * 64, 'sha256:' + 'b' * 64, 'healthy', 'thaara-v2-pilot', 'api']), patch.object(module, 'execute') as execute:
            with self.assertRaisesRegex(RuntimeError, 'target_identity_changed'):
                module.main()
            execute.assert_not_called()

    def test_refuses_changed_install_bytes(self):
        with patch.object(module, 'INSTALL_BASE64', base64.b64encode(b'COMMIT;').decode()):
            with self.assertRaisesRegex(RuntimeError, 'approved_sql_checksum_mismatch'):
                module.approved_payload()

    def test_fixed_one_session_no_password_and_no_restart(self):
        calls = []
        def inspect(container, service):
            return module.EXPECTED[service]
        def execute(arguments, payload=None, timeout=15):
            calls.append(arguments)
            self.assertEqual(arguments[:5], ['docker', 'exec', '-i', '--user', 'postgres'])
            self.assertIn('PGOPTIONS=-c thaara.step115_hosted_install_approved=owner-approved-step115-hosted-install-r3-acl', arguments)
            self.assertIn('/var/run/postgresql', arguments)
            self.assertIn('-w', arguments)
            self.assertEqual(payload, module.approved_payload())
            return 'fixture'
        with patch.object(module, 'inspect', inspect), patch.object(module, 'execute', execute), patch.object(module, 'parse_metadata', return_value={}), patch.object(module, 'validate_post'), patch('sys.stdout', new=io.StringIO()) as output:
            module.main()
            self.assertIn('"schemaInstalled": true', output.getvalue())
            self.assertIn('"activation": "disabled"', output.getvalue())
        self.assertEqual(len(calls), 1)

    def test_new_roles_must_remain_nologin_and_no_elevated_flags(self):
        data = {
            'roles': [{'rolname': name, 'rolsuper': 'f', 'rolcreaterole': 'f', 'rolcreatedb': 'f',
                       'rolreplication': 'f', 'rolbypassrls': 'f', 'rolcanlogin': 'f', 'rolinherit': 'f'} for name in module.ROLES],
            'columns': [{'relname': name, 'relrowsecurity': 't', 'relforcerowsecurity': 't'} for name in module.TABLES],
            'functions': [{'signature': name + '()'} for name in module.FUNCTIONS],
        }
        module.validate_post(data)
        next(row for row in data['roles'] if row['rolname'] == 'thaara_phone_notify')['rolcanlogin'] = 't'
        with self.assertRaisesRegex(RuntimeError, 'installed_role_login_denied'):
            module.validate_post(data)

    def test_database_failure_is_never_retried(self):
        with patch.object(module, 'inspect', side_effect=lambda container, service: module.EXPECTED[service]), patch.object(module, 'execute', side_effect=RuntimeError('outcome_unverified')) as execute:
            with self.assertRaisesRegex(RuntimeError, 'outcome_unverified'):
                module.main()
            self.assertEqual(execute.call_count, 1)


if __name__ == '__main__':
    unittest.main()
