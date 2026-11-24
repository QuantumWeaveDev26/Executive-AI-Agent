"""Check n8n commands."""
import subprocess

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', '--help'], capture_output=True, text=True)
print(p.stdout)
