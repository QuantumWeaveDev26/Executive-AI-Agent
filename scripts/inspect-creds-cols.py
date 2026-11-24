import sqlite3
import json

db_path = '/var/lib/docker/volumes/n8n_data/_data/database.sqlite'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("PRAGMA table_info(credentials_entity);")
cols = cur.fetchall()
print("Cols:", [c[1] for c in cols])

# Check if we can see the decrypted or fields of G1VGVGldX32ch2xV using n8n container
