import fs from 'node:fs';
import crypto from 'node:crypto';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const backupPath = 'deploy/hostinger-pilot/phone-backup-restore.review.py';
const backup = fs.readFileSync(backupPath);
if (hash(backup) !== '650464fee1a727eeeccbf938d4e474fde3b3b336e58e812b1c55948ad326916e') throw Error('Approved backup procedure changed');
const baseline = JSON.parse(fs.readFileSync('node_modules/.cache/phone-step115-install-verification-20261111.result.json'));
const pyPath = 'deploy/hostinger-pilot/phone-step115-protected-backup-20261111.py';
const payload = `"""Approved protected backup and isolated restore only. No source migration."""
import base64, contextlib, hashlib, io, json, re, subprocess, sys, types
BACKUP_SHA256='${hash(backup)}'
BACKUP_B64='${backup.toString('base64')}'
EXPECTED_API=${JSON.stringify([baseline.containerId, baseline.imageId, 'healthy'])}
EXPECTED_DB=${JSON.stringify([baseline.databaseContainerId, baseline.databaseImageId, 'healthy'])}
def identity(name):
    value=subprocess.run(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.State.Health.Status}}',name],capture_output=True,timeout=15)
    if value.returncode: raise RuntimeError('target_identity_unavailable')
    return value.stdout.decode().strip().split('|')
def run():
    code=base64.b64decode(BACKUP_B64,validate=True)
    if hashlib.sha256(code).hexdigest()!=BACKUP_SHA256: raise RuntimeError('backup_checksum_denied')
    if identity('thaara-v2-pilot-api-1')!=EXPECTED_API or identity('thaara-v2-pilot-postgres-1')!=EXPECTED_DB:
        raise RuntimeError('target_identity_changed')
    module=types.ModuleType('step115_reviewed_backup')
    exec(compile(code,'reviewed_backup.py','exec'),module.__dict__)
    sys.argv=['reviewed_backup.py','--approved-phone-backup-restore']
    with contextlib.redirect_stdout(io.StringIO()) as captured:
        module.main()
    facts=json.loads(captured.getvalue())
    safe={key:facts.get(key) for key in ['status','sourceMutated','providerCalls','cleanupVerified','countsVerified',
       'schemaOwnersAclVerified','rolesVerified','sourceIdentityUnchanged','restoreContainerRemoved','destructionObserved',
       'archiveSha256','globalsSha256','tableCount','phase','category','preflightStep']}
    folder=facts.get('backupDirectory')
    if folder is not None:
        if not re.fullmatch('/opt/thaara-v2-pilot-private/phone-backups/phone110-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}',folder):
            raise RuntimeError('backup_path_denied')
        safe['backupDirectory']=folder
    safe['apiIdentityUnchanged']=identity('thaara-v2-pilot-api-1')==EXPECTED_API
    safe['databaseIdentityUnchanged']=identity('thaara-v2-pilot-postgres-1')==EXPECTED_DB
    if not safe['apiIdentityUnchanged'] or not safe['databaseIdentityUnchanged']: safe['status']='failed'
    print(json.dumps(safe))
if __name__=='__main__':
    try:
        run()
    except Exception as error:
        allowed={'target_identity_unavailable','backup_checksum_denied','target_identity_changed','backup_path_denied'}
        print(json.dumps({'status':'failed','category':str(error) if str(error) in allowed else 'backup_outcome_unverified','sourceMutated':False,'providerCalls':0,'cleanupVerified':False}))
`;
fs.writeFileSync(pyPath, payload);
let ps = fs.readFileSync('scripts/phone-step115-schema-20261111.readonly.ps1', 'utf8');
ps = ps.replaceAll('phone-step115-schema-20261111', 'phone-step115-protected-backup-20261111')
  .replaceAll('PHONE_STEP115_SCHEMA_20261111', 'PHONE_STEP115_PROTECTED_BACKUP_20261111')
  .replaceAll('ApprovedPhoneRuntimeReadOnly', 'ApprovedProtectedBackup')
  .replaceAll('phone-step115-protected-backup-20261111.readonly.py', 'phone-step115-protected-backup-20261111.py')
  .replaceAll('one_readonly_phone_step115_schema_metadata', 'one_owner_approved_protected_backup_and_isolated_restore')
  .replaceAll('fixed read-only catalog SQL; schema/role metadata and function hashes only; no application rows or source definitions', 'protected on-VPS backup and isolated restore verification; no source migration or provider requests')
  .replace('($verifiedPayload.Replace("`r`n","`n")) $agentEnv 90000', '($verifiedPayload.Replace("`r`n","`n")) $agentEnv 720000');
const start = ps.indexOf('  $facts=$remote.Text|ConvertFrom-Json');
const end = ps.indexOf('\n\n }\n}catch{', start);
if (start < 0 || end < 0) throw Error('Protected wrapper integration point changed');
ps = ps.slice(0, start) + `  $facts=$remote.Text|ConvertFrom-Json
  $stream=[IO.File]::Open($receipt,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$bytes=$utf8.GetBytes(($facts|ConvertTo-Json -Depth 5 -Compress));$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
  if($facts.status -cne 'verified' -or $facts.sourceMutated -ne $false -or $facts.providerCalls -ne 0 -or
    $facts.cleanupVerified -ne $true -or $facts.countsVerified -ne $true -or $facts.schemaOwnersAclVerified -ne $true -or
    $facts.rolesVerified -ne $true -or $facts.sourceIdentityUnchanged -ne $true -or $facts.apiIdentityUnchanged -ne $true -or
    $facts.databaseIdentityUnchanged -ne $true -or $facts.restoreContainerRemoved -ne $true -or $facts.destructionObserved -ne $true -or
    $facts.archiveSha256 -cnotmatch '^[a-f0-9]{64}$' -or $facts.globalsSha256 -cnotmatch '^[a-f0-9]{64}$'){
      $output=@{status='stopped';mode='protected_backup';receiptPath=$receipt;category=$facts.category;preflightStep=$facts.preflightStep}
      $global:LASTEXITCODE=1
  }else{$output=@{status='verified';mode='protected_backup';receiptPath=$receipt;archiveSha256=$facts.archiveSha256;tableCount=$facts.tableCount}}
` + ps.slice(end);
const psPath = 'scripts/phone-step115-protected-backup-20261111.ps1';
fs.writeFileSync(psPath, ps);
const manifestPath = 'docs/integrations/phone/PHONE_STEP115_PROTECTED_BACKUP_20261111.review.json';
fs.writeFileSync(manifestPath, JSON.stringify({ remoteExecutionAllowed: true,
  authorization: 'Owner explicitly approved protected backup and disabled SQL installation against STEP115_NEXT_INSTALLATION_SCOPE_20261111.md; this runner performs backup/restore only',
  artifacts: [psPath, pyPath, backupPath, 'docs/integrations/phone/STEP115_NEXT_INSTALLATION_SCOPE_20261111.md']
    .map(path => ({ path, sha256: hash(fs.readFileSync(path)) })) }, null, 2) + '\n');
console.log(JSON.stringify({ runner: psPath, manifestSha256: hash(fs.readFileSync(manifestPath)) }));
