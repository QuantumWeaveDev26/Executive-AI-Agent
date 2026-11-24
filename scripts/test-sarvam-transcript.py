"""Test transcript retrieval with X-API-Key."""
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
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print("Transcript retrieval SUCCESS: status=200")
        print("Transcript keys:", list(data.keys()))
        if 'transcript' in data:
            print(f"Turns count: {len(data['transcript'])}")
            if len(data['transcript']) > 0:
                print("First turn:", data['transcript'][0])
except Exception as e:
    print("Transcript retrieval ERROR:", e)
