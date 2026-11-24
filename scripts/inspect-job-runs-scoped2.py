"""Query scoped job_runs via stdin."""
import subprocess

sql = """
BEGIN;
SELECT set_config('app.workspace_id', '75d2f889-d3eb-4acc-861a-fada4691ecce', false);
SELECT id, job_type, created_at, left(payload::text, 80) FROM public.job_runs;
COMMIT;
"""

p = subprocess.run([
    'docker', 'exec', '-i', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-f', '-'
], input=sql, capture_output=True, text=True)
print(p.stdout)
