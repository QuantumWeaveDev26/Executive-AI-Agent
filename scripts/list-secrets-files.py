import os
from pathlib import Path
import json

secrets_dir = Path('/opt/thaara-v2-pilot-private/secrets')
files = []
if secrets_dir.exists():
    for f in secrets_dir.iterdir():
        files.append({'name': f.name, 'size': f.stat().st_size})

print(json.dumps(files, indent=2))
