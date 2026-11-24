"""Stage the Step 108.25-108.27 pilot publication from fresh builds. Local only; uploads nothing.
Usage: python -I scripts/stage-10827.py   (run after building contracts/db/policy/api/web)."""
import base64, hashlib, json, os, re, shutil, sys, tarfile, time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
cache = root / 'node_modules/.cache/step10827'
pub = cache / 'publication'
base_json = cache / 'publication' / 'pilot-compose-base.json'
assert base_json.exists(), 'pilot-compose-base.json (read-only pilot base hashes) missing'
base_copy = json.loads(base_json.read_text(encoding='utf-8'))
files = {
    '10825-whatsapp-templates-media-contacts.review.sql': 'docs/migrations/10825-whatsapp-templates-media-contacts.review.sql',
    'Dockerfile': 'deploy/hostinger-pilot/Dockerfile.whatsapp-compose',
    'patch-whatsapp-compose.mjs': 'deploy/hostinger-pilot/patch-whatsapp-compose.mjs',
    'api-root/pilot-config.mjs': 'deploy/hostinger-pilot/pilot-config.mjs',
    'db/whatsapp-postgres.js': 'packages/db/dist/repositories/whatsapp-postgres.js',
    **{f'contracts/{n}.js': f'packages/contracts/dist/{n}.js' for n in ['meta-whatsapp', 'whatsapp-n8n', 'whatsapp-upload']},
    **{f'api-routes/{n}.js': f'apps/api/dist/routes/{n}.js' for n in ['approvals', 'whatsapp-inbox']},
    **{f'api-services/{n}.js': f'apps/api/dist/services/{n}.js' for n in ['chat-whatsapp-assistant', 'chat-whatsapp-read', 'whatsapp-durable', 'whatsapp-inbox', 'whatsapp-media-preview', 'whatsapp-media-upload', 'whatsapp-media', 'whatsapp-templates', 'whatsapp-upload-admission']},
    **{f'host-scripts/{n}': f'deploy/hostinger-pilot/{n}' for n in ['pilot-meta-key-entry.sh', 'pilot-send-live-on.sh', 'pilot-send-live-off.sh']},
}
SQL_SHA = '03f152fd0755cdfa5a00be8cba59cf33f4ad792c9d5ec0684189f651572672ee'
shutil.rmtree(pub)
pub.mkdir(parents=True)
(pub / 'pilot-compose-base.json').write_text(json.dumps(base_copy, indent=2), encoding='utf-8')
for target, source in files.items():
    dest = pub / target; dest.parent.mkdir(parents=True, exist_ok=True)
    data = (root / source).read_bytes()
    if target.startswith('host-scripts/'):
        data = data.replace(b'\r\n', b'\n')  # LF only on the server
    dest.write_bytes(data)
shutil.copytree(root / 'apps/web/dist', pub / 'web-dist')
assert hashlib.sha256((pub / '10825-whatsapp-templates-media-contacts.review.sql').read_bytes()).hexdigest() == SQL_SHA, 'reviewed SQL changed'
# Paused Phone code must never enter the pilot.
for path in pub.rglob('*.js'):
    if re.search(rb'PHONE_AI_CALL_ACTION|PhoneCallingService|chat-phone-calling|phone-calling-store', path.read_bytes()):
        sys.exit('Paused Phone code found in ' + str(path.relative_to(pub)))
manifest = sorted(({'Path': p.relative_to(pub).as_posix(), 'SHA256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in pub.rglob('*') if p.is_file()), key=lambda x: x['Path'])
(pub / 'manifest.json').write_text(json.dumps(manifest, indent=1), encoding='utf-8')
now = int(time.time())
def clean(t):
    t.uid = t.gid = 0; t.uname = t.gname = ''; t.mtime = now; return t  # real mtimes: never let BuildKit keep stale files
archive = cache / 'publication.tar.gz'
with tarfile.open(archive, 'w:gz') as tar:
    for name in sorted(os.listdir(pub)):
        tar.add(pub / name, arcname=name, filter=clean)
raw = archive.read_bytes(); sha = hashlib.sha256(raw).hexdigest()
publisher = (root / 'deploy/hostinger-pilot/publish-whatsapp-compose.py').read_text(encoding='utf-8')
publisher = re.sub(r"ARCHIVE_SHA = '[^']*'", "ARCHIVE_SHA = '" + sha + "'", publisher, count=1)
(root / 'deploy/hostinger-pilot/publish-whatsapp-compose.py').write_text(publisher, encoding='utf-8', newline='\n')
(cache / 'publish.sh').write_text("set -euo pipefail\npython3 - <<'THAARA_10827_PY'\nOWNER_APPROVED_10827 = True\nPAYLOAD = '" + base64.b64encode(raw).decode() + "'\n" + publisher + "\nTHAARA_10827_PY\n", encoding='utf-8', newline='\n')
print(json.dumps({'files': len(manifest), 'archive_sha256': sha, 'bytes': len(raw)}))
