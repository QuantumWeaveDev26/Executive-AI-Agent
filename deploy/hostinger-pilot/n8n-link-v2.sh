#!/bin/bash
# Step 108.11b — safer n8n <-> pilot link. RUN ONLY AFTER EXPLICIT OWNER APPROVAL.
# The PILOT API joins n8n_default; n8n stays on its single network, so Traefik's n8n route cannot change.
# Auto-rollback: if public n8n fails any check, the pilot is detached again and Traefik is refreshed.
set -uo pipefail
N8N=n8n-n8n-1; API=thaara-v2-pilot-api-1; NET=n8n_default; OLD=thaara-v2-pilot-n8n; ALIAS=thaara-pilot-api
IMG=postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
pub(){ curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://n8n.srv1871828.hstgr.cloud/healthz; }
refresh(){ docker run --rm --network none --read-only --cap-drop ALL --entrypoint true "$IMG" >/dev/null; }
rollback(){ echo "ROLLBACK: $1"; docker network disconnect "$NET" "$API" 2>/dev/null; refresh; sleep 3; echo "public_after_rollback=$(pub)"; exit 1; }
# Preconditions: n8n on exactly n8n_default, public healthy, alias unused, pilot healthy.
[ "$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' $N8N)" = "$NET " ] || { echo "ABORT: n8n not single-network"; exit 1; }
[ "$(docker inspect -f '{{.State.Health.Status}}' $API)" = healthy ] || { echo "ABORT: pilot API not healthy"; exit 1; }
[ "$(pub)" = 200 ] || { echo "ABORT: public n8n not healthy before change"; exit 1; }
docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' $NET | grep -qw "$API" && { echo "ABORT: pilot already on $NET"; exit 1; }
N8N_BEFORE=$(docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' $N8N)
# Remove the superseded link network (only the pilot API is on it).
if docker network inspect $OLD >/dev/null 2>&1; then
  [ "$(docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' $OLD)" = "$API " ] || { echo "ABORT: unexpected members on $OLD"; exit 1; }
  docker network disconnect $OLD $API && docker network rm $OLD >/dev/null && echo old_link_removed
fi
docker network connect --alias $ALIAS $NET $API || rollback "connect failed"
echo "pilot_networks=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}},{{end}}' $API)"
# Proof 1: n8n reaches pilot health; a forged callback token is refused.
docker exec $N8N node -e "fetch('http://$ALIAS:3002/api/v1/health').then(r=>console.log('n8n_to_pilot_health='+r.status)).catch(()=>console.log('n8n_to_pilot_health=ERR'))"
docker exec $N8N node -e "fetch('http://$ALIAS:3002/api/v1/connectors/whatsapp/n8n/relay/probe/events',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'x'.repeat(43)},body:JSON.stringify({event:{}})}).then(r=>console.log('forged_callback_status='+r.status)).catch(()=>console.log('forged_callback_status=ERR'))"
# Proof 2: public n8n healthy right after, and after a deliberate Traefik rebuild (the exact trigger of the incident).
[ "$(pub)" = 200 ] || rollback "public check after connect"
refresh; sleep 3
[ "$(pub)" = 200 ] || rollback "public check after Traefik rebuild"
# Proof 3: 2-minute watch, every 10 s.
for i in $(seq 1 12); do c=$(pub); [ "$c" = 200 ] || rollback "watch tick $i got $c"; sleep 10; done
echo "public_watch=12/12 ok"
[ "$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' $N8N)" = "$NET " ] && echo n8n_single_network=yes || rollback "n8n networks changed"
[ "$N8N_BEFORE" = "$(docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' $N8N)" ] && echo n8n_not_restarted=yes || echo n8n_not_restarted=NO
