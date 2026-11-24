#!/bin/bash
# Step 108.16 (VPS part) — RUN ONLY AFTER EXPLICIT OWNER APPROVAL OF THE CONTROLLED SEND TEST.
# Enables a bounded pilot send profile: one connection, one recipient, 10 attempts/rolling 24 h, 24 h expiry.
# Generates the n8n webhook secret on the server (owner copies it into n8n; never printed here),
# widens the relay key to events+claim+receipts, recreates ONLY the pilot API with the send image.
set -euo pipefail
NEW=sha256:46605527c350d405a3294f01b0d7ae768666bd390c2020825de4e129e1600fb6
P=/opt/thaara-v2-pilot; S=/opt/thaara-v2-pilot-private/secrets; H=/opt/thaara-v2-pilot-private/handoff
C=wa_pilot_meta_test_10813b
docker image inspect "$NEW" >/dev/null || { echo "ABORT: send image not loaded"; exit 1; }
for c in thaara-v2-pilot-postgres-1 thaara-v2-pilot-redis-1 thaara-v2-pilot-api-1; do [ "$(docker inspect -f '{{.State.Health.Status}}' $c)" = healthy ] || { echo "ABORT: $c not healthy"; exit 1; }; done
[ ! -e "$S/n8n_dispatch_secret" ] && [ ! -e "$S/send_profile" ] && [ ! -e "$H" ] || { echo "ABORT: send files already exist"; exit 1; }
[ -f "$P/compose.send.json" ] || { echo "ABORT: compose.send.json missing"; exit 1; }
[ -f "$P/pilot-send-disable-10816.sh" ] || { echo "ABORT: reviewed disable script missing"; exit 1; }
[ "$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' thaara-v2-pilot-api-1 | grep '^THAARA_WHATSAPP_SEND_ENABLED=')" = THAARA_WHATSAPP_SEND_ENABLED=false ] || { echo "ABORT: pilot must start send-off"; exit 1; }
# Preserve a known send-off restore point before any permission or secret change.
cp "$P/compose.json" "$P/compose.json.before-10816"; cp "$P/.env" "$P/.env.before-10816"
rollback_on_error() {
  local result=$?
  if [ "$result" -ne 0 ]; then
    trap - EXIT INT TERM
    echo "ENABLE_FAILED: restoring send-off permissions and removing temporary secrets"
    bash "$P/pilot-send-disable-10816.sh" || echo "ROLLBACK_INCOMPLETE: operator verification required"
  fi
  exit "$result"
}
trap rollback_on_error EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
umask 077
head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' > "$S/n8n_dispatch_secret"
grep -Eq '^[A-Za-z0-9_-]{43}$' "$S/n8n_dispatch_secret" || { echo "ABORT: secret format"; exit 1; }
printf '{"connectionId":"%s","recipientId":"owner_test_phone","maxPerDay":10,"expiresAt":"%s","webhookPath":"/webhook/thaara-v2-dev-whatsapp-approved-1082","headerName":"X-Thaara-Dispatch"}' \
  "$C" "$(date -u -d '+24 hours' +%Y-%m-%dT%H:%M:%SZ)" > "$S/send_profile"
# API (uid 1000) reads as owner; the owner CLI container (uid 999) reads via group.
chown 1000:999 "$S/n8n_dispatch_secret" "$S/send_profile"; chmod 0440 "$S/n8n_dispatch_secret" "$S/send_profile"
install -d -m 0700 -o root -g root "$H"; cp "$S/n8n_dispatch_secret" "$H/n8n_dispatch_secret"; chown root:root "$H/n8n_dispatch_secret"; chmod 0400 "$H/n8n_dispatch_secret"
docker exec thaara-v2-pilot-postgres-1 psql -X -q -U postgres -d thaara_vps_pilot -v ON_ERROR_STOP=1 -c \
  "UPDATE public.whatsapp_n8n_relay_principals SET allowed_operations=ARRAY['events','claim','receipts'] WHERE connection_id='$C' AND enabled AND revoked_at IS NULL"
PG_BEFORE=$(docker inspect -f '{{.Id}} {{.RestartCount}}' thaara-v2-pilot-postgres-1)
cp "$P/compose.send.json" "$P/compose.json"; printf 'THAARA_PILOT_API_IMAGE=%s\n' "$NEW" > "$P/.env"
cd "$P" && docker compose -p thaara-v2-pilot -f compose.json --profile application up -d --no-deps api 2>&1 | tail -3
for i in $(seq 1 40); do a=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' thaara-v2-pilot-api-1); [ "$a" = running/healthy ] && break; sleep 3; done
echo "api=$a image=$(docker inspect -f '{{.Image}}' thaara-v2-pilot-api-1)"
if [ "$a" != running/healthy ]; then echo "API_UNHEALTHY: restoring send-off state"; exit 1; fi
[ "$PG_BEFORE" = "$(docker inspect -f '{{.Id}} {{.RestartCount}}' thaara-v2-pilot-postgres-1)" ] || { echo "ABORT: data service identity changed"; exit 1; }
echo data_services_untouched=yes
echo "send_profile_expires=$(grep -o '"expiresAt":"[^"]*"' "$S/send_profile")"
echo "handoff=$(stat -c '%U:%G %a %s' "$H/n8n_dispatch_secret")"
trap - EXIT INT TERM
