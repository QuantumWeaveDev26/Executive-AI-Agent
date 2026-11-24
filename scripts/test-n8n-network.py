"""Test network connectivity from n8n-n8n-1 to thaara-v2-pilot-api-1."""
import subprocess
import hmac
import hashlib
from pathlib import Path

PRIVATE = Path('/opt/thaara-v2-pilot-private')
secret_path = PRIVATE / 'secrets' / 'sarvam_webhook_secret'
raw_secret = secret_path.read_text(encoding='utf-8').strip()

WORKSPACE_ID = '75d2f889-d3eb-4acc-861a-fada4691ecce'
OWNER_USER_ID = '4b4cbc9c-df01-4cc2-8565-8a23a3435b9d'
msg = f"thaara:phone-n8n-sync:v1:{WORKSPACE_ID}:{OWNER_USER_ID}".encode('utf-8')
derived_token = hmac.new(raw_secret.encode('utf-8'), msg, hashlib.sha256).hexdigest()

js = f"""
fetch('http://thaara-v2-pilot-api-1:3002/api/v1/connectors/phone/n8n/checkpoint', {{
  headers: {{ 'x-thaara-phone-sync-token': '{derived_token}' }}
}})
.then(r => r.json().then(d => console.log(JSON.stringify({{status: r.status, body: d}}))))
.catch(e => console.error(e));
"""

p = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1',
    'node', '--input-type=module', '-e', js
], capture_output=True, text=True)

print("STDOUT:\n", p.stdout)
print("STDERR:\n", p.stderr)
