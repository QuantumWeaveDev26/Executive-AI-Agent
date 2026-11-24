"""Read-only live baseline refresh V6: records container/image/mounts, actual web asset hashes, 12 WhatsApp 10831 file hashes, and 4 Phone API files."""
import base64
import hashlib
import json
import re
import subprocess

CONTAINER='thaara-v2-pilot-api-1'
FILE_LIMIT=196608
TOTAL_LIMIT=524288
WEB_10831={
 '/app/apps/web/dist/index.html':'ae2eb1b4e729f83513746d37a92d97162e418256d4cd2631bbcb09953f4eff6d',
 '/app/apps/web/dist/assets/index-CAoiIo_h.js':'504aa0bc3133edd6a6d0639562d1eed9d087ed202c3e7b7f4a3f51ade4260394',
 '/app/apps/web/dist/assets/index-Co2o2hIb.css':'ed715f21be63f91a95091267354402101c750b39666ff5f6a8b52d853ff63309',
}
FILES={
 'app':('/app/apps/api/dist/app.js','661ddf6e2f77d8357544fb31d60740401093b4a5e6d39f34014bd3b759c1b36a'),
 'startup':('/app/apps/api/pilot-start.mjs','cbffaddee7dae4918420a2942ea2bcaab5f64a6136b20e13c97ee9c52fa2528d'),
 'phoneStartup':('/app/apps/api/dist/services/phone-pilot-startup.js','7273fc04178102049eae487793dc2b90176987adb4abada521faad73998a5430'),
 'contracts':('/app/apps/api/node_modules/@thaara/contracts/dist/index.js','10ab922a56b468843eec0a853bea41de1dd4f60e39006593e50a4127088d8a30'),
}
WHATSAPP_FILES={
 '/app/apps/api/dist/routes/whatsapp-inbox.js':'f85222fef22d3e028d4c59ab06cb45eb93ed8cf85ae976e97bef8f8e191c3763',
 '/app/apps/api/dist/services/chat-whatsapp-assistant.js':'721dacf62fff07a8f874329df7ad17d461c9f875f257f3a0b1ff2ad652411f87',
 '/app/apps/api/dist/services/chat-whatsapp-read.js':'42a5acb2c2b974d002ea03761622c0a23e5b744716e21ad7e37a09a2d6c9429f',
 '/app/apps/api/dist/services/whatsapp-durable.js':'9121db29b5ddf91459753c84f09b3ed65b4e85668e280fa35993c6f206bf70da',
 '/app/apps/api/dist/services/whatsapp-enquiries.js':'4e439b5959a56d9815b93f302ff31eac4630d6542ed3e49ab6cc43f02657d3aa',
 '/app/apps/api/dist/services/whatsapp-inbox.js':'5afed4762b0dfbc3cf9435a8b831ec3e53b7669a2b5c89bebe98e92382823b3f',
 '/app/apps/api/dist/services/whatsapp-pilot-dispatch.js':'573b9e5b877e4ccf6ea87eacd3cdc0de9747d464493cf7b87256f3b1fa260542',
 '/app/apps/api/dist/services/whatsapp-templates.js':'ccf106284b81ae7601c53a83a8bfd5bc66adf83fa01c09a1cfcedc4ebd52f3c0',
}
PROBE=r"""
import fs from 'node:fs';import crypto from 'node:crypto';import{fileURLToPath}from'node:url';
const web10831=WEB_PINS, files=CODE_PINS, waPins=WA_PINS;
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
 const htmlPath='/app/apps/web/dist/index.html', assetsDir='/app/apps/web/dist/assets';
 if(fs.realpathSync(assetsDir)!==assetsDir||!fs.lstatSync(assetsDir).isDirectory())throw Error();
 const htmlRaw=read(htmlPath,65536);
 const webAssets={[htmlPath]:sha(htmlRaw)};
 const entries=fs.readdirSync(assetsDir).sort();
 if(entries.length<1||entries.length>8)throw Error();
 for(const name of entries){
  if(!/^index-[A-Za-z0-9_-]+\.(?:js|css)$/.test(name))throw Error();
  const p=assetsDir+'/'+name;
  webAssets[p]=sha(read(p,700000));
 }
 const webMatches10831=Object.keys(webAssets).length===Object.keys(web10831).length&&Object.entries(web10831).every(([k,v])=>webAssets[k]===v);
 category='compiled_code_unavailable';const output=[];let total=0;
 for(const[name,[path,old]]of Object.entries(files)){
  const raw=read(path,196608,name==='contracts'),hash=sha(raw),changed=hash!==old;
  total+=raw.length;if(total>524288)throw Error();
  output.push({name,path,bytes:raw.length,sha256:hash,changed,...(changed?{base64:raw.toString('base64')}: {})});
 }
 const whatsappFiles={};
 for(const[p,expected]of Object.entries(waPins)){
  const raw=read(p,196608),hash=sha(raw);
  whatsappFiles[p]={bytes:raw.length,sha256:hash,matches10831:hash===expected};
 }
 const whatsappFilesVerified=Object.values(whatsappFiles).every(v=>v.matches10831);
 console.log(JSON.stringify({status:'verified',webAssetsVerified:true,webMatches10831,webAssets,whatsappFilesVerified,whatsappFiles,files:output}));
}catch{console.log(JSON.stringify({status:'stopped',category}));process.exitCode=2;}
""".replace('WEB_PINS',json.dumps(WEB_10831)).replace('CODE_PINS',json.dumps(FILES)).replace('WA_PINS',json.dumps(WHATSAPP_FILES))

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
            if code or set(data)!={'status','webAssetsVerified','webMatches10831','webAssets','whatsappFilesVerified','whatsappFiles','files'} or data['status']!='verified' or data['webAssetsVerified'] is not True or type(data['webMatches10831']) is not bool or not isinstance(data['webAssets'],dict) or not (2<=len(data['webAssets'])<=9) or type(data['whatsappFilesVerified']) is not bool or not isinstance(data['whatsappFiles'],dict) or set(data['whatsappFiles'])!=set(WHATSAPP_FILES) or not isinstance(data['files'],list) or len(data['files'])!=len(FILES):raise ValueError()
            for k,v in data['webAssets'].items():
                if not isinstance(k,str) or not (k=='/app/apps/web/dist/index.html' or re.fullmatch(r'/app/apps/web/dist/assets/index-[A-Za-z0-9_-]+\.(?:js|css)',k)) or not isinstance(v,str) or not re.fullmatch(r'[a-f0-9]{64}',v):raise ValueError()
            for k,v in data['whatsappFiles'].items():
                if not isinstance(v,dict) or set(v)!={'bytes','sha256','matches10831'} or type(v['bytes']) is not int or not (1<=v['bytes']<=FILE_LIMIT) or not re.fullmatch(r'[a-f0-9]{64}',v['sha256']) or type(v['matches10831']) is not bool:raise ValueError()
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
            result={'status':'verified','containerId':f[0],'imageId':f[1],'mounts':f[7],'sourceHealthy':True,'webAssetsVerified':True,'webMatches10831':data['webMatches10831'],'webAssets':data['webAssets'],'whatsappFilesVerified':data['whatsappFilesVerified'],'whatsappFiles':data['whatsappFiles'],'files':data['files'],'providerRequests':0,'changesMade':False}
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
