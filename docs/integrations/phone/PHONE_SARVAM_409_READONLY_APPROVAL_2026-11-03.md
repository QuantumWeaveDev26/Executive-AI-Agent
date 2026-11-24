# Separate approval request — ONE read-only HTTP409 receipt inspection

**EXECUTION UPDATE:** Explicit owner approval received; executed once successfully. Stable single `claimed` receipt confirms create-suite was the
HTTP409 operation. No provider access/remote writes. Independent local auth cleanup and both gates false verified. Approval consumed; no retry.
See `SARVAM_HTTP409_READONLY_RESULT_2026-11-03.md`. Preparation text below is historical, not authorization for another run.

**NOT approved/executed.** This is not a simulation retry and does not query Sarvam.

## Exact local command (only after explicit approval)

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-409-readonly.review.ps1 -ApprovedReadOnly409
```

After approval only, enable the NEW diagnostic manifest Boolean `remoteExecutionAllowed` once, verify both pins, then execute once.
The helper consumes/resets only this separate diagnostic gate before/after authentication. It never opens or changes the simulation execution
manifest, the remote anti-replay guard or any phase receipt for writing. No retry if authentication/read/permission/snapshot checks fail.

| Artifact | SHA256 |
|---|---|
| `scripts/phone-sarvam-409-readonly.review.ps1` | `c961662490028daff753e95d1046c486c8344e6199bfc6ce80338793c883645d` |
| `deploy/hostinger-pilot/phone-sarvam-409-readonly.review.py` | `1102209220d6cea56db8db74d76230e8344bb41527311fdf75b10ad68e14386a` |

Manifest: `docs/integrations/phone/PHONE_SARVAM_409_READONLY.review.json`, currently FALSE. Source is concrete and locally tested; no execution approval inferred.

## Exact remote command and access scope

The existing encrypted dedicated SSH identity is loaded through the reviewed temporary-agent mechanism, without a plaintext key file.
Reuse the independently trusted ED25519 host fingerprint and strict verification already recorded in the existing authentication helper;
no unknown host acceptance, forwarding, key changes, credentials in arguments/output or Sarvam API-key access.

On the SAME previously pinned VPS/root SSH account only, run this exact command:

```sh
python3 -B - --approved-readonly-409
```

The checksum-pinned Python source above is supplied on SSH stdin. It is not installed on the VPS. It performs these fixed read-only operations:

- Open `/`, `/opt`, `/opt/thaara-v2-pilot-private`, and existing `phone-eval-stage-b-20261103-v6-once` through directory descriptors;
  reject symlinks/unsafe ownership/modes. Require the existing guard root-owned0700.
- List ONLY that guard directory and read ONLY a complete contiguous prefix of `01.json` through `06.json`, each root-owned0600,
  regular single-link, at most8192bytes. Do not scan other directories/logs. Unexpected files/incomplete JSON/changed snapshot stop the read.
- Use `O_RDONLY|O_NOFOLLOW|O_NOATIME`; validate metadata before/after. No file creation, edits, chmod/chown, deletion, SQL, Docker, service,
  provider/network request, key/environment dump or simulation invocation.
- Parse IDs only in memory to check shape/consistency; print NO private identifiers, ID hashes, raw receipt contents, paths/inodes or unknown strings.
  Output only known phase/operation enums, count and Boolean presence/consistency flags.

Remote command timeout30seconds, SSH connect bound12seconds, one connection/no retry. No Sarvam spend or billing call is included.
Local authentication setup creates only its owned protected temporary directory/public known_hosts/agent socket and temporary SSH agent;
verify cleanup of those exact resources afterward. Never delete or reset the existing VPS guard/receipts.

## Expected output

Schema: `status`, `receiptCount`, `lastPhase`, `hasSuiteId`, `hasMappingId`, `hasRunId`, `runSubmissionFencePresent`, `candidateOperations`,
`snapshotStable`, `providerQueried:false`, `billingReconciled:false`, `remoteWrites:0`, plus host-verification/local-cleanup/diagnostic-gate flags.

**Illustration ONLY if the actual snapshot contains just the initial claim (not a finding):**

```json
{"status":"readonly_complete","receiptCount":1,"lastPhase":"claimed","hasSuiteId":false,"hasMappingId":false,"hasRunId":false,"runSubmissionFencePresent":false,"candidateOperations":["create_suite"],"snapshotStable":true,"providerQueried":false,"billingReconciled":false,"remoteWrites":0}
```

Other valid snapshots return the conditional candidates in `SARVAM_HTTP409_LOCAL_ANALYSIS_2026-11-03.md`. Some phases remain ambiguous.
A failed read returns only `receipt_snapshot_rejected`; do not loosen checks, print raw data or reconnect automatically.
This inspection cannot establish current provider-resource existence, recover the discarded HTTP body or reconcile billing; those would need a later
separate read-only scope if required. No further provider operation, repair or paid test follows this approval.

## Owner decision requested

Approve ONE invocation of this exact pinned read-only diagnostic package. It reads existing retained phase evidence only; no provider API,
simulation, credit spend, API-key read, remote write, deletion, gate/guard reset for the simulation, deployment, restart, commit/push or integration change.
