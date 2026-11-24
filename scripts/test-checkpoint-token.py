"""Test Thaara backend checkpoint and sync endpoints with token."""
import urllib.request
import json

token = "34d60f56367e401eab3d3c8e3b1ae4902838cb71f3e1cdc3bb2bfa55b87af850"

# Test Checkpoint
req1 = urllib.request.Request(
    'http://172.16.1.13:3002/api/v1/connectors/phone/n8n/checkpoint',
    headers={'x-thaara-phone-sync-token': token}
)
try:
    with urllib.request.urlopen(req1, timeout=5) as resp:
        print("Checkpoint response status:", resp.status)
        print("Checkpoint body:", resp.read().decode('utf-8'))
except Exception as e:
    print("Checkpoint error:", e)

# Test without token (to see the exact error that happened in n8n)
req2 = urllib.request.Request('http://172.16.1.13:3002/api/v1/connectors/phone/n8n/checkpoint')
try:
    with urllib.request.urlopen(req2, timeout=5) as resp:
        print("Without token status:", resp.status)
except urllib.error.HTTPError as e:
    print("Without token HTTPError (EXPECTED):", e.code, e.read().decode('utf-8'))
