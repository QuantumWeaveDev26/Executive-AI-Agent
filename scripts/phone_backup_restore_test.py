"""Pure/mock preparation tests. Never starts Docker, SQL, SSH or reads credentials."""
import importlib.util
import pathlib
import io
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('phone_backup', ROOT / 'deploy/hostinger-pilot/phone-backup-restore.review.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


def source():
    return {'Id': M.SOURCE_ID, 'Name': '/' + M.SOURCE_NAME, 'Image': M.IMAGE_ID,
            'Project': 'thaara-v2-pilot', 'Service': 'postgres', 'Running': True, 'Healthy': 'healthy', 'Restarts': 0}


def fixture():
    ident = {'id': 'a' * 64, 'name': 'thaara-phone-restore-' + 'b' * 32, 'run': 'b' * 32}
    facts = {'Id': ident['id'], 'Name': '/' + ident['name'], 'Image': M.IMAGE_ID,
             'Labels': {'thaara.phone-restore': ident['run']}, 'ReadOnly': True, 'Restarts': 0,
             'NetworkMode': 'none', 'Networks': ['none'], 'PortBindings': {}, 'Ports': {'5432/tcp': None},
             'Binds': [], 'Mounts': [], 'Tmpfs': dict(M.TMPFS),
             'Memory': 805306368, 'NanoCpus': 1000000000, 'ShmSize': 67108864, 'PidsLimit': 128, 'SecurityOpt': ['no-new-privileges:true'],
             'Resolved': {'/var/lib/postgresql/data': '/var/lib/postgresql/data', '/var/run/postgresql': '/run/postgresql', '/tmp': '/tmp'},
             'MountInfo': '\n'.join([
                 '1 0 0:1 / / ro,relatime - overlay overlay rw',
                 '2 1 0:2 / /var/lib/postgresql/data rw,nosuid,noexec - tmpfs tmpfs rw,size=524288k',
                 '3 1 0:3 / /run/postgresql rw,nosuid,noexec - tmpfs tmpfs rw,size=16384k',
                 '4 1 0:4 / /tmp rw,nosuid,noexec - tmpfs tmpfs rw,size=32768k'])}
    return ident, facts


class BackupBoundaryTests(unittest.TestCase):
    def test_diagnostics_never_forward_unknown_exception_text(self):
        for error in [M.Refusal('synthetic-private-secret'), RuntimeError('synthetic-private-secret')]:
            self.assertEqual(M.diagnostic_category(error), 'unclassified_failure')
        for error, expected in [(FileNotFoundError('/private/path'), 'missing_path_or_tool'),
                                (PermissionError('/private/path'), 'filesystem_permissions'),
                                (M.Refusal('source_identity_denied'), 'container_identity'),
                                (M.Refusal('docker_command_timeout'), 'command_timeout'),
                                (M.Refusal('disk_budget_insufficient'), 'disk_availability'),
                                (M.json.JSONDecodeError('private', 'private', 0), 'docker_metadata')]:
            self.assertEqual(M.diagnostic_category(error), expected)

    def test_host_diagnostic_never_reaches_database_or_fixture(self):
        with patch.object(M, 'host_preflight', return_value=source()), patch.object(M, 'Docker') as docker, \
                patch.object(M, 'Snapshot') as snapshot:
            docker.return_value.source.return_value = source()
            receipt = M.host_diagnostic()
        self.assertEqual(receipt['status'], 'verified')
        self.assertTrue(receipt['databaseAccessed'] is False and receipt['resourcesCreated'] is False)
        snapshot.assert_not_called()
        docker.return_value.assert_not_called()

    def test_host_diagnostic_retains_only_sanitized_failed_step(self):
        def fail(_docker, progress):
            progress['step'] = 'protected_paths'
            raise PermissionError('synthetic-private-secret')
        with patch.object(M, 'host_preflight', side_effect=fail), patch.object(M, 'Docker'):
            receipt = M.host_diagnostic()
        self.assertEqual(receipt['category'], 'filesystem_permissions')
        self.assertEqual(receipt['preflightStep'], 'protected_paths')
        self.assertNotIn('synthetic-private-secret', M.json.dumps(receipt))
        self.assertTrue(receipt['cleanupVerified'])

    def test_host_preflight_reports_failed_check_without_creating_resources(self):
        cases = [('container_identity', M.Refusal('source_identity_denied'), 'container_identity'),
                 ('cached_image', M.json.JSONDecodeError('private', 'private', 0), 'docker_metadata'),
                 ('deadline_tool', M.Refusal('source_client_deadline_tool_unavailable'), 'missing_path_or_tool'),
                 ('protected_paths', FileNotFoundError('private'), 'missing_path_or_tool'),
                 ('protected_paths', M.Refusal('unsafe_backup_path'), 'filesystem_permissions'),
                 ('disk_availability', M.Refusal('disk_budget_insufficient'), 'disk_availability'),
                 ('memory_availability', M.Refusal('memory_budget_insufficient'), 'memory_availability'),
                 ('container_identity', M.Refusal('docker_command_timeout'), 'command_timeout')]
        for step, error, expected in cases:
            def fail(_docker, progress):
                progress['step'] = step
                raise error
            with self.subTest(step=step, category=expected), patch.object(M, 'host_preflight', side_effect=fail), \
                    patch.object(M, 'Docker'), patch.object(M, 'Snapshot') as snapshot:
                receipt = M.host_diagnostic()
                self.assertEqual((receipt['category'], receipt['preflightStep']), (expected, step))
                self.assertFalse(receipt['resourcesCreated'])
                snapshot.assert_not_called()

    def test_host_source_changed_during_diagnostic_is_not_accepted(self):
        with patch.object(M, 'host_preflight', return_value=source()), patch.object(M, 'Docker') as docker:
            docker.return_value.source.return_value = {**source(), 'Id': 'f' * 64}
            receipt = M.host_diagnostic()
        self.assertEqual((receipt['status'], receipt['category'], receipt['preflightStep']),
                         ('failed', 'container_identity', 'identity_recheck'))

    def test_missing_command_permission_and_timeout_are_distinct_without_stderr(self):
        for error, expected in [(FileNotFoundError('private'), 'missing_path_or_tool'),
                                (PermissionError('private'), 'filesystem_permissions'),
                                (M.subprocess.TimeoutExpired('private', 1), 'command_timeout')]:
            with self.subTest(category=expected), patch.object(M.subprocess, 'Popen', side_effect=error):
                try:
                    M.Docker()(['synthetic-operation'])
                except M.Refusal as caught:
                    self.assertEqual(M.diagnostic_category(caught), expected)
                    self.assertNotIn('private', str(caught))
                else:
                    self.fail('Expected fail-closed command refusal')

    def test_host_checks_failure_boundaries_with_synthetic_fixtures(self):
        docker = Mock()
        docker.source.return_value = source()
        docker.side_effect = [M.json.dumps(M.IMAGE_ID).encode(), b'']
        progress = {}
        with patch.object(M.sys, 'platform', 'linux'), patch.object(M.os, 'geteuid', return_value=0, create=True), \
                patch.object(M, 'safe_directory'), patch.object(M.os, 'statvfs', return_value=SimpleNamespace(f_bavail=4*1024**3, f_frsize=1), create=True), \
                patch.object(M.Path, 'read_text', return_value='MemAvailable: 2097152 kB\n'):
            self.assertEqual(M.host_preflight(docker, progress), source())
        self.assertEqual(progress['step'], 'memory_availability')

    def test_deadline_probe_uses_same_flags_as_clients_not_a_gnu_version_banner(self):
        # Pinned postgres:16-alpine ships BusyBox timeout: --version exits 1 and writes stderr.
        docker = Mock()
        docker.source.return_value = source()
        docker.side_effect = [M.json.dumps(M.IMAGE_ID).encode(), b'']
        with patch.object(M.sys, 'platform', 'linux'), patch.object(M.os, 'geteuid', return_value=0, create=True), \
                patch.object(M, 'safe_directory'), patch.object(M.os, 'statvfs', return_value=SimpleNamespace(f_bavail=4*1024**3, f_frsize=1), create=True), \
                patch.object(M.Path, 'read_text', return_value='MemAvailable: 2097152 kB\n'):
            M.host_preflight(docker, {})
        probe = docker.call_args_list[1].args[0]
        self.assertEqual(probe, ['exec', '--user', 'postgres', M.SOURCE_ID, 'timeout', '-k', '1s', '5s', 'true'])
        self.assertNotIn('--version', probe)
        for name in ['psql', 'pg_dump', 'pg_dumpall', 'pg_restore']:
            self.assertNotIn(name, probe)

    def test_membership_comparison_skips_only_builtin_to_builtin_rows(self):
        # initdb's pg_monitor memberships are granted by each cluster's own bootstrap role, so they never match.
        self.assertIn("NOT (r.rolname ~ '^pg_' AND u.rolname ~ '^pg_')", M.MEMBERSHIPS)
        self.assertNotIn("r.rolname !~ '^pg_'", M.MEMBERSHIPS)

    def test_client_env_avoids_settings_libpq_rejects_or_warns_about(self):
        # Reproduced on the pinned image: PGSERVICE= fails 'definition of service "" not found';
        # PGPASSFILE=/dev/null prints a not-a-plain-file warning, which stderr-strict readers refuse.
        settings = dict(item.split('=', 1) for item in M.LOCAL_CLIENT_ENV if item != '-e')
        self.assertNotIn('PGSERVICE', settings)
        self.assertNotEqual(settings['PGPASSFILE'], '/dev/null')
        self.assertTrue(settings['PGPASSFILE'].startswith('/nonexistent/'))
        self.assertEqual(settings['PGPASSWORD'], '')
        self.assertEqual(settings['PGHOST'], '/var/run/postgresql')

    def test_database_session_failures_have_a_category_without_private_text(self):
        for code in ['snapshot_diagnostic', 'snapshot_session_failed', 'snapshot_value_shape',
                     'snapshot_output_limit', 'source_session_close_failed']:
            with self.subTest(code=code):
                self.assertEqual(M.diagnostic_category(M.Refusal(code)), 'database_preflight')

    def test_deadline_probe_refuses_unexpected_output(self):
        docker = Mock()
        docker.source.return_value = source()
        docker.side_effect = [M.json.dumps(M.IMAGE_ID).encode(), b'unexpected']
        progress = {}
        with patch.object(M.sys, 'platform', 'linux'), patch.object(M.os, 'geteuid', return_value=0, create=True), \
                self.assertRaises(M.Refusal) as caught:
            M.host_preflight(docker, progress)
        self.assertEqual(str(caught.exception), 'source_client_deadline_tool_unavailable')
        self.assertEqual(progress['step'], 'deadline_tool')

    def test_source_identity(self):
        M.validate_source(source())
        for field, bad in [('Id', 'c' * 64), ('Name', '/other'), ('Image', 'sha256:other'),
                           ('Project', 'n8n'), ('Service', 'other'), ('Running', False), ('Healthy', 'unhealthy')]:
            with self.subTest(field=field), self.assertRaises(M.Refusal):
                M.validate_source({**source(), field: bad})

    def test_valid_fixture_requires_actual_mounts(self):
        ident, facts = fixture()
        M.validate_fixture(ident, facts)
        for field, bad in [('MountInfo', ''), ('Binds', ['/host:/data']), ('NetworkMode', 'bridge'),
                           ('PortBindings', {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '15435'}]}),
                           ('ReadOnly', False), ('Mounts', [{'Type': 'volume', 'Destination': '/var/lib/postgresql/data'}])]:
            with self.subTest(field=field), self.assertRaises(M.Refusal):
                M.validate_fixture(ident, {**facts, field: bad})

    def test_fixture_resource_bounds_are_independently_verified(self):
        ident, facts = fixture()
        for key, bad in [('Memory', 0), ('NanoCpus', 0), ('ShmSize', 0), ('PidsLimit', -1), ('SecurityOpt', [])]:
            with self.subTest(key=key), self.assertRaises(M.Refusal):
                M.validate_fixture(ident, {**facts, key: bad})

    def test_wrong_actual_storage_is_refused(self):
        ident, facts = fixture()
        for bad in [facts['MountInfo'].replace('- tmpfs tmpfs rw,size=524288k', '- ext4 /dev/sda rw'),
                    facts['MountInfo'].replace('rw,nosuid,noexec', 'ro,nosuid,noexec', 1),
                    facts['MountInfo'].replace('size=524288k', 'size=1024k'),
                    facts['MountInfo'] + '\n5 2 0:5 / /var/lib/postgresql/data/nested rw - ext4 /host rw',
                    facts['MountInfo'] + '\n5 1 0:5 / /unrelated rw - ext4 /host rw']:
            with self.subTest(bad=bad[-60:]), self.assertRaises(M.Refusal):
                M.validate_fixture(ident, {**facts, 'MountInfo': bad})

    def test_wrong_resolved_storage_path_is_refused(self):
        ident, facts = fixture()
        with self.assertRaises(M.Refusal):
            M.validate_fixture(ident, {**facts, 'Resolved': {**facts['Resolved'], '/tmp': '/host'}})

    def test_cleanup_never_deletes_unowned_resources(self):
        ident, facts = fixture()
        docker = Mock(return_value={**facts, 'Labels': {'thaara.phone-restore': 'other'}})
        with self.assertRaises(M.Refusal):
            M.cleanup_fixture(docker, ident)
        self.assertFalse(any(call.args[0][0] == 'rm' for call in docker.call_args_list))

    def test_cleanup_uses_only_exact_owned_id(self):
        ident, facts = fixture()
        docker = Mock(side_effect=[facts, None])
        M.cleanup_fixture(docker, ident)
        self.assertEqual(docker.call_args_list[-1].args[0], ['rm', '-f', ident['id']])

    def test_schema_normalization_only_removes_outer_matching_psql_wrappers(self):
        a = b'-- header\n\\restrict abc123\nSET x = 1;\n-- footer\n\\unrestrict abc123\n'
        b = a.replace(b'abc123', b'def456')
        self.assertEqual(M.canonical_schema(a), M.canonical_schema(b))
        self.assertNotEqual(M.canonical_schema(a), M.canonical_schema(a.replace(b'x = 1', b'x = 2')))
        body = b'-- header\nCREATE FUNCTION x() AS $$\n\\restrict keep_me\n$$;\n'
        self.assertEqual(M.canonical_schema(body), body.replace(b'-- header\n', b''))
        with self.assertRaises(M.Refusal):
            M.canonical_schema(a.replace(b'\\unrestrict abc123', b'\\unrestrict mismatch'))

    def test_schema_match_ignores_owner_headers_but_not_sql_or_bootstrap_leaks(self):
        source = b'-- Name: f; Owner: postgres\nALTER TABLE t OWNER TO postgres;\n'
        restored = b'-- Name: f; Owner: boot_x\nALTER TABLE t OWNER TO postgres;\n'
        self.assertTrue(M.schema_matches(source, restored, 'boot_x'))
        self.assertFalse(M.schema_matches(source, b'ALTER TABLE t OWNER TO other;\n', 'boot_x'))
        self.assertFalse(M.schema_matches(source.replace(b'postgres;', b'boot_x;'), restored.replace(b'postgres;', b'boot_x;'), 'boot_x'))

    def test_only_the_exact_reviewed_reparse_lines_are_treated_as_equal(self):
        self.assertEqual(len(M.REPARSE_EQUIVALENT), 2)
        for before, after in M.REPARSE_EQUIVALENT.items():
            with self.subTest(line=before[:60]):
                # Only one redundant bracket pair differs: same conditions, same order.
                self.assertEqual(before.replace(b'(', b'').replace(b')', b''), after.replace(b'(', b'').replace(b')', b''))
                self.assertEqual(len(before) - len(after), 2)
                self.assertTrue(M.schema_matches(before, after, 'boot_x'))
                self.assertFalse(M.schema_matches(before, after.replace(b') AND (', b') OR (', 1), 'boot_x'))
                self.assertFalse(M.schema_matches(before.replace(b'AND', b'OR', 1), after, 'boot_x'))

    def migration_sql(self):
        return {step: M.base64.b64encode(b'synthetic').decode() for step, _ in M.MIGRATIONS}

    def test_migration_refuses_missing_or_altered_sql_before_any_database_work(self):
        for supplied in [None, {}, self.migration_sql()]:
            with self.subTest(supplied=bool(supplied)), patch.object(M, 'MIGRATION_SQL_B64', supplied, create=True), \
                    patch.object(M, 'run') as backup, patch.object(M, 'Docker') as docker:
                receipt = M.run_with_migration()
                self.assertEqual((receipt['status'], receipt['category'], receipt['migrationStatus'], receipt['sourceMutated']),
                                 ('failed', 'migration_failed', 'not_started', False))
                backup.assert_not_called()
                docker.assert_not_called()

    def test_migration_never_starts_without_a_verified_backup(self):
        for backup in [{'status': 'failed', 'cleanupVerified': True, 'sourceMutated': False},
                       {'status': 'verified', 'cleanupVerified': False, 'sourceMutated': False}]:
            with self.subTest(backup=backup), patch.object(M, 'migration_inputs', return_value=[]), patch.object(M, 'run', return_value=dict(backup)), \
                    patch.object(M, 'migrate') as migrate, patch.object(M.signal, 'alarm', create=True):
                receipt = M.run_with_migration()
                migrate.assert_not_called()
                self.assertEqual(receipt['migrationStatus'], 'not_started')
                self.assertFalse(receipt['sourceMutated'])

    def test_migration_refuses_a_target_that_is_not_clean_without_running_sql(self):
        dirty = {'tables': 'a', 'columns': 'b', 'roles': 'c', 'contacts': True, 'calls': False, 'events': False, 'guard': False, 'dispatch': False}
        docker = Mock()
        with patch.object(M, 'migration_facts', return_value=(dirty, None)):
            receipt = M.migrate(docker, [('110a', b'x')], {'status': 'verified', 'sourceMutated': False})
        docker.assert_not_called()
        self.assertEqual((receipt['status'], receipt['category'], receipt['migrationStep'], receipt['sourceMutated'], receipt['migrationApplied']),
                         ('failed', 'migration_failed', 'precheck', False, []))

    def test_migration_failure_reports_partial_state_and_never_continues(self):
        clean = {'tables': 'a', 'columns': 'b', 'roles': 'c', 'contacts': False, 'calls': False, 'events': False, 'guard': False, 'dispatch': False}
        partial = {**clean, 'contacts': True}
        docker = Mock(side_effect=[b'', M.Refusal('unexpected_command_diagnostic')])
        with patch.object(M, 'migration_facts', side_effect=[(clean, None), (partial, None)]):
            receipt = M.migrate(docker, [('110a', b'x'), ('110b', b'y'), ('110c', b'z')], {'status': 'verified', 'sourceMutated': False})
        self.assertEqual(docker.call_count, 2)
        self.assertEqual((receipt['status'], receipt['migrationStep'], receipt['migrationApplied'], receipt['sourceMutated']), ('failed', '110b', ['110a'], True))
        self.assertTrue(receipt['migrationObserved']['contacts'])
        self.assertFalse(receipt['migrationObserved']['calls'])

    def test_migration_rejects_changed_existing_objects_and_weak_security(self):
        good = {'rls': [['phone_call_events', True, True], ['phone_calls', True, True], ['phone_contacts', True, True]], 'rows': 0,
                'guard': [False, False, False], 'definer': 3, 'appInsert': True, 'appDelete': False, 'publicRead': False, 'publicExecute': False}
        M.validate_migrated(good)
        for change in [{'rls': [['phone_call_events', True, False], ['phone_calls', True, True], ['phone_contacts', True, True]]}, {'rows': 1},
                       {'guard': [True, False, False]}, {'definer': 2}, {'appDelete': True}, {'publicRead': True}, {'publicExecute': True}]:
            with self.subTest(change=change), self.assertRaises(M.Refusal):
                M.validate_migrated({**good, **change})
        clean = {'tables': 'a', 'columns': 'b', 'roles': 'c', 'contacts': False, 'calls': False, 'events': False, 'guard': False, 'dispatch': False}
        with patch.object(M, 'migration_facts', side_effect=[(clean, None), ({**clean, 'columns': 'changed'}, good), (clean, None)]):
            receipt = M.migrate(Mock(), [('110a', b'x')], {'status': 'verified', 'sourceMutated': False})
        self.assertEqual((receipt['status'], receipt['category'], receipt['migrationStep']), ('failed', 'migration_failed', 'postcheck'))

    def test_source_limits_and_unreviewed_capabilities(self):
        valid = {'database': M.DATABASE, 'version': 160010, 'size': 1000000, 'extensions': ['plpgsql', 'pgcrypto'],
                 'tablespaces': ['pg_default', 'pg_global'], 'foreign': 0, 'subscriptions': 0, 'events': 0, 'largeObjects': 0,
                 'materialized': 0, 'parameterAcls': 0, 'databaseSettings': 0,
                 'roles': [{'name': 'postgres', 'config': None}]}
        M.validate_metadata(valid, 'restore_bootstrap')
        for key, value in [('database', 'other'), ('version', 170000), ('size', 129 * 1024 * 1024),
                           ('extensions', ['unknown']), ('tablespaces', ['custom']), ('foreign', 1), ('subscriptions', 1), ('events', 1),
                           ('roles', [{'name': 'postgres', 'config': ['app.secret=not-allowed']}]),
                           ('roles', [{'name': 'restore_bootstrap', 'config': None}])]:
            with self.subTest(key=key), self.assertRaises(M.Refusal):
                M.validate_metadata({**valid, key: value}, 'restore_bootstrap')

    def test_counts_require_exact_relations_and_values(self):
        M.verify_counts({'["public","users"]': 3}, {'["public","users"]': 3})
        for other in [{'["public","users"]': 4}, {}, {'["public","users"]': 3, 'extra': 1}]:
            with self.assertRaises(M.Refusal):
                M.verify_counts({'["public","users"]': 3}, other)

    def test_source_commands_are_read_only_and_restore_targets_the_fixture(self):
        command = M.dump_command('snapshot-1', schema=False)
        self.assertIn(M.SOURCE_ID, command)
        self.assertIn('--snapshot=snapshot-1', command)
        restore = M.restore_command('a' * 64, 'restore_bootstrap')
        self.assertNotIn(M.SOURCE_ID, restore)
        self.assertIn('--create', restore)
        self.assertIn('--exit-on-error', restore)
        self.assertNotIn('--clean', restore)

    def test_cached_image_uses_local_immutable_id_not_registry_digest_syntax(self):
        self.assertEqual(M.IMAGE, M.IMAGE_ID)
        self.assertTrue(M.IMAGE.startswith('sha256:'))
        self.assertNotIn('@', M.IMAGE)

    def test_source_clients_cannot_use_password_files_or_external_host_environment(self):
        command = M.dump_command('snapshot-1')
        self.assertIn('PGHOST=/var/run/postgresql', command)
        self.assertIn('PGHOSTADDR=', command)
        self.assertIn('PGPASSFILE=/nonexistent/thaara-no-passfile', command)
        self.assertIn('-w', command)
        self.assertNotIn('rolpassword', M.ROLE_STATE)
        self.assertNotIn('rolpassword', M.MEMBERSHIPS)

    def test_source_client_deadline_exists_inside_container_not_only_docker_cli(self):
        command = M.dump_command('snapshot-1', seconds=40)
        self.assertEqual(command[command.index('timeout'):command.index('pg_dump')], ['timeout', '-k', '5s', '40s'])
        for seconds in [0, 111, True]:
            with self.assertRaises(M.Refusal):
                M.dump_command('snapshot-1', seconds=seconds)

    def test_source_id_cannot_be_used_as_restore_or_cleanup_target(self):
        with self.assertRaises(M.Refusal):
            M.restore_command(M.SOURCE_ID, 'restore_bootstrap')
        docker = Mock()
        with self.assertRaises(M.Refusal):
            M.cleanup_fixture(docker, {'id': M.SOURCE_ID, 'name': 'other', 'run': 'b' * 32})
        docker.assert_not_called()

    def test_readiness_requires_final_server_not_temporary_init_socket(self):
        command = M.ready_command('a' * 64, 'restore_bootstrap')
        self.assertEqual(command[command.index('-h') + 1], '127.0.0.1')
        self.assertEqual(command[command.index('-p') + 1], '5432')
        self.assertNotIn(M.SOURCE_ID, command)

    def test_private_directories_require_root_owner_and_no_symlinks(self):
        for mode, uid in [(stat.S_IFLNK | 0o700, 0), (stat.S_IFDIR | 0o777, 0), (stat.S_IFDIR | 0o700, 1000), (stat.S_IFDIR | 0o755, 0)]:
            with self.subTest(mode=mode, uid=uid), patch.object(M.os, 'lstat', return_value=SimpleNamespace(st_mode=mode, st_uid=uid)):
                with self.assertRaises(M.Refusal):
                    M.safe_directory('/synthetic', private=True)
        with patch.object(M.os, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)):
            M.safe_directory('/synthetic', private=True)

    def test_snapshot_initialization_failure_closes_owned_client(self):
        with patch.object(M.subprocess, 'Popen', return_value=Mock()), patch.object(M.selectors, 'DefaultSelector', return_value=Mock()), \
                patch.object(M.Snapshot, 'query', side_effect=M.Refusal('synthetic-failure')), patch.object(M.Snapshot, 'close') as close:
            with self.assertRaises(M.Refusal):
                M.Snapshot(Mock(), M.SOURCE_ID, 'postgres')
            close.assert_called_once()

    def test_snapshot_diagnostic_is_not_ignored_even_with_a_ready_stdout_response(self):
        session = M.Snapshot.__new__(M.Snapshot)
        session.proc, session.selector = Mock(), Mock()
        session.proc.stderr.fileno.return_value = 12
        session.proc.stdout.fileno.return_value = 11
        session.selector.select.return_value = [
            (SimpleNamespace(fileobj=session.proc.stdout, data='stdout'), 1),
            (SimpleNamespace(fileobj=session.proc.stderr, data='stderr'), 1)]
        with patch.object(M.os, 'read', return_value=b'WARNING synthetic-private-data') as read:
            with self.assertRaisesRegex(M.Refusal, '^snapshot_diagnostic$'):
                session.query('SELECT synthetic_only')
            self.assertEqual(read.call_count, 1)

    def test_command_output_is_bounded_and_only_own_mock_child_is_killed(self):
        proc, selector = Mock(), Mock()
        proc.stdout.fileno.return_value = 11
        proc.poll.return_value = None
        proc.wait.return_value = 0
        selector.get_map.return_value = {11: object()}
        selector.select.return_value = [(SimpleNamespace(fileobj=proc.stdout, data='stdout'), 1)]
        output = io.BytesIO()
        with patch.object(M.subprocess, 'Popen', return_value=proc) as popen, patch.object(M.selectors, 'DefaultSelector', return_value=selector), \
                patch.object(M.os, 'read', return_value=b'x' * 2048):
            with self.assertRaisesRegex(M.Refusal, '^command_output_limit$'):
                M.Docker()(['synthetic-operation'], output=output, limit=1024)
            self.assertEqual(output.getvalue(), b'')
            proc.kill.assert_called_once()
            self.assertEqual(popen.call_args.args[0][:2], ['docker', '--host=unix:///var/run/docker.sock'])

    def test_raw_stderr_is_never_exposed_as_diagnostic_category(self):
        proc, selector = Mock(), Mock()
        proc.stderr.fileno.return_value = 12
        proc.poll.return_value = None
        selector.get_map.return_value = {12: object()}
        selector.select.return_value = [(SimpleNamespace(fileobj=proc.stderr, data='stderr'), 1)]
        with patch.object(M.subprocess, 'Popen', return_value=proc), patch.object(M.selectors, 'DefaultSelector', return_value=selector), \
                patch.object(M.os, 'read', return_value=b'synthetic-private-data'):
            with self.assertRaisesRegex(M.Refusal, '^unexpected_command_diagnostic$'):
                M.Docker()(['synthetic-operation'])

    def test_missing_source_metadata_capability_field_cannot_be_assumed_safe(self):
        valid = {'database': M.DATABASE, 'version': 160010, 'size': 1000000, 'extensions': ['plpgsql'],
                 'tablespaces': ['pg_default', 'pg_global'], 'foreign': 0, 'subscriptions': 0, 'events': 0, 'largeObjects': 0,
                 'materialized': 0, 'parameterAcls': 0, 'roles': [{'name': 'postgres', 'config': None}]}
        with self.assertRaises(M.Refusal):
            M.validate_metadata(valid, 'restore_bootstrap')


if __name__ == '__main__':
    unittest.main()
