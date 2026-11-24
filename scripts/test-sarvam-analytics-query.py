"""Test querying Sarvam analytics API with X-API-Key."""
import urllib.request
import urllib.error
import json
from pathlib import Path

PRIVATE = Path('/opt/thaara-v2-pilot-private')
sarvam_api_key = (PRIVATE / 'secrets' / 'sarvam_api_key').read_text(encoding='utf-8').strip()

from datetime import datetime, timedelta, timezone

now = datetime.now(timezone.utc)
start = (now - timedelta(days=30)).strftime('%Y-%m-%dT%H:%M:%SZ')
end = (now + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ')

url = f"https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453/attempts?limit=5&offset=0&start_datetime={start}&end_datetime={end}"

for header_name in ['X-API-Key', 'api-subscription-key', 'both']:
    headers = {'User-Agent': 'Thaara-Sync/1.0'}
    if header_name == 'both':
        headers['X-API-Key'] = sarvam_api_key
        headers['api-subscription-key'] = sarvam_api_key
    else:
        headers[header_name] = sarvam_api_key
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            print(f"Header '{header_name}': SUCCESS status={resp.status}, count={len(data.get('items', []))}")
            if data.get('items'):
                sample = data['items'][0]
                print(f"  Sample attempt_id={sample.get('attempt_id')}, direction={sample.get('channel_direction')}, interaction_id={sample.get('interaction_id')}")
    except urllib.error.HTTPError as e:
        print(f"Header '{header_name}': HTTP ERROR {e.code}: {e.read().decode('utf-8')[:200]}")
    except Exception as e:
        print(f"Header '{header_name}': ERROR {e}")
