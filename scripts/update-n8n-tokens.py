"""Update n8n workflows with verified token and activate."""
import json
import subprocess
from pathlib import Path

VERIFIED_TOKEN = '34d60f56367e401eab3d3c8e3b1ae4902838cb71f3e1cdc3bb2bfa55b87af850'
PROJECT_ID = 'fn6pQNcDpG7hLM3t'

stage = Path('/opt/thaara-v2-pilot/staging-phone-n8n-sync')
wf1_path = stage / 'wf1.json'
wf2_path = stage / 'wf2.json'

wf1 = json.loads(wf1_path.read_text(encoding='utf-8'))
wf2 = json.loads(wf2_path.read_text(encoding='utf-8'))

for node in wf1.get('nodes', []):
    if node.get('name') in ['Verify Consent & Claim Single Delivery', 'Record Delivery Receipt', 'Release Claim for Retry']:
        params = node.get('parameters', {})
        header_params = params.get('headerParameters', {}).get('parameters', [])
        for hp in header_params:
            if hp.get('name') == 'x-thaara-phone-sync-token':
                hp['value'] = VERIFIED_TOKEN

for node in wf2.get('nodes', []):
    if node.get('name') in ['Fetch Sync Checkpoint', 'Send Call Batch to Thaara']:
        params = node.get('parameters', {})
        header_params = params.get('headerParameters', {}).get('parameters', [])
        for hp in header_params:
            if hp.get('name') == 'x-thaara-phone-sync-token':
                hp['value'] = VERIFIED_TOKEN

wf1_path.write_text(json.dumps(wf1, indent=2), encoding='utf-8')
wf2_path.write_text(json.dumps(wf2, indent=2), encoding='utf-8')

# Copy into container
subprocess.run(['docker', 'cp', str(wf1_path), 'n8n-n8n-1:/tmp/wf1.json'], check=True)
subprocess.run(['docker', 'cp', str(wf2_path), 'n8n-n8n-1:/tmp/wf2.json'], check=True)

# Re-import
p1 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf1.json', f'--projectId={PROJECT_ID}'], capture_output=True, text=True)
print("Import WF1:\n", p1.stdout, p1.stderr)

p2 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf2.json', f'--projectId={PROJECT_ID}'], capture_output=True, text=True)
print("Import WF2:\n", p2.stdout, p2.stderr)

# Activate
act_p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', (err) => {
  db.run("UPDATE workflow_entity SET active = 1 WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err2) => {
    db.all("SELECT id, name, active FROM workflow_entity WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err3, rows) => {
      console.log(JSON.stringify(rows));
      db.close();
    });
  });
});
"""], capture_output=True, text=True)
print("Activated rows:\n", act_p.stdout)

# Restart n8n container
subprocess.run(['docker', 'restart', 'n8n-n8n-1'], check=True)
print("Restarted n8n.")
