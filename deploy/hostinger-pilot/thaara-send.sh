#!/bin/bash
# Step 108.16 owner commands, run by the OWNER in the Hostinger browser terminal:
#   bash /opt/thaara-v2-pilot/thaara-send.sh prepare "Your reply text"
#   bash /opt/thaara-v2-pilot/thaara-send.sh approve <approval-id>
# Short-lived container from the approved image; data network + n8n network (to hand over to the Thaara outgoing workflow).
set -euo pipefail
IMG=sha256:46605527c350d405a3294f01b0d7ae768666bd390c2020825de4e129e1600fb6
P=/opt/thaara-v2-pilot; S=/opt/thaara-v2-pilot-private/secrets
mode="${1:-}"; arg="${2:-}"
case "$mode" in prepare|approve) ;; *) echo 'Usage: thaara-send.sh prepare "text" | approve <approval-id>'; exit 1;; esac
NAME=thaara-v2-pilot-send-cli
docker rm -f "$NAME" >/dev/null 2>&1 || true
EXTRA=(); [ "$mode" = approve ] && EXTRA=(-v "$S/send_profile:/run/secrets/send_profile:ro" -v "$S/n8n_dispatch_secret:/run/secrets/n8n_dispatch_secret:ro")
docker create --rm --name "$NAME" --network thaara-v2-pilot-data --read-only --user 999:999 --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 256m --pids-limit 64 -e THAARA_PILOT_SEND_CLI_ACK=controlled_send_10816 \
  -v "$S/admin_password:/run/secrets/admin_password:ro" -v "$S/api_password:/run/secrets/api_password:ro" "${EXTRA[@]}" \
  -v "$P/pilot-seed.mjs:/app/apps/api/pilot-seed.mjs:ro" -v "$P/pilot-send-cli.mjs:/app/apps/api/pilot-send-cli.mjs:ro" \
  -w /app/apps/api --entrypoint node "$IMG" pilot-send-cli.mjs "$mode" "$arg" >/dev/null
[ "$mode" = approve ] && docker network connect n8n_default "$NAME"
docker start -a "$NAME"
