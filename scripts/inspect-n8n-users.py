"""Inspect n8n users."""
import json
import subprocess

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.log(JSON.stringify({error: err.message})); process.exit(1); }
  db.all('SELECT id, email, firstName, lastName, role FROM user;', (err, rows) => {
    console.log(JSON.stringify(rows));
    db.close();
  });
});
"""], capture_output=True, text=True)
print(p.stdout)
