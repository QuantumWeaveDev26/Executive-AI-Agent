"""Pure/mock tests for the phone publisher. Never starts Docker, SSH, a provider or reads credentials."""
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('phone_publish', ROOT / 'deploy/hostinger-pilot/phone-publish.review.py')
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)


def model():
    return json.loads((ROOT / 'deploy/hostinger-pilot/compose.send.review.json').read_text(encoding='utf-8'))


class ModelTests(unittest.TestCase):
    def test_deploy_only_adds_the_durable_switch(self):
        before, after = model(), P.with_durable(model())
        self.assertEqual(P.phone_environment(after), {'THAARA_PHONE_DURABLE': 'approved'})
        after['services']['api']['environment'].pop('THAARA_PHONE_DURABLE')
        self.assertEqual(before, after)

    def test_live_adds_exact_switches_and_mounts_and_off_removes_them(self):
        live = P.with_live(model())
        env = live['services']['api']['environment']
        self.assertEqual(env['THAARA_PHONE_LIVE_CALLING'], 'approved')
        self.assertNotIn('THAARA_PHONE_DAILY_CALL_LIMIT', env)
        for name in P.SARVAM_SECRETS:
            self.assertIn(name, live['services']['api']['secrets'])
            self.assertEqual(live['secrets'][name], {'file': '/opt/thaara-v2-pilot-private/secrets/' + name})
        self.assertEqual(P.without_live(live), P.with_durable(model()))
        for service in ['postgres', 'redis']:
            self.assertEqual(live['services'][service], model()['services'][service])

    def test_no_secret_value_or_provider_address_in_the_publisher(self):
        source = (ROOT / 'deploy/hostinger-pilot/phone-publish.review.py').read_text(encoding='utf-8')
        self.assertNotIn('sarvam.ai', source)
        self.assertNotRegex(source, r'(?i)docker.*(volume|network)\s+rm')


