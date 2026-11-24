"""Test querying Sarvam recordings endpoint."""
import urllib.request
import urllib.parse
from pathlib import Path

PRIVATE = Path('/opt/thaara-v2-pilot-private')
sarvam_api_key = (PRIVATE / 'secrets' / 'sarvam_api_key').read_text(encoding='utf-8').strip()

interaction_id = "20261031/04db88db-18:07:43-251116b1"
encoded = urllib.parse.quote(interaction_id, safe='')
url = f"https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453/recordings/{encoded}"

req = urllib.request.Request(url, headers={
    'User-Agent': 'Thaara-Voice-Proxy/1.0',
    'X-API-Key': sarvam_api_key,
    'Accept': 'audio/wav, audio/*;q=0.9'
})

try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        print("Sarvam recording fetch: SUCCESS 200")
        print("Content-Type:", resp.headers.get('content-type'))
        print("Content-Length:", resp.headers.get('content-length'))
except urllib.error.HTTPError as e:
    print(f"HTTP ERROR {e.code}: {e.read().decode('utf-8')[:200]}")
except Exception as e:
    print("ERROR:", e)
