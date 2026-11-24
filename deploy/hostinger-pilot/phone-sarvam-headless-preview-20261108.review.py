"""Run the approved synthetic test in the exact live API container, without exporting its key."""
import base64
import json
import subprocess


CID = '3bd3284fbce9ebc9e3deefa274b88ed373fd6d4f043c052af6218aae7a61182c'
IMAGE = 'sha256:da0cf28a92658a89498693e8b1724377be8a399c5c693f31db506f3d64b12d81'
FLAGS = ('sessionAttempted', 'interruptSignalObserved', 'questionMatched', 'answerMatched',
         'aiDisclosureTranscript', 'staleAudio', 'purposeMatched', 'toolEvent')
STAGES = ('signed_url', 'connect', 'greeting', 'intro', 'interrupt')


def execute(args, data=None, timeout=15):
    result = subprocess.run(['docker', '--host=unix:///var/run/docker.sock', *args], input=data,
                            capture_output=True, timeout=timeout)
    return result.returncode, result.stdout


def run_preview(payload, run=execute):
    inspect = ['inspect', '--format', '{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{.HostConfig.ReadonlyRootfs}}',
               'thaara-v2-pilot-api-1']
    code, before = run(inspect)
    if code or before.decode().strip() != f'{CID}|{IMAGE}|healthy|true':
        return {'status': 'stopped', 'category': 'live_identity_changed', 'phoneCalls': 0}
    if not 0 < len(payload) <= 600000:
        return {'status': 'stopped', 'category': 'payload_scope_denied', 'phoneCalls': 0}
    code, raw = run(['exec', '-i', CID, 'node', '--input-type=module', '-'], data=payload, timeout=120)
    final_code, after = run(inspect)
    if final_code or before != after:
        return {'status': 'stopped', 'category': 'live_identity_changed_after_preview', 'phoneCalls': 0}
    if code or len(raw) > 8192:
        return {'status': 'stopped', 'category': 'preview_process_failed', 'phoneCalls': 0}
    result = json.loads(raw)
    if result.get('status') != 'finished':
        return {'status': 'stopped', 'category': 'preview_preflight_or_transport_failed', 'phoneCalls': 0}
    rows = result['results']
    if not isinstance(rows, list) or not 1 <= len(rows) <= 2:
        raise ValueError()
    sanitized = []
    for version, row in zip((19, 21), rows):
        if row.get('version') != version or row.get('status') not in ('observed', 'incomplete', 'stopped'):
            raise ValueError()
        info = {'version': version, 'status': row['status']}
        for flag in FLAGS:
            if flag in row:
                if type(row[flag]) is not bool:
                    raise ValueError()
                info[flag] = row[flag]
        if row.get('stage') in STAGES:
            info['stage'] = row['stage']
        if 'providerStatus' in row and type(row['providerStatus']) is int and 100 <= row['providerStatus'] <= 599:
            info['providerStatus'] = row['providerStatus']
        sanitized.append(info)
    return {'status': 'finished', 'results': sanitized, 'phoneCalls': 0}


if __name__ == '__main__':
    try:
        print(json.dumps(run_preview(base64.b64decode(APPROVED_PREVIEW_PROGRAM, validate=True))))
    except Exception:
        print(json.dumps({'status': 'stopped', 'category': 'bounded_preview_failed', 'phoneCalls': 0}))
