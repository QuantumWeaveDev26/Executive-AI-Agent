"""Read-only recheck after the published frontend changed. Export only changed compiled files."""
import base64
import hashlib
import json
import re
import subprocess

CONTAINER='thaara-v2-pilot-api-1'
FILE_LIMIT=196608
TOTAL_LIMIT=524288
WEB={
 '/app/apps/web/dist/index.html':'31662774c575989524e3606c4a748dd3fb325835960105f25915e05e8e180718',
 '/app/apps/web/dist/assets/index-BJd1tkRP.js':'6d3efdef15e09108e72fdf98b563bf7d12c5c2acd48544cd8730d742360dc107',
 '/app/apps/web/dist/assets/index-Co2o2hIb.css':'ed715f21be63f91a95091267354402101c750b39666ff5f6a8b52d853ff63309',
}
FILES={
 'app':('/app/apps/api/dist/app.js','661ddf6e2f77d8357544fb31d60740401093b4a5e6d39f34014bd3b759c1b36a'),
 'startup':('/app/apps/api/pilot-start.mjs','cbffaddee7dae4918420a2942ea2bcaab5f64a6136b20e13c97ee9c52fa2528d'),
 'phoneStartup':('/app/apps/api/dist/services/phone-pilot-startup.js','7273fc04178102049eae487793dc2b90176987adb4abada521faad73998a5430'),
 'contracts':('/app/apps/api/node_modules/@thaara/contracts/dist/index.js','10ab922a56b468843eec0a853bea41de1dd4f60e39006593e50a4127088d8a30'),
}
PROBE=r"""
import fs from 'node:fs';import crypto from 'node:crypto';import{fileURLToPath}from'node:url';
const web=WEB_PINS, files=CODE_PINS;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function read(path,limit,contracts=false){
 const real=fs.realpathSync(path);
 if(contracts){if(!real.startsWith('/app/apps/api/node_modules/')||!real.endsWith('/dist/index.js')||fs.realpathSync(fileURLToPath(import.meta.resolve('@thaara/contracts')))!==real)throw Error();}
 else if(real!==path)throw Error();
 const fd=fs.openSync(real,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const before=fs.fstatSync(fd);if(!before.isFile()||before.size<1||before.size>limit)throw Error();
  const raw=Buffer.alloc(before.size);let pos=0;
  while(pos<raw.length){const n=fs.readSync(fd,raw,pos,raw.length-pos,pos);if(!n)throw Error();pos+=n;}
  const after=fs.fstatSync(fd);
  if(before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error();
  return raw;
 }finally{fs.closeSync(fd);}
}
let category='public_frontend_mismatch';
try{
 for(const[path,expected]of Object.entries(web))if(sha(read(path,700000))!==expected)throw Error();
 category='compiled_code_unavailable';const output=[];let total=0;
 for(const[name,[path,old]]of Object.entries(files)){
  const raw=read(path,196608,name==='contracts'),hash=sha(raw),changed=hash!==old;
  total+=raw.length;if(total>524288)throw Error();
  output.push({name,path,bytes:raw.length,sha256:hash,changed,...(changed?{base64:raw.toString('base64')}: {})});
 }
 console.log(JSON.stringify({status:'verified',webAssetsVerified:true,files:output}));
}catch{console.log(JSON.stringify({status:'stopped',category}));process.exitCode=2;}
""".replace('WEB_PINS',json.dumps(WEB)).replace('CODE_PINS',json.dumps(FILES))

def execute(args):
    p=subprocess.run(['docker','--host=unix:///var/run/docker.sock',*args[1:]],capture_output=True,timeout=20)
    return (p.returncode,p.stdout.decode('utf8').strip()) if len(p.stdout)<800000 else (2,'{}')

def mount_destinations(raw):
    destinations=json.loads(raw)
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

def inspect(run=execute):
    inventory=['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.StartedAt}}|{{.HostConfig.ReadonlyRootfs}}|[{{range $i,$mount := .Mounts}}{{if $i}},{{end}}{{json $mount.Destination}}{{end}}]',CONTAINER]
    code,raw=run(inventory);f=raw.split('|',7)
    if code or len(f)!=8 or not re.fullmatch(r'[a-f0-9]{64}',f[0]) or not re.fullmatch(r'sha256:[a-f0-9]{64}',f[1]) or f[2:5]!=['healthy','thaara-v2-pilot','api']:
        return {'status':'stopped','category':'source_identity_or_health_mismatch'}
    if f[6]!='true':
        return {'status':'stopped','category':'image_file_provenance_denied'}
    try:
        f[7]=mount_destinations(f[7])
    except ValueError:
        return {'status':'stopped','category':'image_file_provenance_denied'}
    code,raw=run(['docker','exec',f[0],'node','--input-type=module','-e',PROBE])
    result={'status':'stopped','category':'source_output_not_allowlisted'}
    try:
        data=json.loads(raw)
        if code==2 and isinstance(data,dict) and set(data)=={'status','category'} and data['status']=='stopped' and data['category'] in ('public_frontend_mismatch','compiled_code_unavailable'):
            result=data
        else:
            if code or set(data)!={'status','webAssetsVerified','files'} or data['status']!='verified' or data['webAssetsVerified'] is not True or not isinstance(data['files'],list) or len(data['files'])!=len(FILES):raise ValueError()
            total=0
            for e,(name,(path,old)) in zip(data['files'],FILES.items()):
                if not isinstance(e,dict) or e['name']!=name or e['path']!=path or type(e['bytes']) is not int or not 1<=e['bytes']<=FILE_LIMIT or not re.fullmatch(r'[a-f0-9]{64}',e['sha256']) or type(e['changed']) is not bool or e['changed']!=(e['sha256']!=old):raise ValueError()
                keys={'name','path','bytes','sha256','changed'}|({'base64'} if e['changed'] else set())
                if set(e)!=keys:raise ValueError()
                if e['changed']:
                    body=base64.b64decode(e['base64'],validate=True)
                    if len(body)!=e['bytes'] or hashlib.sha256(body).hexdigest()!=e['sha256']:raise ValueError()
                total+=e['bytes']
            if total>TOTAL_LIMIT:raise ValueError()
            result={'status':'verified','containerId':f[0],'imageId':f[1],'sourceHealthy':True,'webAssetsVerified':True,'files':data['files'],'providerRequests':0,'changesMade':False}
    except (TypeError,ValueError,KeyError):pass
    final,raw=run(inventory)
    if final!=0:
        return {'status':'stopped','category':'final_inventory_failed','returnCode':final}
    fields=('containerId','imageId','health','project','service','startedAt','readonlyRoot','mounts')
    observed=raw.split('|',7)
    if len(observed)!=len(fields):
        return {'status':'stopped','category':'final_inventory_invalid'}
    try:
        observed[7]=mount_destinations(observed[7])
    except ValueError:
        return {'status':'stopped','category':'image_file_provenance_denied'}
    changed=[name for name,before,after in zip(fields,f,observed) if before!=after]
    if changed:
        return {'status':'stopped','category':'live_baseline_changed_during_read','changedFields':changed}
    return result

if __name__=='__main__':
    try:print(json.dumps(inspect()))
    except subprocess.TimeoutExpired:print(json.dumps({'status':'stopped','category':'command_timeout'}))
    except Exception:print(json.dumps({'status':'stopped','category':'baseline_refresh_failed'}))
