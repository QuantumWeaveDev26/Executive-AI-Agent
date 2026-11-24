"""Test Sarvam attempts query with filter_conditions."""
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
    'limit': 5,
    'offset': 0,
    'filter_conditions': json.dumps([{'field': 'channel_direction', 'operator': 'equals', 'value': 'inbound'}])
})

url = f"{base_url}?{params}"
req = urllib.request.Request(url, headers={'X-API-Key': sarvam_api_key})
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        print("Status with filter_conditions:", resp.status)
        data = json.loads(resp.read().decode('utf-8'))
        print("Total returned items:", len(data.get('items', [])))
        for it in data.get('items', []):
            print("  Direction:", it.get('channel_direction'), "attempt_id:", it.get('attempt_id'))
except urllib.error.HTTPError as e:
    print(f"HTTPError {e.code}: {e.reason}")
    print("Body:", e.read().decode('utf-8'))
