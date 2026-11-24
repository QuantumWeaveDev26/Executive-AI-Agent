"""Check n8n container uptime and schedule triggers."""
import subprocess

p = subprocess.run(['docker', 'inspect', '--format', '{{.State.Status}} Started: {{.State.StartedAt}}', 'n8n-n8n-1'], capture_output=True, text=True)
print("n8n status:", p.stdout.strip())

# Check workflow trigger counts in sqlite
p2 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.all("SELECT id, name, active, triggerCount FROM workflow_entity WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err, rows) => {
    console.log(JSON.stringify(rows));
    db.close();
  });
});
"""], capture_output=True, text=True)
print("Workflows in sqlite:", p2.stdout.strip())
