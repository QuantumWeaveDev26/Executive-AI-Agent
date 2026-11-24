"""Inspect workflow definitions of ThaarSarvamSync1 and ThaaraCbNotif001 in n8n."""
import subprocess
import json

script = """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.error(err); process.exit(1); }
  db.all("SELECT id, name, active, nodes FROM workflow_entity WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err, rows) => {
    if (err) { console.error(err); process.exit(1); }
    for (const r of rows) {
      console.log(`=== Workflow ${r.id} (${r.name}) [active=${r.active}] ===`);
      const nodes = JSON.parse(r.nodes);
      for (const n of nodes) {
        if (n.type === 'n8n-nodes-base.httpRequest') {
          console.log(`Node: "${n.name}"`);
          console.log(`  URL: ${n.parameters?.url}`);
          console.log(`  Auth: ${n.parameters?.authentication}`);
          console.log(`  SendHeaders: ${n.parameters?.sendHeaders}`);
          console.log(`  Headers: ${JSON.stringify(n.parameters?.headerParameters)}`);
          console.log(`  Credentials: ${JSON.stringify(n.credentials)}`);
        } else if (n.type === 'n8n-nodes-base.emailSend') {
          console.log(`Node: "${n.name}"`);
          console.log(`  Credentials: ${JSON.stringify(n.credentials)}`);
          console.log(`  FromEmail: ${n.parameters?.fromEmail}`);
          console.log(`  ToEmail: ${n.parameters?.toEmail}`);
        }
      }
    }
    db.close();
  });
});
"""

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', script], capture_output=True, text=True)
print(p.stdout)
if p.stderr:
    print(p.stderr)
