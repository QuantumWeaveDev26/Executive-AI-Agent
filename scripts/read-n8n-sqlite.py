import sqlite3
import json

db_path = '/var/lib/docker/volumes/n8n_data/_data/database.sqlite'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Get table names
cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [r[0] for r in cur.fetchall()]
print("Tables in n8n:", [t for t in tables if 'cred' in t.lower() or 'work' in t.lower()])

# Check credentials_entity
cur.execute("SELECT id, name, type, createdAt FROM credentials_entity;")
creds = cur.fetchall()
print("\nCredentials:")
for c in creds:
    print(c)

# Check the workflow for callback email notifications in workflow_entity
cur.execute("SELECT id, name, active FROM workflow_entity WHERE id = 'ThaaraCbNotif001';")
wf = cur.fetchall()
print("\nWorkflow ThaaraCbNotif001 in DB:", wf)
