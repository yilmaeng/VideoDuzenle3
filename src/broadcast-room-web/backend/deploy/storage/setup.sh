#!/bin/sh
set -eu
cd "$(dirname "$0")"
APP=/var/www/evd/evd-yayinodasi-server
install -d -m 700 -o nodeapp -g nodeapp /var/lib/evd-recordings /var/lib/evd-recordings/evd-recordings
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL https://downloads.rclone.org/v1.75.2/rclone-v1.75.2-linux-amd64.zip -o "$TMP/rclone-v1.75.2-linux-amd64.zip"
curl -fsSL https://downloads.rclone.org/v1.75.2/SHA256SUMS -o "$TMP/SHA256SUMS"
(cd "$TMP" && grep ' rclone-v1.75.2-linux-amd64.zip$' SHA256SUMS | sha256sum -c -)
python3 - "$TMP" <<'PY'
import sys, zipfile
from pathlib import Path
root = Path(sys.argv[1])
with zipfile.ZipFile(root / 'rclone-v1.75.2-linux-amd64.zip') as archive:
    (root / 'rclone').write_bytes(archive.read('rclone-v1.75.2-linux-amd64/rclone'))
PY
install -m 755 "$TMP/rclone" /usr/local/bin/evd-rclone
python3 - "$APP/.env" <<'PY'
import os, secrets, sys
from pathlib import Path
os.umask(0o077)
gateway = Path('/etc/evd-recording-storage.env')
if gateway.exists():
    pair = gateway.read_text().strip().split('=', 1)[1].strip("\"'")
else:
    pair = secrets.token_hex(16) + ',' + secrets.token_hex(32)
gateway.write_text("RCLONE_AUTH_KEY='\"" + pair + "\"'\n")
access, secret = pair.split(',')
values = {
    'SERVER_RECORDING_ENABLED': 'true',
    'SERVER_RECORDING_FILES_DIR': '/var/lib/evd-recordings/evd-recordings',
    'SERVER_RECORDING_S3_ENDPOINT': 'https://evd.drenginyilmaz.net',
    'SERVER_RECORDING_S3_BUCKET': 'evd-recordings',
    'SERVER_RECORDING_S3_REGION': 'us-east-1',
    'SERVER_RECORDING_S3_ACCESS_KEY': access,
    'SERVER_RECORDING_S3_SECRET': secret,
}
env = Path(sys.argv[1])
lines = [line for line in env.read_text().splitlines() if line.split('=', 1)[0] not in values]
env.write_text('\n'.join(lines + [key + '=' + value for key, value in values.items()]) + '\n')
PY
install -d /usr/local/lib/evd
install -m 644 recording-retention.py /usr/local/lib/evd/recording-retention.py
install -m 644 evd-recording-storage.service evd-recording-retention.service evd-recording-retention.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now evd-recording-storage.service evd-recording-retention.timer
systemctl restart evd-recording-storage.service
systemctl is-active evd-recording-storage.service
