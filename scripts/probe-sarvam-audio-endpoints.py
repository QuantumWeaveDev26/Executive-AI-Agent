"""Probe potential Sarvam audio/recording endpoints under apps.sarvam.ai."""
from pathlib import Path
import urllib.request
import urllib.error
import json

secrets_dir = Path('/opt/thaara-v2-pilot-private/secrets')
sarvam_api_key = (secrets_dir / 'sarvam_api_key').read_text(encoding='utf-8').strip()

base = "https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453"
interaction_id = "20261116/921070f1-11:55:58-aw1a08aa"
attempt_id = "475aca75-4f46-4e2e-a751-4c5386798399"

candidates = [
    f"{base}/recordings/{interaction_id}",
    f"{base}/audio/{interaction_id}",
    f"{base}/media/{interaction_id}",
    f"{base}/attempts/{attempt_id}/recording",
    f"{base}/attempts/{attempt_id}/audio",
    f"https://apps.sarvam.ai/api/analytics/v1/media?interaction_id={interaction_id}",
    f"https://api.sarvam.ai/media?interaction_id={interaction_id}",
]

headers = {'X-API-Key': sarvam_api_key}

for url in candidates:
    print(f"Testing: {url}")
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"  -> SUCCESS {resp.status} Content-Type: {resp.headers.get('Content-Type')}")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')[:100]
        print(f"  -> HTTPError {e.code}: {body}")
    except Exception as ex:
        print(f"  -> {ex}")
