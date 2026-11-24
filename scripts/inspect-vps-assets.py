import os
from pathlib import Path

p = Path('/opt/thaara-v2-pilot/staging-phone-n8n-sync/web-dist/assets')
if p.exists():
    for f in p.iterdir():
        print(f.name, f.stat().st_size)
else:
    print("Does not exist!")
