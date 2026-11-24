# Sarvam key replacement on the pilot (DRAFT for owner approval, 31 Oct 2026)

**Status:** not executed. Live-calling settings, limits, approvals, consent and no-redial checks are unchanged.

## Why

On 31 Oct, the read-only diagnostic found that both live attempts (16:18:54 and 16:22:12 IST) ended with `PHONE_DISPATCH_HTTP_401`. Sarvam refused the key stored in `/opt/thaara-v2-pilot-private/secrets/sarvam_api_key`.

Sarvam's [Create outbound call](https://docs.sarvam.ai/voice-agents/api/instant-outbound/create) page requires the **workspace API key** in the `X-API-Key` header. That key is managed under Voice Agents **Settings → API Key**.

The local `keys.env` key was used successfully on 29 Oct for speech (TTS/STT) through the `Api-Subscription-Key` header. That is a different Sarvam service. The public docs don't say whether a speech subscription key works as a Voice Agents workspace key.

## Step 0 — optional read-only key comparison (separate approval)

- **Command:** `-ApprovedSarvamKeyCompare`, using manifest `PHONE_SARVAM_KEY_COMPARE.review.json`.
- **Local side:**
  - Reads `SARVAM_API_KEY` from `C:/ThaaraProjects/thaara-speech-test/keys.env`.
  - Makes a fresh random 32-byte nonce and computes HMAC-SHA256(nonce, key).
  - Sends only the nonce and that HMAC.
- **VPS side:** computes the same HMAC over the saved key file and returns one Boolean, `keysMatch`.
- **Never output:** the key, a plain hash, its length or its prefix. Nothing is written, no provider is contacted, no call is made, and the temporary SSH agent and temp folder are cleaned up.
- **What the result means:**
  - `keysMatch: true` means the VPS holds the speech key. Replace it with the Voice Agents workspace key.
  - `keysMatch: false` means the VPS holds some other key, which Sarvam also refused. Still replace it with the workspace key from the workspace that owns "Thaara AI Voice Assistant".

## Step 1 — owner gets the right key (Sarvam dashboard)

1. Go to Voice Agents, then the workspace that owns the agent "Thaara AI Voice Assistant", then Settings → API Key.
2. Copy that workspace's API key, or create one if none exists.
3. Never paste it into chat, Git or a file on your computer.

## Step 2 — owner replaces the file in place (root terminal on the VPS)

The file must keep the same inode. Docker file-secrets are bind mounts that pin the original file, so replacing it with a new file would not be seen until a restart. Thaara re-reads this file on every call, so no restart or deploy is needed.

```bash
F=/opt/thaara-v2-pilot-private/secrets/sarvam_api_key
BEFORE=$(stat -c '%i %U:%G %a' "$F")
read -r -s -p 'Paste the Sarvam Voice Agents workspace API key privately, then press Enter: ' K; printf '\n'
if [[ ${#K} -ge 8 && ${#K} -le 4096 && ! "$K" =~ [[:space:][:cntrl:]] ]]; then printf '%s' "$K" > "$F"; echo 'Saved.'; else echo 'Key format refused; nothing changed.'; fi
unset K
AFTER=$(stat -c '%i %U:%G %a' "$F"); [[ "$BEFORE" = "$AFTER" ]] && echo "Same file, owner and mode: $AFTER" || echo "STOP: file identity changed ($BEFORE -> $AFTER)"
```

- **Expected result:** `Same file, owner and mode: <inode> 1000:1000 400`.
- **If anything else prints, stop and tell me.**
- The previous key is not kept. Sarvam already rejects it, so it has no recovery value.

## Step 3 — verification (separate approval)

One owner-approved test call to the owner's own number. Pass criteria are in `SARVAM_GO_LIVE_PACKAGE.md`, Gate 6.

A 401 again means the key is still not accepted. Any other code is a new, separate finding.
