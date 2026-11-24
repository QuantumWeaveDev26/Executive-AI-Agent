#!/bin/bash
# Step 108.13b (VPS part) — RUN ONLY AFTER EXPLICIT OWNER APPROVAL.
# 1) Recreate ONLY the pilot API with the fixed image (postgres/redis untouched).
# 2) Re-attach the pilot API to n8n_default (recreate drops the live link) via n8n-link-v2.sh (public n8n proofs + auto-rollback).
# 3) Add the corrected receive-only Meta connection and move the events-only key onto it.
set -euo pipefail
NEW=sha256:ebac2a935fc573fb51f4fa12f78a454fe8fc86da364bd893b35c91d38c5520d1
P=/opt/thaara-v2-pilot; S=/opt/thaara-v2-pilot-private/secrets; Q=/opt/thaara-v2-pilot-private/params
docker image inspect "$NEW" >/dev/null || { echo "ABORT: new image not loaded"; exit 1; }
for c in thaara-v2-pilot-postgres-1 thaara-v2-pilot-redis-1 thaara-v2-pilot-api-1; do [ "$(docker inspect -f '{{.State.Health.Status}}' $c)" = healthy ] || { echo "ABORT: $c not healthy"; exit 1; }; done
echo "4685330fba3494bd3a633357f7274979024e8c533af94c490cce880aca256be6  $P/pilot-seed.mjs" | sha256sum -c - >/dev/null || { echo "ABORT: seed checksum"; exit 1; }
echo "a36800822a201a73078769f441bacfabae7ca686174bbe7c9bda3f5921b03bc8  $P/pilot-meta-connection.mjs" | sha256sum -c - >/dev/null || { echo "ABORT: meta checksum"; exit 1; }
echo "e5855e7c2752b18b4118d76802f4eb7e474e4367aad72fefd80ea8c4d7af42d2  $P/pilot-meta-connection-fix.mjs" | sha256sum -c - >/dev/null || { echo "ABORT: fix checksum"; exit 1; }
[ -f "$Q/meta-test-params-10813b.json" ] || { echo "ABORT: params missing"; exit 1; }
PG_BEFORE=$(docker inspect -f '{{.Id}} {{.RestartCount}}' thaara-v2-pilot-postgres-1); RD_BEFORE=$(docker inspect -f '{{.Id}} {{.RestartCount}}' thaara-v2-pilot-redis-1)
cp "$P/.env" "$P/.env.before-10813b"
printf 'THAARA_PILOT_API_IMAGE=%s\n' "$NEW" > "$P/.env"
cd "$P" && docker compose -p thaara-v2-pilot -f compose.json --profile application up -d --no-deps api 2>&1 | tail -3
for i in $(seq 1 40); do a=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' thaara-v2-pilot-api-1); [ "$a" = running/healthy ] && break; sleep 3; done
echo "api=$a image=$(docker inspect -f '{{.Image}}' thaara-v2-pilot-api-1)"
[ "$a" = running/healthy ] || { echo "API_UNHEALTHY: restoring previous image"; cp "$P/.env.before-10813b" "$P/.env"; docker compose -p thaara-v2-pilot -f compose.json --profile application up -d --no-deps api; exit 1; }
[ "$PG_BEFORE" = "$(docker inspect -f '{{.Id}} {{.RestartCount}}' thaara-v2-pilot-postgres-1)" ] && [ "$RD_BEFORE" = "$(docker inspect -f '{{.Id}} {{.RestartCount}}' thaara-v2-pilot-redis-1)" ] && echo data_services_untouched=yes
echo "health_http=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:15440/api/v1/health)"
chown 999:999 "$Q" "$Q/meta-test-params-10813b.json"; chmod 0700 "$Q"; chmod 0400 "$Q/meta-test-params-10813b.json"
docker run --rm --name thaara-v2-pilot-meta-10813b --network thaara-v2-pilot-data --read-only --user 999:999 --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 256m --pids-limit 64 -e THAARA_PILOT_META_ACK=receive_only_10813b \
  -v "$S/admin_password:/run/secrets/admin_password:ro" -v "$S/api_password:/run/secrets/api_password:ro" -v "$Q:/params:ro" \
  -v "$P/pilot-seed.mjs:/app/apps/api/pilot-seed.mjs:ro" -v "$P/pilot-meta-connection.mjs:/app/apps/api/pilot-meta-connection.mjs:ro" \
  -v "$P/pilot-meta-connection-fix.mjs:/app/apps/api/pilot-meta-connection-fix.mjs:ro" \
  -w /app/apps/api --entrypoint node "$NEW" pilot-meta-connection-fix.mjs --approved
