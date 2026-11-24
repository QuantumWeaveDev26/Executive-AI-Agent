"""Test network reachability from inside n8n to Thaara API."""
import subprocess

js = """
fetch('http://172.16.1.13:3002/api/v1/connectors/phone/n8n/checkpoint', {
  headers: { 'x-thaara-phone-sync-token': '34d60f56367e401eab3d3c8e3b1ae4902838cb71f3e1cdc3bb2bfa55b87af850' }
})
.then(r => r.json().then(d => console.log('STATUS:', r.status, JSON.stringify(d))))
.catch(e => console.error('ERR:', e));
"""

p = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'node', '--input-type=module', '-e', js
], capture_output=True, text=True)
print("STDOUT:", p.stdout)
print("STDERR:", p.stderr)
