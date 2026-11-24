"""Execute exactly the owner-approved read-only catalog SQL. Export metadata and hashes only."""
import base64
import csv
import hashlib
import io
import json
import re
import subprocess

SQL_SHA256 = 'a4448d05d9323ae510e448acb6d0f09a08c24e1511f62071a63b00c7e742872c'
SQL_BASE64 = 'LS0gUHJlcGFyZWQgcmVhZC1vbmx5IG1ldGFkYXRhIGNoZWNrLiBSZXF1aXJlcyBzZXBhcmF0ZSBvd25lciBhdXRob3JpemF0aW9uIGJlZm9yZSBwcm9kdWN0aW9uIHVzZS4KLS0gTm8gYXBwbGljYXRpb24gcm93cywgY3JlZGVudGlhbHMsIGVudmlyb25tZW50IHZhbHVlcyBvciBTUUwgZGVmaW5pdGlvbnMgYXJlIHJldHVybmVkLgpCRUdJTiBUUkFOU0FDVElPTiBSRUFEIE9OTFk7ClNFVCBMT0NBTCBzdGF0ZW1lbnRfdGltZW91dD0nNXMnOwpTRVQgTE9DQUwgbG9ja190aW1lb3V0PScxcyc7CgpTRUxFQ1QgY3VycmVudF9kYXRhYmFzZSgpIEFTIGRhdGFiYXNlX25hbWUsY3VycmVudF9zZXR0aW5nKCdzZXJ2ZXJfdmVyc2lvbl9udW0nKSBBUyBzZXJ2ZXJfdmVyc2lvbjsKClNFTEVDVCByLnJvbG5hbWUsci5yb2xzdXBlcixyLnJvbGluaGVyaXQsci5yb2xjcmVhdGVyb2xlLHIucm9sY3JlYXRlZGIsci5yb2xjYW5sb2dpbixyLnJvbHJlcGxpY2F0aW9uLHIucm9sYnlwYXNzcmxzCiBGUk9NIHBnX2NhdGFsb2cucGdfcm9sZXMgciBXSEVSRSByLnJvbG5hbWUgSU4oJ3RoYWFyYV9hcHAnLCd0aGFhcmFfd29ya2VyJywndGhhYXJhX3Bob25lX2luZ2VzdCcsJ3RoYWFyYV9waG9uZV9ndWFyZCcsCiAgJ3RoYWFyYV9waG9uZV9jYWxsYmFja19ndWFyZCcsJ3RoYWFyYV9waG9uZV9ub3RpZnknLCd0aGFhcmFfcGhvbmVfbm90aWZ5X2d1YXJkJykgT1JERVIgQlkgci5yb2xuYW1lOwoKU0VMRUNUIGMucmVsbmFtZSxjLnJlbHJvd3NlY3VyaXR5LGMucmVsZm9yY2Vyb3dzZWN1cml0eSxwZ19jYXRhbG9nLnBnX2dldF91c2VyYnlpZChjLnJlbG93bmVyKSBBUyBvd25lcl9yb2xlLAogYS5hdHRuYW1lLHBnX2NhdGFsb2cuZm9ybWF0X3R5cGUoYS5hdHR0eXBpZCxhLmF0dHR5cG1vZCkgQVMgY29sdW1uX3R5cGUsYS5hdHRub3RudWxsCiBGUk9NIHBnX2NhdGFsb2cucGdfY2xhc3MgYyBKT0lOIHBnX2NhdGFsb2cucGdfbmFtZXNwYWNlIG4gT04gbi5vaWQ9Yy5yZWxuYW1lc3BhY2UKIEpPSU4gcGdfY2F0YWxvZy5wZ19hdHRyaWJ1dGUgYSBPTiBhLmF0dHJlbGlkPWMub2lkIEFORCBhLmF0dG51bT4wIEFORCBOT1QgYS5hdHRpc2Ryb3BwZWQKIFdIRVJFIG4ubnNwbmFtZT0ncHVibGljJyBBTkQgYy5yZWxuYW1lIElOKCdwaG9uZV9jb250YWN0cycsJ3Bob25lX2NhbGxzJywncGhvbmVfY2FsbF9ldmVudHMnLCdwaG9uZV9pbmJvdW5kX2NhbGxfZXZlbnRzJywKICAncGhvbmVfaW5ib3VuZF9wcmluY2lwYWxzJywncGhvbmVfY2FsbGJhY2tfcmVxdWVzdHMnLCdwaG9uZV9jYWxsYmFja19ub3RpZmljYXRpb25fZ3JhbnRzJywncGhvbmVfY2FsbGJhY2tfbm90aWZpY2F0aW9uX2dyYW50X3VzZXMnLAogICdwaG9uZV9jYWxsYmFja193b3JrZXJfcHJpbmNpcGFscycsJ3Bob25lX2NhbGxiYWNrX2Rpc3BhdGNoX251bWJlcnMnKSBPUkRFUiBCWSBjLnJlbG5hbWUsYS5hdHRudW0gTElNSVQgNTAwOwoKU0VMRUNUIHAub2lkOjpyZWdwcm9jZWR1cmU6OnRleHQgQVMgc2lnbmF0dXJlLHAucHJvc2VjZGVmIEFTIHNlY3VyaXR5X2RlZmluZXIscGdfY2F0YWxvZy5wZ19nZXRfdXNlcmJ5aWQocC5wcm9vd25lcikgQVMgb3duZXJfcm9sZSwKIGVuY29kZShzaGEyNTYoY29udmVydF90byhwZ19jYXRhbG9nLnBnX2dldF9mdW5jdGlvbmRlZihwLm9pZCksJ1VURjgnKSksJ2hleCcpIEFTIGRlZmluaXRpb25fc2hhMjU2CiBGUk9NIHBnX2NhdGFsb2cucGdfcHJvYyBwIEpPSU4gcGdfY2F0YWxvZy5wZ19uYW1lc3BhY2UgbiBPTiBuLm9pZD1wLnByb25hbWVzcGFjZQogV0hFUkUgbi5uc3BuYW1lPSdwdWJsaWMnIEFORCBwLnByb25hbWUgSU4oJ3Bob25lX3Byb3ZpZGVyX2JpbmRpbmcnLCdhcHBseV9waG9uZV9wcm92aWRlcl9ldmVudCcsJ2NvbXBsZXRlX3Bob25lX3Byb3ZpZGVyX3JlcG9ydCcsCiAgJ3Bob25lX2luYm91bmRfcmVzb2x2ZV9ncmFudCcsJ3Bob25lX2luYm91bmRfc2NvcGVfbWF0Y2hlcycsJ3Bob25lX2luYm91bmRfYXBwZW5kX2V2ZW50JywncGhvbmVfY2FsbGJhY2tfd29ya2VyX29wZXJhdGlvbicsCiAgJ3Bob25lX2NhbGxiYWNrX3ZhbGlkYXRlX2dyYW50JywncGhvbmVfY2FsbGJhY2tfcmVjb3JkX2dyYW50X3VzZScsJ3Bob25lX2NhbGxiYWNrX2luYm91bmRfc2F2ZScsCiAgJ3Bob25lX2NhbGxiYWNrX291dGJvdW5kX2NvbnRleHQnLCdwaG9uZV9jYWxsYmFja19vdXRib3VuZF9zYXZlJykgT1JERVIgQlkgc2lnbmF0dXJlIExJTUlUIDUwOwpDT01NSVQ7Cg=='
HEADERS = {
    'database': ('database_name', 'server_version'),
    'roles': ('rolname', 'rolsuper', 'rolinherit', 'rolcreaterole', 'rolcreatedb', 'rolcanlogin', 'rolreplication', 'rolbypassrls'),
    'columns': ('relname', 'relrowsecurity', 'relforcerowsecurity', 'owner_role', 'attname', 'column_type', 'attnotnull'),
    'functions': ('signature', 'security_definer', 'owner_role', 'definition_sha256'),
}
ROLES = {'thaara_app', 'thaara_worker', 'thaara_phone_ingest', 'thaara_phone_guard',
         'thaara_phone_callback_guard', 'thaara_phone_notify', 'thaara_phone_notify_guard'}
