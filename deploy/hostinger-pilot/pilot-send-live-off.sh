#!/bin/bash
# Step 108.24 — switch live sending OFF: relay events-only, restore the pre-live compose (same image), restore the
# private n8n link, shred send secrets. Continues containment after errors; success requires every postcondition.
set -uo pipefail
[ "${1:-}" = "--approved" ] || { echo "Usage: bash /opt/thaara-v2-pilot/pilot-send-live-off.sh --approved"; exit 1; }
P=/opt/thaara-v2-pilot; S=/opt/thaara-v2-pilot-private/secrets; H=/opt/thaara-v2-pilot-private/handoff
C=wa_pilot_meta_test_10813b; API=thaara-v2-pilot-api-1; B="$H/send-live-latest"
failed=0
if docker exec thaara-v2-pilot-postgres-1 psql -X -q -U postgres -d thaara_vps_pilot -v ON_ERROR_STOP=1 -c \
  "UPDATE public.whatsapp_n8n_relay_principals SET allowed_operations=ARRAY['events'] WHERE connection_id='$C'"; then echo relay_events_only=yes
else echo "SHUTDOWN_FAILED: relay restriction"; failed=1; fi
if [ -f "$B/compose.json" ] && [ -f "$B/.env" ]; then
  cp "$B/compose.json" "$P/compose.json" && cp "$B/.env" "$P/.env" || failed=1
else
  # No backup: switch the current compose back to send-off without the send secrets.
  python3 - "$P/compose.json" <<'PY' || failed=1
import json, sys
path = sys.argv[1]; model = json.load(open(path)); api = model['services']['api']
api['environment']['THAARA_WHATSAPP_SEND_ENABLED'] = 'false'
api['secrets'] = [s for s in api['secrets'] if s not in ('n8n_dispatch_secret', 'send_profile')]
for name in ('n8n_dispatch_secret', 'send_profile'): model['secrets'].pop(name, None)
open(path, 'w').write(json.dumps(model, indent=2))
PY
fi
IMG=$(sed -n 's/^THAARA_PILOT_API_IMAGE=//p' "$P/.env")
(cd "$P" && THAARA_PILOT_API_IMAGE="$IMG" docker compose -p thaara-v2-pilot -f compose.json --profile application up -d --no-deps --no-build --pull never api 2>&1 | tail -2) || failed=1
for i in $(seq 1 40); do a=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' $API); [ "$a" = running/healthy ] && break; sleep 3; done
echo "api=$a"; [ "$a" = running/healthy ] || failed=1
link=$(bash "$P/n8n-link-v2.sh" 2>&1) || failed=1
grep -q 'n8n_to_pilot_health=200' <<<"$link" && grep -q 'n8n_single_network=yes' <<<"$link" && echo link_restored=yes || { echo "SHUTDOWN_FAILED: link"; failed=1; }
for f in "$S/n8n_dispatch_secret" "$S/send_profile" "$H/n8n_dispatch_secret"; do [ -e "$f" ] && { shred -u -z "$f" || failed=1; }; done
if [ ! -e "$S/n8n_dispatch_secret" ] && [ ! -e "$S/send_profile" ] && [ ! -e "$H/n8n_dispatch_secret" ]; then echo send_files_removed=yes; else echo send_files_removed=NO; failed=1; fi
[ "$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $API | grep '^THAARA_WHATSAPP_SEND_ENABLED=')" = THAARA_WHATSAPP_SEND_ENABLED=false ] && echo send_env=false || { echo "SHUTDOWN_FAILED: send flag"; failed=1; }
[ "$failed" -eq 0 ] || { echo "SHUTDOWN_INCOMPLETE: do not enable sending"; exit 1; }
echo shutdown_verified=yes
