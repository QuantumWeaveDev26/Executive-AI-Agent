"""Inspect n8n SQLite execution_entity and PostgreSQL tables."""
import sqlite3
import subprocess
import json

db_path = '/var/lib/docker/volumes/n8n_data/_data/database.sqlite'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

print("=== Recent Executions for Thaara Workflows ===")
cur.execute("""
    SELECT id, workflowId, status, mode, startedAt, stoppedAt 
    FROM execution_entity 
    WHERE workflowId IN ('ThaaraCbNotif001', 'ThaarSarvamSync1')
    ORDER BY id DESC LIMIT 10;
""")
rows = cur.fetchall()
for r in rows:
    print(r)

if rows:
    latest_id = rows[0][0]
    print(f"\n=== Inspect Latest Execution Data (id: {latest_id}) ===")
    cur.execute("SELECT id, status, workflowData FROM execution_entity WHERE id = ?", (latest_id,))
    # Also check if execution_data is stored in execution_data or execution_entity
    cur.execute("PRAGMA table_info(execution_entity);")
    cols = [c[1] for c in cur.fetchall()]
    print("execution_entity columns:", cols)

    if 'data' in cols:
        cur.execute("SELECT data FROM execution_entity WHERE id = ?", (latest_id,))
        raw_data = cur.fetchone()[0]
        # print first 1000 chars of data
        print("Data preview:", str(raw_data)[:1000])

print("\n=== All Recent Executions in Last 10 Minutes ===")
cur.execute("""
    SELECT id, workflowId, status, mode, startedAt, stoppedAt 
    FROM execution_entity 
    ORDER BY id DESC LIMIT 10;
""")
for r in cur.fetchall():
    print(r)

print("\n=== Query PostgreSQL Job Runs ===")
p_pg = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-postgres-1', 'psql', '-U', 'postgres', '-d', 'thaara_v2_pilot',
    '-c', "SELECT job_type, idempotency_key, status, created_at, updated_at FROM job_runs WHERE job_type LIKE 'sarvam%' OR job_type LIKE 'phone%' ORDER BY created_at DESC LIMIT 15;"
], capture_output=True, text=True)
print(p_pg.stdout)

print("\n=== Check Phone Calls Endpoints ===")
p_api = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-api-1', 'node', '-e', """
const http = require('http');
http.get('http://127.0.0.1:3002/api/v1/health', res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('Local API Health:', res.statusCode, body));
});
"""
], capture_output=True, text=True)
print(p_api.stdout)
