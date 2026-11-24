#!/bin/bash
# Step 108.13 (VPS part) — RUN ONLY AFTER EXPLICIT OWNER APPROVAL.
# Adds the receive-only Meta test connection and moves the events-only relay principal to it.
# Params file holds only non-secret IDs plus the owner's own opted-in phone number.
set -euo pipefail
IMG=sha256:7fbcfa2aa3c5c1f7e5a849e23092a746d0bc5bcb7bdf8b0177d7c6d2ad162018
P=/opt/thaara-v2-pilot; S=/opt/thaara-v2-pilot-private/secrets; Q=/opt/thaara-v2-pilot-private/params
for c in thaara-v2-pilot-postgres-1 thaara-v2-pilot-api-1; do [ "$(docker inspect -f '{{.State.Health.Status}}' $c)" = healthy ] || { echo "ABORT: $c not healthy"; exit 1; }; done
echo "4685330fba3494bd3a633357f7274979024e8c533af94c490cce880aca256be6  $P/pilot-seed.mjs" | sha256sum -c - >/dev/null || { echo "ABORT: seed checksum mismatch"; exit 1; }
echo "a36800822a201a73078769f441bacfabae7ca686174bbe7c9bda3f5921b03bc8  $P/pilot-meta-connection.mjs" | sha256sum -c - >/dev/null || { echo "ABORT: script checksum mismatch"; exit 1; }
[ -f "$Q/meta-test-params.json" ] || { echo "ABORT: params file missing"; exit 1; }
chown 999:999 "$Q" "$Q/meta-test-params.json"; chmod 0700 "$Q"; chmod 0400 "$Q/meta-test-params.json"
docker run --rm --name thaara-v2-pilot-meta-10813 --network thaara-v2-pilot-data --read-only --user 999:999 --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 256m --pids-limit 64 -e THAARA_PILOT_META_ACK=receive_only_10813 \
  -v "$S/admin_password:/run/secrets/admin_password:ro" -v "$S/api_password:/run/secrets/api_password:ro" -v "$Q:/params:ro" \
  -v "$P/pilot-seed.mjs:/app/apps/api/pilot-seed.mjs:ro" -v "$P/pilot-meta-connection.mjs:/app/apps/api/pilot-meta-connection.mjs:ro" \
  -w /app/apps/api --entrypoint node "$IMG" pilot-meta-connection.mjs --approved
