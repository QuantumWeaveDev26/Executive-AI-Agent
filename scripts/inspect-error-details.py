"""Inspect execution error details."""
import sqlite3
import json

db_path = '/var/lib/docker/volumes/n8n_data/_data/database.sqlite'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%exec%';")
print("Execution tables:", cur.fetchall())

cur.execute("PRAGMA table_info(execution_entity);")
print("execution_entity cols:", [c[1] for c in cur.fetchall()])

# Check execution_data if exists
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='execution_data';")
if cur.fetchone():
    cur.execute("PRAGMA table_info(execution_data);")
    print("execution_data cols:", [c[1] for c in cur.fetchall()])
    cur.execute("SELECT executionId, data FROM execution_data WHERE executionId IN (76727, 76726);")
    for row in cur.fetchall():
        print(f"--- Execution {row[0]} data ---")
        try:
            d = json.loads(row[1])
            print("Keys:", list(d.keys()))
            if 'resultData' in d:
                res = d['resultData']
                print("Result error:", res.get('error'))
                if 'runData' in res:
                    for node, runs in res['runData'].items():
                        for run in runs:
                            if 'error' in run:
                                print(f"Node {node} error: {run['error']}")
        except Exception as e:
            print("Raw data snippet:", str(row[1])[:500])
else:
    # check execution_entity for error details
    cur.execute("SELECT id, status FROM execution_entity WHERE id IN (76727, 76726);")
    print("Statuses:", cur.fetchall())
