"""One reviewed candidate build + networkless import check. No deployment or SQL."""
import base64
import hashlib
import io
import json
import os
import re
import subprocess
import tarfile
import time
import uuid
import zipfile

BASE='sha256:b1b13df2fb1b51817765f099c2645e25bafa6934251add0d71c890c6f29d7117'
ZIP_SHA='3de4e8f3b72c6c2046451c124fe67fe1f510ccc2fa6090c4b6d567b6570ec3fc'
API='thaara-v2-pilot-api-1'
TAG='thaara-v2-pilot-api:phone-sarvam-compatibility-20261108-v3'
LABEL='thaara.phone.sarvam-compatibility-build'
FILES={'overlay/sarvam/phone-sarvam-runtime.js', 'validate.mjs', 'overlay/contracts/phone-sarvam-compat.js', 'overlay/contracts/index.js', 'overlay/sarvam/phone-sarvam-knowledge-binding.js', 'manifest.json', 'overlay/sarvam/phone-sarvam-calls.js'}
BASELINE_FILES={'/app/apps/api/dist/services/phone-sarvam-knowledge-binding.js', '/app/apps/api/dist/app.js', '/app/apps/api/dist/services/phone-sarvam-results.js', '/app/apps/web/dist/assets/index-Co2o2hIb.css', '/app/apps/api/dist/services/whatsapp-durable.js', '/app/apps/api/node_modules/@thaara/contracts/dist/index.js', '/app/apps/api/dist/services/whatsapp-enquiries.js', '/app/apps/api/pilot-start.mjs', '/app/apps/api/dist/services/phone-sarvam-runtime.js', '/app/apps/api/dist/services/phone-sarvam-calls.js', '/app/apps/api/dist/services/phone-pilot-startup.js', '/app/apps/web/dist/index.html', '/app/apps/web/dist/assets/index-CAoiIo_h.js', '/app/apps/api/node_modules/@thaara/contracts/dist/phone-sarvam-compat.js'}
LIVE_FORMAT='{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.StartedAt}}|{{.HostConfig.ReadonlyRootfs}}|[{{range $i,$mount := .Mounts}}{{if $i}},{{end}}{{json $mount.Destination}}{{end}}]'
OWNED_FORMAT='{{.Id}}|{{.Image}}|{{.Name}}|{{index .Config.Labels "'+LABEL+'"}}|{{.HostConfig.NetworkMode}}|{{.HostConfig.ReadonlyRootfs}}|{{len .Mounts}}|{{.HostConfig.Privileged}}|{{.Config.User}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}|{{.HostConfig.Memory}}|{{.HostConfig.PidsLimit}}|{{.State.Status}}'
IMAGE_CONFIG='{{.Config.User}}|{{.Config.WorkingDir}}|{{json .Config.Volumes}}|{{json .Config.Cmd}}|{{json .Config.Entrypoint}}|{{json .Config.Healthcheck}}'
ROOTS={'overlay/sarvam/':'/app/apps/api/dist/services/','overlay/contracts/':'/app/apps/api/node_modules/@thaara/contracts/dist/'}

