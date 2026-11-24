"""Offline boundary tests. No Docker process or database is started."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_rehearsal', ROOT / 'scripts/phone_step115_pg16_local_rehearsal.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LocalRehearsalBoundaries(unittest.TestCase):
    def fixture(self):
        nonce = 'a' * 24
        return nonce, {'Id': 'b' * 64, 'Image': module.IMAGE, 'Name': '/thaara-step115-' + nonce + '-source',
                       'Config': {'Labels': {'thaara.step115.rehearsal': nonce}},
                       'HostConfig': {'NetworkMode': 'none', 'PortBindings': {}, 'Binds': []},
                       'Mounts': [{'Type': 'tmpfs'}]}

    def test_accepts_only_its_own_isolated_resource(self):
        nonce, facts = self.fixture()
        self.assertEqual(module.owned(facts, nonce), 'b' * 64)

    def test_refuses_other_agents_container(self):
        nonce, facts = self.fixture()
        for patch_value in [{'Name': '/other-development-agent'}, {'Image': 'sha256:' + 'c' * 64},
                            {'Config': {'Labels': {'thaara.step115.rehearsal': 'other'}}}]:
            with self.assertRaisesRegex(RuntimeError, 'identity_denied'):
                module.owned({**facts, **patch_value}, nonce)

    def test_refuses_ports_network_or_persistent_mounts(self):
        nonce, facts = self.fixture()
        for setting, value in [('NetworkMode', 'bridge'), ('PortBindings', {'5432/tcp': [{}]}), ('Binds', ['/host:/data'])]:
            changed = copy.deepcopy(facts)
            changed['HostConfig'][setting] = value
            with self.assertRaises(RuntimeError):
                module.owned(changed, nonce)
        facts['Mounts'] = [{'Type': 'volume'}]
        with self.assertRaises(RuntimeError):
            module.owned(facts, nonce)

    def test_sql_bytes_are_the_reviewed_transaction(self):
        self.assertEqual(module.digest(module.SQL_PATH.read_bytes()), module.SQL_HASH)

    def test_schema_comparison_ignores_random_dump_restriction_tokens_only(self):
        sql = b'-- dump\n\\restrict one\nCREATE TABLE public.synthetic(id int);\n\\unrestrict one\n'
        with patch.object(module, 'docker', return_value=sql):
            self.assertEqual(module.schema('synthetic'), b'CREATE TABLE public.synthetic(id int);')

    def test_preserves_constraints_while_normalizing_known_pg16_reparse_parentheses(self):
        original = b"    CONSTRAINT phone_contacts_display_name_check CHECK ((((length(btrim(display_name)) >= 1) AND (length(btrim(display_name)) <= 128)) AND (display_name = btrim(display_name)) AND (display_name !~ '[[:cntrl:]<>]'::text))),\n"
        restored = b"    CONSTRAINT phone_contacts_display_name_check CHECK (((length(btrim(display_name)) >= 1) AND (length(btrim(display_name)) <= 128) AND (display_name = btrim(display_name)) AND (display_name !~ '[[:cntrl:]<>]'::text))),\n"
        with patch.object(module, 'docker', side_effect=[original, restored]):
            self.assertEqual(module.schema('source'), module.schema('restored'))
        with patch.object(module, 'docker', side_effect=[original, restored.replace(b'<= 128', b'<= 999')]):
            self.assertNotEqual(module.schema('source'), module.schema('restored'))

    def test_normalizes_only_the_observed_operations_or_reparse(self):
        original = b"    CONSTRAINT phone_inbound_principals_operations_check CHECK ((((operations = ARRAY['callback'::text]) OR (operations = ARRAY['completion'::text])) OR (operations = ARRAY['callback'::text, 'completion'::text]))),\n"
        restored = b"    CONSTRAINT phone_inbound_principals_operations_check CHECK (((operations = ARRAY['callback'::text]) OR (operations = ARRAY['completion'::text]) OR (operations = ARRAY['callback'::text, 'completion'::text]))),\n"
        with patch.object(module, 'docker', side_effect=[original, restored]):
            self.assertEqual(module.schema('source'), module.schema('restored'))
        with patch.object(module, 'docker', side_effect=[original, restored.replace(b"'completion'", b"'unauthorized'")]):
            self.assertNotEqual(module.schema('source'), module.schema('restored'))


if __name__ == '__main__':
    unittest.main()
