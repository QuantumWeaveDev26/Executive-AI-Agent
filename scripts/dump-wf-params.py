"""Inspect parameters and code of nodes in wf1 and wf2."""
import json
from pathlib import Path

stage = Path('/opt/thaara-v2-pilot/staging-phone-n8n-sync')
wf1 = json.loads((stage / 'wf1.json').read_text(encoding='utf-8'))
wf2 = json.loads((stage / 'wf2.json').read_text(encoding='utf-8'))

print("=== WF1 Detailed Nodes ===")
for n in wf1.get('nodes', []):
    print(f"\nNode: {n.get('name')} ({n.get('type')})")
    print("Parameters:", json.dumps(n.get('parameters'), indent=2))

print("\n=== WF2 Detailed Nodes ===")
for n in wf2.get('nodes', []):
    print(f"\nNode: {n.get('name')} ({n.get('type')})")
    print("Parameters:", json.dumps(n.get('parameters'), indent=2))
