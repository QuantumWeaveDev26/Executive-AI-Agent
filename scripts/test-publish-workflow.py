"""Test publish:workflow command on both workflows."""
import subprocess

p1 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'publish:workflow', '--id=ThaarSarvamSync1'], capture_output=True, text=True)
print("Publish ThaarSarvamSync1:\n", p1.stdout, p1.stderr)

p2 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'publish:workflow', '--id=ThaaraCbNotif001'], capture_output=True, text=True)
print("Publish ThaaraCbNotif001:\n", p2.stdout, p2.stderr)

# Restart n8n container
subprocess.run(['docker', 'restart', 'n8n-n8n-1'], check=True)
print("Restarted n8n.")
