"""Return only SHA-256 digests for the nine existing Phone release baseline paths."""
import json
import re
import subprocess

CONTAINER = 'thaara-v2-pilot-api-1'
IMAGE = 'sha256:b1b13df2fb1b51817765f099c2645e25bafa6934251add0d71c890c6f29d7117'
CONTAINER_ID = '08f378a8216af3b5b24749825da6d9fe789bd9b891831ede1e27df673b093ba8'
PATHS = (
    '/app/apps/api/dist/app.js', '/app/apps/api/pilot-start.mjs',
    '/app/apps/api/dist/services/phone-pilot-startup.js',
    '/app/apps/api/node_modules/@thaara/contracts/dist/index.js',
    '/app/apps/api/dist/services/whatsapp-durable.js',
    '/app/apps/api/dist/services/whatsapp-enquiries.js',
    '/app/apps/web/dist/index.html', '/app/apps/web/dist/assets/index-CAoiIo_h.js',
    '/app/apps/web/dist/assets/index-Co2o2hIb.css',
)
FORMAT = ('{{.Id}}|{{.Image}}|{{.State.Health.Status}}|'
          '{{index .Config.Labels "com.docker.compose.project"}}|'
          '{{index .Config.Labels "com.docker.compose.service"}}|'
          '{{.State.StartedAt}}|{{.HostConfig.ReadonlyRootfs}}|'
          '{{range .Mounts}}{{json .Destination}} {{end}}')
PROBE = r'''
const fs=require('node:fs'), crypto=require('node:crypto');
const paths=BASELINE_PATHS, hashes={};
for(const path of paths){
  const resolved=fs.realpathSync(path);
  if(path.endsWith('/@thaara/contracts/dist/index.js')){
    if(!resolved.startsWith('/app/apps/api/node_modules/')||!resolved.endsWith('/dist/index.js'))throw Error();
  }else if(resolved!==path)throw Error();
  const fd=fs.openSync(resolved,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.size<1||before.size>700000)throw Error();
    const buffer=Buffer.alloc(before.size);
    let offset=0;
    while(offset<buffer.length){const n=fs.readSync(fd,buffer,offset,buffer.length-offset,offset);if(!n)throw Error();offset+=n;}
    const after=fs.fstatSync(fd);
    if(['ino','dev','size','ctimeMs','mtimeMs'].some(k=>before[k]!==after[k]))throw Error();
    hashes[path]=crypto.createHash('sha256').update(buffer).digest('hex');
  }finally{fs.closeSync(fd);}
}
console.log(JSON.stringify(hashes));
'''.replace('BASELINE_PATHS', json.dumps(PATHS))


def docker(*args):
    result = subprocess.run(('docker', '--host=unix:///var/run/docker.sock', *args),
                            capture_output=True, check=True, timeout=15)
    if len(result.stdout) > 4096:
        raise ValueError('oversized output')
    return result.stdout.decode('ascii').strip()


def check(run=docker):
    args = ('inspect', '--format', FORMAT, CONTAINER)
    first = run(*args)
    fields = first.split('|', 7)
    if (len(fields) != 8 or fields[:5] != [CONTAINER_ID, IMAGE, 'healthy', 'thaara-v2-pilot', 'api']
            or fields[6] != 'true'):
        return {'status': 'stopped', 'category': 'baseline_identity_mismatch'}
    try:
        mounts = [json.loads(s) for s in fields[7].split()]
    except ValueError:
        mounts = [None]
    if any(not isinstance(p, str) or not p.startswith('/') or p in ('/', '/app')
           or p.startswith('/app/') or any(part in ('', '.', '..') for part in p[1:].split('/'))
           for p in mounts):
        return {'status': 'stopped', 'category': 'application_mount_denied'}
    hashes = json.loads(run('exec', CONTAINER_ID, 'node', '-e', PROBE))
    if (not isinstance(hashes, dict) or set(hashes) != set(PATHS)
            or any(not isinstance(v, str) or not re.fullmatch(r'[a-f0-9]{64}', v) for v in hashes.values())):
        return {'status': 'stopped', 'category': 'hash_output_denied'}
    if run(*args) != first:
        return {'status': 'stopped', 'category': 'baseline_changed_during_read'}
    return {'status': 'verified', 'imageId': IMAGE, 'containerId': CONTAINER_ID, 'hashes': hashes}


if __name__ == '__main__':
    try:
        print(json.dumps(check()))
    except (subprocess.SubprocessError, ValueError):
        print(json.dumps({'status': 'stopped', 'category': 'hash_probe_unavailable'}))
