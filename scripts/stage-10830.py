"""Stage the Step 108.30 pilot publication (failure reasons). Local only; uploads nothing.
Usage: python -I scripts/stage-10828.py"""
import base64, hashlib, json, os, re, shutil, sys, tarfile, time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
cache = root / 'node_modules/.cache/step10830'
pub = cache / 'publication'
files = {
    'Dockerfile': 'deploy/hostinger-pilot/Dockerfile.failure-reasons',
    'api-services/whatsapp-durable.js': 'apps/api/dist/services/whatsapp-durable.js',
}
shutil.rmtree(pub, ignore_errors=True)
pub.mkdir(parents=True)
for target, source in files.items():
    dest = pub / target; dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes((root / source).read_bytes().replace(b'\r\n', b'\n'))  # LF only
for path in (pub / 'api-services').rglob('*'):  # Dockerfile/patcher contain the guard text itself
    if path.is_file() and re.search(rb'PHONE_AI_CALL_ACTION|PhoneCallingService', path.read_bytes()):
        sys.exit('Paused Phone code found in ' + str(path))
manifest = sorted(({'Path': p.relative_to(pub).as_posix(), 'SHA256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in pub.rglob('*') if p.is_file()), key=lambda x: x['Path'])
(pub / 'manifest.json').write_text(json.dumps(manifest, indent=1), encoding='utf-8')
now = int(time.time())
def clean(t):
    t.uid = t.gid = 0; t.uname = t.gname = ''; t.mtime = now; return t
archive = cache / 'publication.tar.gz'
with tarfile.open(archive, 'w:gz') as tar:
    for name in sorted(os.listdir(pub)):
        tar.add(pub / name, arcname=name, filter=clean)
raw = archive.read_bytes(); sha = hashlib.sha256(raw).hexdigest()
pub_path = root / 'deploy/hostinger-pilot/publish-failure-reasons.py'
publisher = re.sub(r"ARCHIVE_SHA = '[^']*'", "ARCHIVE_SHA = '" + sha + "'", pub_path.read_text(encoding='utf-8'), count=1)
pub_path.write_text(publisher, encoding='utf-8', newline='\n')
(cache / 'publish.sh').write_text("set -euo pipefail\npython3 - <<'THAARA_10830_PY'\nOWNER_APPROVED_10830 = True\nPAYLOAD = '" + base64.b64encode(raw).decode() + "'\n" + publisher + "\nTHAARA_10830_PY\n", encoding='utf-8', newline='\n')
print(json.dumps({'files': len(manifest), 'archive_sha256': sha}))
