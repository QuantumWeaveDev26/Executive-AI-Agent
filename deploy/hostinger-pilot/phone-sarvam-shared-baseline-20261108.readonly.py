"""Read allowlisted checksums from one exact healthy API container. Never export source."""
import json
import re
import subprocess

CID = '0d7c367d2c212d8796a6ae599047681779f19bba0b083922ba956e8656da330b'
IMAGE = 'sha256:df1499e3a4b7cfbfab87f9ba4face080bb44737a8a3f2d4b0767cd7b270a99c5'
PATHS = {"phone-sarvam-runtime.js":"/app/apps/api/dist/services/phone-sarvam-runtime.js","phone-sarvam-knowledge-binding.js":"/app/apps/api/dist/services/phone-sarvam-knowledge-binding.js","phone-sarvam-calls.js":"/app/apps/api/dist/services/phone-sarvam-calls.js","phone-sarvam-results.js":"/app/apps/api/dist/services/phone-sarvam-results.js","whatsapp-durable.js":"/app/apps/api/dist/services/whatsapp-durable.js","whatsapp-enquiries.js":"/app/apps/api/dist/services/whatsapp-enquiries.js","phone-pilot-startup.js":"/app/apps/api/dist/services/phone-pilot-startup.js","contracts-index.js":"/app/apps/api/node_modules/@thaara/contracts/dist/index.js","phone-sarvam-compat.js":"/app/apps/api/node_modules/@thaara/contracts/dist/phone-sarvam-compat.js","app.js":"/app/apps/api/dist/app.js","pilot-start.mjs":"/app/apps/api/pilot-start.mjs","index.html":"/app/apps/web/dist/index.html","index-BJGkboGa.js":"/app/apps/web/dist/assets/index-BJGkboGa.js","index-C_8sjcAM.css":"/app/apps/web/dist/assets/index-C_8sjcAM.css"}
INVENTORY = ['docker', 'inspect', '--format', '{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{.State.StartedAt}}|{{.HostConfig.ReadonlyRootfs}}', 'thaara-v2-pilot-api-1']
PROBE = r"""
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const hashes = {};
for (const [name, path] of Object.entries(PATHS)) {
 const parent = require('node:path').dirname(path);
 const resolved = fs.realpathSync(parent);
 if (name === 'contracts-index.js' || name === 'phone-sarvam-compat.js') {
  if (!resolved.startsWith('/app/apps/api/node_modules/') || !resolved.endsWith('/dist')) throw Error('unexpected_contracts_directory');
 } else if (resolved !== parent) throw Error('unexpected_module_directory');
 let fd;
 try { fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
 catch (error) { if (error.code !== 'ENOENT' || !['phone-sarvam-knowledge-binding.js','phone-sarvam-compat.js'].includes(name)) throw error; hashes[name] = null; continue; }
 try {
  const before = fs.fstatSync(fd);
  if (!before.isFile() || before.size < 1 || before.size > 1500000) throw Error('unexpected_module_type_or_size');
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
    check_code, raw = run(['docker', 'exec', CID, 'node', '-e', 'const PATHS=' + json.dumps(PATHS) + ';' + PROBE])
    after_code, after = run(INVENTORY)
    if after_code or after != before:
        return {'status': 'stopped', 'category': 'live_identity_changed'}
    try:
        hashes = json.loads(raw)
        if check_code or not isinstance(hashes, dict) or set(hashes) != set(PATHS) or any(
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
