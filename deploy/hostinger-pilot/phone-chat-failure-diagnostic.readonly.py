"""Single read-only inspection of retained Phone Chat deployment prerequisites. Never invokes a build/deploy."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess

EXPECTED='sha256:0287204a4b9ba3db5febc37e5bf022e0d615f4c600d23a4452288f07a7533161'
ROOT=Path('/opt/thaara-v2-pilot-private/handoff/phone-chat-20261105')
checks=[]

def check(name,ok,**facts):
    checks.append({'check':name,'passed':bool(ok),**facts})

def run(args):
    p=subprocess.run(args,capture_output=True,timeout=15)
    if p.returncode:raise RuntimeError('readonly_command_failed')
    if len(p.stdout)>1048576:raise RuntimeError('readonly_output_limit')
    return p.stdout.decode().strip()

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

try:
    check('root_identity',os.geteuid()==0)
    for p in [Path('/'),Path('/opt'),Path('/opt/thaara-v2-pilot'),Path('/opt/thaara-v2-pilot-private'),ROOT]:
        s=p.lstat();check('protected_directory:'+str(p),stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,ownerRoot=s.st_uid==0,mode=oct(stat.S_IMODE(s.st_mode)))
    body=(ROOT/'manifest.json').read_bytes();m=json.loads(body)
    check('manifest_base',m['baseImage']==EXPECTED)
    cid=run(['docker','inspect','--format','{{.Id}}','thaara-v2-pilot-api-1'])
    image=run(['docker','inspect','--format','{{.Image}}',cid])
    healthy=run(['docker','inspect','--format','{{.State.Health.Status}}',cid])=='healthy'
    check('live_container',cid==m['baseContainer']);check('live_image',image==EXPECTED);check('health',healthy)
    for leaf,expected in m['protectedHashes'].items():
        p=Path('/opt/thaara-v2-pilot')/leaf;s=p.lstat()
        check('protected_config:'+leaf,stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022 and sha(p)==expected)
    for name,expected in m['otherServices'].items():
        now=run(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}',name])
        check('other_service:'+name,now==expected)
    for leaf,expected in m['packageFiles'].items():
        p=ROOT/leaf;s=p.lstat()
        check('package_file:'+leaf,stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022 and sha(p)==expected)
    check('base_image_present',run(['docker','image','inspect','--format','{{.Id}}',EXPECTED])==EXPECTED)
    layers=json.loads(run(['docker','image','inspect','--format','{{json .RootFS.Layers}}',EXPECTED]))
    check('base_layers',layers==m['baseLayers'])
    dockerfile=(ROOT/'Dockerfile').read_text()
    check('dockerfile_content',dockerfile.splitlines()[0]=='FROM '+EXPECTED and len(dockerfile.splitlines())==5)
    # Only scoped filename metadata, never environment, credentials or unrelated logs.
    logs={name:(ROOT/name).is_file() for name in ['build.log','stdout.log','stderr.log','deployment-result.json']}
    candidate=subprocess.run(['docker','image','inspect','--format','{{.Id}}','thaara-v2-pilot-api:phone-chat-20261105'],capture_output=True,timeout=15)
    validation=run(['docker','ps','-a','--filter','label=thaara.phone-chat.validation=20261105','--format','{{.ID}}'])
    print(json.dumps({'status':'verified','containerId':cid,'imageId':image,'sourceHealthy':healthy,
        'checks':checks,'allPrebuildChecksPassed':all(x['passed'] for x in checks),'retainedManifestSha256':hashlib.sha256(body).hexdigest(),
        'knownLogsExist':logs,'candidateImageExists':candidate.returncode==0,'validationContainers':len(validation.splitlines()) if validation else 0,
        'dockerVersion':run(['docker','version','--format','{{.Client.Version}}|{{.Server.Version}}']),
        'originalErrorRecoverableFromPackage':False}))
except Exception:
    print(json.dumps({'status':'stopped','category':'readonly_diagnostic_failed','checks':checks}));raise SystemExit(1)
