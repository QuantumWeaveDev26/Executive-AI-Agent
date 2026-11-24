"""Query user and project in n8n."""
import subprocess

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.all("SELECT id, email, role FROM user;", (err, u) => {
    db.all("SELECT id, name, type FROM project;", (err, p) => {
      console.log(JSON.stringify({users: u, projects: p}));
      db.close();
    });
  });
});
"""], capture_output=True, text=True)
print(p.stdout)
