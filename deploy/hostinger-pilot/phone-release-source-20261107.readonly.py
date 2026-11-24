"""Prepared only: fixed, bounded compiled-code export; no credentials or provider access."""
import base64
import hashlib
import json
import re
import subprocess

IMAGE = 'sha256:44387266137de5747b3bd68a647af0cbbbce9387cd66239dcfcdfb0dd6aab927'
CONTAINER = 'thaara-v2-pilot-api-1'
FILE_LIMIT = 196608
TOTAL_LIMIT = 524288
FILES = {
    'app': '/app/apps/api/dist/app.js',
    'startup': '/app/apps/api/pilot-start.mjs',
    'phoneStartup': '/app/apps/api/dist/services/phone-pilot-startup.js',
    'contracts': '/app/apps/api/node_modules/@thaara/contracts/dist/index.js',
}
PROBE = r"""
import fs from 'node:fs';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const files=[['app','/app/apps/api/dist/app.js'],['startup','/app/apps/api/pilot-start.mjs'],
 ['phoneStartup','/app/apps/api/dist/services/phone-pilot-startup.js'],
 ['contracts','/app/apps/api/node_modules/@thaara/contracts/dist/index.js']];
try{
 const output=[];let total=0;
 for(const [name,path]of files){
  const real=fs.realpathSync(path);
  if(name==='contracts'){
   if(!real.startsWith('/app/apps/api/node_modules/')||!real.endsWith('/dist/index.js')||
      fs.realpathSync(fileURLToPath(import.meta.resolve('@thaara/contracts')))!==real)throw Error('code_path');
  }else if(real!==path)throw Error('code_path');
  const fd=fs.openSync(real,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
   const before=fs.fstatSync(fd);if(!before.isFile()||before.size<1||before.size>196608)throw Error('code_shape');
   const raw=Buffer.alloc(before.size);let pos=0;
   while(pos<raw.length){const n=fs.readSync(fd,raw,pos,raw.length-pos,pos);if(!n)throw Error('code_short');pos+=n;}
   const after=fs.fstatSync(fd);
   if(before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('code_changed');
   total+=raw.length;if(total>524288)throw Error('code_limit');
   output.push({name,path,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex'),base64:raw.toString('base64')});
  }finally{fs.closeSync(fd);}
 }
 console.log(JSON.stringify({status:'verified',files:output}));
}catch{console.log(JSON.stringify({status:'stopped',category:'compiled_code_unavailable'}));process.exitCode=2;}
"""

def execute(args):
    p = subprocess.run(args, capture_output=True, timeout=20)
    if len(p.stdout) > 800000:
        return 2, '{}'
    return p.returncode, p.stdout.decode('utf-8').strip()

def inspect(run=execute):
    inventory = ['docker','inspect','--format',
        '{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}', CONTAINER]
    code,raw=run(inventory)
    fields=raw.split('|')
    if code or len(fields)!=5 or not re.fullmatch(r'[a-f0-9]{64}',fields[0]) or fields[1:]!=[IMAGE,'healthy','thaara-v2-pilot','api']:
        return {'status':'stopped','category':'source_identity_or_health_mismatch'}
    code,raw=run(['docker','exec',fields[0],'node','--input-type=module','-e',PROBE])
    result={'status':'stopped','category':'source_output_not_allowlisted'}
    try:
        facts=json.loads(raw)
        if code or not isinstance(facts,dict) or set(facts)!={'status','files'} or facts['status']!='verified' or not isinstance(facts['files'],list) or len(facts['files'])!=len(FILES):
            raise ValueError()
        total=0
        for entry,(name,path) in zip(facts['files'],FILES.items()):
            if not isinstance(entry,dict) or set(entry)!={'name','path','bytes','sha256','base64'} or entry['name']!=name or entry['path']!=path or type(entry['bytes']) is not int or not 1<=entry['bytes']<=FILE_LIMIT:
                raise ValueError()
            data=base64.b64decode(entry['base64'],validate=True)
            if len(data)!=entry['bytes'] or hashlib.sha256(data).hexdigest()!=entry['sha256']:
                raise ValueError()
            total+=len(data)
        if total>TOTAL_LIMIT:raise ValueError()
        result={'status':'verified','containerId':fields[0],'imageId':IMAGE,'sourceHealthy':True,
                'files':facts['files'],'providerRequests':0,'changesMade':False}
    except (ValueError,TypeError,KeyError):
        pass
    final_code,final_raw=run(inventory)
    if final_code or final_raw.split('|')!=fields:
        return {'status':'stopped','category':'live_baseline_changed_during_read'}
    return result

if __name__=='__main__':
    try:print(json.dumps(inspect()))
    except subprocess.TimeoutExpired:print(json.dumps({'status':'stopped','category':'command_timeout'}))
    except Exception:print(json.dumps({'status':'stopped','category':'code_export_failed'}))
