#!/bin/bash
# Step 108.24 — RUN ONLY AFTER EXPLICIT OWNER APPROVAL OF NORMAL (LIVE) SENDING.
# Keeps the CURRENT pilot image and compose (web routing labels included); only adds the two send secrets and
# THAARA_WHATSAPP_SEND_ENABLED=true to the API. Profile: this connection, any opted-in contact ("*"), daily cap,
# 30-day validity. Every message still needs per-message owner approval, Meta's 24 h window, audit and idempotency.
# Generates the n8n header secret on the server (owner copies it into n8n; never printed). Any failure runs live-off.
set -euo pipefail
[ "${1:-}" = "--approved" ] || { echo "Usage: bash /opt/thaara-v2-pilot/pilot-send-live-on.sh --approved [unlimited|1..250] [text|rich]"; exit 1; }
# Default: no Thaara daily cap (owner decision). Per-message approval and Meta's own limits always apply.
MAX="${2:-unlimited}"
# rich = template and media messages too; only after the outbound workflow has the reviewed rich-message branch.
MODE="${3:-text}"; case "$MODE" in text) RICH=false;; rich) RICH=true;; *) echo "ABORT: mode must be text or rich"; exit 1;; esac
if [ "$MAX" = unlimited ]; then CAP=null; elif [[ "$MAX" =~ ^[0-9]{1,3}$ ]] && [ "$MAX" -ge 1 ] && [ "$MAX" -le 250 ]; then CAP=$MAX; else echo "ABORT: cap must be unlimited or 1..250"; exit 1; fi
P=/opt/thaara-v2-pilot; S=/opt/thaara-v2-pilot-private/secrets; H=/opt/thaara-v2-pilot-private/handoff
C=wa_pilot_meta_test_10813b; API=thaara-v2-pilot-api-1
B="$H/send-live-$(date -u +%Y%m%dT%H%M%SZ)"
for c in thaara-v2-pilot-postgres-1 thaara-v2-pilot-redis-1 $API; do [ "$(docker inspect -f '{{.State.Health.Status}}' $c)" = healthy ] || { echo "ABORT: $c not healthy"; exit 1; }; done
[ ! -e "$S/n8n_dispatch_secret" ] && [ ! -e "$S/send_profile" ] && [ ! -e "$H/n8n_dispatch_secret" ] || { echo "ABORT: send files already exist (run live-off first)"; exit 1; }
[ -f "$P/pilot-send-live-off.sh" ] && [ -f "$P/n8n-link-v2.sh" ] || { echo "ABORT: reviewed off/link scripts missing"; exit 1; }
[ "$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $API | grep '^THAARA_WHATSAPP_SEND_ENABLED=')" = THAARA_WHATSAPP_SEND_ENABLED=false ] || { echo "ABORT: pilot must start send-off"; exit 1; }
[ "$(docker inspect -f '{{json .NetworkSettings.Networks}}' n8n-n8n-1 | python3 -c 'import json,sys;print(",".join(json.load(sys.stdin)))')" = n8n_default ] || { echo "ABORT: n8n network changed"; exit 1; }
IMG=$(docker inspect -f '{{.Image}}' $API)
grep -qx "THAARA_PILOT_API_IMAGE=$IMG" "$P/.env" || { echo "ABORT: .env does not match running image"; exit 1; }
umask 077; install -d -m 0700 -o root -g root "$B"
cp "$P/compose.json" "$B/compose.json"; cp "$P/.env" "$B/.env"; ln -sfn "$B" "$H/send-live-latest"
IDS_BEFORE=$(for c in thaara-v2-pilot-postgres-1 thaara-v2-pilot-redis-1 n8n-n8n-1 n8n-traefik-1; do docker inspect -f '{{.Id}} {{.State.StartedAt}}' $c; done)
rollback_on_error() {
  local result=$?
  if [ "$result" -ne 0 ]; then trap - EXIT INT TERM; echo "LIVE_ON_FAILED: running live-off"; bash "$P/pilot-send-live-off.sh" --approved || echo "ROLLBACK_INCOMPLETE: operator verification required"; fi
  exit "$result"
}
trap rollback_on_error EXIT; trap 'exit 130' INT; trap 'exit 143' TERM
head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' > "$S/n8n_dispatch_secret"
grep -Eq '^[A-Za-z0-9_-]{43}$' "$S/n8n_dispatch_secret" || { echo "ABORT: secret format"; exit 1; }
printf '{"connectionId":"%s","recipientId":"*","maxPerDay":%s,"expiresAt":"%s","webhookPath":"/webhook/thaara-v2-dev-whatsapp-approved-1082","headerName":"X-Thaara-Dispatch","richMessages":%s}' \
  "$C" "$CAP" "$(date -u -d '+30 days' +%Y-%m-%dT%H:%M:%SZ)" "$RICH" > "$S/send_profile"
