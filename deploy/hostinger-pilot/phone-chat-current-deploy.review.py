"""Approval-only, image-only Phone Chat overlay. No SQL, provider calls or secret-file reads."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time

API='thaara-v2-pilot-api-1'
PILOT=Path('/opt/thaara-v2-pilot')
SITE='https://thaara-v2.quantumweaveai.io'

def require(ok,code):
    if not ok: raise RuntimeError(code)

class CommandFailure(RuntimeError):
    def __init__(self,args,returncode,stderr=b'',timed_out=False):
        # Only these locally defined command families and fixed error phrases leave memory.
        operation='command'
        if args[:2]==['docker','build']:operation='docker_build'
        elif args[:3]==['docker','image','inspect']:operation='docker_image_inspect'
        elif args[:2]==['docker','inspect']:operation='docker_container_inspect'
        elif args[:2]==['docker','compose']:operation='docker_compose'
        elif args[:2]==['docker','create']:operation='validation_container_create'
        elif args[:2]==['docker','start']:operation='validation_container_start'
        elif args[:2]==['docker','rm']:operation='validation_container_cleanup'
        elif args[:1]==['bash']:operation='private_link_restore'
        elif args[:1]==['curl']:operation='public_health_check'
        message='raw_error_not_allowlisted'
        text=stderr.decode('utf8','replace') if isinstance(stderr,bytes) else str(stderr)
        for phrase in ['pull access denied for sha256','failed to resolve source metadata for docker.io/library/sha256','invalid reference format','failed to read dockerfile','permission denied','Cannot connect to the Docker daemon']:
            if phrase in text:message=phrase;break
        self.diagnostic={'operation':operation,'returnCode':returncode,'error':message,'timedOut':timed_out}
        super().__init__('command_timeout' if timed_out else 'command_failed')

def run(args,timeout=60,env=None):
    try:p=subprocess.run(args,capture_output=True,timeout=timeout,env=env)
    except subprocess.TimeoutExpired as error:raise CommandFailure(args,None,error.stderr or b'',True) from None
    if p.returncode!=0:raise CommandFailure(args,p.returncode,p.stderr)
    require(len(p.stdout)<=1048576,'output_limit')
    return p.stdout

def digest(body): return hashlib.sha256(body).hexdigest()

def protected(path,directory=False):
    s=path.lstat()
    require(s.st_uid==0 and not s.st_mode&0o022 and (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)),'path_permissions')

def identity(name):
    return run(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}',name]).decode().strip()

def api_image(): return run(['docker','inspect','--format','{{.Image}}',API]).decode().strip()

def wait_health():
    for _ in range(40):
        if run(['docker','inspect','--format','{{.State.Health.Status}}',API]).strip()==b'healthy': return
        time.sleep(2)
    raise RuntimeError('api_health_timeout')

def inventory(image,expected):
    js="const{createHash}=await import('node:crypto');const{readdirSync,readFileSync,lstatSync}=await import('node:fs');const o=[];function scan(p){for(const n of readdirSync(p).sort()){const f=p+'/'+n,s=lstatSync(f);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())scan(f);else if(s.isFile())o.push([f,createHash('sha256').update(readFileSync(f)).digest('hex')]);else throw Error('type')}}scan('/app/apps/api/dist');scan('/app/apps/web/dist');console.log(JSON.stringify(o));"
    # Explicitly approved disposable validation container: no network, ports, mounts or provider configuration.
    require(json.loads(run(['docker','image','inspect','--format','{{json .Config.Volumes}}',image])) in (None,{}),'unexpected_image_volumes')
    cid=run(['docker','create','--label','thaara.phone-chat.current-validation=20261105','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--pids-limit','64','--entrypoint','node',image,'--input-type=module','-e',js]).decode().strip()
    require(len(cid)==64 and all(c in '0123456789abcdef' for c in cid),'validation_identity_failed')
    try:
        require(json.loads(run(['docker','inspect','--format','{{json .Mounts}}',cid]))==[],'validation_mounts_changed')
        out=run(['docker','start','--attach',cid]);require(json.loads(out)==expected,'candidate_inventory_mismatch')
    finally:
        proof=run(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{index .Config.Labels "thaara.phone-chat.current-validation"}}',cid]).decode().strip()
        require(proof==cid+'|'+image+'|20261105','validation_cleanup_identity_failed')
        run(['docker','rm','-f',cid])
        absent=subprocess.run(['docker','inspect',cid],capture_output=True,timeout=10)
        require(absent.returncode!=0 and b'No such object' in absent.stderr,'validation_cleanup_unverified')

PHASE='preflight'

def deploy(directory,manifest):
    global PHASE
    require(os.geteuid()==0,'root_required')
    for p in [Path('/'),Path('/opt'),PILOT,Path('/opt/thaara-v2-pilot-private'),directory]: protected(p,True)
    compose=PILOT/'compose.json';link=PILOT/'n8n-link-v2.sh'
    protected(compose);protected(link)
    require(digest(compose.read_bytes())==manifest['protectedHashes']['compose.json'],'compose_changed')
    require(digest(link.read_bytes())==manifest['protectedHashes']['n8n-link-v2.sh'],'link_changed')
    require(identity(API).split('|')[0]==manifest['baseContainer'] and api_image()==manifest['baseImage'],'live_base_changed')
    require(all(identity(n)==v for n,v in manifest['otherServices'].items()),'other_service_changed')
    wait_health()
    PHASE='package_verification'
    for f,expected in manifest['packageFiles'].items():
        protected(directory/f);require(digest((directory/f).read_bytes())==expected,'package_file_changed')
    require(run(['docker','image','inspect','--format','{{.Id}}',manifest['baseImage']]).decode().strip()==manifest['baseImage'],'base_image_missing')
    layers=json.loads(run(['docker','image','inspect','--format','{{json .RootFS.Layers}}',manifest['baseImage']]))
    require(layers==manifest['baseLayers'],'base_layers_changed')
    require(manifest['baseImage']=='sha256:d19e2e2217e8c41b8ce0eeb677b5585d7968acbd1bea6b37c69639a549d67df9','base_pin_mismatch')
    require(manifest['baseReference']=='thaara-v2-whatsapp-enquiries:10831','base_reference_mismatch')
    require(run(['docker','image','inspect','--format','{{.Id}}',manifest['baseReference']]).decode().strip()==manifest['baseImage'],'local_base_tag_changed')
    require((directory/'Dockerfile').read_text().splitlines()[0]=='FROM '+manifest['baseReference'],'dockerfile_base_mismatch')
    tag='thaara-v2-pilot-api:phone-chat-current-20261105'
    exists=subprocess.run(['docker','image','inspect',tag],capture_output=True,timeout=15)
    require(exists.returncode!=0 and b'No such image' in exists.stderr,'candidate_tag_exists_or_unverified')
    PHASE='docker_build'
    run(['docker','build','--network','none','--pull=false','-t',tag,'-f',str(directory/'Dockerfile'),str(directory)],180)
    new=run(['docker','image','inspect','--format','{{.Id}}',tag]).decode().strip()
    new_layers=json.loads(run(['docker','image','inspect','--format','{{json .RootFS.Layers}}',new]))
    require(new_layers[:len(layers)]==layers,'base_layers_not_preserved')
    require(run(['docker','image','inspect','--format','{{.Id}}',manifest['baseReference']]).decode().strip()==manifest['baseImage'],'local_base_tag_changed')
    PHASE='isolated_validation'
    inventory(new,manifest['expectedInventory'])
    PHASE='configuration_comparison'
    original=compose.read_bytes();model=json.loads(original)
    candidate=json.loads(original);candidate['services']['api']['image']=new
    (directory/'previous-compose.json').write_bytes(original);os.chmod(directory/'previous-compose.json',0o600)
    (directory/'rollback-image.txt').write_text(manifest['baseImage']+'\n');os.chmod(directory/'rollback-image.txt',0o600)
    candidate_path=directory/'candidate-compose.json';candidate_path.write_text(json.dumps(candidate,indent=2));os.chmod(candidate_path,0o600)
    def command(file): return ['docker','compose','--project-directory',str(PILOT),'-p','thaara-v2-pilot','-f',str(file),'--profile','application']
    old_render=json.loads(run(command(compose)+['config','--format','json']))
    new_render=json.loads(run(command(candidate_path)+['config','--format','json']))
    new_render['services']['api']['image']=old_render['services']['api']['image']
    require(new_render==old_render,'non_image_config_change')
    old_ref=old_render['services']['api']['image']
    require(run(['docker','image','inspect','--format','{{.Id}}',old_ref]).decode().strip()==manifest['baseImage'],'rollback_reference_changed')
    def link_check():
        require(digest(link.read_bytes())==manifest['protectedHashes']['n8n-link-v2.sh'],'link_changed')
        result=run(['bash',str(link)],150).decode()
        require(all(x in result for x in ['n8n_to_pilot_health=200','forged_callback_status=403','public_watch=12/12 ok','n8n_single_network=yes','n8n_not_restarted=yes']),'private_link_verification_failed')
    def check_others(): require(all(identity(n)==v for n,v in manifest['otherServices'].items()),'other_service_changed')
    changed=False
    try:
        require(identity(API).split('|')[0]==manifest['baseContainer'] and api_image()==manifest['baseImage'] and digest(compose.read_bytes())==manifest['protectedHashes']['compose.json'],'baseline_changed_before_update')
        check_others()
        compose.write_bytes(candidate_path.read_bytes());changed=True
        PHASE='api_switch'
        run(command(compose)+['up','-d','--no-deps','--pull','never','--no-build','api'],120)
        PHASE='health_and_link_verification'
        wait_health();require(api_image()==new,'new_image_mismatch');link_check();check_others()
        for route,expected in [('/api/v1/health','200'),('/integrations/phone','200'),('/integrations/whatsapp','200'),('/api/v1/connectors/phone/ai/requests','401')]:
            status=run(['curl','-sS','-o','/dev/null','-w','%{http_code}','--max-time','10',SITE+route]).decode()
            require(status==expected,'public_health_or_auth_failed')
    except Exception:
        if changed:
            PHASE='rollback'
            require(compose.read_bytes()==candidate_path.read_bytes(),'rollback_compose_conflict')
            compose.write_bytes(original)
            run(command(compose)+['up','-d','--no-deps','--pull','never','--no-build','api'],120)
            wait_health();require(api_image()==manifest['baseImage'],'rollback_image_mismatch');link_check();check_others()
            print(json.dumps({'status':'rolled_back','imageId':manifest['baseImage'],'callsPlaced':0,'databaseChanges':0}))
        raise
    return {'status':'verified','baseImage':manifest['baseImage'],'imageId':new,'filesChanged':4,'preservedFiles':len(manifest['expectedInventory'])-4,'otherServicesUnchanged':True,'callsPlaced':0,'databaseChanges':0}

if __name__=='__main__':
    if len(sys.argv)!=4 or sys.argv[1]!='--approved-phone-chat-deploy':
        print(json.dumps({'status':'review_only','deploymentExecuted':False}));raise SystemExit(0)
    try:
        directory=Path(sys.argv[2]).resolve(strict=True)
        require(directory.parent==Path('/opt/thaara-v2-pilot-private/handoff') and directory.name=='phone-chat-current-20261105','destination_denied')
        body=(directory/'manifest.json').read_bytes();require(digest(body)==sys.argv[3],'manifest_changed')
        print(json.dumps(deploy(directory,json.loads(body))))
    except Exception as error:
        allowed={'live_base_changed','compose_changed','link_changed','other_service_changed','candidate_inventory_mismatch','non_image_config_change','rollback_image_mismatch','rollback_compose_conflict','baseline_changed_before_update','local_base_tag_changed','base_reference_mismatch','base_pin_mismatch','dockerfile_base_mismatch','candidate_tag_exists_or_unverified','path_permissions','package_file_changed','base_image_missing','base_layers_changed','base_layers_not_preserved','validation_cleanup_unverified','validation_cleanup_identity_failed','unexpected_image_volumes'}
        receipt={'status':'stopped','stage':PHASE,'category':str(error) if str(error) in allowed else 'deployment_check_failed','callsPlaced':0}
        if isinstance(error,CommandFailure):receipt['commandDiagnostic']=error.diagnostic
        # Retain only the same sanitized receipt; never raw child output/configuration.
        try:
            if directory.parent==Path('/opt/thaara-v2-pilot-private/handoff') and directory.name=='phone-chat-current-20261105':
                protected(directory,True)
                fd=os.open(directory/'deployment-result.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                with os.fdopen(fd,'w') as stream:json.dump(receipt,stream)
                receipt['sanitizedReceiptRetained']=True
        except Exception:receipt['sanitizedReceiptRetained']=False
        print(json.dumps(receipt));raise SystemExit(1)