TABLES = {'phone_contacts', 'phone_calls', 'phone_call_events', 'phone_inbound_call_events', 'phone_inbound_principals',
          'phone_callback_requests', 'phone_callback_notification_grants', 'phone_callback_notification_grant_uses',
          'phone_callback_worker_principals', 'phone_callback_dispatch_numbers'}
FUNCTIONS = {'phone_provider_binding', 'apply_phone_provider_event', 'complete_phone_provider_report',
             'phone_inbound_resolve_grant', 'phone_inbound_scope_matches', 'phone_inbound_append_event',
             'phone_callback_worker_operation', 'phone_callback_validate_grant', 'phone_callback_record_grant_use',
             'phone_callback_inbound_save', 'phone_callback_outbound_context', 'phone_callback_outbound_save'}


def parse_metadata(value):
    if len(value) > 1048576:
        raise ValueError('metadata_limit')
    result = {name: [] for name in HEADERS}
    seen = set()
    section = None
    for row in csv.reader(io.StringIO(value)):
        if not row:
            continue
        match = next((name for name, header in HEADERS.items() if tuple(row) == header), None)
        if match:
            if match in seen:
                raise ValueError('repeated_metadata_header')
            seen.add(match)
            section = match
            continue
        if section is None or len(row) != len(HEADERS[section]) or any(len(field) > 1024 for field in row):
            raise ValueError('unexpected_metadata_shape')
        record = dict(zip(HEADERS[section], row))
        if section == 'database' and (record['database_name'] != 'thaara_vps_pilot' or not re.fullmatch('[0-9]{6}', record['server_version'])):
            raise ValueError('unexpected_database')
        if section == 'roles' and record['rolname'] not in ROLES:
            raise ValueError('unexpected_role')
        if section == 'columns' and record['relname'] not in TABLES:
            raise ValueError('unexpected_relation')
        if section == 'functions' and (record['signature'].split('(')[0].removeprefix('public.') not in FUNCTIONS
                                      or not re.fullmatch('[a-f0-9]{64}', record['definition_sha256'])):
            raise ValueError('unexpected_function')
        result[section].append(record)
    if seen != set(HEADERS) or len(result['database']) != 1 or len(result['roles']) > 7 or len(result['columns']) > 500 or len(result['functions']) > 50:
        raise ValueError('metadata_count_denied')
    return result


