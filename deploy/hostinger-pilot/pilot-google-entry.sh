#!/usr/bin/env bash
# OWNER EXECUTION ONLY, in a root terminal on the VPS. Never run from an agent, never pass values as arguments,
# never paste them into chat. Saves the EXISTING Google OAuth client (the one Thaara already uses) for Gmail and Calendar,
# and generates a new pilot-only token-encryption key. Files are readable only by the API user. No service is restarted
# and Google is not contacted; Gmail/Calendar stay not configured until a separately approved switch-on.
set +x
set -euo pipefail
[[ "${1:-}" = '--approved-owner-entry' && "$#" = 1 && "$(id -u)" = 0 ]] || { echo 'Owner approval and root terminal required.'; exit 1; }
SECRET_DIRECTORY=/opt/thaara-v2-pilot-private/secrets
ID_FILE="$SECRET_DIRECTORY/google_client_id"
SECRET_FILE="$SECRET_DIRECTORY/google_client_secret"
VAULT_FILE="$SECRET_DIRECTORY/google_vault_key"
[[ -d "$SECRET_DIRECTORY" && ! -L "$SECRET_DIRECTORY" && ! -e "$ID_FILE" && ! -e "$SECRET_FILE" && ! -e "$VAULT_FILE" ]] || { echo 'Stop: the private directory is unavailable or a Google file already exists. Nothing was changed.'; exit 1; }
umask 077
trap 'unset owner_client_id owner_client_secret; rm -f -- "$SECRET_DIRECTORY"/.google-entry.*' EXIT
read -r -p 'Paste the Google OAuth Client ID (ends with .apps.googleusercontent.com), then press Enter: ' owner_client_id
[[ "$owner_client_id" =~ ^[0-9]{6,30}-[a-z0-9]{10,64}\.apps\.googleusercontent\.com$ ]] || { echo 'Client ID format refused; nothing saved.'; exit 1; }
read -r -s -p 'Paste the Google OAuth Client secret privately, then press Enter: ' owner_client_secret
printf '\n'
[[ ${#owner_client_secret} -ge 10 && ${#owner_client_secret} -le 200 && ! "$owner_client_secret" =~ [[:space:][:cntrl:]] ]] || { echo 'Client secret format refused; nothing saved.'; exit 1; }
publish() { # content on stdin; atomic no-overwrite publication, readable only by the API user
 local item
 item=$(mktemp "$SECRET_DIRECTORY/.google-entry.XXXXXXXX")
 cat > "$item"
 chown 1000:1000 "$item"
 chmod 0400 "$item"
 ln -- "$item" "$1"
 rm -f -- "$item"
}
printf '%s' "$owner_client_id" | publish "$ID_FILE"
printf '%s' "$owner_client_secret" | publish "$SECRET_FILE"
unset owner_client_id owner_client_secret
head -c 32 /dev/urandom | od -An -vtx1 | tr -d ' \n' | publish "$VAULT_FILE"
echo 'Google client saved privately and a new pilot token key was generated. No service was restarted and Google was not contacted.'
