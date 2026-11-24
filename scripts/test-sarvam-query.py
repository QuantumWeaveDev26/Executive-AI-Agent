"""Test Sarvam Analytics API with X-API-Key header and start/end datetime query params."""
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
    'limit': 10
})

url = f"{base_url}?{params}"
print("Testing URL:", url)

headers = {
    'X-API-Key': sarvam_api_key,
    'User-Agent': 'Thaara-Sync/1.0'
}

req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        print("SUCCESS! Status:", resp.status)
        data = resp.read().decode('utf-8')
        parsed = json.loads(data)
        print("Data type:", type(parsed))
        if isinstance(parsed, list):
            print(f"Returned {len(parsed)} attempts.")
            if parsed:
                print("First attempt preview:", json.dumps(parsed[0], indent=2)[:500])
        elif isinstance(parsed, dict):
            print("Dict keys:", list(parsed.keys()))
            print("Preview:", json.dumps(parsed, indent=2)[:500])
except urllib.error.HTTPError as e:
    print(f"HTTPError {e.code}: {e.reason}")
    print("Body:", e.read().decode('utf-8'))
except Exception as ex:
    print("Exception:", ex)
