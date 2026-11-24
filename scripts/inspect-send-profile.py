"""Check send_profile keys."""
import json
from pathlib import Path

PRIVATE = Path('/opt/thaara-v2-pilot-private')
p = PRIVATE / 'secrets' / 'send_profile'
if p.exists():
    data = json.loads(p.read_text(encoding='utf-8').strip())
    print("send_profile keys:", list(data.keys()))
