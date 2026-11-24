# Phone110 — pilot deployment, key entry, live switch and first call

Step A EXECUTED 31 October2026 on owner's "Yes, deploy once": exit0, status=verified, image sha256:3e21eaef…87cb, rollback image sha256:e6d9d0bc…07fb, callingEnabled=false, sendStatePreserved, otherServicesUnchanged, traefikAccessLog=false, providerCalls=0, callsPlaced=0. Authorization consumed; do not rerun. Steps B-D not done.
Step B done by owner (reported). Step C EXECUTED 31 October2026 on owner's "Yes, switch it on": exit0, status=verified, callingEnabled=true, Sarvam file checks and forged-webhook check passed, send state preserved, other services not restarted, providerCalls=0, callsPlaced=0. Authorization consumed. Step D and live-off pending.
Three locked manifests (PHONE_DEPLOY_110, PHONE_LIVE_ON_110, PHONE_LIVE_OFF_110), all remoteExecutionAllowed=false. Each remaining step needs its own explicit owner approval.

Operator: `pwsh` is not on the Claude session PATH; use `%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe` with the same arguments, in the background.
Flip only that step's gate with a whitespace-tolerant edit, run once, restore original bytes in finally, independently verify the owned agent and temp directory are gone.

## Step A — deploy with calling off

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-backup-restore.review.ps1 -ApprovedPhoneDeploy
```

Uploads the pinned image archive (about 107 MiB) to the private handoff folder, then on the VPS:
1. Requires root, pinned link script, API image exactly sha256:e6d9d0bc… (29 Oct record; anything else stops with nothing changed), healthy API, n8n on its single network, phone schema present.
2. Verifies archive hash, loads it and compares image layers. Renders the new compose: Postgres and Redis must match; validates it with the new image's own rules.
3. Keeps previous compose and image references in a new private folder. Recreates only the API with `THAARA_PHONE_DURABLE=approved`; live switch absent. Restores the n8n link with its two-minute public n8n watch.
4. Checks: API healthy, image correct, WhatsApp send state unchanged, Postgres/Redis/n8n/Traefik not restarted, public health and phone page 200, signed-out phone route 401.
5. Any failed check restores the previous compose and image and re-verifies them. Category `rollback_image_mismatch` means rollback itself needs attention.
6. Installs the owner key-entry script and profile (hashes pinned). Records whether Traefik has access logging (the callback address holds a private token).

Expect about a minute of API downtime. No SQL, secret values, provider request, call, n8n workflow change or Meta setting change. n8n itself is not restarted.
**Known risk:** the pilot has run hand-patched overlays. This replaces them with one image built from the current source. It is the first full rebuild, so WhatsApp behaviour is covered by tests and these checks, but not by a real message. Owner set WhatsApp testing aside for now.

## Step B — owner enters the Sarvam key (owner only, in a VPS root terminal)

```bash
/opt/thaara-v2-pilot/pilot-sarvam-key-entry.sh --approved-owner-entry
```

Key is pasted at a hidden prompt, never in chat. It saves the key, generates the webhook secret, installs the profile (all owner-readable only by the API user, 0400), and refuses to overwrite. Nothing restarts; calling stays off.

## Step C — live switch on

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-backup-restore.review.ps1 -ApprovedPhoneLiveOn
```

Refuses if Traefik access logging is on or Sarvam files are not exact. Adds live environment and three secret mounts, recreates only the API, same checks and rollback, and requires a forged webhook to get 403. Places no call. Default limit five calls per rolling 24 hours, five-minute maximum, each still needing owner approval in Chat.

## Step D — one real call, then live switch off

Owner saves their own number as a contact with consent, asks Chat to call, checks the card, taps **Call now** once. Verify conversation, end within five minutes, callback, transcript, Chat report, no second dial, audit rows. This also proves Instant Outbound permission. Then:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-backup-restore.review.ps1 -ApprovedPhoneLiveOff
```

## Local evidence (31 October 2026)

Image thaara-v2-pilot-api:phone-110-web, archive SHA256 c70c2c3d…c3d3. Full API + web build from the working tree (pinned Node image, lockfile packages). Started locally on pilot schema + 110a-c with pilot limits (read-only, 512 MiB, dropped capabilities) on an internal network: off, durable, live (synthetic secrets), unsafe secret file; all healthy, 80–127 MiB; webhook 404 unless live, then 403; unsafe file logged `secret_file_permissions` and stayed off; no secret in logs. Report node_modules/.cache/phone-image-local-check.json.
Tests: API813/813, web243/243, runner41/41, publisher10/10, transport + pilot config26/26, bounded-process5/5, key entry in a throwaway container with a synthetic key. Image validator accepted the durable, live and off models.
NOT covered: this publisher has not run against the real VPS layout (mocks plus the real validator only; it stops before changes if the layout differs), real Sarvam behaviour, real WhatsApp traffic, spoken reports (still refused outside tests). Reviewed by the implementing session, not an independent reviewer.