def execute(arguments, payload=None, timeout=15):
    process = subprocess.run(arguments, input=payload, capture_output=True, timeout=timeout)
    if process.returncode != 0:
        raise RuntimeError('readonly_command_failed')
    return process.stdout.decode('utf-8').strip()


def inspect(container, service):
    value = execute(['docker', 'inspect', '--format',
                     '{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}', container])
    parts = value.split('|')
    if len(parts) != 5 or not re.fullmatch('[a-f0-9]{64}', parts[0]) or not re.fullmatch('sha256:[a-f0-9]{64}', parts[1]) or parts[2:] != ['healthy', 'thaara-v2-pilot', service]:
        raise RuntimeError('container_identity_unavailable')
    return parts


def main():
    sql = base64.b64decode(SQL_BASE64, validate=True)
    if hashlib.sha256(sql).hexdigest() != SQL_SHA256:
        raise RuntimeError('approved_sql_checksum_mismatch')
    api = inspect('thaara-v2-pilot-api-1', 'api')
    database = inspect('thaara-v2-pilot-postgres-1', 'postgres')
    data = execute(['docker', 'exec', '-i', '--user', 'postgres',
                    '--env', 'PGOPTIONS=-c default_transaction_read_only=on', '--env', 'PGCONNECT_TIMEOUT=5',
                    database[0], 'psql', '-X', '-q', '-w', '--csv', '-v', 'ON_ERROR_STOP=1',
                    '-U', 'postgres', '-h', '/var/run/postgresql', '-d', 'thaara_vps_pilot', '-f', '-'], sql, timeout=35)
    schema = parse_metadata(data)
    if api != inspect('thaara-v2-pilot-api-1', 'api') or database != inspect('thaara-v2-pilot-postgres-1', 'postgres'):
        raise RuntimeError('container_changed')
    print(json.dumps({'status': 'verified', 'containerId': api[0], 'imageId': api[1], 'sourceHealthy': True,
                      'databaseContainerId': database[0], 'databaseImageId': database[1], 'changesMade': False,
                      'providerRequests': 0, 'sqlSha256': SQL_SHA256, 'schema': schema}))


if __name__ == '__main__':
    main()
