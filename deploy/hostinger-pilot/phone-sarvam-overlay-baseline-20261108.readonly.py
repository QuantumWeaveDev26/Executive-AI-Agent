"""Read four checksums from one exact healthy API container. Never export source."""
import json
import re
import subprocess

CID = '08f378a8216af3b5b24749825da6d9fe789bd9b891831ede1e27df673b093ba8'
IMAGE = 'sha256:b1b13df2fb1b51817765f099c2645e25bafa6934251add0d71c890c6f29d7117'
NAMES = ('phone-sarvam-runtime.js', 'phone-sarvam-knowledge-binding.js', 'phone-sarvam-calls.js', 'phone-sarvam-results.js')
INVENTORY = ['docker', 'inspect', '--format', '{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{.State.StartedAt}}|{{.HostConfig.ReadonlyRootfs}}', 'thaara-v2-pilot-api-1']
PROBE = r"""
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const root = '/app/apps/api/dist/services';
if (fs.realpathSync(root) !== root) throw Error('unexpected_module_directory');
const hashes = {};
for (const name of NAMES) {
 const path = root + '/' + name;
 let fd;
 try { fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
 catch (error) { if (error.code !== 'ENOENT') throw error; hashes[name] = null; continue; }
 try {
  const before = fs.fstatSync(fd);
  if (!before.isFile() || before.size < 1 || before.size > 262144) throw Error('unexpected_module_type_or_size');
  const buffer = Buffer.alloc(before.size);
  for (let offset = 0; offset < buffer.length;) {
   const count = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
   if (count === 0) throw Error('unexpected_module_eof');
   offset += count;
  }
  const after = fs.fstatSync(fd);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw Error('module_changed');
  hashes[name] = createHash('sha256').update(buffer).digest('hex');
 } finally { fs.closeSync(fd); }
}
console.log(JSON.stringify(hashes));
"""


def execute(args):
    child = subprocess.run(args, capture_output=True, timeout=20)
    return child.returncode, child.stdout.decode('utf-8').strip()


def inspect(run=execute):
    code, before = run(INVENTORY)
    fields = before.split('|')
    if code or len(fields) != 5 or fields[:3] != [CID, IMAGE, 'healthy'] or not fields[3] or fields[4] != 'true':
        return {'status': 'stopped', 'category': 'live_identity_mismatch'}
    check_code, raw = run(['docker', 'exec', CID, 'node', '-e', 'const NAMES=' + json.dumps(NAMES) + ';' + PROBE])
    after_code, after = run(INVENTORY)
    if after_code or after != before:
        return {'status': 'stopped', 'category': 'live_identity_changed'}
    try:
        hashes = json.loads(raw)
        if check_code or not isinstance(hashes, dict) or set(hashes) != set(NAMES) or any(
                value is not None and (not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value))
                for value in hashes.values()):
            raise ValueError()
    except ValueError:
        return {'status': 'stopped', 'category': 'module_hashes_unverified'}
    return {'status': 'verified', 'containerId': CID, 'imageId': IMAGE, 'sourceHealthy': True,
            'changesMade': False, 'providerRequests': 0, 'moduleHashes': hashes}


if __name__ == '__main__':
    try:
        print(json.dumps(inspect()))
    except (OSError, ValueError, subprocess.SubprocessError):
        print(json.dumps({'status': 'stopped', 'category': 'module_hash_check_failed'}))
