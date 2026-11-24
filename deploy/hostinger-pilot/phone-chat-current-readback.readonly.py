"""Post-attempt state verification only: no repair, build, SQL, provider or file writes."""
import hashlib
import json
from pathlib import Path
import subprocess
import re
from datetime import datetime,timezone
import urllib.request

def run(args):
    p=subprocess.run(args,capture_output=True,timeout=15)
    if p.returncode:raise RuntimeError('readback_failed')
    return p.stdout.decode().strip()

try:
    name='thaara-v2-pilot-api-1'
    cid=run(['docker','inspect','--format','{{.Id}}',name])
    image=run(['docker','inspect','--format','{{.Image}}',cid])
    health=run(['docker','inspect','--format','{{.State.Health.Status}}',cid])
    compose=Path('/opt/thaara-v2-pilot/compose.json')
    stage=Path('/opt/thaara-v2-pilot-private/handoff/phone-chat-current-20261105')
    files={n:(stage/n).is_file() for n in ['manifest.json','deploy.review.py','Dockerfile','candidate-compose.json','previous-compose.json','rollback-image.txt']}
    p=subprocess.run(['docker','image','inspect','--format','{{.Id}}','thaara-v2-pilot-api:phone-chat-current-20261105'],capture_output=True,timeout=15)
    new_image=p.stdout.decode().strip() if p.returncode==0 else None
    validation=run(['docker','ps','-a','--filter','label=thaara.phone-chat.current-validation=20261105','--format','{{.ID}}'])
    others={}
    for n in ['thaara-v2-pilot-postgres-1','thaara-v2-pilot-redis-1','n8n-n8n-1','n8n-traefik-1']:
        others[n]=run(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}',n])
    until=datetime.now(timezone.utc).isoformat()
    events_raw=run(['docker','events','--since','2026-11-05T11:35:16Z','--until',until,'--filter','type=container','--filter','label=thaara.phone-chat.current-validation=20261105','--format','{{.Action}}|{{.Actor.ID}}|{{index .Actor.Attributes "exitCode"}}'])
    events=[line.split('|') for line in events_raw.splitlines() if line]
    created={e[1] for e in events if e[0]=='create'};destroyed={e[1] for e in events if e[0]=='destroy'}
    absence=[]
    for owned_id in sorted(created):
        if not re.fullmatch('[a-f0-9]{64}',owned_id):raise RuntimeError('event_identity_invalid')
        lookup=subprocess.run(['docker','inspect',owned_id],capture_output=True,timeout=15)
        phrase=re.search(r'no such (?:object|container|image)',lookup.stderr.decode('utf8','replace'),re.I)
        absence.append({'id':owned_id,'returnCode':lookup.returncode,'sanitizedError':phrase.group(0) if phrase else 'unrecognized_error_suppressed'})
    public={}
    for route in ['/api/v1/health','/integrations/phone','/integrations/whatsapp']:
        try:
            with urllib.request.urlopen('https://thaara-v2.quantumweaveai.io'+route,timeout=10) as response:public[route]=response.status
        except Exception:public[route]=None
    print(json.dumps({'status':'verified','containerId':cid,'imageId':image,'sourceHealthy':health=='healthy',
        'validationEvents':events,'destructionEvidence':bool(created) and created==destroyed,'independentAbsence':absence,'publicStatus':public,'composeSha256':hashlib.sha256(compose.read_bytes()).hexdigest(),'stageFiles':files,
        'candidateImage':new_image,'validationContainerIds':validation.splitlines() if validation else [],'otherServices':others}))
except Exception:
    print(json.dumps({'status':'stopped','category':'readonly_state_verification_failed'}));raise SystemExit(1)
