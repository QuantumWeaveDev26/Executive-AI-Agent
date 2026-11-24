"""Return only SHA-256 digests for the nine existing Phone release baseline paths."""
import json
import re
import subprocess

CONTAINER = 'thaara-v2-pilot-api-1'
IMAGE = 'sha256:3985893e8cef0ac5117af145e4785c5ae60bb95e3c997a74532b164860bd1cf9'
CONTAINER_ID = '266e7ea1f430fdbc433d5e3dae449068f41628411c3f57644a2a71fe1eae3d60'
PATHS = ("/app/apps/api/dist/app.js","/app/apps/api/pilot-start.mjs","/app/apps/api/dist/services/phone-pilot-startup.js","/app/apps/api/node_modules/@thaara/contracts/dist/index.js","/app/apps/api/dist/services/whatsapp-durable.js","/app/apps/api/dist/services/whatsapp-enquiries.js","/app/apps/api/dist/services/phone-calling.js","/app/apps/api/dist/routes/phone-sarvam-webhook.js","/app/apps/web/dist/index.html",)
FORMAT = ('{{.Id}}|{{.Image}}|{{.State.Health.Status}}|'
          '{{index .Config.Labels "com.docker.compose.project"}}|'
          '{{index .Config.Labels "com.docker.compose.service"}}|'
          '{{.State.StartedAt}}|{{.HostConfig.ReadonlyRootfs}}|'
          '[{{range $i,$mount := .Mounts}}{{if $i}},{{end}}{{json $mount.Destination}}{{end}}]')
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


def mount_destinations(raw):
    mounts = json.loads(raw)
    if not isinstance(mounts, list):
        raise ValueError('invalid mount inventory')
    for path in mounts:
        if (not isinstance(path, str) or not path.startswith('/') or path in ('/', '/app')
                or path.startswith('/app/') or any(ord(c) < 32 for c in path)
                or any(part in ('', '.', '..') for part in path[1:].split('/'))):
            raise ValueError('invalid mount destination')
    if len(mounts) != len(set(mounts)):
        raise ValueError('duplicate mount destination')
    return sorted(mounts)


def check(run=docker):
    args = ('inspect', '--format', FORMAT, CONTAINER)
    fields = run(*args).split('|', 7)
    if (len(fields) != 8 or fields[:5] != [CONTAINER_ID, IMAGE, 'healthy', 'thaara-v2-pilot', 'api']
            or fields[6] != 'true'):
        return {'status': 'stopped', 'category': 'baseline_identity_mismatch'}
    try:
        fields[7] = mount_destinations(fields[7])
    except ValueError:
        return {'status': 'stopped', 'category': 'application_mount_denied'}
    hashes = json.loads(run('exec', CONTAINER_ID, 'node', '-e', PROBE))
    if (not isinstance(hashes, dict) or set(hashes) != set(PATHS)
            or any(not isinstance(v, str) or not re.fullmatch(r'[a-f0-9]{64}', v) for v in hashes.values())):
        return {'status': 'stopped', 'category': 'hash_output_denied'}
    final = run(*args).split('|', 7)
    if len(final) != 8:
        return {'status': 'stopped', 'category': 'final_inventory_invalid'}
    try:
        final[7] = mount_destinations(final[7])
    except ValueError:
        return {'status': 'stopped', 'category': 'application_mount_denied'}
    if final != fields:
        return {'status': 'stopped', 'category': 'baseline_changed_during_read'}
    return {'status': 'verified', 'imageId': IMAGE, 'containerId': CONTAINER_ID, 'hashes': hashes}


if __name__ == '__main__':
    try:
        print(json.dumps(check()))
    except (subprocess.SubprocessError, ValueError):
        print(json.dumps({'status': 'stopped', 'category': 'hash_probe_unavailable'}))
