"""Post-preflight read-only state. No build, retry, process argv/env or server writes."""
import json
import re
import subprocess
import urllib.request

def run(args):
    p=subprocess.run(args,capture_output=True,timeout=15)
    return p.returncode,p.stdout.decode().strip()

code,raw=run(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.State.Health.Status}}','thaara-v2-pilot-api-1'])
if code:
    print(json.dumps({'status':'stopped','stage':'docker_container_lookup','returnCode':code,'sourceHealthy':False,'buildExecuted':False}))
    raise SystemExit(0)
cid,image,health=raw.split('|')
code,raw=run(['docker','image','inspect','--format','{{json .RepoTags}}',image])
tags=json.loads(raw) if code==0 else []
tags=tags or []
matching=[t for t in tags if re.fullmatch(r'thaara-v2-pilot-api:[A-Za-z0-9_.-]+',t)]
public={}
for path in ['/api/v1/health','/integrations/phone','/integrations/whatsapp']:
    try:
        with urllib.request.urlopen('https://thaara-v2.quantumweaveai.io'+path,timeout=10) as response:public[path]=response.status
    except Exception:public[path]=None
print(json.dumps({'status':'verified','containerId':cid,'imageId':image,'sourceHealthy':health=='healthy',
    'totalLocalTagCount':len(tags),'approvedScriptMatchingTagCount':len(matching),'tagMetadataReadable':code==0,
    'publicStatus':public,'buildExecuted':False}))
