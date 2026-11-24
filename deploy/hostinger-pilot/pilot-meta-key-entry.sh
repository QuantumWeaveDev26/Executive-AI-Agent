#!/usr/bin/env bash
# OWNER EXECUTION ONLY, after separate approval to install a dedicated pilot credential.
# Never run from an agent with the key as an argument, and never paste it into chat.
set +x
set -euo pipefail
[[ "${1:-}" = '--approved-owner-entry' && "$#" = 1 && "$(id -u)" = 0 ]] || { echo 'Owner approval and root terminal required.'; exit 1; }
KEY_DIRECTORY=/opt/thaara-v2-pilot-private/secrets
KEY_FILE="$KEY_DIRECTORY/meta_access_token"
[[ -d "$KEY_DIRECTORY" && ! -L "$KEY_DIRECTORY" && ! -e "$KEY_FILE" ]] || { echo 'Stop: the private directory is unavailable or a key already exists. Do not overwrite existing setup.'; exit 1; }
umask 077
trap 'unset owner_meta_key; if [[ -n "${key_temporary:-}" && "$key_temporary" == "$KEY_DIRECTORY"/.meta-entry.* ]]; then rm -f -- "$key_temporary"; fi' EXIT
read -r -s -p 'Paste the dedicated Thaara Meta key privately, then press Enter: ' owner_meta_key
printf '\n'
[[ ${#owner_meta_key} -ge 20 && ${#owner_meta_key} -le 4096 && ! "$owner_meta_key" =~ [[:space:][:cntrl:]] ]] || { echo 'Key format refused; nothing saved.'; exit 1; }
key_temporary=$(mktemp "$KEY_DIRECTORY/.meta-entry.XXXXXXXX")
printf '%s' "$owner_meta_key" > "$key_temporary"
unset owner_meta_key
chown 1000:1000 "$key_temporary"
chmod 0400 "$key_temporary"
# Atomic no-overwrite publication; private parent directory remains root-only.
ln -- "$key_temporary" "$KEY_FILE"
echo 'Dedicated key saved privately. No service was restarted, API called or messaging enabled.'
