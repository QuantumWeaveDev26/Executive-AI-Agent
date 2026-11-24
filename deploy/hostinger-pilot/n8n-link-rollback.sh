#!/bin/bash
# Step 108.11 rollback: removes only the private link network. n8n keeps running; nothing restarts.
set -uo pipefail
NET=thaara-v2-pilot-n8n
docker network disconnect "$NET" n8n-n8n-1 2>/dev/null
docker network disconnect "$NET" thaara-v2-pilot-api-1 2>/dev/null
docker network rm "$NET" && echo LINK_REMOVED
