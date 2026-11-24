"""Check n8n executions, PostgreSQL synced calls, and Thaara API phone endpoints."""
import json
import subprocess
import urllib.request
import urllib.error

print("=== 1. Checking n8n Workflow and Execution Status ===")
p_wf = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'sqlite3', '/home/node/.n8n/database.sqlite',
    'SELECT id, name, active, triggerCount FROM workflow_entity WHERE id IN ("ThaaraCbNotif001", "ThaarSarvamSync1");'
], capture_output=True, text=True)
print("Workflows in SQLite:\n", p_wf.stdout)

p_exec = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'sqlite3', '/home/node/.n8n/database.sqlite',
    'SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity ORDER BY id DESC LIMIT 10;'
], capture_output=True, text=True)
print("Recent Executions in SQLite:\n", p_exec.stdout)

print("\n=== 2. Triggering One Manual Execution of ThaarSarvamSync1 to Verify Execution Pipeline ===")
p_run = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'n8n', 'execute', '--id=ThaarSarvamSync1'
], capture_output=True, text=True)
print("Sync Execution Output:\n", p_run.stdout)
if p_run.stderr:
    print("Sync Execution Stderr:\n", p_run.stderr)

print("\n=== 3. Checking PostgreSQL Job Runs for Synced Calls ===")
p_pg = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-db-1', 'psql', '-U', 'postgres', '-d', 'thaara_v2_pilot',
    '-c', "SELECT job_type, idempotency_key, status, created_at, updated_at FROM job_runs WHERE job_type LIKE 'sarvam%' OR job_type LIKE 'phone%' ORDER BY created_at DESC LIMIT 15;"
], capture_output=True, text=True)
print(p_pg.stdout)

print("\n=== 4. Checking Thaara API Health and Endpoints ===")
req = urllib.request.Request('https://thaara-v2.quantumweaveai.io/api/v1/health')
try:
    with urllib.request.urlopen(req) as resp:
        print("Health status:", resp.status, resp.read().decode('utf-8'))
except Exception as e:
    print("Health check error:", e)

# Check checkpoint internal endpoint from container
p_cp = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'curl', '-s', '-H', 'x-thaara-phone-sync-token: 34d60f56367e401eab3d3c8e3b1ae4902838cb71f3e1cdc3bb2bfa55b87af850',
    'http://thaara-v2-pilot-api-1:3002/api/v1/connectors/phone/n8n/checkpoint'
], capture_output=True, text=True)
print("Internal Checkpoint API response:\n", p_cp.stdout)