class FlowTests(unittest.TestCase):
    def directory(self):
        return pathlib.Path(tempfile.mkdtemp(prefix='thaara-publish-test-'))

    def setup_files(self):
        pilot = self.directory()
        (pilot / 'compose.json').write_text(json.dumps(model()))
        (pilot / '.env').write_text('THAARA_PILOT_API_IMAGE=sha256:old\n')
        return pilot

    def run_change(self, pilot, *, up=None, send=None, identities=None):
        compose = ['docker', 'compose', '-f', str(pilot / 'compose.json')]
        calls = []
        running = {'image': 'sha256:old'}

        def fake_run(args, **kwargs):
            calls.append(args)
            if 'config' in args:
                return Mock(stdout=json.dumps(model()), returncode=0)
            if '--entrypoint' in args:
                return Mock(stdout='valid\n', returncode=0)
            if 'up' in args:
                running['image'] = kwargs['env']['THAARA_PILOT_API_IMAGE']
                if up:
                    up()
            return Mock(stdout='', returncode=0)
        with patch.object(P, 'PILOT', pilot), patch.object(P, 'COMPOSE', compose), patch.object(P, 'run', side_effect=fake_run), \
                patch.object(P, 'identity', side_effect=identities or (lambda name: ('same',))), patch.object(P, 'send_state', side_effect=send or (lambda: ['x'])), \
                patch.object(P, 'wait_api'), patch.object(P, 'restore_link') as link, patch.object(P, 'networks', return_value=['n8n_default']), \
                patch.object(P, 'inspect', side_effect=lambda _name: {'Image': running['image']}), patch.object(P, 'http_status', side_effect=lambda p, m='GET': '401' if 'phone/ai' in p else '200'):
            try:
                P.change_api(self.directory(), 'sha256:new', P.with_durable)
                return None, calls, link
            except Exception as error:
                return error, calls, link

    def test_success_changes_compose_and_image_and_restores_the_n8n_link(self):
        pilot = self.setup_files()
        error, calls, link = self.run_change(pilot)
        self.assertIsNone(error)
        self.assertIn('THAARA_PHONE_DURABLE', (pilot / 'compose.json').read_text())
        self.assertIn('sha256:new', (pilot / '.env').read_text())
        link.assert_called_once()
        self.assertTrue(all('--no-deps' in c for c in calls if 'up' in c))

    def test_changed_send_state_restores_previous_compose_and_image(self):
        pilot = self.setup_files()
        original = (pilot / 'compose.json').read_bytes()
        states = iter([['before'], ['after'], ['after']])
        error, calls, link = self.run_change(pilot, send=lambda: next(states))
        self.assertEqual(str(error), 'send_state_changed')
        self.assertEqual((pilot / 'compose.json').read_bytes(), original)
        self.assertIn('sha256:old', (pilot / '.env').read_text())
        self.assertEqual(sum('up' in c for c in calls), 2)

    def test_changed_other_service_restores_previous_state(self):
        pilot = self.setup_files()
        original = (pilot / 'compose.json').read_bytes()
        seen = {'count': 0}

        def identities(_name):
            seen['count'] += 1
            return ('before',) if seen['count'] <= 4 else ('after',)
        error, _, _ = self.run_change(pilot, identities=identities)
        self.assertEqual(str(error), 'other_service_changed')
        self.assertEqual((pilot / 'compose.json').read_bytes(), original)

    def test_failed_validation_never_touches_compose(self):
        pilot = self.setup_files()
        original = (pilot / 'compose.json').read_bytes()
        calls = []

        def fake_run(args, **kwargs):
            calls.append(args)
            if 'config' in args:
                return Mock(stdout=json.dumps(model()), returncode=0)
            return Mock(stdout='invalid', returncode=0)
        with patch.object(P, 'PILOT', pilot), patch.object(P, 'COMPOSE', ['docker']), patch.object(P, 'run', side_effect=fake_run), patch.object(P, 'identity', return_value=('x',)), patch.object(P, 'send_state', return_value=['x']):
            with self.assertRaises(P.Refusal):
                P.change_api(self.directory(), 'sha256:new', P.with_durable)
        self.assertEqual((pilot / 'compose.json').read_bytes(), original)
        self.assertFalse(any('up' in c for c in calls))

    def test_live_on_refuses_access_logs_or_unready_files_before_any_change(self):
        for traefik, files, code in [(True, True, 'traefik_access_log_enabled'), (False, False, 'sarvam_files_not_ready')]:
            receipt = {}

            def preconditions(r, _image):
                r['traefikAccessLog'] = traefik
            with self.subTest(code=code), patch.object(P, 'inspect', return_value={'Id': 'sha256:new', 'Image': 'sha256:new'}), patch.object(P, 'preconditions', side_effect=preconditions), \
                    patch.object(P, 'sarvam_files_ready', return_value=files), patch.object(P, 'change_api') as change:
                with self.assertRaises(P.Refusal) as caught:
                    P.live_on(receipt)
                self.assertEqual(str(caught.exception), code)
                change.assert_not_called()

    def test_unknown_error_text_never_reaches_the_receipt(self):
        with patch.object(P.sys, 'argv', ['x', '--approved-phone-live-off']), patch.dict(P.MODES, {'--approved-phone-live-off': Mock(side_effect=RuntimeError('synthetic-private-secret'))}), patch('builtins.print') as output:
            self.assertEqual(P.main(), 1)
        text = output.call_args[0][0]
        self.assertNotIn('synthetic-private-secret', text)
        self.assertEqual(json.loads(text)['category'], 'unclassified_failure')

    def test_ui_update_keeps_the_compose_model_and_refuses_unpinned_archives(self):
        live = P.with_live(model())
        self.assertEqual(P.unchanged(live), live)
        self.assertIsNot(P.unchanged(live), live)
        archive = self.directory() / 'ui.tar.gz'
        archive.write_bytes(b'not the reviewed image')
        with patch.object(P, 'run') as run:
            with self.assertRaises(P.Refusal) as caught:
                P.load_image(archive, P.UI_ARCHIVE_SHA, P.UI_TAG, P.UI_LAYERS_SHA)
        self.assertEqual(str(caught.exception), 'archive_checksum')
        run.assert_not_called()

    def test_ui_update_only_runs_on_the_expected_live_build_and_reports_the_live_state(self):
        pilot = self.directory()
        (pilot / 'compose.json').write_text(json.dumps(P.with_live(model())))
        receipt = {}
        statuses = {'/integrations/phone/contacts': '200', '/integrations/phone/history': '200'}
        with patch.object(P, 'PILOT', pilot), patch.object(P, 'preconditions') as pre, patch.object(P, 'sarvam_files_ready', return_value=True),                 patch.object(P, 'load_image', return_value='sha256:ui'), patch.object(P, 'new_directory', return_value=pilot), patch.object(P, 'change_api') as change,                 patch.object(P, 'http_status', side_effect=lambda p, m='GET': statuses.get(p, '403')):
            P.ui_update(receipt)
        pre.assert_called_once_with(receipt, P.RUNNING_IMAGE)
        self.assertIs(change.call_args[0][2], P.unchanged)
        self.assertEqual((receipt['status'], receipt['callingEnabled'], receipt['rollbackImage']), ('verified', True, P.RUNNING_IMAGE))

    def test_ui_update_refuses_a_lost_live_state_and_an_unchanged_image(self):
        pilot = self.directory()
        (pilot / 'compose.json').write_text(json.dumps(P.with_live(model())))
        for image, hook, code in [('sha256:ui', '404', 'live_state_changed'), (P.RUNNING_IMAGE, '403', 'image_not_new')]:
            with self.subTest(code=code), patch.object(P, 'PILOT', pilot), patch.object(P, 'preconditions'), patch.object(P, 'sarvam_files_ready', return_value=True),                     patch.object(P, 'load_image', return_value=image), patch.object(P, 'new_directory', return_value=pilot), patch.object(P, 'change_api'),                     patch.object(P, 'http_status', side_effect=lambda p, m='GET', h=hook: h if 'sarvam' in p else '200'):
                with self.assertRaises(P.Refusal) as caught:
                    P.ui_update({})
                self.assertEqual(str(caught.exception), code)

    def test_live_switches_accept_only_a_known_phone_build(self):
        facts = {P.API: {'Image': 'sha256:ui'}, P.NEW_TAG: {'Id': 'sha256:first'}, P.UI_TAG: {'Id': 'sha256:ui'}}

        def known(name):
            if name not in facts:
                raise P.Refusal('command_failed')
            return facts[name]
        with patch.object(P, 'inspect', side_effect=known):
            self.assertEqual(P.phone_image(), 'sha256:ui')
        facts[P.API] = {'Image': 'sha256:chat'}
        facts[P.CHAT_TAG] = {'Id': 'sha256:chat'}
        with patch.object(P, 'inspect', side_effect=known):
            self.assertEqual(P.phone_image(), 'sha256:chat')
        facts[P.API] = {'Image': 'sha256:other'}
        with patch.object(P, 'inspect', side_effect=known):
            with self.assertRaises(P.Refusal):
                P.phone_image()

    def test_chat_switch_adds_only_the_key_mount_and_switch_and_off_removes_them(self):
        live = P.with_live(model())
        on = P.with_chat(live)
        self.assertEqual(on['services']['api']['environment']['THAARA_OPENAI_API_KEY_FILE'], '/run/secrets/openai_api_key')
        self.assertEqual(on['secrets']['openai_api_key'], {'file': '/opt/thaara-v2-pilot-private/secrets/openai_api_key'})
        both = P.with_google(on)
        self.assertEqual(both['services']['api']['environment']['THAARA_GOOGLE_OAUTH'], 'approved')
        for name in P.GOOGLE_SECRETS:
            self.assertIn(name, both['services']['api']['secrets'])
        self.assertEqual(P.without_google(both), on)
        self.assertEqual(P.without_chat(on), live)
        self.assertEqual(P.phone_environment(on), P.phone_environment(live))
        for service in ['postgres', 'redis']:
            self.assertEqual(on['services'][service], live['services'][service])

    def test_chat_on_refuses_a_missing_key_before_any_change(self):
        with patch.object(P, 'inspect', return_value={'Id': 'sha256:chat'}), patch.object(P, 'preconditions'), patch.object(P, 'chat_file_ready', return_value=False),                 patch.object(P, 'change_api') as change:
            with self.assertRaises(P.Refusal) as caught:
                P.chat_on({})
        self.assertEqual(str(caught.exception), 'chat_key_not_ready')
        change.assert_not_called()

    def test_chat_deploy_runs_only_on_the_ui_build_keeps_chat_off_and_installs_the_entry_script(self):
        pilot = self.directory()
        (pilot / 'compose.json').write_text(json.dumps(P.with_live(model())))
        receipt = {}
        with patch.object(P, 'PILOT', pilot), patch.object(P, 'preconditions') as pre, patch.object(P, 'sarvam_files_ready', return_value=True),                 patch.object(P, 'load_image', return_value='sha256:chat'), patch.object(P, 'new_directory', return_value=pilot), patch.object(P, 'change_api') as change,                 patch.object(P, 'install_owner_files') as owner, patch.object(P, 'http_status', return_value='403'):
            P.chat_deploy(receipt)
        pre.assert_called_once_with(receipt, P.UI_IMAGE)
        applied = change.call_args[0][2](P.with_google(P.with_chat(P.with_live(model()))))
        self.assertEqual(applied, P.with_live(model()))
        owner.assert_called_once_with(P.CHAT_OWNER_FILES, 'CHAT_OWNER_FILES_B64')
        self.assertEqual((receipt['status'], receipt['chatEnabled'], receipt['callingEnabled'], receipt['rollbackImage']), ('verified', False, True, P.UI_IMAGE))

    def test_owner_entry_script_pins_match_the_reviewed_files(self):
        import hashlib
        for name, expected in P.CHAT_OWNER_FILES.items():
            data = (ROOT / 'deploy/hostinger-pilot' / name).read_bytes()
            self.assertNotIn(bytes([13]), data)
            self.assertEqual(hashlib.sha256(data).hexdigest(), expected)

    def test_google_on_refuses_missing_files_before_any_change(self):
        with patch.object(P, 'inspect', return_value={'Id': 'sha256:chat'}), patch.object(P, 'preconditions'), patch.object(P, 'secret_file_ready', return_value=False),                 patch.object(P, 'change_api') as change:
            with self.assertRaises(P.Refusal) as caught:
                P.google_on({})
        self.assertEqual(str(caught.exception), 'google_files_not_ready')
        change.assert_not_called()

    def test_default_mode_is_review_only(self):
        with patch.object(P.sys, 'argv', ['x']), patch('builtins.print') as output:
            self.assertEqual(P.main(), 0)
        self.assertEqual(json.loads(output.call_args[0][0])['status'], 'review_only')


if __name__ == '__main__':
    unittest.main()
