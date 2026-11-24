#!/bin/bash
# Step 108.11b rollback: detach the pilot API from n8n_default, then refresh Traefik routes. Nothing restarts.
set -uo pipefail
docker network disconnect n8n_default thaara-v2-pilot-api-1 && echo pilot_detached
docker run --rm --network none --read-only --cap-drop ALL --entrypoint true postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea >/dev/null
sleep 3; echo "public_n8n=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://n8n.srv1871828.hstgr.cloud/healthz)"
