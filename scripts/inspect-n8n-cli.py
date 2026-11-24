"""Check n8n CLI capabilities."""
import subprocess
p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', '--version'], capture_output=True, text=True)
print("n8n version:", p.stdout.strip(), p.stderr.strip())

p2 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--help'], capture_output=True, text=True)
print("import:workflow help:", p2.stdout.strip()[:300])