chown 1000:999 "$S/n8n_dispatch_secret" "$S/send_profile"; chmod 0440 "$S/n8n_dispatch_secret" "$S/send_profile"
install -d -m 0700 -o root -g root "$H"; cp "$S/n8n_dispatch_secret" "$H/n8n_dispatch_secret"; chown root:root "$H/n8n_dispatch_secret"; chmod 0400 "$H/n8n_dispatch_secret"
docker exec thaara-v2-pilot-postgres-1 psql -X -q -U postgres -d thaara_vps_pilot -v ON_ERROR_STOP=1 -c \
  "UPDATE public.whatsapp_n8n_relay_principals SET allowed_operations=ARRAY['events','claim','receipts'] WHERE connection_id='$C' AND enabled AND revoked_at IS NULL"
# Derive the send compose from the CURRENT compose: only the flag and the two API secrets change.
python3 - "$P/compose.json" <<'PY'
import json, sys
path = sys.argv[1]; model = json.load(open(path))
api = model['services']['api']
assert api['environment']['THAARA_WHATSAPP_SEND_ENABLED'] == 'false' and 'labels' in api
api['environment']['THAARA_WHATSAPP_SEND_ENABLED'] = 'true'
api['secrets'] = [s for s in api['secrets'] if s not in ('n8n_dispatch_secret', 'send_profile')] + ['n8n_dispatch_secret', 'send_profile']
for name in ('n8n_dispatch_secret', 'send_profile'):
    model['secrets'][name] = {'file': '/opt/thaara-v2-pilot-private/secrets/' + name}
open(path, 'w').write(json.dumps(model, indent=2))
PY
cd "$P" && THAARA_PILOT_API_IMAGE="$IMG" docker compose -p thaara-v2-pilot -f compose.json --profile application up -d --no-deps --no-build --pull never api 2>&1 | tail -2
for i in $(seq 1 40); do a=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' $API); [ "$a" = running/healthy ] && break; sleep 3; done
[ "$a" = running/healthy ] || { echo "API_UNHEALTHY"; exit 1; }
[ "$(docker inspect -f '{{.Image}}' $API)" = "$IMG" ] || { echo "ABORT: image changed"; exit 1; }
link=$(bash "$P/n8n-link-v2.sh" 2>&1) || { echo "ABORT: private link failed"; exit 1; }
for m in n8n_to_pilot_health=200 forged_callback_status=403 'public_watch=12/12 ok' n8n_single_network=yes n8n_not_restarted=yes; do grep -q "$m" <<<"$link" || { echo "ABORT: link check $m"; exit 1; }; echo "$m"; done
[ "$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $API | grep '^THAARA_WHATSAPP_SEND_ENABLED=')" = THAARA_WHATSAPP_SEND_ENABLED=true ] || { echo "ABORT: send flag"; exit 1; }
[ "$IDS_BEFORE" = "$(for c in thaara-v2-pilot-postgres-1 thaara-v2-pilot-redis-1 n8n-n8n-1 n8n-traefik-1; do docker inspect -f '{{.Id}} {{.State.StartedAt}}' $c; done)" ] || { echo "ABORT: other services changed"; exit 1; }
[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://thaara-v2.quantumweaveai.io/api/v1/health)" = 200 ] || { echo "ABORT: public health"; exit 1; }
trap - EXIT INT TERM
echo "live_sending=on daily_cap=$MAX messages=$MODE recipients=opted_in_contacts expires=$(grep -o '"expiresAt":"[^"]*"' "$S/send_profile" | cut -d'"' -f4)"
echo "owner_next=copy secret with: cat $H/n8n_dispatch_secret; echo   (into the n8n X-Thaara-Dispatch credential)"
