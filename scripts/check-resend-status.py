"""Check Resend email status for d14034cf-59c5-4798-895a-27513fbc2b67."""
import subprocess
import json
import urllib.request
from pathlib import Path

PRIVATE = Path('/opt/thaara-v2-pilot-private')
key_path = PRIVATE / 'secrets' / 'send_profile'

if key_path.exists():
    raw = key_path.read_text(encoding='utf-8').strip()
    try:
        profile = json.loads(raw)
        resend_key = profile.get('apiKey') or profile.get('key')
    except Exception:
        resend_key = raw

    if resend_key:
        req = urllib.request.Request(
            'https://api.resend.com/emails/d14034cf-59c5-4798-895a-27513fbc2b67',
            headers={'Authorization': f'Bearer {resend_key}'}
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                print("Resend email details:\n", json.dumps(data, indent=2))
        except Exception as e:
            print("Resend query error:", e)
    else:
        print("No resend key in send_profile")
else:
    print("send_profile not found")
