# ONE pilot Gmail + Calendar activation — approval required

## Execution record — approved once, completed, approval consumed

Owner replied procced to the presented exact command/API-only restart scope. ONE execution exit0/statusverified/googleEnabledtrue,
callingEnabledtrue preserved, sendStatePreservedtrue/otherServicesUnchangedtrue, providerCalls0/callsPlaced0; strict host handshake verified.
Independent local check: agentPID24716 absent; owned temp thaara-phone-agent-053d65708fb74b2682d695a40c90146f absent; ON/OFF gatesfalse;
source pins unchanged. Receipts node_modules/.cache/google-on-attempt.json and google-on-cleanup.json. No OAuth completed or email/calendar
data read yet. Owner sign-in is next. Scope below is historical and does not authorize another execution.

Originally prepared2November2026 after owner confirmed Google credential entry succeeded; subsequent approved execution is recorded above.
No need to repeat Google Cloud/client/private entry setup. Do not regenerate a token key or display/read credential values in reports.

Exact command:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-backup-restore.review.ps1 -ApprovedGoogleOn
```

## One-run scope

- Verify both source hashes in docs/integrations/phone/GOOGLE_ON.review.json; require current command and gatefalse. Stop on mismatch.
  Only after explicit approval set that local gate true for one attempt; restorefalse in finally on every outcome. Google OFF remainsfalse.
- Existing encrypted SSH key through temporary agent, strict existing trusted-host pin; no plaintext key file/new enrollment/credential change.
- Existing publisher preconditions: expected current healthy image, unchanged n8n network, checked private relay helper, read-only phone schema
  existence query and logging metadata. No migration/DDL/DML. Host checks all three existing Google files for regular-file/UID1000/mode0400
  before any API change. Do not overwrite/change the files. Runtime loader still validates readable private mounts and formats at startup.
- Retain protected previous Compose/image settings in a new private handoff directory; candidate changes only the three Google mounts plus
  THAARA_GOOGLE_OAUTH=approved. Preserve same image, original OpenAI gpt-4.1-mini, phone settings and WhatsApp/n8n settings.
- Existing publisher uses one temporary --rm/networknone image-based configuration validator; no database setup/mount or provider request.
  Recreate ONLY API via existing Compose --no-deps/--pull never/--no-build path; brief API interruption is included. No other service restart.
  Restore existing private relay using n8n-link-v2.sh only; never attach n8n to another network or modify workflows.
- Health/image/send-state/other-service identity/network checks; public health/phone-page/auth checks and synthetic forged phone-webhook probe.
  No real call/message/email, OAuth sign-in or provider account query by this command. Owner performs Gmail/Calendar OAuth afterward.
- change_api restores prior Compose/image for failures within its guarded block and recreates ONLY API for that rollback. Later phone-webhook
  postcheck is outside that block: on failure stop/report; do not claim universal rollback or automatically run another command.
- Save sanitized receipt; independently verify exact owned temporary agent/path cleanup and gatefalse. No automatic retry or unrelated repair.

## Rollback boundaries

Retain protected prior configuration/image. Existing Google-only OFF command is available, but requires separate explicit approval if not
covered by a later scoped instruction. No backup deletion, database restore, secret removal or new image deployment authorized here.

## Evidence and limitations

Fresh local checks: provider16/16, publisher19/19; pins match, gatesfalse. Actual VPS credentials/permissions/runtime access remain pending
remote checks; owner successful entry is recorded, not independently asserted. Activation receipt/configuration does not prove OAuth success.
After activation owner connects Gmail then Calendar with authorized test account; verify read-only access first. Tokens are memory-only today;
API restart requires reconnection. Persistent storage/public multi-user launch need further reviewed implementation and approval gates.
