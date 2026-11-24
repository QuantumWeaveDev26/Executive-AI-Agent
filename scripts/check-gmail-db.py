import subprocess

def run_psql(query):
    p = subprocess.run([
        'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
        'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c', query
    ], capture_output=True, text=True)
    return p.stdout.strip()

print("Tables in public:")
out = run_psql("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE '%oauth%' OR table_name LIKE '%gmail%' OR table_name LIKE '%google%' OR table_name LIKE '%connector%');")
print(out)

print("\nRows in connector tables:")
for t in out.splitlines():
    if t:
        count = run_psql(f"SELECT count(*) FROM public.{t};")
        print(f"Table {t}: count = {count}")
