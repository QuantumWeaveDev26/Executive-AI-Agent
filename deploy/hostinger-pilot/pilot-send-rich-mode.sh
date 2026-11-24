#!/bin/bash
# Step 108.29b — RUN ONLY AFTER EXPLICIT OWNER APPROVAL. Switch template/media messages on or off in the EXISTING live
# send profile without regenerating the n8n dispatch key. Edits only the richMessages flag (same file/inode, same owner
# and mode), restarts only the API (network links kept), verifies, and restores the previous profile on any failure.
set -euo pipefail
case "${1:-} ${2:-}" in "--approved on") RICH=true;; "--approved off") RICH=false;; *) echo "Usage: bash /opt/thaara-v2-pilot/pilot-send-rich-mode.sh --approved on|off"; exit 1;; esac
S=/opt/thaara-v2-pilot-private/secrets; H=/opt/thaara-v2-pilot-private/handoff; API=thaara-v2-pilot-api-1; PROFILE="$S/send_profile"
[ -f "$PROFILE" ] && [ -f "$S/n8n_dispatch_secret" ] || { echo "ABORT: live sending is not on (run live-on first)"; exit 1; }
[ "$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $API | grep '^THAARA_WHATSAPP_SEND_ENABLED=')" = THAARA_WHATSAPP_SEND_ENABLED=true ] || { echo "ABORT: API is not in live send mode"; exit 1; }
[ "$(docker inspect -f '{{.State.Health.Status}}' $API)" = healthy ] || { echo "ABORT: API not healthy"; exit 1; }
umask 077
BACKUP="$H/send_profile.before-rich-$(date -u +%Y%m%dT%H%M%SZ)"; cp -p "$PROFILE" "$BACKUP"
IDS_BEFORE=$(for c in thaara-v2-pilot-postgres-1 thaara-v2-pilot-redis-1 n8n-n8n-1 n8n-traefik-1; do docker inspect -f '{{.Id}} {{.State.StartedAt}}' $c; done)
restore() {
  local result=$?
  if [ "$result" -ne 0 ]; then
    trap - EXIT
    echo "RICH_MODE_FAILED: restoring previous profile"
    cat "$BACKUP" > "$PROFILE"; docker restart $API >/dev/null || true
    for i in $(seq 1 40); do [ "$(docker inspect -f '{{.State.Health.Status}}' $API)" = healthy ] && break; sleep 3; done
    echo "restored_profile=yes api=$(docker inspect -f '{{.State.Health.Status}}' $API)"
  fi
  exit "$result"
}
trap restore EXIT
# In-place rewrite keeps the inode, owner (1000:999) and mode (0440) that the API mount expects.
python3 - "$PROFILE" "$RICH" <<'PY'
import json, sys
path, rich = sys.argv[1], sys.argv[2] == 'true'
profile = json.load(open(path))
allowed = {'connectionId', 'recipientId', 'maxPerDay', 'expiresAt', 'webhookPath', 'headerName', 'richMessages'}
assert set(profile) <= allowed and profile['recipientId'] == '*', 'unexpected profile shape'
profile['richMessages'] = rich
with open(path, 'r+') as f:
    f.seek(0); f.write(json.dumps(profile, separators=(',', ':'))); f.truncate()
PY
docker restart $API >/dev/null
for i in $(seq 1 40); do a=$(docker inspect -f '{{.State.Health.Status}}' $API); [ "$a" = healthy ] && break; sleep 3; done
[ "$a" = healthy ] || { echo "API_UNHEALTHY"; exit 1; }
[ "$(docker exec n8n-n8n-1 node -e "fetch('http://thaara-pilot-api:3002/api/v1/health').then(r=>console.log(r.status)).catch(()=>console.log(0))")" = 200 ] || { echo "ABORT: n8n cannot reach the API"; exit 1; }
for i in 1 2 3 4 5; do p=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://thaara-v2.quantumweaveai.io/api/v1/health); [ "$p" = 200 ] && break; sleep 3; done
[ "$p" = 200 ] || { echo "ABORT: public health"; exit 1; }
[ "$IDS_BEFORE" = "$(for c in thaara-v2-pilot-postgres-1 thaara-v2-pilot-redis-1 n8n-n8n-1 n8n-traefik-1; do docker inspect -f '{{.Id}} {{.State.StartedAt}}' $c; done)" ] || { echo "ABORT: other services changed"; exit 1; }
LOADED=$(docker exec -w /app/apps/api $API node --input-type=module -e "const m=await import('./pilot-config.mjs');console.log(m.pilotSendSettings().profile.richMessages)")
[ "$LOADED" = "$RICH" ] || { echo "ABORT: API did not load richMessages=$RICH"; exit 1; }
trap - EXIT
echo "rich_messages=$RICH (same n8n key; API restarted; link and services verified; previous profile: $BACKUP)"
