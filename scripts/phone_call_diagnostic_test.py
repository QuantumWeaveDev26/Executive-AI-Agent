"""Pure tests for the read-only call diagnostic. Never starts Docker or SSH."""
import importlib.util
import pathlib
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('phone_call_diagnostic', ROOT / 'deploy/hostinger-pilot/phone-call-diagnostic.review.py')
D = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(D)
ROW = {'created_ist': '2026-11-02 13:54:10 IST', 'state': 'failed', 'dispatch_status': 'failed', 'dispatch_code': 'PHONE_DISPATCH_HTTP_403',
       'has_provider_request_id': False, 'events': [{'sequence': 1, 'kind': 'state', 'state': 'failed'}]}


class DiagnosticTests(unittest.TestCase):
    def test_current_failure_window_and_tenant_owner_scope_are_fixed(self):
        self.assertIn("2026-11-02 13:54:00+05:30", D.QUERY)
        self.assertIn("2026-11-02 13:55:00+05:30", D.QUERY)
        self.assertIn("w.name = 'Thaara Pilot Synthetic 10812'", D.QUERY)
        self.assertIn("u.display_name = 'Pilot Synthetic Owner'", D.QUERY)
        self.assertIn('c.owner_user_id = s.user_id', D.QUERY)
        self.assertIn('e.owner_user_id = c.owner_user_id', D.QUERY)
        self.assertIn('count(*) FROM target_scope', D.QUERY)

    def test_query_is_read_only_and_selects_no_personal_or_secret_columns(self):
        q = D.QUERY.lower()
        for word in ['insert', 'update', 'delete', 'alter', 'drop', 'truncate', 'grant', 'draft', 'report', 'e.text', 'contact']:
            self.assertNotIn(word, q)
        self.assertIn('(c.provider_request_id is not null) as has_provider_request_id', q)

    def test_sanitize_keeps_only_allowlisted_values(self):
        self.assertEqual(D.sanitize([ROW])[0]['dispatchCode'], 'PHONE_DISPATCH_HTTP_403')
        for bad in [{**ROW, 'phone': '+919999999999'}, {**ROW, 'dispatch_code': 'key=sk-secret'}, {**ROW, 'state': 'weird'},
                    {**ROW, 'created_ist': '2026-11-01 00:00:00 IST'}, {**ROW, 'events': [{'sequence': 1, 'kind': 'state', 'state': 'failed', 'text': 'hi'}]}]:
            with self.assertRaises(RuntimeError):
                D.sanitize([bad])

    def test_multi_row_output_spread_over_lines_is_parsed(self):
        # PostgreSQL json_agg puts each row on its own line; the first run failed on exactly this shape.
        stdout = '[{"created_ist":"2026-11-02 13:54:10 IST","state":"failed","dispatch_status":"failed","dispatch_code":"X","has_provider_request_id":false,"events":[]}, \n {"created_ist":"2026-11-02 13:54:20 IST","state":"failed","dispatch_status":"failed","dispatch_code":"X","has_provider_request_id":false,"events":[]}]\n'
        with patch.object(D.subprocess, 'run', return_value=Mock(returncode=0, stdout=stdout)):
            self.assertEqual(len(D.sanitize(D.read_rows())), 2)
        with patch.object(D.subprocess, 'run', return_value=Mock(returncode=0, stdout='BEGIN\nnot json\n')):
            with self.assertRaisesRegex(RuntimeError, 'output_not_json'):
                D.read_rows()

    def test_command_uses_read_only_transaction_and_reports_no_raw_error(self):
        seen = {}

        def fake(args, **kwargs):
            seen['args'] = args
            return Mock(returncode=0, stdout='[]\n')
        with patch.object(D.subprocess, 'run', side_effect=fake):
            self.assertEqual(D.read_rows(), [])
        joined = ' '.join(seen['args'])
        self.assertIn('default_transaction_read_only=on', joined)
        self.assertIn('BEGIN READ ONLY;', joined)
        with patch.object(D.sys, 'argv', ['x', '--approved-phone-call-diagnostic']), patch.object(D.os, 'getuid', return_value=0, create=True), \
                patch.object(D, 'read_rows', side_effect=RuntimeError('synthetic-private-detail')), patch('builtins.print') as out:
            self.assertEqual(D.main(), 1)
        self.assertNotIn('synthetic-private-detail', out.call_args[0][0])


if __name__ == '__main__':
    unittest.main()
