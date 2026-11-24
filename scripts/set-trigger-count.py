"""Set triggerCount to 1 and restart n8n."""
import subprocess

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', (err) => {
  db.run("UPDATE workflow_entity SET active = 1, triggerCount = 1 WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err2) => {
    db.all("SELECT id, name, active, triggerCount FROM workflow_entity WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err3, rows) => {
      console.log(JSON.stringify(rows));
      db.close();
    });
  });
});
"""], capture_output=True, text=True)
print("Updated:\n", p.stdout)

subprocess.run(['docker', 'restart', 'n8n-n8n-1'], check=True)
print("Restarted n8n.")