class Stop(Exception):pass
def require(ok,code):
    if not ok:raise Stop(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def valid_id(s):return re.fullmatch(r'[a-f0-9]{64}',s) is not None
def valid_image(s):return re.fullmatch(r'sha256:[a-f0-9]{64}',s) is not None

def mount_destinations(raw):
    try:destinations=json.loads(raw)
    except Exception as error:raise ValueError('invalid mount inventory') from error
    if not isinstance(destinations,list):
        raise ValueError('invalid mount inventory')
    for path in destinations:
        if (not isinstance(path,str) or not path.startswith('/') or
            any(part in ('','.','..') for part in path[1:].split('/')) or
            any(ord(char)<32 for char in path) or path=='/app' or path.startswith('/app/')):
            raise ValueError('unsafe mount destination')
    if len(destinations)!=len(set(destinations)):
        raise ValueError('duplicate mount destination')
    return sorted(destinations)

def decode_package(body,expected=ZIP_SHA):
    require(len(body)<=262144 and sha(body)==expected,'package_checksum_mismatch')
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        require(set(z.namelist())==FILES and len(z.namelist())==len(FILES),'package_scope_mismatch')
        require(sum(i.file_size for i in z.infolist())<1048576 and all((i.external_attr>>16)&0o170000 in (0,0o100000) for i in z.infolist()),'package_size_or_type_denied')
        files={name:z.read(name) for name in FILES}
    m=json.loads(files['manifest.json'])
    require(m['baseImage']==BASE and m['baseContainer']==API and m['reviewOnly'] is True and m['executionAuthorized'] is False and m['buildOnly'] is True and m['assembly']=='exact-local-stopped-container','package_mode_mismatch')
    require(set(m['packageFiles'])==FILES-{'manifest.json'} and all(sha(files[n])==h for n,h in m['packageFiles'].items()),'package_inner_hash_mismatch')
    installed={target+n[len(prefix):]:sha(body) for n,body in files.items() for prefix,target in ROOTS.items() if n.startswith(prefix)}
    require(set(m['baselineFiles'])==BASELINE_FILES and m['baselineFiles']=={'/app/apps/api/dist/app.js': '661ddf6e2f77d8357544fb31d60740401093b4a5e6d39f34014bd3b759c1b36a', '/app/apps/api/dist/services/phone-pilot-startup.js': '7273fc04178102049eae487793dc2b90176987adb4abada521faad73998a5430', '/app/apps/api/dist/services/phone-sarvam-calls.js': '955e65dce7aa5c4f48b3925de090b48cbcd5779c196b5d61561ce1be20a459e2', '/app/apps/api/dist/services/phone-sarvam-knowledge-binding.js': None, '/app/apps/api/dist/services/phone-sarvam-results.js': '6688511df42b20055b48a65e56e0dfbc963291a20a6566d6b036a472860f77b3', '/app/apps/api/dist/services/phone-sarvam-runtime.js': '96a9ee4d122b82a6e3fd3f8737e3e97650a338a87b3cbd38ce291eac1d8c3c9f', '/app/apps/api/dist/services/whatsapp-durable.js': 'dfc0036868bea4ab37f8f9b0e074fdda336378590915d418decd491addeabb91', '/app/apps/api/dist/services/whatsapp-enquiries.js': '2e913e8192606b58c34e91cc26e117396367fc773fd6fbb3f65aeb4a88c603c4', '/app/apps/api/node_modules/@thaara/contracts/dist/index.js': '10ab922a56b468843eec0a853bea41de1dd4f60e39006593e50a4127088d8a30', '/app/apps/api/pilot-start.mjs': 'cbffaddee7dae4918420a2942ea2bcaab5f64a6136b20e13c97ee9c52fa2528d', '/app/apps/web/dist/assets/index-CAoiIo_h.js': '504aa0bc3133edd6a6d0639562d1eed9d087ed202c3e7b7f4a3f51ade4260394', '/app/apps/web/dist/assets/index-Co2o2hIb.css': 'ed715f21be63f91a95091267354402101c750b39666ff5f6a8b52d853ff63309', '/app/apps/web/dist/index.html': 'ae2eb1b4e729f83513746d37a92d97162e418256d4cd2631bbcb09953f4eff6d', '/app/apps/api/node_modules/@thaara/contracts/dist/phone-sarvam-compat.js': None} and m['installedFiles']==installed,'package_inventory_mismatch')
    return m,files

def execute(args,data=None,timeout=15):
    require(args[0]=='docker','command_scope_denied')
    p=subprocess.run(['docker','--host=unix:///var/run/docker.sock',*args[1:]],input=data,capture_output=True,timeout=timeout)
    require(len(p.stdout)<1048576,'child_output_limit')
    return p.returncode,p.stdout,p.stderr

def checked(run,args,timeout=15):
    code,output,_=run(args,timeout=timeout)
    require(code==0,'readonly_command_failed')
    return output.decode('utf8').strip()

def missing(code,error,kind):
    s=error.lower();phrases=(b'no such object',b'no such '+kind.lower().encode())
    return code==1 and any(p in s for p in phrases)

def sanitize(error):
    phrases=['pull access denied','invalid reference format','permission denied','network is unreachable','no space left on device','Cannot connect to the Docker daemon']
    s=error.decode('utf8','replace')
    return [p for p in phrases if p in s] or ['unrecognized_error_output_suppressed']

def validation_command(name,owner,image,probe):
    args=['docker','create','--name',name,'--label',LABEL+'='+owner,'--pull=never','--network','none',
          '--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--pids-limit','64','--user','1000:1000']
    return args+[image] if probe is None else args+['--read-only','--no-healthcheck','--entrypoint','node',image,'--input-type=module','-e',probe]

def overlay_archive(files,index_path):
    require(isinstance(index_path,str) and re.fullmatch(r'/app/apps/api/node_modules/(?:[A-Za-z0-9._@+~%-]+/)+dist/index\.js',index_path) and not any(p in ('.','..') for p in index_path.split('/')),'installed_contract_path_denied')
    output=io.BytesIO()
    with tarfile.open(fileobj=output,mode='w') as archive:
        for name,body in sorted(files.items()):
            for prefix,target in ROOTS.items():
                if name.startswith(prefix):
                    if prefix=='overlay/contracts/':target=index_path.rsplit('/',1)[0]+'/'
                    entry=tarfile.TarInfo((target+name[len(prefix):])[1:]);entry.size=len(body);entry.uid=entry.gid=1000;entry.mode=0o644
                    archive.addfile(entry,io.BytesIO(body))
    return output.getvalue()

def owned_container(run,name,owner,image,lookup=None):
    code,raw,error=run(['docker','inspect','--format',OWNED_FORMAT,lookup or name],timeout=15)
    if missing(code,error,'container'):return None
    f=raw.decode().strip().split('|')
    require(code==0 and len(f)==14 and valid_id(f[0]) and f[1:4]==[image,'/'+name,owner],'validation_identity_mismatch')
    return f

def cleanup_container(run,name,owner,image,expected_id):
    f=owned_container(run,name,owner,image,expected_id)
    if f is not None:
        require(expected_id is not None and f[0]==expected_id,'validation_cleanup_id_changed')
        checked(run,['docker','rm','-f',expected_id])
        require(owned_container(run,name,owner,image,expected_id) is None,'validation_cleanup_id_still_exists')
    require(owned_container(run,name,owner,image) is None,'validation_cleanup_name_still_exists')

def cleanup_failed_image(run,owner,expected_image):
    code,raw,error=run(['docker','image','inspect','--format','{{.Id}}|{{index .Config.Labels "'+LABEL+'"}}',TAG],timeout=15)
    if missing(code,error,'image'):
        if expected_image is not None:
            code,_,error=run(['docker','image','inspect',expected_image],timeout=15)
            require(missing(code,error,'image'),'candidate_cleanup_image_still_exists')
        return
    f=raw.decode().strip().split('|')
    require(code==0 and len(f)==2 and valid_image(f[0]) and f[0]!=BASE and f[1]==owner and (expected_image is None or expected_image==f[0]),'candidate_cleanup_identity_mismatch')
    checked(run,['docker','image','rm',f[0]])
    code,_,error=run(['docker','image','inspect',TAG],timeout=15)
    require(missing(code,error,'image'),'candidate_cleanup_unverified')
    code,_,error=run(['docker','image','inspect',f[0]],timeout=15)
    require(missing(code,error,'image'),'candidate_cleanup_image_still_exists')

def build_candidate(body,run=execute):
    result={'status':'stopped','stage':'preflight','buildStarted':False,'validationStarted':False,
            'deploymentExecuted':False,'databaseCommands':0,'providerRequests':0,'cleanupVerified':False}
    owner=uuid.uuid4().hex;owned=[];image=None;uncertain=False;api_id=None
    start=time.monotonic()
    def bounded(deadline):
        def call(args,data=None,timeout=15):
            remaining=min(timeout,deadline-time.monotonic())
            if remaining<=0:raise subprocess.TimeoutExpired(args[:2],timeout)
            return run(args,data=data,timeout=remaining)
        return call
    work=bounded(start+170);cleanup=bounded(start+230)
    def mutate(args,data=None,timeout=15):
        nonlocal uncertain
        try:return work(args,data=data,timeout=timeout)
        except subprocess.TimeoutExpired:
            uncertain=True
            raise
    def live(check,expected_id=None):
        raw=checked(check,['docker','inspect','--format',LIVE_FORMAT,API])
        identity=raw.split('|',7)
        require(len(identity)==8 and valid_id(identity[0]) and (expected_id is None or identity[0]==expected_id) and identity[1:5]==[BASE,'healthy','thaara-v2-pilot','api'] and identity[6]=='true','live_baseline_mismatch')
        try:identity[7]=mount_destinations(identity[7])
        except ValueError:raise Stop('live_app_mount_denied')
        return identity
    def absent_tag():
        code,_,error=work(['docker','image','inspect',TAG])
        require(missing(code,error,'image'),'candidate_tag_exists_or_unverified')
    def create(name,base,probe=None):
        record=[name,base,None];owned.append(record)
        cid=checked(mutate,validation_command(name,owner,base,probe));require(valid_id(cid),'created_container_id_denied')
        record[2]=cid
        f=owned_container(work,name,owner,base)
        mode='false' if probe is None else 'true'
        require(f and f[0]==cid and f[4:9]==['none',mode,'0','false','1000:1000'] and json.loads(f[9])==['ALL'] and json.loads(f[10]) in (['no-new-privileges'],['no-new-privileges=true']) and f[11:]==['268435456','64','created'],'validation_isolation_mismatch')
        return cid
    try:
        m,files=decode_package(body)
        initial=live(work, '08f378a8216af3b5b24749825da6d9fe789bd9b891831ede1e27df673b093ba8');api_id=initial[0]
        config=checked(work,['docker','image','inspect','--format',IMAGE_CONFIG,BASE]);fields=config.split('|')
        require(len(fields)==6 and fields[:2]==['1000:1000','/app/apps/api'] and fields[2] in ('null','{}'),'base_image_config_denied')
        # Exact code/asset checks and the actual installed package path; never read secret files or environment values.
        probe="const fs=require('fs'),c=require('crypto');try{let index;for(const [p,h]of Object.entries("+json.dumps(m['baselineFiles'])+")){if(h===null){try{fs.lstatSync(p);throw Error('unexpected_file');}catch(e){if(e.code!=='ENOENT')throw e;}continue;}const r=fs.realpathSync(p);if(p.endsWith('/@thaara/contracts/dist/index.js')){if(!r.startsWith('/app/apps/api/node_modules/')||!r.endsWith('/dist/index.js'))throw Error();index=r;}else if(r!==p)throw Error();const fd=fs.openSync(r,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size<1||st.size>700000)throw Error();const b=Buffer.alloc(st.size);let n=0;while(n<b.length){const k=fs.readSync(fd,b,n,b.length-n,n);if(!k)throw Error();n+=k;}const after=fs.fstatSync(fd);if(st.size!==after.size||st.mtimeMs!==after.mtimeMs||st.ctimeMs!==after.ctimeMs||c.createHash('sha256').update(b).digest('hex')!==h)throw Error();}finally{fs.closeSync(fd);}}for(const d of ['/app/apps/api/dist/routes','/app/apps/api/dist/services','/app/apps/web/dist/assets'])if(fs.realpathSync(d)!==d||!fs.lstatSync(d).isDirectory())throw Error();console.log(JSON.stringify({status:'baseline_verified',index}));}catch{process.exitCode=2}"
        facts=json.loads(checked(work,['docker','exec',api_id,'node','-e',probe]))
        require(set(facts)=={'status','index'} and facts['status']=='baseline_verified','live_baseline_files_mismatch')
        archive=overlay_archive(files,facts['index'])
        layers=json.loads(checked(work,['docker','image','inspect','--format','{{json .RootFS.Layers}}',BASE]))
        require(isinstance(layers,list) and layers and all(valid_image(x) for x in layers),'base_layers_denied')
        absent_tag();require(live(work,api_id)==initial,'live_baseline_changed_before_assembly')
        result['stage']='staging_container';stage_name='thaara-phone-sarvam-compatibility-stage-'+owner
        stage=create(stage_name,BASE)
        result['stage']='copy_overlay';code,_,error=mutate(['docker','cp','-a','-',stage+':/'],data=archive,timeout=25)
        if code:result.update(buildReturnCode=code,buildError=sanitize(error))
        require(code==0,'candidate_copy_failed')
        f=owned_container(work,stage_name,owner,BASE)
        require(f and f[0]==stage and f[13]=='created','stage_identity_or_state_changed')
        absent_tag();require(live(work,api_id)==initial,'live_baseline_changed_before_commit')
        result.update(stage='image_assembly',buildStarted=True)
        code,raw,error=mutate(['docker','commit',stage,TAG],timeout=70);result['buildReturnCode']=code
        if code:result['buildError']=sanitize(error)
        require(code==0,'candidate_build_failed')
        image=raw.decode().strip();require(valid_image(image) and image!=BASE,'candidate_image_mismatch')
        require(checked(work,['docker','image','inspect','--format','{{.Id}}',TAG])==image,'candidate_tag_mismatch')
        candidate_layers=json.loads(checked(work,['docker','image','inspect','--format','{{json .RootFS.Layers}}',image]))
        require(candidate_layers[:len(layers)]==layers and len(candidate_layers)==len(layers)+1,'candidate_base_layers_changed')
        require(checked(work,['docker','image','inspect','--format',IMAGE_CONFIG,image])==config,'candidate_config_changed')
        require(checked(work,['docker','image','inspect','--format','{{index .Config.Labels "'+LABEL+'"}}',image])==owner,'candidate_owner_mismatch')
        require(live(work,api_id)==initial,'live_baseline_changed_before_validation')
        result['stage']='isolated_validation';name='thaara-phone-sarvam-compatibility-validate-'+owner
        verification={key:m[key] for key in ('overlayFiles','retainedResultsSha256','contractOverlayFiles')}
        probe='const PACKED_MANIFEST='+json.dumps(verification)+';\n'+files['validate.mjs'].decode('utf8')
        cid=create(name,image,probe)
        result['validationStarted']=True
        code,raw,error=mutate(['docker','start','-a',cid],timeout=30);result['validationReturnCode']=code
        if code:
            try:
                detail=json.loads(raw)
            except ValueError:
                detail={}
            allowed={'module_hashes','runtime_import','adapter_import','legacy_profile','candidate_profile',
                     'evidence_gate','approval_binding','simulated_dispatch','report_readback','dispatch_scope'}
            if isinstance(detail,dict) and set(detail)=={'status','stage'} and detail['status']=='failed' and detail['stage'] in allowed:
                result['validationFailureStage']=detail['stage']
            elif b'SyntaxError' in error:
                result['validationFailureStage']='node_syntax'
            else:
                result['validationFailureStage']='no_allowlisted_diagnostic'
        require(code==0 and json.loads(raw)=={'status':'passed','filesVerified':4,'rollbackV2Ready':True,'syntheticV19Ready':True,'evidenceRequired':True,'separateApprovalFingerprints':True,'resultReaderVerified':True,'providerRequests':0},'candidate_import_or_hash_check_failed')
        result.update(status='verified',stage='complete',candidateImage=image,compatibilityVerified=True)
    except Stop as error:result['category']=str(error)
    except subprocess.TimeoutExpired:result['category']='command_timeout'
    except Exception:result['category']='build_validation_failed'
    finally:
        cleanup_ok=True
        for name,base,cid in reversed(owned):
            try:cleanup_container(cleanup,name,owner,base,cid)
            except Exception:cleanup_ok=False
        if result['status']=='verified':
            try:
                require(cleanup_ok and live(cleanup,api_id)==initial and checked(cleanup,['docker','image','inspect','--format','{{.Id}}',TAG])==image,'postcheck_or_cleanup_denied')
                result.update(sourceHealthy=True,liveImage=BASE,liveContainer=api_id)
            except Exception:result.update(status='stopped',category='postcheck_or_cleanup_denied')
        if result['status']!='verified' and result['buildStarted']:
            try:cleanup_failed_image(cleanup,owner,image)
            except Exception:cleanup_ok=False
        if uncertain:result.update(status='stopped',category='mutating_timeout_cleanup_unverified')
        elif not cleanup_ok:result.update(status='stopped',category='owned_resource_cleanup_unverified')
        result['cleanupVerified']=cleanup_ok and not uncertain
    return result

if __name__=='__main__':
    try:
        require(os.geteuid()==0 and len(PACKAGE_B64)<350000,'runner_input_denied')
        print(json.dumps(build_candidate(base64.b64decode(PACKAGE_B64,validate=True))))
    except Exception:print(json.dumps({'status':'stopped','category':'runner_input_denied'}))
