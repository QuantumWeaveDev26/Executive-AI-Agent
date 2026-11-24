"""Inspect messages structure in Sarvam transcript response."""
import urllib.request
import urllib.parse
import json
from pathlib import Path

PRIVATE = Path('/opt/thaara-v2-pilot-private')
sarvam_api_key = (PRIVATE / 'secrets' / 'sarvam_api_key').read_text(encoding='utf-8').strip()

interaction_id = "20261031/04db88db-18:07:43-251116b1"
encoded = urllib.parse.quote(interaction_id, safe='')
url = f"https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453/transcripts/{encoded}"

headers = {
    'User-Agent': 'Thaara-Sync/1.0',
    'X-API-Key': sarvam_api_key,
    'api-subscription-key': sarvam_api_key
}

req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req, timeout=15) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    print("Messages count:", len(data.get('messages', [])))
    if data.get('messages'):
        print("Sample message 0:", json.dumps(data['messages'][0], indent=2))
        if len(data['messages']) > 1:
            print("Sample message 1:", json.dumps(data['messages'][1], indent=2))
