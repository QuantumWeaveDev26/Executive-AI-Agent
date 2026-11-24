"""Import and activate the two Thaara workflows in n8n with explicit IDs."""
import json
import subprocess
import hmac
import hashlib
from pathlib import Path

PRIVATE = Path('/opt/thaara-v2-pilot-private')
secret_path = PRIVATE / 'secrets' / 'sarvam_webhook_secret'
raw_secret = secret_path.read_text(encoding='utf-8').strip()

WORKSPACE_ID = '75d2f889-d3eb-4acc-861a-fada4691ecce'
OWNER_USER_ID = '4b4cbc9c-df01-4cc2-8565-8a23a3435b9d'
PROJECT_ID = 'fn6pQNcDpG7hLM3t'

msg = f"thaara:phone-n8n-sync:v1:{WORKSPACE_ID}:{OWNER_USER_ID}".encode('utf-8')
derived_token = hmac.new(raw_secret.encode('utf-8'), msg, hashlib.sha256).hexdigest()
print("Derived token prefix:", derived_token[:12])

WF1_PATH = Path('/opt/thaara-v2-pilot/staging-phone-n8n-sync') / 'wf1.json'
WF2_PATH = Path('/opt/thaara-v2-pilot/staging-phone-n8n-sync') / 'wf2.json'

# Read templates from bundled or repo
with open('/opt/thaara-v2-pilot/staging-phone-n8n-sync/wf1_template.json', 'r') as f:
    wf1 = json.load(f)
with open('/opt/thaara-v2-pilot/staging-phone-n8n-sync/wf2_template.json', 'r') as f:
    wf2 = json.load(f)

wf1['id'] = 'ThaaraCbNotif001'
wf2['id'] = 'ThaarSarvamSync1'

# Substitute token in HTTP Request headers
for node in wf1.get('nodes', []):
    if node.get('name') in ['Verify Consent & Claim Single Delivery', 'Record Delivery Receipt', 'Release Claim for Retry']:
        params = node.get('parameters', {})
        header_params = params.get('headerParameters', {}).get('parameters', [])
        for hp in header_params:
            if hp.get('name') == 'x-thaara-phone-sync-token':
                hp['value'] = derived_token

for node in wf2.get('nodes', []):
    if node.get('name') in ['Fetch Sync Checkpoint', 'Send Call Batch to Thaara']:
        params = node.get('parameters', {})
        header_params = params.get('headerParameters', {}).get('parameters', [])
        for hp in header_params:
            if hp.get('name') == 'x-thaara-phone-sync-token':
                hp['value'] = derived_token

WF1_PATH.write_text(json.dumps(wf1, indent=2), encoding='utf-8')
WF2_PATH.write_text(json.dumps(wf2, indent=2), encoding='utf-8')

# Copy into container
subprocess.run(['docker', 'cp', str(WF1_PATH), 'n8n-n8n-1:/tmp/wf1.json'], check=True)
subprocess.run(['docker', 'cp', str(WF2_PATH), 'n8n-n8n-1:/tmp/wf2.json'], check=True)

# Run n8n import:workflow
p1 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf1.json', f'--projectId={PROJECT_ID}'], capture_output=True, text=True)
print("Import WF1:\n", p1.stdout, p1.stderr)

p2 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf2.json', f'--projectId={PROJECT_ID}'], capture_output=True, text=True)
print("Import WF2:\n", p2.stdout, p2.stderr)

# Activate both workflows in sqlite
act_p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', (err) => {
  if (err) { console.error(err); process.exit(1); }
  db.run("UPDATE workflow_entity SET active = 1 WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err2) => {
    if (err2) { console.error(err2); process.exit(1); }
    db.all("SELECT id, name, active FROM workflow_entity WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err3, rows) => {
      console.log(JSON.stringify(rows));
      db.close();
    });
  });
});
"""], capture_output=True, text=True)
print("Activated rows:\n", act_p.stdout, act_p.stderr)

# Restart n8n container to register active triggers
subprocess.run(['docker', 'restart', 'n8n-n8n-1'], check=True)
print("n8n restarted successfully.")
