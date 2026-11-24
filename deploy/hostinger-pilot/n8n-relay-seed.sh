#!/bin/bash
# Step 108.12 (VPS part) — RUN ONLY AFTER EXPLICIT OWNER APPROVAL.
# One-off seed container from the approved pilot image on the internal data network.
# Prints only non-secret IDs. The relay token lands in a root-only handoff file for the owner.
set -euo pipefail
IMG=sha256:7fbcfa2aa3c5c1f7e5a849e23092a746d0bc5bcb7bdf8b0177d7c6d2ad162018
P=/opt/thaara-v2-pilot; S=/opt/thaara-v2-pilot-private/secrets; H=/opt/thaara-v2-pilot-private/handoff
for c in thaara-v2-pilot-postgres-1 thaara-v2-pilot-api-1; do [ "$(docker inspect -f '{{.State.Health.Status}}' $c)" = healthy ] || { echo "ABORT: $c not healthy"; exit 1; }; done
[ ! -e "$H" ] || { echo "ABORT: handoff already exists"; exit 1; }
echo "4685330fba3494bd3a633357f7274979024e8c533af94c490cce880aca256be6  $P/pilot-seed.mjs" | sha256sum -c - >/dev/null || { echo "ABORT: seed checksum mismatch"; exit 1; }
install -d -m 0700 -o 999 -g 999 "$H"
docker run --rm --name thaara-v2-pilot-seed-10812 --network thaara-v2-pilot-data --read-only --user 999:999 --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 256m --pids-limit 64 -e THAARA_PILOT_SEED_ACK=synthetic_relay_10812 \
  -v "$S/admin_password:/run/secrets/admin_password:ro" -v "$S/api_password:/run/secrets/api_password:ro" \
  -v "$H:/handoff" -v "$P/pilot-seed.mjs:/app/apps/api/pilot-seed.mjs:ro" -w /app/apps/api --entrypoint node "$IMG" pilot-seed.mjs --approved
chown root:root "$H" "$H/n8n_relay_token" && chmod 0700 "$H" && chmod 0400 "$H/n8n_relay_token"
echo "handoff=$(stat -c '%U:%G %a %s' "$H/n8n_relay_token")"
