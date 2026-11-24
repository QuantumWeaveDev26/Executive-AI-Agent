"""Owner-required read-only baseline/tag/concurrent Docker-client check; no argv/env reads or server writes."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

BASE='sha256:d19e2e2217e8c41b8ce0eeb677b5585d7968acbd1bea6b37c69639a549d67df9'

def run(args):return subprocess.run(args,capture_output=True,timeout=15,check=True).stdout.decode().strip()

try:
    def snapshot():
        return run(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{.State.StartedAt}}|{{.RestartCount}}','thaara-v2-pilot-api-1'])
    start=snapshot();fields=start.split('|')
    assert fields[1]==BASE and fields[2]=='healthy'
    paths=[Path('/opt/thaara-v2-pilot/compose.json'),Path('/opt/thaara-v2-pilot/n8n-link-v2.sh')]
    before=[hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
    tags=json.loads(run(['docker','image','inspect','--format','{{json .RepoTags}}',BASE])) or []
    tags=sorted(t for t in tags if isinstance(t,str) and re.fullmatch(r'thaara-v2-whatsapp-enquiries:10831',t))
    assert tags
    tag=tags[0];assert run(['docker','image','inspect','--format','{{.Id}}',tag])==BASE
    candidate='sha256:213c9d89b6db4e3cc861f9adc548a629a0092285a9610bd147b56a3fd6bbc4e3'
    assert run(['docker','image','inspect','--format','{{.Id}}',candidate])==candidate
    active=[]
    # Names only, no command lines or environment (which might contain private values).
    for p in Path('/proc').iterdir():
        if not p.name.isdigit():continue
        try:
            comm=(p/'comm').read_text().strip()
            if comm in {'docker','docker-compose','docker-buildx','compose','buildx'}:active.append(comm)
        except (FileNotFoundError,ProcessLookupError):pass
    end=snapshot();after=[hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
    stable=start==end and before==after
    print(json.dumps({'status':'verified' if stable and not active else 'stopped','containerId':fields[0],
        'imageId':fields[1],'sourceHealthy':fields[2]=='healthy','baselineStable':stable,'activeDockerClients':active,
        'selectedLocalTag':tag,'selectedTagMatchesPinnedBase':True,'concurrencyObservation':'no_exclusive_lock; stable live/config snapshots plus process-name inspection'}))
except Exception:
    print(json.dumps({'status':'stopped','category':'corrected_build_preflight_failed'}));raise SystemExit(1)
