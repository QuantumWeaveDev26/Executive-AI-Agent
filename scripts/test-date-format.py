"""Test Sarvam API datetime format sensitivity."""
import urllib.request
import urllib.error
from pathlib import Path

PRIVATE = Path('/opt/thaara-v2-pilot-private')
sarvam_api_key = (PRIVATE / 'secrets' / 'sarvam_api_key').read_text(encoding='utf-8').strip()

def test_dates(start_dt, end_dt):
    url = f"https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453/attempts?limit=5&offset=0&start_datetime={start_dt}&end_datetime={end_dt}"
    headers = {'User-Agent': 'Thaara-Sync/1.0', 'X-API-Key': sarvam_api_key}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"[{start_dt}] -> SUCCESS 200")
    except urllib.error.HTTPError as e:
        print(f"[{start_dt}] -> HTTP ERROR {e.code}: {e.read().decode('utf-8')[:150]}")

test_dates("2026-10-18T13:01:24.602Z", "2026-11-18T05:40:00.000Z")
test_dates("2026-10-18T13:01:24Z", "2026-11-18T05:40:00Z")
