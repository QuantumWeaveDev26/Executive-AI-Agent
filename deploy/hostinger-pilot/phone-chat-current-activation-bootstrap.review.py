"""Pinned transport payload. PACKAGE_B64 and PACKAGE_SHA are prepended in memory by the approved local wrapper."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import zipfile

def check(ok):
    if not ok: raise RuntimeError('package_or_destination_denied')

try:
    body=base64.b64decode(PACKAGE_B64,validate=True)
    check(hashlib.sha256(body).hexdigest()==PACKAGE_SHA)
    parent=Path('/opt/thaara-v2-pilot-private/handoff')
    for p in [Path('/'),Path('/opt'),Path('/opt/thaara-v2-pilot-private'),parent]:
        s=p.lstat();check(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022)
    target=parent/'phone-chat-current-activate-20261105'
    check(not target.exists() and not target.is_symlink())
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        names=z.namelist();check(len(names)==len(set(names)) and 'manifest.json' in names)
        manifest_body=z.read('manifest.json');manifest=json.loads(manifest_body)
        check(set(names)==set(manifest['packageFiles'])|{'manifest.json'})
        check(all(not n.startswith('/') and '\\' not in n and '..' not in n.split('/') and not n.endswith('/') for n in names))
        check(all(i.file_size<1048576 and not stat.S_ISLNK(i.external_attr>>16) for i in z.infolist()))
        for name,sha in manifest['packageFiles'].items():check(hashlib.sha256(z.read(name)).hexdigest()==sha)
        target.mkdir(mode=0o700)
        for name in names:
            f=target/name;f.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            with f.open('xb') as out:out.write(z.read(name))
            os.chmod(f,0o600)
    result=subprocess.run(['python3','-B',str(target/'deploy.review.py'),'--approved-phone-chat-deploy',str(target),hashlib.sha256(manifest_body).hexdigest()],capture_output=True,timeout=1800)
    # Child emits only sanitized receipts. Never relay stderr/build logs/config.
    receipts=[json.loads(line) for line in result.stdout.decode().splitlines()]
    check(receipts and all(isinstance(r,dict) and r.get('status') in ['verified','stopped','rolled_back'] for r in receipts))
    for r in receipts:print(json.dumps(r))
    raise SystemExit(result.returncode)
except Exception:
    print(json.dumps({'status':'stopped','category':'package_or_deployment_failed','callsPlaced':0}));raise SystemExit(1)
