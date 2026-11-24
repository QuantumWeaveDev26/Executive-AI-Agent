"""Inspect running container image and n8n credentials."""
import subprocess
import json

def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.stdout.strip(), p.stderr.strip()

out = {}

# 1. API container info
api_out, _ = run(['docker', 'inspect', 'thaara-v2-pilot-api-1'])
if api_out:
    data = json.loads(api_out)[0]
    out['api_image_tag'] = data.get('Config', {}).get('Image')
    out['api_image_id'] = data.get('Image')
    out['api_created'] = data.get('Created')
    out['api_state'] = data.get('State', {}).get('Status')

# 2. n8n credentials
cred_out, _ = run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.all("SELECT id, name, type FROM credentials_entity;", (err, rows) => {
    console.log(JSON.stringify(rows || []));
    db.close();
  });
});
"""])
try:
    out['n8n_credentials'] = json.loads(cred_out)
except Exception:
    out['n8n_credentials'] = cred_out

# 3. Check postgres job_runs
pg_out, _ = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT count(*) FROM public.job_runs;"
])
out['postgres_job_runs_count'] = pg_out

# 4. Check if phone_calls or phone_inbound_calls exist
tables_out, _ = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%phone%';"
])
out['phone_tables'] = tables_out.split('\n') if tables_out else []

print(json.dumps(out, indent=2))
