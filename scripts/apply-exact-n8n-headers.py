"""Update n8n workflows with complete headers for all nodes and re-import/publish."""
import json
import subprocess
from pathlib import Path

VERIFIED_TOKEN = '34d60f56367e401eab3d3c8e3b1ae4902838cb71f3e1cdc3bb2bfa55b87af850'
PRIVATE = Path('/opt/thaara-v2-pilot-private')
sarvam_api_key = (PRIVATE / 'secrets' / 'sarvam_api_key').read_text(encoding='utf-8').strip()
PROJECT_ID = 'fn6pQNcDpG7hLM3t'

stage = Path('/opt/thaara-v2-pilot/staging-phone-n8n-sync')
stage.mkdir(parents=True, exist_ok=True)
wf1_path = stage / 'wf1.json'
wf2_path = stage / 'wf2.json'

# Read current workflows from n8n database to keep whatever the user configured in UI
fetch_script = """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.all("SELECT id, name, nodes, connections FROM workflow_entity WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err, rows) => {
    console.log(JSON.stringify(rows));
    db.close();
  });
});
"""

p_fetch = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', fetch_script], capture_output=True, text=True)
rows = json.loads(p_fetch.stdout)

wf1 = None
wf2 = None
for r in rows:
    wf_obj = {
        'id': r['id'],
        'name': r['name'],
        'nodes': json.loads(r['nodes']),
        'connections': json.loads(r['connections'])
    }
    if r['id'] == 'ThaaraCbNotif001':
        wf1 = wf_obj
    elif r['id'] == 'ThaarSarvamSync1':
        wf2 = wf_obj

if not wf1 or not wf2:
    raise RuntimeError("Could not find both workflows in n8n database")

# Helper to configure an HTTP request node
def configure_http_node(node):
    params = node.setdefault('parameters', {})
    url = str(params.get('url', ''))
    params['authentication'] = 'none'
    params.pop('genericAuthType', None)
    node.pop('credentials', None)
    params['sendHeaders'] = True

    if 'sarvam.ai' in url:
        params['headerParameters'] = {
            'parameters': [
                {'name': 'X-API-Key', 'value': sarvam_api_key},
                {'name': 'api-subscription-key', 'value': sarvam_api_key}
            ]
        }
    elif '172.16.1.13:3002' in url or 'thaara' in url or '/api/v1/connectors/phone/n8n/' in url:
        params['headerParameters'] = {
            'parameters': [
                {'name': 'x-thaara-phone-sync-token', 'value': VERIFIED_TOKEN}
            ]
        }

# Update WF1 (Callback Notifications)
for node in wf1.get('nodes', []):
    if node.get('type') == 'n8n-nodes-base.httpRequest':
        configure_http_node(node)
    elif node.get('type') == 'n8n-nodes-base.emailSend':
        # Ensure BrandMint SMTP credential is used
        node['credentials'] = {
            'smtp': {
                'id': 'G1VGVGldX32ch2xV',
                'name': 'BrandMint SMTP'
            }
        }

# Update WF2 (Call History Sync)
for node in wf2.get('nodes', []):
    if node.get('type') == 'n8n-nodes-base.httpRequest':
        configure_http_node(node)

wf1_path.write_text(json.dumps(wf1, indent=2), encoding='utf-8')
wf2_path.write_text(json.dumps(wf2, indent=2), encoding='utf-8')

# Copy into n8n container
subprocess.run(['docker', 'cp', str(wf1_path), 'n8n-n8n-1:/tmp/wf1.json'], check=True)
subprocess.run(['docker', 'cp', str(wf2_path), 'n8n-n8n-1:/tmp/wf2.json'], check=True)

# Re-import
p1 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf1.json', f'--projectId={PROJECT_ID}'], capture_output=True, text=True)
p2 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf2.json', f'--projectId={PROJECT_ID}'], capture_output=True, text=True)
print("Import WF1:\n", p1.stdout, p1.stderr)
print("Import WF2:\n", p2.stdout, p2.stderr)

# Ensure both workflows remain active
act_script = """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', (err) => {
  db.run("UPDATE workflow_entity SET active = 1 WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err2) => {
    db.all("SELECT id, name, active FROM workflow_entity WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err3, rows) => {
      console.log(JSON.stringify(rows));
      db.close();
    });
  });
});
"""
p_act = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', act_script], capture_output=True, text=True)
print("Active status:", p_act.stdout)

# Restart n8n container to register clean active triggers
subprocess.run(['docker', 'restart', 'n8n-n8n-1'], check=True)
print("Restarted n8n container successfully.")
