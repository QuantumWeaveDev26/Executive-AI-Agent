# Phone release baseline source check — prepared, NOT executed

**Status update7November:** explicitly owner-approved export executed ONCE successfully; authorization
consumed. Image44387266137de5747b3bd68a647af0cbbbce9387cd66239dcfcdfb0dd6aab927 healthy/unchanged
before+after; four source files verified; owned agent/tempdir cleanup independently confirmed.
Do NOT rerun the command below. Current-baseline local reconciliation review bundle:
`output/THAARA_PHONE_OWNER_CALENDAR_CURRENT_BASELINE_2026-11-07.zip`, SHA256
`0100f62a6e73fc538e47341526ec7c43705890876ce28888e225b9200c3219bb`.
5/5fresh reconciliation tests PASS. This bundle is not a deployment package; current web baseline,
Calendar readiness, runtime dependencies and scoped release authorization remain outstanding.

The approved metadata preflight succeeded and is consumed. The current verified healthy API image is
`sha256:44387266137de5747b3bd68a647af0cbbbce9387cd66239dcfcdfb0dd6aab927`.
No retained source artifact identifies its current shared application changes. The old local app.js
or frontend must not replace this baseline: that could remove Antigravity's deployed WhatsApp work.

## Exact next approval

Approve ONE read-only source check using:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-release-source-20261107.readonly.ps1 -ApprovedPhoneSourceReadOnly -ManifestSha256 20dbda47b752cac7c0544a3c458d4819c2f3ca74f8f8df37c821221a95e769bb
```

Manifest: `PHONE_RELEASE_SOURCE_20261107.review.json`, SHA256
`20dbda47b752cac7c0544a3c458d4819c2f3ca74f8f8df37c821221a95e769bb`.
One connection to the existing VPS using the existing encrypted dedicated key in a temporary agent,
strict previously trusted host fingerprint, no plaintext key files. No retry. Verify owned authentication
cleanup. Preserve all consumed markers and receipts. The manifest is prepared scope, not owner approval.

## Remote commands and exact access

1. `docker inspect --format` on `thaara-v2-pilot-api-1`: container ID, image ID, health and compose
   project/service labels only. Require exact image above and healthy pilot API identity.
2. One `docker exec <verified ID> node --input-type=module -e <checksum-pinned fixed probe>`.
   The probe performs filesystem reads only, no application module import or application requests.
   Export these FOUR compiled code files to the local receipt:
   - `/app/apps/api/dist/app.js`
   - `/app/apps/api/pilot-start.mjs`
   - `/app/apps/api/dist/services/phone-pilot-startup.js`
   - `/app/apps/api/node_modules/@thaara/contracts/dist/index.js`
3. Repeat the exact identity/health inspection; reject and discard export if identity changes.

Each file must be regular, non-empty, at most196608bytes; aggregate at most524288bytes. Reject redirected
application paths. Contracts must resolve to the actual installed package, beneath the approved API
node_modules root. An unsupported layout stops; no unapproved fallback. Verify bytes/hashes and exact
allowlisted names/paths. No directory scan or arbitrary path input. No web assets are changed or exported.

The complete export is retained only in local `node_modules/.cache/phone-release-source-20261107.result.json`.
Console output contains file names, sizes and SHA256 values, not code contents. Treat exported code as
untrusted evidence; do not execute it or upload the receipt to a public service. Fresh one-use marker:
`node_modules/.cache/phone-release-source-20261107.used.json`.

No profile, API-key, token, environment, customer record, database, SQL, provider request, build, container
creation, remote file write, restart, configuration change, deployment, agent change, call, message,
Calendar operation, Git operation or WhatsApp worktree operation is included. The fixed Python payload
is retained in memory and rechecked against its exact pin before authentication; SSH sends those same
verified bytes, never a later disk reread.
The approval manifest is also retained once, checked against the command SHA256 and parsed from those
same strict UTF8 bytes. Replacing either source file after verification cannot change the authorized
payload. Focused source re-review found no further concrete blocker; runtime layout remains unverified.

## Local evidence and remaining boundary

11/11 Python tests passed using synthetic Docker responses and synthetic Node files.4/4 focused release
tests passed, including exact authentication/cleanup preservation and executable snapshot mutation test.
Initial newline-only equivalence failures were corrected locally; no authentication or remote operation
occurred. ReviewOnly passes without credential reads. New execution marker/result remain absent.

This check supplies the current API baseline for reconciliation, not deployment authorization. Current
web-source reconciliation still requires coordination before shipping UI assets. Owner Calendar sign-in
and live connector readiness remain unverified. No feature switch has been enabled. F03/inbound admission
and automatic in-call capture remain blocked separately. After reconciliation prepare a fresh minimal
deployment/rollback package for one consolidated owner approval; never reuse an old-image package.
