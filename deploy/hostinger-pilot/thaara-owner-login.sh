#!/bin/bash
# Step 108.18 — Provision or rotate the pilot owner web login password on the VPS.
# Writes a fresh 32-char random password to /opt/thaara-v2-pilot-private/handoff/owner_login_password (mode 0400, root:root)
# and stores its scrypt hash on pilot-owner-10812@thaara-pilot.invalid in thaara_vps_pilot.
set -euo pipefail
[ "${1:-}" = "--approved" ] || { echo "Usage: bash /opt/thaara-v2-pilot/thaara-owner-login.sh --approved"; exit 1; }

P="/opt/thaara-v2-pilot"
S="/opt/thaara-v2-pilot-private/secrets"
H="/opt/thaara-v2-pilot-private/handoff"
IMG=$(docker inspect -f '{{.Image}}' thaara-v2-pilot-api-1)

install -d -m 0700 -o 999 -g 999 "$H"
rm -f "$H/owner_login_password"
docker run --rm --name thaara-v2-pilot-owner-login-10818 --network thaara-v2-pilot-data --read-only --user 999:999 --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 256m --pids-limit 64 -e THAARA_PILOT_OWNER_LOGIN_ACK=owner_login_10818 \
  -v "$S/admin_password:/run/secrets/admin_password:ro" -v "$H:/handoff:rw" \
  -v "$P/pilot-seed.mjs:/app/apps/api/pilot-seed.mjs:ro" -v "$P/pilot-owner-login.mjs:/app/apps/api/pilot-owner-login.mjs:ro" \
  -w /app/apps/api --entrypoint node "$IMG" pilot-owner-login.mjs --approved
chown root:root "$H" "$H/owner_login_password"
chmod 0700 "$H"
chmod 0400 "$H/owner_login_password"
echo "owner_login_email=pilot-owner-10812@thaara-pilot.invalid"
echo "owner_login_password_file=$H/owner_login_password"
