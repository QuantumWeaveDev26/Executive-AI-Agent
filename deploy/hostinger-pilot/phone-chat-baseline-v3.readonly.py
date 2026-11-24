"""Read-only current API image/source inventory. No config, secrets, SQL or provider access."""
import base64
import hashlib
import json
import re
import subprocess
import os
import stat
from pathlib import Path

NAME = 'thaara-v2-pilot-api-1'
FILES = ['routes/conversations.js', 'services/chat-phone-calling.js',
         'services/phone-calling.js', 'services/phone-calling-store.js']

def run(args, limit=400000):
    p = subprocess.run(args, capture_output=True, timeout=15, check=True)
    if len(p.stdout) > limit:
        raise ValueError('output_limit')
    return p.stdout

def inspect(target):
    # Formatted fields only; never inspect environment values or arbitrary config.
    fmt = '{{json .Id}}|{{json .Image}}|{{json .State.Running}}|{{json .State.Health.Status}}|{{json (index .Config.Labels "com.docker.compose.project")}}|{{json (index .Config.Labels "com.docker.compose.service")}}'
    parts = run(['docker', 'inspect', '--format', fmt, target], 2048).decode().strip().split('|')
    return [json.loads(x) for x in parts]

try:
    before = inspect(NAME)
    cid, image, running, health, project, service = before
    assert re.fullmatch('[a-f0-9]{64}', cid) and re.fullmatch('sha256:[a-f0-9]{64}', image)
    assert running is True and health == 'healthy' and project == 'thaara-v2-pilot' and service == 'api'
    assert image == 'sha256:d19e2e2217e8c41b8ce0eeb677b5585d7968acbd1bea6b37c69639a549d67df9'
    mounts = json.loads(run(['docker', 'inspect', '--format', '{{json .Mounts}}', cid], 16384))
    for m in mounts:
        dest = m['Destination'].rstrip('/')
        assert dest and not ('/app' == dest or '/app'.startswith(dest + '/') or dest.startswith('/app/'))
    image_id = run(['docker', 'image', 'inspect', '--format', '{{.Id}}', image], 256).decode().strip()
    assert image_id == image
    layers = json.loads(run(['docker', 'image', 'inspect', '--format', '{{json .RootFS.Layers}}', image], 16384))
    assert layers and all(re.fullmatch('sha256:[a-f0-9]{64}', x) for x in layers)
    tags=json.loads(run(['docker','image','inspect','--format','{{json .RepoTags}}',image],16384)) or []
    assert tags and all(isinstance(t,str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*:[A-Za-z0-9_.-]+',t) for t in tags)
    tags.sort()
    assert run(['docker','image','inspect','--format','{{.Id}}',tags[0]],256).decode().strip()==image
    files = {}
    for rel in FILES:
        # Fixed source-code paths only. cat has no application/provider side effect.
        body = run(['docker', 'exec', cid, 'cat', '/app/apps/api/dist/' + rel], 300000)
        files[rel] = {'sha256': hashlib.sha256(body).hexdigest(), 'base64': base64.b64encode(body).decode()}
    review_files={}
    for rel in ['services/chat-whatsapp-assistant.js','services/chat-whatsapp-read.js','services/whatsapp-inbox.js','services/whatsapp-enquiries.js']:
        body=run(['docker','exec',cid,'cat','/app/apps/api/dist/'+rel],300000)
        review_files[rel]={'sha256':hashlib.sha256(body).hexdigest(),'base64':base64.b64encode(body).decode()}
    # Hash the complete immutable dist + web file sets without returning customer/config data.
    js = "const{createHash}=await import('node:crypto');const{readdirSync,readFileSync,lstatSync}=await import('node:fs');const out=[];function scan(p){for(const n of readdirSync(p).sort()){const f=p+'/'+n,s=lstatSync(f);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())scan(f);else if(s.isFile())out.push([f,createHash('sha256').update(readFileSync(f)).digest('hex')]);else throw Error('type')}}scan('/app/apps/api/dist');scan('/app/apps/web/dist');console.log(JSON.stringify(out));"
    inventory = json.loads(run(['docker', 'exec', cid, 'node', '--input-type=module', '-e', js], 300000))
    assert inventory and len(inventory) < 5000
    assert inspect(NAME) == before and inspect(cid) == before
    protected_hashes = {}
    for name in ['compose.json', 'n8n-link-v2.sh']:
        path = Path('/opt/thaara-v2-pilot') / name
        info = path.lstat()
        assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not (info.st_mode & 0o022)
        protected_hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    others = {}
    for name in ['thaara-v2-pilot-postgres-1','thaara-v2-pilot-redis-1','n8n-n8n-1','n8n-traefik-1']:
        fmt = '{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}'
        others[name] = run(['docker','inspect','--format',fmt,name],2048).decode().strip()
    print(json.dumps({'status':'verified','containerId':cid,'imageId':image,'layers':layers,
                      'sourceHealthy':True,'files':files,'reviewFiles':review_files,'inventory':inventory,'baseReference':tags[0],
                      'protectedHashes':protected_hashes,'otherServices':others}, separators=(',', ':')))
except Exception:
    print(json.dumps({'status':'stopped','category':'baseline_identity_or_read_failed'}))
    raise SystemExit(1)
