"""Read-only outbound rollback metadata and an isolated parser compatibility check."""
import json
import re
import subprocess

CONTAINER = 'thaara-v2-pilot-api-1'
EXPECTED = 'sha256:da0cf28a92658a89498693e8b1724377be8a399c5c693f31db506f3d64b12d81'
INVENTORY = ['docker', 'inspect', '--format',
             '{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{.HostConfig.ReadonlyRootfs}}|'
             '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}',
             CONTAINER]
PROBE = r"""
import {createHash} from 'node:crypto';
import {openSync, fstatSync, readFileSync, closeSync, constants} from 'node:fs';
const path = '/run/secrets/sarvam_profile';
if (process.env.THAARA_SARVAM_PROFILE_FILE !== path) throw Error('profile_path_mismatch');
const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
let raw;
try {
 const before = fstatSync(fd);
 if (!before.isFile() || before.size < 1 || before.size > 32768) throw Error('profile_shape');
 raw = readFileSync(fd);
 const after = fstatSync(fd);
 if (raw.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
     after.ctimeMs !== before.ctimeMs) throw Error('profile_changed');
} finally { closeSync(fd); }
const profile = JSON.parse(raw);
if (profile.appId !== 'Thaara-AI-V-db336de4-5453') throw Error('wrong_agent');
let linktreeSupported = false;
try {
 const {parseSarvamRuntimeProfile: parse} = await import('/app/apps/api/dist/services/phone-sarvam-runtime.js');
 const digest = 'a'.repeat(64);
 const synthetic = {reviewOnly:false,runtimeProfile:true,orgId:'probe-org',workspaceId:'probe-workspace',
  appId:'probe-app',appVersion:19,connectionId:'probe-connection',agentPhoneNumber:'+918000000001',
  requiredMaxCallLengthMinutes:5,verifiedMaxCallLengthMinutes:5,
  variableMapping:{call_purpose:'approvedDraft.purpose',user_name:'approvedDraft.recipient.displayName'},
  companyKnowledge:{reviewOnly:false,providerAcceptanceVerified:true,direction:'outbound',appVersion:19,
   inboundAppVersion:21,maxDurationSeconds:300,knowledgeBaseId:'probe-kb',knowledgeVersion:'qw-company-kb-v3-linktree',
   knowledgeSha256:digest,policyVersion:'qw-route-policy-v1',policySha256:digest,commonPolicySha256:digest,
   acceptanceEvidenceSha256:digest}};
 const result = parse(synthetic);
 linktreeSupported = result.profile?.companyKnowledge?.inboundAppVersion === 21 &&
  result.profile.companyKnowledge.knowledgeVersion === 'qw-company-kb-v3-linktree';
} catch { /* A missing or incompatible parser is a negative result. */ }
console.log(JSON.stringify({appVersion:profile.appVersion, profileSha256:createHash('sha256').update(raw).digest('hex'),
 linktreeSupported}));
"""


def execute(args):
    child = subprocess.run(args, capture_output=True, timeout=20)
    return child.returncode, child.stdout.decode('utf-8').strip()


def stopped(category):
    return {'status': 'stopped', 'category': category}


def inspect(run=execute):
    code, before = run(INVENTORY)
    fields = before.split('|')
    if (code or len(fields) != 6 or not re.fullmatch(r'[a-f0-9]{64}', fields[0]) or
            not re.fullmatch(r'sha256:[a-f0-9]{64}', fields[1]) or
            fields[2:] != ['healthy', 'true', 'thaara-v2-pilot', 'api']):
        return stopped('live_identity_or_health_unverified')
    cid, image = fields[:2]
    if image != EXPECTED:
        return stopped('v4_image_not_active')
    mount_format = ('{{range .Mounts}}{{if eq .Destination "/run/secrets/sarvam_profile"}}'
                    '{{if and (eq .Type "bind") (eq .Source "/opt/thaara-v2-pilot-private/secrets/sarvam_profile") (not .RW)}}'
                    'profile_mount_verified{{end}}{{end}}{{end}}')
    mount_code, mount = run(['docker', 'inspect', '--format', mount_format, cid])
    relay_probe = "fetch('http://thaara-pilot-api:3002/api/v1/health',{signal:AbortSignal.timeout(5000)}).then(r=>console.log(r.status)).catch(()=>process.exit(1))"
    relay_code, relay = run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', relay_probe])
    command = ['docker', 'exec', cid, 'node', '--input-type=module', '-e', PROBE]
    first_code, first = run(command)
    second_code, second = run(command)
    final_code, after = run(INVENTORY)
    if final_code or after != before:
        return stopped('live_identity_changed_during_read')
    if first_code or second_code or first != second:
        return stopped('profile_read_failed_or_changed')
    try:
        facts = json.loads(first)
        if (set(facts) != {'appVersion', 'profileSha256', 'linktreeSupported'} or
                type(facts['appVersion']) is not int or not 1 <= facts['appVersion'] <= 10000 or
                not re.fullmatch(r'[a-f0-9]{64}', facts['profileSha256']) or
                type(facts['linktreeSupported']) is not bool):
            raise ValueError()
    except (ValueError, TypeError):
        return stopped('profile_output_not_allowlisted')
    return {'status': 'verified', 'containerId': cid, 'imageId': image, 'sourceHealthy': True,
            'changesMade': False, 'providerRequests': 0, 'phoneRuntime': facts,
            'profileMountVerified': not mount_code and mount == 'profile_mount_verified',
            'relayHealthy': not relay_code and relay == '200'}


if __name__ == '__main__':
    try:
        print(json.dumps(inspect()))
    except (OSError, ValueError, subprocess.SubprocessError):
        print(json.dumps(stopped('metadata_read_failed')))
