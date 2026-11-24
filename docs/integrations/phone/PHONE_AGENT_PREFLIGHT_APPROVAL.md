# Agent-only SSH + host metadata preflight — exact next approval

31 October2026. ONE explicitly approved host-metadata run completed successfully; live phone calling remains disabled.

## Latest completed result — authorization consumed

Both source checksums matched before/after. Reused only existing encrypted key via memory-to-temporary-agent stdin, no private-key file.
Actual strict SSH handshake matched trusted ED25519 pin. Source immutable container ID
`340a0ab86ef4156d87651433676978473f58c82b32e1fa4c279664261ace7893`, expected project/service/running/healthy/final identity checks passed;
image matched `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`. Root-owned protected path verified, backup child absent.
Free disk55826136KiB (~53.24GiB), available RAM4266764KiB (~4.07GiB) at inspection. No database/SQL/backup/restore/source configuration writes.
Owned agentPID22780 and temp directory removal independently verified; local remoteExecutionAllowed resetfalse even after success. No retry.
Evidence in latest31Oct handover and cache `phone-agent-host-preflight-attempt.json`, `phone-agent-host-preflight-cleanup.json`.
No further run/backup/restore/deployment/call is authorized by this result. Source DB details need separately approved read-only DB metadata checks.

## Implemented and checked

- `scripts/phone-agent-preflight.review.ps1` uses existing Git OpenSSH binaries, an independent foreground SSH-agent child and a protected
  current-user/SYSTEM-only temporary directory/socket. It does not start/change an SSH service or use an existing/shared agent.
- Only if explicitly approved, the existing DPAPI key is decoded in the helper's memory and piped to `ssh-add -t120 -` stdin. No key value
  appears in argv, output or a private-key file. BSTR buffer is cleared; agent termination and helper-process exit end the in-memory use.
  Managed-string/OS-memory forensic erasure is not claimed. Existing key/enrollment are never replaced or changed.
- Exact Boolean gates and validated identity fingerprint precede key import. The new agent must start empty and hold exactly the expected key.
- PUBLIC saved host record is hashed and matched to trusted `SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`; strict SSH host checking,
  no forwarding, no global config/trust update, strong algorithms, one connection attempt. Temporary known_hosts contains only that trusted record.
- Pinned shell payload `deploy/hostinger-pilot/phone-host-preflight.review.sh` uses container/image inspection, no-follow stat checks and RAM/disk
  metadata only. **No docker exec, database commands, provider calls, downloads, writes, service changes, containers or backups.** Fixed source
  name resolves once to verified64hex ID; require exact project/service labels, pinned cached image, running/healthy status; recheck before receipt.
- Cleanup terminates only the owned agent process/PID, removes only its exact known_hosts/socket and new temp directory, verifies removal. All
  unexpected errors stop with phase-only output; no child stderr/key/remote payload is echoed. No insecure/private-file fallback.

Verification: **9/9 local preparation tests passed** (PowerShell/shell syntax, default review-only, exact authorization gate, conflicting mode,
checksum tamper and non-Boolean refusal). Tests use a synthetic credential profile. Focused read-only security review passed after hardening.
Latest actual EMPTY-agent test: public host record matched, keyLoaded=false, remoteConnected=false, cleanupVerified=true; independent readback
confirmed owned PID3688 absent and owned temp directory `thaara-phone-agent-39fb520132cb42fcbd23461d6698deaf` absent. No key was generated/imported.
Evidence: `node_modules/.cache/phone-agent-preflight-tests.json`, `phone-agent-empty-test.json`.

## Historical request — subsequently explicitly approved for ONE completed execution

Approve ONE run on the existing VPS76.13.217.50 using the existing encrypted dedicated key via this reviewed agent-only mechanism, and only the
new no-database metadata payload. This replaces the earlier preflight's psql/pg_dump/pg_restore commands: **those are excluded entirely**.

Source pins and host information: `PHONE_AGENT_PREFLIGHT.review.json` (remoteExecutionAllowed=false). Verify both exact SHA256 entries before
any authentication; mismatch stops. After explicit approval, the operator may set only its LOCAL review gate remoteExecutionAllowed=true for
this one run; keep all artifacts/IDs/pins unchanged. Reset that gate to false in the operator's finally block after the attempt, including failure.
No application live switch, credential configuration or deployment flag changes are included.

Exact helper command, after the approved local one-run gate change:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-agent-preflight.review.ps1 -ApprovedAgentOnlyPreflight
```

Expected receipt: verified host handshake, source container/image IDs, healthy/path-safe status, existing backup-directory flag, free disk/RAM,
owned agent PID/random temp basename and cleanup result. Only bounded typed fields accepted; no rows, environment variables or secret values.
Independently confirm that exact agent PID and temp directory are absent; never kill/delete by generic process name or directory prefix.
If host pin, key permissions/identity, source labels/image, path ownership/mode, resource output or cleanup fails, stop without retry/repair.

EXCLUDED: any database command/SQL/query/dump/restore/migration; new keys or plaintext private-key files; changed enrollments/credentials/services;
VPS files/directories/config writes; images pulled, Docker networks/volumes/containers created or changed; Sarvam/Meta/Plivo API calls, campaign,
deployment, phone activation, real call, commits/pushes. Existing Gmail/Calendar/WhatsApp/n8n/Sarvam inbound untouched.

After successful metadata preflight, prepare one concrete backup/restore and subsequent launch review using verified source facts. Persistent
migration/deployment and one own-number call still require explicitly scoped approvals. This is not permission to make the phone integration live.
