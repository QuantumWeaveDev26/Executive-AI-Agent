import fs from 'node:fs';
import crypto from 'node:crypto';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sqlPath = 'docs/migrations/115-step115-hosted-install-20261111-r2.review.sql';
const manifestPath = 'docs/integrations/phone/PHONE_STEP115_INSTALL_20261111_R2.review.json';
const sql = fs.readFileSync(sqlPath);
if (hash(sql) !== 'c809ba7c0a44f9bdf3b76a1566edf1fbe6fc33e39a1d0c1d25e58a53025dcf8e'
  || hash(fs.readFileSync(manifestPath)) !== 'd0ed08bdcaab46e4c5ed6fae578adc8ad823a7a5312e142c38ba1576d85839ca') throw Error('Approved installation changed');
const refreshed = process.argv.includes('--refreshed-baseline');
const approved = !refreshed || process.argv.includes('--owner-approved');
const backupReceiptPath = 'node_modules/.cache/phone-step115-protected-backup-20261111.result.json';
if (refreshed && approved) {
  const proof = JSON.parse(fs.readFileSync(backupReceiptPath));
  if (proof.status !== 'verified' || proof.sourceMutated !== false || proof.providerCalls !== 0
    || !['cleanupVerified', 'countsVerified', 'schemaOwnersAclVerified', 'rolesVerified', 'sourceIdentityUnchanged',
      'apiIdentityUnchanged', 'databaseIdentityUnchanged', 'restoreContainerRemoved', 'destructionObserved'].every(key => proof[key] === true)
    || !/^[a-f0-9]{64}$/.test(proof.archiveSha256) || !/^[a-f0-9]{64}$/.test(proof.globalsSha256)) {
    throw Error('Approved installation requires the verified protected backup and restore receipt first');
  }
}
const suffix = refreshed ? '-r2' : '';
const receipt = JSON.parse(fs.readFileSync(refreshed
  ? 'node_modules/.cache/phone-step115-install-verification-20261111.result.json'
  : 'node_modules/.cache/phone-step115-schema-20261111.result.json'));
const expected = { api: [receipt.containerId, receipt.imageId, 'healthy', 'thaara-v2-pilot', 'api'],
  postgres: [receipt.databaseContainerId, receipt.databaseImageId, 'healthy', 'thaara-v2-pilot', 'postgres'] };
