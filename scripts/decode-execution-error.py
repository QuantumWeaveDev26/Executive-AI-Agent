"""Decode flatted error in execution_data."""
import sqlite3
import json

db_path = '/var/lib/docker/volumes/n8n_data/_data/database.sqlite'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("SELECT executionId, data FROM execution_data WHERE executionId = 76727;")
row = cur.fetchone()
if row:
    arr = json.loads(row[1])
    print(f"Total elements: {len(arr)}")
    for i, item in enumerate(arr):
        if isinstance(item, dict) and ('message' in item or 'node' in item or 'name' in item):
            print(f"[{i}] {item}")
        elif isinstance(item, str) and any(kw in item.lower() for kw in ['error', 'unauthorized', 'forbidden', 'failed', 'connect', 'sarvam', 'http']):
            print(f"[{i}] (str) {item}")
