"""Configure n8n workflows with direct header authentication without credential dependencies."""
import json
import subprocess
from pathlib import Path

VERIFIED_TOKEN = '34d60f56367e401eab3d3c8e3b1ae4902838cb71f3e1cdc3bb2bfa55b87af850'
PRIVATE = Path('/opt/thaara-v2-pilot-private')
sarvam_api_key = (PRIVATE / 'secrets' / 'sarvam_api_key').read_text(encoding='utf-8').strip()
PROJECT_ID = 'fn6pQNcDpG7hLM3t'

stage = Path('/opt/thaara-v2-pilot/staging-phone-n8n-sync')
wf1_path = stage / 'wf1.json'
wf2_path = stage / 'wf2.json'

wf1 = json.loads(wf1_path.read_text(encoding='utf-8'))
wf2 = json.loads(wf2_path.read_text(encoding='utf-8'))

# Update WF1 nodes
for node in wf1.get('nodes', []):
    name = node.get('name', '')
    if node.get('type') == 'n8n-nodes-base.httpRequest':
        params = node.setdefault('parameters', {})
        params['authentication'] = 'none'
        params.pop('genericAuthType', None)
        node.pop('credentials', None)
        params['sendHeaders'] = True
        
        if 'Sarvam' in name or 'Transcript' in name:
            params['headerParameters'] = {
                'parameters': [{'name': 'api-subscription-key', 'value': sarvam_api_key}]
            }
        elif any(k in name for k in ['Verify', 'Receipt', 'Release']):
            params['headerParameters'] = {
                'parameters': [{'name': 'x-thaara-phone-sync-token', 'value': VERIFIED_TOKEN}]
            }

# Update WF2 nodes
for node in wf2.get('nodes', []):
    name = node.get('name', '')
    if node.get('type') == 'n8n-nodes-base.httpRequest':
        params = node.setdefault('parameters', {})
        params['authentication'] = 'none'
        params.pop('genericAuthType', None)
        node.pop('credentials', None)
        params['sendHeaders'] = True
        
        if 'Sarvam' in name or 'Transcript' in name:
            params['headerParameters'] = {
                'parameters': [{'name': 'api-subscription-key', 'value': sarvam_api_key}]
            }
        elif any(k in name for k in ['Checkpoint', 'Batch']):
            params['headerParameters'] = {
                'parameters': [{'name': 'x-thaara-phone-sync-token', 'value': VERIFIED_TOKEN}]
            }

wf1_path.write_text(json.dumps(wf1, indent=2), encoding='utf-8')
wf2_path.write_text(json.dumps(wf2, indent=2), encoding='utf-8')

# Copy into container
subprocess.run(['docker', 'cp', str(wf1_path), 'n8n-n8n-1:/tmp/wf1.json'], check=True)
subprocess.run(['docker', 'cp', str(wf2_path), 'n8n-n8n-1:/tmp/wf2.json'], check=True)

# Re-import
p1 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf1.json', f'--projectId={PROJECT_ID}'], capture_output=True, text=True)
p2 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf2.json', f'--projectId={PROJECT_ID}'], capture_output=True, text=True)
print("Import WF1:\n", p1.stdout, p1.stderr)
print("Import WF2:\n", p2.stdout, p2.stderr)

# Publish workflows
pub1 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'publish:workflow', '--id=ThaaraCbNotif001'], capture_output=True, text=True)
pub2 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'publish:workflow', '--id=ThaarSarvamSync1'], capture_output=True, text=True)
print("Publish:\n", pub1.stdout, pub2.stdout)

# Restart n8n container
subprocess.run(['docker', 'restart', 'n8n-n8n-1'], check=True)
print("Restarted n8n successfully.")
