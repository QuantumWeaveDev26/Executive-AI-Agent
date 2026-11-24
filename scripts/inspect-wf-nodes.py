"""Inspect all nodes in wf1 and wf2."""
import json
from pathlib import Path

stage = Path('/opt/thaara-v2-pilot/staging-phone-n8n-sync')
wf1 = json.loads((stage / 'wf1.json').read_text(encoding='utf-8'))
wf2 = json.loads((stage / 'wf2.json').read_text(encoding='utf-8'))

print("=== WF1 NODES ===")
for node in wf1.get('nodes', []):
    print(f"Name: {node.get('name')}, Type: {node.get('type')}")
    params = node.get('parameters', {})
    print(f"  URL: {params.get('url')}")
    print(f"  Auth: {params.get('authentication')}, genericAuthType: {params.get('genericAuthType')}")
    print(f"  Credentials: {node.get('credentials')}")
    print(f"  Headers: {params.get('headerParameters')}")

print("\n=== WF2 NODES ===")
for node in wf2.get('nodes', []):
    print(f"Name: {node.get('name')}, Type: {node.get('type')}")
    params = node.get('parameters', {})
    print(f"  URL: {params.get('url')}")
    print(f"  Auth: {params.get('authentication')}, genericAuthType: {params.get('genericAuthType')}")
    print(f"  Credentials: {node.get('credentials')}")
    print(f"  Headers: {params.get('headerParameters')}")
