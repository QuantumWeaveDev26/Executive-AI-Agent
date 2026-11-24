#!/bin/bash
# Step 108.16 close-out: restore send-off, events-only and remove temporary send files.
# Continue containment after errors; success requires every shutdown postcondition.
set -uo pipefail
P=/opt/thaara-v2-pilot; S=/opt/thaara-v2-pilot-private/secrets; H=/opt/thaara-v2-pilot-private/handoff
C=wa_pilot_meta_test_10813b
failed=0
if docker exec thaara-v2-pilot-postgres-1 psql -X -q -U postgres -d thaara_vps_pilot -v ON_ERROR_STOP=1 -c \
  "UPDATE public.whatsapp_n8n_relay_principals SET allowed_operations=ARRAY['events'] WHERE connection_id='$C'"; then
  echo relay_events_only=yes
else echo "SHUTDOWN_FAILED: relay restriction not confirmed"; failed=1; fi
if [ -f "$P/compose.json.before-10816" ] && [ -f "$P/.env.before-10816" ]; then
  if cp "$P/compose.json.before-10816" "$P/compose.json" && cp "$P/.env.before-10816" "$P/.env"; then
    (cd "$P" && docker compose -p thaara-v2-pilot -f compose.json --profile application up -d --no-deps api 2>&1 | tail -2) || failed=1
  else failed=1; fi
else echo "SHUTDOWN_FAILED: send-off restore files missing"; failed=1; fi
for i in $(seq 1 40); do a=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' thaara-v2-pilot-api-1); [ "$a" = running/healthy ] && break; sleep 3; done
echo "api=$a"
[ "$a" = running/healthy ] || failed=1
for f in "$S/n8n_dispatch_secret" "$S/send_profile" "$H/n8n_dispatch_secret"; do
  if [ -e "$f" ]; then shred -u -z "$f" || failed=1; fi
done
rmdir "$H" 2>/dev/null || true
if [ ! -e "$S/n8n_dispatch_secret" ] && [ ! -e "$S/send_profile" ] && [ ! -e "$H/n8n_dispatch_secret" ]; then echo send_files_removed=yes; else echo send_files_removed=NO; failed=1; fi
send_env=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' thaara-v2-pilot-api-1 | grep '^THAARA_WHATSAPP_SEND_ENABLED=')
if [ "$send_env" = THAARA_WHATSAPP_SEND_ENABLED=false ]; then echo send_env=false; else echo "SHUTDOWN_FAILED: send-off flag not confirmed"; failed=1; fi
if [ "$failed" -ne 0 ]; then echo "SHUTDOWN_INCOMPLETE: do not retry or enable sending"; exit 1; fi
echo shutdown_verified=yes
