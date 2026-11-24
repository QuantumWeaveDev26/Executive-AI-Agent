"""Fixed, read-only Phone runtime metadata. No provider requests, SQL or secret-file reads."""
import json
import re
import subprocess

CONTAINER = 'thaara-v2-pilot-api-1'
PROFILE_PROBE = r"""
const fs=require('fs'),crypto=require('crypto');
try{
 const path=process.env.THAARA_SARVAM_PROFILE_FILE;
 if(path!=='/run/secrets/sarvam_profile'){console.log(JSON.stringify({status:'profile_path_unreviewed'}));process.exit(2);}
 const s=fs.lstatSync(path);
 if(!s.isFile()||s.isSymbolicLink()||s.size>32768)throw Error('profile_shape');
 const raw=fs.readFileSync(path,'utf8'),p=JSON.parse(raw),k=p.companyKnowledge;
 if(p.appId!=='Thaara-AI-V-db336de4-5453'||!Number.isSafeInteger(p.appVersion)||p.appVersion<1)throw Error('agent_mismatch');
 console.log(JSON.stringify({status:'verified',appVersion:p.appVersion,
  runtimeProfile:p.runtimeProfile===true,reviewOnly:p.reviewOnly===true,
  requiredMaxCallLengthMinutes:p.requiredMaxCallLengthMinutes,
  verifiedMaxCallLengthMinutes:p.verifiedMaxCallLengthMinutes,
  knowledgeVersion:k?.knowledgeVersion??null,knowledgeAppVersion:k?.appVersion??null,
  inboundAppVersion:k?.inboundAppVersion??null,providerAcceptanceVerified:k?.providerAcceptanceVerified===true,
  direction:k?.direction??null,profileSha256:crypto.createHash('sha256').update(raw).digest('hex')}));
}catch{console.log(JSON.stringify({status:'profile_metadata_unavailable'}));process.exit(2);}
"""

def execute(args):
    p = subprocess.run(args, capture_output=True, timeout=20)
    return p.returncode, p.stdout.decode('utf-8').strip()

def inspect(run=execute):
    inventory = ['docker', 'inspect', '--format',
        '{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}', CONTAINER]
    code, raw = run(inventory)
    if code:
        return {'status': 'stopped', 'category': 'container_lookup_failed', 'returnCode': code}
    fields = raw.split('|')
    if len(fields) != 5 or not re.fullmatch(r'[a-f0-9]{64}', fields[0]) or not re.fullmatch(r'sha256:[a-f0-9]{64}', fields[1]) or fields[2:] != ['healthy', 'thaara-v2-pilot', 'api']:
        return {'status': 'stopped', 'category': 'source_identity_or_health_mismatch'}
    cid, image = fields[:2]
    code, raw = run(['docker', 'exec', cid, 'node', '-e', PROFILE_PROBE])
    result = {'status': 'verified', 'containerId': cid, 'imageId': image, 'sourceHealthy': True,
              'profileReadReturnCode': code, 'providerRequests': 0, 'changesMade': False}
    try:
        facts = json.loads(raw)
        allowed = {'status', 'appVersion', 'runtimeProfile', 'reviewOnly', 'requiredMaxCallLengthMinutes',
                   'verifiedMaxCallLengthMinutes', 'knowledgeVersion', 'knowledgeAppVersion', 'inboundAppVersion',
                   'providerAcceptanceVerified', 'direction', 'profileSha256'}
        if not isinstance(facts, dict) or set(facts) - allowed or facts.get('status') not in {'verified', 'profile_path_unreviewed', 'profile_metadata_unavailable'}:
            raise ValueError()
        if facts['status'] == 'verified':
            if code != 0 or type(facts.get('appVersion')) is not int or not 1 <= facts['appVersion'] <= 10000 or not re.fullmatch(r'[a-f0-9]{64}', facts.get('profileSha256', '')):
                raise ValueError()
            if facts.get('knowledgeVersion') not in {None, 'qw-company-kb-v1'} or facts.get('direction') not in {None, 'outbound'}:
                raise ValueError()
            for key in ['runtimeProfile','reviewOnly','providerAcceptanceVerified']:
                if key in facts and type(facts[key]) is not bool:
                    raise ValueError()
            for key in ['requiredMaxCallLengthMinutes','verifiedMaxCallLengthMinutes','knowledgeAppVersion','inboundAppVersion']:
                value=facts.get(key)
                if value is not None and (type(value) is not int or not 1 <= value <= 10000):
                    raise ValueError()
        result['phoneRuntime'] = facts
    except (ValueError, TypeError):
        result['status'] = 'stopped'
        result['category'] = 'profile_output_not_allowlisted'
    final_code, final_raw = run(inventory)
    if final_code or final_raw.split('|') != fields:
        return {'status':'stopped','category':'live_baseline_changed_during_read'}
    return result

if __name__ == '__main__':
    try:
        print(json.dumps(inspect()))
    except subprocess.TimeoutExpired:
        print(json.dumps({'status':'stopped','category':'command_timeout'}))
    except Exception:
        print(json.dumps({'status':'stopped','category':'metadata_read_failed'}))
