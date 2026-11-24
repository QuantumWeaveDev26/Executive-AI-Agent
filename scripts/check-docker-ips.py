"""Check docker networks and IP of thaara-v2-pilot-api-1 and n8n-n8n-1."""
import subprocess
import json

p1 = subprocess.run(['docker', 'inspect', 'thaara-v2-pilot-api-1'], capture_output=True, text=True)
p2 = subprocess.run(['docker', 'inspect', 'n8n-n8n-1'], capture_output=True, text=True)

d1 = json.loads(p1.stdout)[0]
d2 = json.loads(p2.stdout)[0]

print("=== thaara-v2-pilot-api-1 Networks ===")
for net_name, net_info in d1.get('NetworkSettings', {}).get('Networks', {}).items():
    print(f"Network: {net_name}, IP: {net_info.get('IPAddress')}")

print("\n=== n8n-n8n-1 Networks ===")
for net_name, net_info in d2.get('NetworkSettings', {}).get('Networks', {}).items():
    print(f"Network: {net_name}, IP: {net_info.get('IPAddress')}")
