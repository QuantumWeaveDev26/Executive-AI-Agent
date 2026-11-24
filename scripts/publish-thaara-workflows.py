"""Publish both Thaara workflows using n8n CLI."""
import subprocess

p1 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'publish:workflow', '--id=ThaarSarvamSync1'], capture_output=True, text=True)
print("Publish ThaarSarvamSync1 STDOUT:\n", p1.stdout)
if p1.stderr:
    print("Publish ThaarSarvamSync1 STDERR:\n", p1.stderr)

p2 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'publish:workflow', '--id=ThaaraCbNotif001'], capture_output=True, text=True)
print("Publish ThaaraCbNotif001 STDOUT:\n", p2.stdout)
if p2.stderr:
    print("Publish ThaaraCbNotif001 STDERR:\n", p2.stderr)

# Check active status in sqlite
p3 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.all("SELECT id, name, active, triggerCount FROM workflow_entity WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err, rows) => {
    console.log(JSON.stringify(rows));
    db.close();
  });
});
"""], capture_output=True, text=True)
print("Workflows in sqlite:\n", p3.stdout)
