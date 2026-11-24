"""Post-attempt state verification only: no repair, build, SQL, provider or file writes."""
import hashlib
import json
from pathlib import Path
import subprocess

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
    stage=Path('/opt/thaara-v2-pilot-private/handoff/phone-chat-20261105')
    files={n:(stage/n).is_file() for n in ['manifest.json','deploy.review.py','Dockerfile','candidate-compose.json','previous-compose.json','rollback-image.txt']}
    p=subprocess.run(['docker','image','inspect','--format','{{.Id}}','thaara-v2-pilot-api:phone-chat-20261105'],capture_output=True,timeout=15)
    new_image=p.stdout.decode().strip() if p.returncode==0 else None
    validation=run(['docker','ps','-a','--filter','label=thaara.phone-chat.validation=20261105','--format','{{.ID}}'])
    others={}
    for n in ['thaara-v2-pilot-postgres-1','thaara-v2-pilot-redis-1','n8n-n8n-1','n8n-traefik-1']:
        others[n]=run(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}',n])
    print(json.dumps({'status':'verified','containerId':cid,'imageId':image,'sourceHealthy':health=='healthy',
        'composeSha256':hashlib.sha256(compose.read_bytes()).hexdigest(),'stageFiles':files,
        'candidateImage':new_image,'validationContainerIds':validation.splitlines() if validation else [],'otherServices':others}))
except Exception:
    print(json.dumps({'status':'stopped','category':'readonly_state_verification_failed'}));raise SystemExit(1)
