#!/usr/bin/env bash
# OWNER EXECUTION ONLY, after separate approval to install a dedicated pilot credential.
# Never run from an agent with the key as an argument, and never paste it into chat.
# Saves the Sarvam workspace key, generates the private webhook secret and installs the non-secret profile.
# No service is restarted, no provider is contacted and calling stays off until a separately approved deployment.
set +x
set -euo pipefail
[[ "${1:-}" = '--approved-owner-entry' && "$#" = 1 && "$(id -u)" = 0 ]] || { echo 'Owner approval and root terminal required.'; exit 1; }
SECRET_DIRECTORY=/opt/thaara-v2-pilot-private/secrets
KEY_FILE="$SECRET_DIRECTORY/sarvam_api_key"
HOOK_FILE="$SECRET_DIRECTORY/sarvam_webhook_secret"
PROFILE_FILE="$SECRET_DIRECTORY/sarvam_profile"
PROFILE_SOURCE="$(dirname -- "$(readlink -f -- "$0")")/sarvam-runtime-profile.pilot.json"
PROFILE_SHA=7a41b4f34482ccf833fcdab6b7bb0c8a5c198f52a994ec4d8c0ca11a19596447
[[ -d "$SECRET_DIRECTORY" && ! -L "$SECRET_DIRECTORY" && ! -e "$KEY_FILE" && ! -e "$HOOK_FILE" && ! -e "$PROFILE_FILE" ]] || { echo 'Stop: the private directory is unavailable or a Sarvam file already exists. Do not overwrite existing setup.'; exit 1; }
[[ "$(sha256sum "$PROFILE_SOURCE" | cut -d' ' -f1)" = "$PROFILE_SHA" ]] || { echo 'Stop: reviewed profile not found or changed; nothing saved.'; exit 1; }
umask 077
trap 'unset owner_sarvam_key; rm -f -- "$SECRET_DIRECTORY"/.sarvam-entry.*' EXIT
read -r -s -p 'Paste the Sarvam workspace API key privately, then press Enter: ' owner_sarvam_key
printf '\n'
[[ ${#owner_sarvam_key} -ge 8 && ${#owner_sarvam_key} -le 4096 && ! "$owner_sarvam_key" =~ [[:space:][:cntrl:]] ]] || { echo 'Key format refused; nothing saved.'; exit 1; }
publish() { # content on stdin; atomic no-overwrite publication, readable only by the API user
 local item
 item=$(mktemp "$SECRET_DIRECTORY/.sarvam-entry.XXXXXXXX")
 cat > "$item"
 chown 1000:1000 "$item"
 chmod 0400 "$item"
 ln -- "$item" "$1"
 rm -f -- "$item"
}
printf '%s' "$owner_sarvam_key" | publish "$KEY_FILE"
unset owner_sarvam_key
head -c 48 /dev/urandom | base64 -w0 | tr '+/' '-_' | tr -d '=' | publish "$HOOK_FILE"
publish "$PROFILE_FILE" < "$PROFILE_SOURCE"
echo 'Sarvam files saved privately. No service was restarted, no provider was contacted and calling stays off.'
