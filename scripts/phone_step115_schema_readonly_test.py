import base64
import csv
import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('phone_schema_readonly', ROOT / 'deploy/hostinger-pilot/phone-step115-schema-20261111.readonly.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(role='thaara_app', relation='phone_calls', digest='a' * 64):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(module.HEADERS['database'])
    writer.writerow(['thaara_vps_pilot', '160011'])
    writer.writerow(module.HEADERS['roles'])
    writer.writerow([role, 'f', 'f', 'f', 'f', 't', 'f', 'f'])
    writer.writerow(module.HEADERS['columns'])
    writer.writerow([relation, 't', 't', 'postgres', 'call_id', 'uuid', 't'])
    writer.writerow(module.HEADERS['functions'])
    writer.writerow(['apply_phone_provider_event(uuid,text,text,text,text,text)', 't', 'thaara_phone_callback_guard', digest])
    return output.getvalue()


class ReadOnlySchemaTests(unittest.TestCase):
    def test_exact_approved_sql_bytes(self):
        sql = (ROOT / 'docs/integrations/phone/STEP115_PRODUCTION_SCHEMA_PREFLIGHT.review.sql').read_bytes()
        self.assertEqual(base64.b64decode(module.SQL_BASE64, validate=True), sql)
        self.assertEqual(hashlib.sha256(sql).hexdigest(), module.SQL_SHA256)
        self.assertIn(b'BEGIN TRANSACTION READ ONLY;', sql)

    def test_parses_only_expected_sections_including_quoted_signatures(self):
        result = module.parse_metadata(fixture())
        self.assertEqual(set(result), {'database', 'roles', 'columns', 'functions'})
        self.assertEqual(result['functions'][0]['definition_sha256'], 'a' * 64)

    def test_rejects_unapproved_role_and_relation(self):
        for value in [fixture(role='unapproved'), fixture(relation='sessions')]:
            with self.assertRaises(ValueError):
                module.parse_metadata(value)

    def test_rejects_definitions_in_place_of_hashes(self):
        with self.assertRaises(ValueError):
            module.parse_metadata(fixture(digest='CREATE FUNCTION synthetic_definition'))

    def test_rejects_missing_or_repeated_sections(self):
        for value in [fixture().split('signature,')[0], fixture() + 'database_name,server_version\n']:
            with self.assertRaises(ValueError):
                module.parse_metadata(value)

    def test_one_fixed_psql_transaction_without_server_files_or_credentials(self):
        calls = []

        def inspect(container, service):
            return [('a' if service == 'api' else 'b') * 64, 'sha256:' + 'c' * 64, 'healthy', 'thaara-v2-pilot', service]

        def execute(arguments, payload=None, timeout=15):
            calls.append(arguments)
            self.assertEqual(arguments[:4], ['docker', 'exec', '-i', '--user'])
            self.assertIn('PGOPTIONS=-c default_transaction_read_only=on', arguments)
            self.assertIn('/var/run/postgresql', arguments)
            self.assertIn('-w', arguments)
            self.assertEqual(arguments[-2:], ['-f', '-'])
            self.assertEqual(hashlib.sha256(payload).hexdigest(), module.SQL_SHA256)
            return fixture()

        with patch.object(module, 'inspect', inspect), patch.object(module, 'execute', execute), patch('sys.stdout', new=io.StringIO()) as output:
            module.main()
            self.assertIn('"status": "verified"', output.getvalue())
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
