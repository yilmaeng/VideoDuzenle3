import json
import os
import re
import time
from pathlib import Path

ROOT = Path('/var/lib/evd-recordings/evd-recordings')
STORE = Path('/var/www/evd/evd-yayinodasi-server/data/server-recordings.json')
MAX_AGE = 7 * 86400

now = time.time()
rows = json.loads(STORE.read_text()).get('recordings', []) if STORE.exists() else []
created = {}
for row in rows:
    names = [row.get('fileName'), row.get('assemblyFileName'), str(row.get('id', '')) + '.m4a']
    names += row.get('assemblyInputs', [])
    names += [segment.get('fileName') for segment in row.get('segments', [])]
    for name in names:
        if name:
            created[name] = row['createdAt'] / 1000
if ROOT.exists():
    for entry in ROOT.iterdir():
        if not (re.fullmatch(r'[a-f0-9-]+\.(mp4|m4a|concat)', entry.name) or entry.name.startswith('.rclone_')):
            continue
        age = now - created.get(entry.name, entry.lstat().st_mtime)
        if age >= MAX_AGE and not entry.is_dir():
            os.unlink(entry)
