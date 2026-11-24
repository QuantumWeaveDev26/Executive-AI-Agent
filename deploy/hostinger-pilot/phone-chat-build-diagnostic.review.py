"""Exactly one build-only diagnostic. No deploy, container start, SQL, secret/config writes or provider calls."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import urllib.request
import zipfile

BASE='sha256:0287204a4b9ba3db5febc37e5bf022e0d615f4c600d23a4452288f07a7533161'
ZIP_SHA='ada9bb9714c8e398f028270b6fcd8d77180e81c81af9dc4b7d6e719f48f55d69'
ROOT=Path('/opt/thaara-v2-pilot-private/handoff/phone-chat-20261105')
API='thaara-v2-pilot-api-1'
TAG='thaara-v2-pilot-api:phone-chat-20261105'

def require(ok,code):
    if not ok:raise RuntimeError(code)

def run(args):
    p=subprocess.run(args,capture_output=True,timeout=15)
    require(p.returncode==0,'readonly_command_failed')
    require(len(p.stdout)<1048576,'readonly_output_limit')
    return p.stdout.decode().strip()

def protected(p,directory=False):
    s=p.lstat()
    require(s.st_uid==0 and not s.st_mode&0o022 and (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)),'path_permissions')

def sha(b):return hashlib.sha256(b).hexdigest()

def identity(name):return run(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}',name])

def sanitize(stderr):
    # Fixed phrases only. No arbitrary stderr, environment, URLs, build context or credentials are emitted.
    text=stderr.decode('utf8','replace') if isinstance(stderr,bytes) else str(stderr)
    phrases=['failed to resolve source metadata for docker.io/library/sha256','pull access denied','repository does not exist or may require authorization','insufficient_scope: authorization failed','invalid reference format','failed to read dockerfile','permission denied','Cannot connect to the Docker daemon','network is unreachable','no space left on device']
    found=[p for p in phrases if p in text]
    return found or ['unrecognized_error_output_suppressed']

def main(package_b64):
    receipt={'status':'stopped','buildStarted':False,'buildSucceeded':False,'callsPlaced':0,'deploymentExecuted':False}
    try:
        body=base64.b64decode(package_b64,validate=True);require(sha(body)==ZIP_SHA,'original_zip_mismatch')
        require(os.geteuid()==0,'root_required')
        for p in [Path('/'),Path('/opt'),Path('/opt/thaara-v2-pilot'),Path('/opt/thaara-v2-pilot-private'),ROOT]:protected(p,True)
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            m=json.loads(z.read('manifest.json'))
            require(set(z.namelist())==set(m['packageFiles'])|{'manifest.json'},'package_scope_mismatch')
            for f in z.namelist():
                require(not f.startswith('/') and '\\' not in f and '..' not in f.split('/'),'package_path_invalid')
                p=ROOT/f;protected(p)
                require(sha(p.read_bytes())==sha(z.read(f)),'retained_package_file_mismatch')
            require(all(sha(z.read(f))==h for f,h in m['packageFiles'].items()),'package_manifest_mismatch')
        require(m['baseImage']==BASE,'base_pin_mismatch')
        start=identity(API)
        require(start.split('|')[:2]==[m['baseContainer'],BASE],'live_baseline_changed')
        require(run(['docker','inspect','--format','{{.State.Health.Status}}',API])=='healthy','live_unhealthy')
        for leaf,h in m['protectedHashes'].items():
            p=Path('/opt/thaara-v2-pilot')/leaf;protected(p);require(sha(p.read_bytes())==h,'protected_config_changed')
        require(all(identity(n)==v for n,v in m['otherServices'].items()),'other_service_changed')
        require(run(['docker','image','inspect','--format','{{.Id}}',BASE])==BASE,'base_image_missing')
        require(json.loads(run(['docker','image','inspect','--format','{{json .RootFS.Layers}}',BASE]))==m['baseLayers'],'base_layers_changed')
        existing=subprocess.run(['docker','image','inspect',TAG],capture_output=True,timeout=15)
        require(existing.returncode!=0 and b'No such image' in existing.stderr,'candidate_tag_exists_or_unverified')
        command=['docker','build','--network','none','--pull=false','-t',TAG,'-f',str(ROOT/'Dockerfile'),str(ROOT)]
        receipt.update(status='verified',buildStarted=True,command=command,stage='docker_build',originalPackageMatched=True,preflightPassed=True)
        try:
            result=subprocess.run(command,capture_output=True,timeout=180)
            receipt.update(returnCode=result.returncode,buildSucceeded=result.returncode==0,
                sanitizedError=[] if result.returncode==0 else sanitize(result.stderr+b'\n'+result.stdout))
        except subprocess.TimeoutExpired as error:
            receipt.update(returnCode=None,buildSucceeded=False,timedOut=True,sanitizedError=sanitize(error.stderr or b''))
        if receipt['buildSucceeded']:
            built=run(['docker','image','inspect','--format','{{.Id}}',TAG])
            layers=json.loads(run(['docker','image','inspect','--format','{{json .RootFS.Layers}}',built]))
            require(layers[:len(m['baseLayers'])]==m['baseLayers'],'candidate_base_layers_changed')
            receipt['candidateImage']=built
        else:receipt['candidateImage']=None
        receipt['liveImage']=run(['docker','inspect','--format','{{.Image}}',API])
        receipt['liveHealthy']=run(['docker','inspect','--format','{{.State.Health.Status}}',API])=='healthy'
        receipt['liveContainerUnchanged']=identity(API)==start
        receipt['configurationUnchanged']=all(sha((Path('/opt/thaara-v2-pilot')/f).read_bytes())==h for f,h in m['protectedHashes'].items())
        receipt['otherServicesUnchanged']=all(identity(n)==v for n,v in m['otherServices'].items())
        public={}
        for path in ['/api/v1/health','/integrations/phone','/integrations/whatsapp']:
            try:
                with urllib.request.urlopen('https://thaara-v2.quantumweaveai.io'+path,timeout=10) as response:public[path]=response.status
            except Exception:public[path]=None
        receipt['publicStatus']=public
        receipt['postChecksPassed']=receipt['liveImage']==BASE and receipt['liveHealthy'] and receipt['liveContainerUnchanged'] and receipt['configurationUnchanged'] and receipt['otherServicesUnchanged'] and all(v==200 for v in public.values())
        receipt['temporaryRemoteFilesCreated']=0
    except Exception as error:
        allowed={'original_zip_mismatch','package_scope_mismatch','package_path_invalid','retained_package_file_mismatch','package_manifest_mismatch','base_pin_mismatch','live_baseline_changed','live_unhealthy','protected_config_changed','other_service_changed','base_image_missing','base_layers_changed','candidate_tag_exists_or_unverified','path_permissions','candidate_base_layers_changed'}
        receipt.update(status='stopped',category=str(error) if str(error) in allowed else 'diagnostic_check_failed')
    return receipt

if __name__=='__main__':
    print(json.dumps(main(PACKAGE_B64)))
