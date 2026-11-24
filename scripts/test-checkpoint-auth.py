"""Test checkpoint endpoint with calculated expectedToken."""
import subprocess

js = """
fetch('http://thaara-v2-pilot-api-1:3002/api/v1/connectors/phone/n8n/checkpoint', {
  headers: { 'x-thaara-phone-sync-token': '34d60f56367e401eab3d3c8e3b1ae4902838cb71f3e1cdc3bb2bfa55b87af850' }
})
.then(r => r.json().then(d => console.log(JSON.stringify({status: r.status, body: d}))))
.catch(e => console.error(e));
"""

p = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1',
    'node', '--input-type=module', '-e', js
], capture_output=True, text=True)

print("STDOUT:\n", p.stdout)
print("STDERR:\n", p.stderr)
