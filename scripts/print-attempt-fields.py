"""Print complete attempt object fields."""
from pathlib import Path
import urllib.request
import urllib.parse
import json
from datetime import datetime, timedelta, timezone

secrets_dir = Path('/opt/thaara-v2-pilot-private/secrets')
sarvam_api_key = (secrets_dir / 'sarvam_api_key').read_text(encoding='utf-8').strip()

base_url = "https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453/attempts"

now = datetime.now(timezone.utc)
start = (now - timedelta(days=7)).isoformat()
end = now.isoformat()

params = urllib.parse.urlencode({
    'start_datetime': start,
    'end_datetime': end,
    'limit': 2
})

url = f"{base_url}?{params}"
req = urllib.request.Request(url, headers={'X-API-Key': sarvam_api_key})
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    for it in data.get('items', []):
        print(json.dumps(it, indent=2))
