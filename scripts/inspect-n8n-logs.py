"""Check n8n container logs."""
import subprocess

p = subprocess.run(['docker', 'logs', '--tail', '50', 'n8n-n8n-1'], capture_output=True, text=True)
print("STDOUT:\n", p.stdout)
print("STDERR:\n", p.stderr)
