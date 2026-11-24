#!/bin/bash
# SUPERSEDED 27 Oct 2026 — DO NOT RUN. Attaching n8n to a second network caused a public n8n outage (Traefik picked the wrong address). See docs/integrations/whatsapp/INCIDENT_2026-10-27_N8N_PUBLIC_OUTAGE.md.
exit 1
# Step 108.11 — private n8n <-> pilot network link. RUN ONLY AFTER EXPLICIT OWNER APPROVAL.
# Creates one internal network shared by exactly n8n-n8n-1 and thaara-v2-pilot-api-1.
# Live attach only: no restart, no compose/file change for n8n, no ports, no workflow change.
set -euo pipefail
NET=thaara-v2-pilot-n8n
N8N=n8n-n8n-1
API=thaara-v2-pilot-api-1
for c in "$N8N" "$API"; do [ "$(docker inspect -f '{{.State.Running}}' "$c")" = true ] || { echo "ABORT: $c not running"; exit 1; }; done
docker network inspect "$NET" >/dev/null 2>&1 && { echo "ABORT: $NET already exists"; exit 1; }
N8N_ID_BEFORE=$(docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' "$N8N")
docker network create --internal --label thaara.step=108.11 --label com.thaara.pilot=thaara-v2-pilot "$NET" >/dev/null
docker network connect --alias thaara-pilot-api "$NET" "$API"
docker network connect "$NET" "$N8N"
echo "members=$(docker network inspect -f '{{range .Containers}}{{.Name}},{{end}}' "$NET")"
# Probes from inside n8n (read-only HTTP): health must be 200, a forged callback token must be refused.
docker exec "$N8N" node -e "fetch('http://thaara-pilot-api:3002/api/v1/health').then(r=>console.log('n8n_to_pilot_health='+r.status)).catch(e=>{console.log('n8n_to_pilot_health=ERR');process.exitCode=1})"
docker exec "$N8N" node -e "fetch('http://thaara-pilot-api:3002/api/v1/connectors/whatsapp/n8n/relay/probe/events',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'x'.repeat(43)},body:JSON.stringify({event:{}})}).then(r=>console.log('forged_callback_status='+r.status)).catch(()=>{console.log('forged_callback_status=ERR');process.exitCode=1})"
# Isolation: the link network must contain exactly these two containers, and the pilot must not be on n8n_default.
[ "$(docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$NET" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ',')" = "$N8N,$API," ] && echo isolation=ok || { echo isolation=FAIL; exit 1; }
docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' n8n_default | grep -q "$API" && { echo pilot_on_n8n_default=YES; exit 1; } || echo pilot_on_n8n_default=no
N8N_ID_AFTER=$(docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' "$N8N")
[ "$N8N_ID_BEFORE" = "$N8N_ID_AFTER" ] && echo n8n_not_restarted=yes || { echo n8n_not_restarted=NO; exit 1; }
