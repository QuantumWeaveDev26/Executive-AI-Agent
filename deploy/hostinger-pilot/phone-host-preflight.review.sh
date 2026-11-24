#!/bin/sh
# REVIEW ONLY: metadata preflight; no docker exec, database commands or writes.
set -eu
export LC_ALL=C
pg_id=$(docker inspect --format '{{.Id}}' thaara-v2-pilot-postgres-1)
case "$pg_id" in *[!0-9a-f]*|'') exit 1;; esac
[ "${#pg_id}" -eq 64 ]
facts=$(docker inspect --format '{{.Image}}|{{.State.Running}}|{{.State.Health.Status}}|{{.RestartCount}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' "$pg_id")
image=$(docker image inspect --format '{{.Id}}' postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea)
case "$image" in sha256:*) ;; *) exit 1;; esac
image_hex=${image#sha256:}
case "$image_hex" in *[!0-9a-f]*|'') exit 1;; esac
[ "${#image_hex}" -eq 64 ]
restart_count=$(printf '%s' "$facts" | awk -F'|' '{print $4}')
case "$restart_count" in *[!0-9]*|'') exit 1;; esac
[ "$facts" = "$image|true|healthy|$restart_count|thaara-v2-pilot|postgres" ]
# No-follow validation precedes any disk probe. Do not repair permissions.
for entry in / /opt /opt/thaara-v2-pilot-private; do
 [ ! -L "$entry" ] && [ -d "$entry" ]
 owner=$(stat -c '%u' "$entry")
 mode=$(stat -c '%a' "$entry")
 [ "$owner" = 0 ]
 case "$mode" in *[!0-7]*|'') exit 1;; esac
 [ "$((0$mode & 0022))" -eq 0 ]
done
[ "$(stat -c '%a' /opt/thaara-v2-pilot-private)" = 700 ]
backup_exists=false
if [ -e /opt/thaara-v2-pilot-private/phone-backups ] || [ -L /opt/thaara-v2-pilot-private/phone-backups ]; then
 [ ! -L /opt/thaara-v2-pilot-private/phone-backups ] && [ -d /opt/thaara-v2-pilot-private/phone-backups ]
 [ "$(stat -c '%u:%a' /opt/thaara-v2-pilot-private/phone-backups)" = 0:700 ]
 backup_exists=true
fi
free_kib=$(df -Pk /opt/thaara-v2-pilot-private | awk 'NR==2 {print $4}')
available_kib=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
case "$free_kib:$available_kib" in *[!0-9:]*|:|*:) exit 1;; esac
[ -n "$free_kib" ] && [ -n "$available_kib" ]
[ "$facts" = "$(docker inspect --format '{{.Image}}|{{.State.Running}}|{{.State.Health.Status}}|{{.RestartCount}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' "$pg_id")" ]
printf '{"containerId":"%s","imageId":"%s","sourceHealthy":true,"pathSafe":true,"backupDirectoryExists":%s,"diskFreeKiB":%s,"memoryAvailableKiB":%s}\n' "$pg_id" "$image" "$backup_exists" "$free_kib" "$available_kib"
