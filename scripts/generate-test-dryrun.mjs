import fs from 'node:fs';

const tarB64 = fs.readFileSync('node_modules/.cache/whatsapp-appointment/publication.tar.gz').toString('base64');
const py = `import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time

BASE_IMAGE = 'sha256:88cb497a4c19e7cd1e81a130d622c65673e4844c7ac4af26c3a23197dcd37cc5'
API = 'thaara-v2-pilot-api-1'

def run(args, check=True, timeout=240):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f"Command failed ({args[0]}): {result.stderr}")
    return result

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]

print("=== VERIFYING LIVE CONTAINER BASELINE ===")
cur_api = inspect(API)
actual_base = cur_api.get('Image') or cur_api['Config']['Image']
print(f"Container ID: {cur_api['Id']}")
print(f"Container Image: {actual_base}")
print(f"Container Health: {cur_api['State'].get('Health', {}).get('Status')}")

if actual_base != BASE_IMAGE:
    raise RuntimeError(f"Base image mismatch: expected {BASE_IMAGE}, got {actual_base}")

stage = Path('/tmp/test-candidate-stage')
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir(parents=True, exist_ok=True)

raw_archive = base64.b64decode('${tarB64}')
archive_sha = hashlib.sha256(raw_archive).hexdigest()
print(f"Payload SHA256 on VPS: {archive_sha}")

with tarfile.open(fileobj=io.BytesIO(raw_archive), mode='r:gz') as tf:
    tf.extractall(stage)

print("Building candidate Docker overlay image on VPS...")
base_tag = 'thaara-v2-base:phone-sarvam-rebase'
run(['docker', 'tag', BASE_IMAGE, base_tag])
cand_tag = 'thaara-v2-pilot-api:whatsapp-appointment-test-build'
run(['docker', 'build', '--no-cache', '--network=none', '--pull=false', '--build-arg', f'BASE_IMAGE={base_tag}', '-t', cand_tag, '-f', str(stage / 'Dockerfile'), str(stage)], timeout=300)

built_inspect = inspect(cand_tag)
cand_id = built_inspect['Id']
print(f"SUCCESS! Candidate Image Digest: {cand_id}")

shutil.rmtree(stage)
run(['docker', 'rmi', cand_tag])
`;

fs.writeFileSync('node_modules/.cache/whatsapp-appointment/test-vps-candidate-dryrun.sh', 'set -euo pipefail\npython3 - <<\'EOF_PY\'\n' + py + '\nEOF_PY\n');
console.log('Generated test-vps-candidate-dryrun.sh successfully');