let python = fs.readFileSync('deploy/hostinger-pilot/phone-step115-schema-20261111.readonly.py', 'utf8').split('\ndef main():')[0];
python += `
INSTALL_SHA256 = '${hash(sql)}'
INSTALL_BASE64 = '${sql.toString('base64')}'
EXPECTED = ${JSON.stringify(expected)}
NEW_ROLES = {'thaara_phone_ingest', 'thaara_phone_guard', 'thaara_phone_notify', 'thaara_phone_notify_guard'}

def approved_payload():
    install = base64.b64decode(INSTALL_BASE64, validate=True)
    verify = base64.b64decode(SQL_BASE64, validate=True)
    if hashlib.sha256(install).hexdigest() != INSTALL_SHA256 or hashlib.sha256(verify).hexdigest() != SQL_SHA256:
        raise RuntimeError('approved_sql_checksum_mismatch')
    return install + b'\\n' + verify


def validate_post(schema):
    if {r['rolname'] for r in schema['roles']} != ROLES:
        raise RuntimeError('installed_roles_unverified')
    for role in schema['roles']:
        if any(role[key] != 'f' for key in ('rolsuper', 'rolcreaterole', 'rolcreatedb', 'rolreplication', 'rolbypassrls')):
            raise RuntimeError('elevated_role_denied')
        if role['rolname'] in NEW_ROLES and (role['rolcanlogin'] != 'f' or role['rolinherit'] != 'f'):
            raise RuntimeError('installed_role_login_denied')
    if {r['relname'] for r in schema['columns']} != TABLES or any(r['relrowsecurity'] != 't' or r['relforcerowsecurity'] != 't' for r in schema['columns']):
        raise RuntimeError('installed_rls_unverified')
    if {r['signature'].split('(')[0].removeprefix('public.') for r in schema['functions']} != FUNCTIONS:
        raise RuntimeError('installed_functions_unverified')


def main():
    payload = approved_payload()
    api = inspect('thaara-v2-pilot-api-1', 'api')
    database = inspect('thaara-v2-pilot-postgres-1', 'postgres')
    if api != EXPECTED['api'] or database != EXPECTED['postgres']:
        raise RuntimeError('target_identity_changed')
    data = execute(['docker', 'exec', '-i', '--user', 'postgres',
                    '--env', 'PGOPTIONS=-c thaara.step115_hosted_install_approved=owner-approved-step115-hosted-install-r3-acl',
                    '--env', 'PGCONNECT_TIMEOUT=5', database[0], 'psql', '-X', '-q', '-w', '--csv',
                    '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-h', '/var/run/postgresql', '-d', 'thaara_vps_pilot', '-f', '-'], payload, timeout=55)
    schema = parse_metadata(data)
    validate_post(schema)
    if api != inspect('thaara-v2-pilot-api-1', 'api') or database != inspect('thaara-v2-pilot-postgres-1', 'postgres'):
        raise RuntimeError('post_commit_container_changed_installation_requires_review')
    print(json.dumps({'status': 'verified', 'containerId': api[0], 'imageId': api[1], 'sourceHealthy': True,
        'databaseContainerId': database[0], 'databaseImageId': database[1], 'changesMade': True,
        'schemaInstalled': True, 'activation': 'disabled', 'providerRequests': 0, 'sqlSha256': INSTALL_SHA256, 'schema': schema}))


if __name__ == '__main__':
    main()
`;
const pyPath = `deploy/hostinger-pilot/phone-step115-disabled-install-20261111${suffix}.py`;
fs.writeFileSync(pyPath, python);
let ps = fs.readFileSync('scripts/phone-step115-schema-20261111.readonly.ps1', 'utf8');
ps = ps.replaceAll('phone-step115-schema-20261111', 'phone-step115-disabled-install-20261111' + suffix)
  .replaceAll('PHONE_STEP115_SCHEMA_20261111', 'PHONE_STEP115_DISABLED_INSTALL_20261111' + (refreshed ? '_R2' : ''))
  .replaceAll('ApprovedPhoneRuntimeReadOnly', 'ApprovedDisabledSchemaInstall')
  .replaceAll(`phone-step115-disabled-install-20261111${suffix}.readonly.py`, `phone-step115-disabled-install-20261111${suffix}.py`)
  .replaceAll('one_readonly_phone_step115_schema_metadata', 'one_approved_disabled_phone_step115_installation')
  .replaceAll('fixed read-only catalog SQL; schema/role metadata and function hashes only; no application rows or source definitions', 'owner-approved exact additive SQL transaction; disabled; catalog verification only')
  .replaceAll("$facts.changesMade -ne $false", "$facts.changesMade -ne $true -or $facts.schemaInstalled -ne $true -or $facts.activation -cne 'disabled'")
  .replaceAll('a4448d05d9323ae510e448acb6d0f09a08c24e1511f62071a63b00c7e742872c', hash(sql))
  .replaceAll('changesMade=$false;providerRequests=0;', "changesMade=$true;schemaInstalled=$true;activation='disabled';providerRequests=0;")
  .replaceAll("mode='readonly_phone_schema'", "mode='disabled_phone_schema_installation'")
  .replaceAll("$phase='pinned_readonly_ssh'", "$phase='pinned_disabled_install_ssh'")
  .replaceAll("throw 'readonly_preflight_failed'", "throw 'installation_outcome_unverified_do_not_retry'");
const psPath = `scripts/phone-step115-disabled-install-20261111${suffix}.ps1`;
fs.writeFileSync(psPath, ps);
const runnerManifest = {
  remoteExecutionAllowed: approved,
  authorization: approved ? 'Owner explicitly approved disabled schema installation only in the active conversation, 11 November 2026'
    : 'Refreshed API identity requires owner confirmation after the original drift stop',
  scope: { vpsId: 1871828, sshSessions: 1, databaseSessions: 1, activation: 'disabled', credentials: false, restart: false, providerRequests: 0 },
  approvedInstallationManifestSha256: hash(fs.readFileSync(manifestPath)),
  artifacts: [psPath, pyPath, sqlPath, manifestPath, ...(refreshed && approved ? [backupReceiptPath] : [])]
    .map(path => ({ path, sha256: hash(fs.readFileSync(path)) })),
};
const runnerPath = `docs/integrations/phone/PHONE_STEP115_DISABLED_INSTALL_20261111${refreshed ? '_R2' : ''}.review.json`;
fs.writeFileSync(runnerPath, JSON.stringify(runnerManifest, null, 2) + '\n');
console.log(JSON.stringify({ runner: psPath, manifest: runnerPath, manifestSha256: hash(fs.readFileSync(runnerPath)) }));
