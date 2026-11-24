#!/usr/bin/env bash
# OWNER EXECUTION ONLY, in a root terminal on the VPS. Never run from an agent, never pass the key as an argument,
# never paste it into chat. Saves the OpenAI API key for Thaara Chat (original gpt-4.1-mini model) as a private file
# readable only by the API user. No service is restarted and no provider is contacted; Chat stays not configured
# until a separately approved switch-on.
set +x
set -euo pipefail
[[ "${1:-}" = '--approved-owner-entry' && "$#" = 1 && "$(id -u)" = 0 ]] || { echo 'Owner approval and root terminal required.'; exit 1; }
SECRET_DIRECTORY=/opt/thaara-v2-pilot-private/secrets
KEY_FILE="$SECRET_DIRECTORY/openai_api_key"
[[ -d "$SECRET_DIRECTORY" && ! -L "$SECRET_DIRECTORY" && ! -e "$KEY_FILE" ]] || { echo 'Stop: the private directory is unavailable or an OpenAI key file already exists. Nothing was changed.'; exit 1; }
umask 077
trap 'unset owner_openai_key; rm -f -- "$SECRET_DIRECTORY"/.openai-entry.*' EXIT
read -r -s -p 'Paste the OpenAI API key privately, then press Enter: ' owner_openai_key
printf '\n'
[[ ${#owner_openai_key} -ge 20 && ${#owner_openai_key} -le 4096 && ! "$owner_openai_key" =~ [[:space:][:cntrl:]] ]] || { echo 'Key format refused; nothing saved.'; exit 1; }
item=$(mktemp "$SECRET_DIRECTORY/.openai-entry.XXXXXXXX")
printf '%s' "$owner_openai_key" > "$item"
unset owner_openai_key
chown 1000:1000 "$item"
chmod 0400 "$item"
ln -- "$item" "$KEY_FILE"
rm -f -- "$item"
echo 'OpenAI key saved privately. No service was restarted, no provider was contacted and Chat stays not configured.'
