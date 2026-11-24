"""Inspect sqlite tables in n8n."""
import subprocess

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.all("SELECT name FROM sqlite_master WHERE type='table';", (err, rows) => {
    console.log(JSON.stringify(rows.map(r => r.name)));
    db.close();
  });
});
"""], capture_output=True, text=True)
print(p.stdout)
