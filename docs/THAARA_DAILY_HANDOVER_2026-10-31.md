# Thaara checkpoint — 31 October 2026

## LATEST — live calling switched ON on the pilot; no call placed yet

Owner reported key entry and replied "Yes, switch it on". Exit0, status=verified, callingEnabled=true, forged webhook 403, send state preserved, other services not restarted, providerCalls=0, callsPlaced=0.
Receipts phone-live-on-110-attempt.json, phone-live-on-110-cleanup.json. Key validity and Instant Outbound permission remain unverified until the owner's first call. Limits 5 calls/rolling 24h, five minutes, per-call approval and consent.
Live calling STAYS ON until -ApprovedPhoneLiveOff is separately approved. Next: owner test call to own number, verify outcome, then request live-off.

## LATEST — phone image DEPLOYED to the pilot with calling OFF; approval consumed

Owner replied "Yes, deploy once". Exit0, status=verified: API image sha256:3e21eaef24a41d15d8962431f10005ec593d68a752a95cf5b56a61e6863387cb, rollback sha256:e6d9d0bc6f63fd126d453159a124fe09eaffdf11300344857a032a65cea007fb, THAARA_PHONE_DURABLE on, live off,
send state preserved, other services not restarted, Traefik access log not configured, providerCalls=0, callsPlaced=0. Receipts phone-deploy-110-attempt.json, phone-deploy-110-cleanup.json. Rollback copies in /opt/thaara-v2-pilot-private/handoff/phone110-deploy-*.
Unverified: real WhatsApp traffic on the new build (owner set aside). Next: owner Step B key entry, /opt/thaara-v2-pilot/pilot-sarvam-key-entry.sh --approved-owner-entry; then explicit approval for -ApprovedPhoneLiveOn, one call, -ApprovedPhoneLiveOff. Plan: integrations/phone/PHONE_DEPLOY_110_APPROVAL.md.

## LATEST — deployment image and publisher ready LOCALLY; nothing deployed

Owner approved local image build. Built thaara-v2-pilot-api:phone-110-web (Dockerfile.api + Dockerfile.phone-110), archive node_modules/.cache/phone110-image.tar.gz SHA256 c70c2c3d…c3d3. Local start check passed in all four modes (scripts/phone_image_local_check.py).
Added deploy/hostinger-pilot/phone-publish.review.py and -ApprovedPhoneDeploy/-ApprovedPhoneLiveOn/-ApprovedPhoneLiveOff transport modes with three locked manifests. Plan: integrations/phone/PHONE_DEPLOY_110_APPROVAL.md.
Fresh: runner41/41, publisher10/10, transport + pilot config26/26, bounded5/5; API813/813 and web243/243 unchanged source. Publisher never run against real VPS layout. Expected base image from 29 Oct record, sha256:e6d9d0bc…; differs = safe stop.
Next: explicit approval for ONE -ApprovedPhoneDeploy (calling off). Then owner key entry, live-on, one call, live-off. No VPS/provider/credential use; no commit/push; HEAD413f5a5.

## LATEST — phone startup wiring written and tested LOCALLY; not deployed

Owner decision 31 Oct: finish phone first, then WhatsApp (owner reports text/image sending tested; templates and live connection remain). Post-migration WhatsApp test set aside by owner, so WhatsApp health after 110a-c is unverified.
Added apps/api/src/services/phone-pilot-startup.ts (off by default; durable switch; live only through the loader, refusal leaves calling off and API up), buildApp guard accepts only a loader-created provider outside tests,
pilot-start.mjs wiring, pilot-config.mjs exact phone env/secret rules, docs/integrations/phone/sarvam-runtime-profile.pilot.json, deploy/hostinger-pilot/pilot-sarvam-key-entry.sh (tested in a throwaway container with a synthetic key).
Report voice guard unchanged. Fresh: API813/813 (73 files), web243/243 (21 files), API typecheck passed. Reports node_modules/.cache/phone-startup-*-regression.json. Single green commands, external runtime/integration suites excluded.
Next: full API + web image build (Dockerfile.api needs the pinned node image, not cached locally, and registry packages), local start check, publisher preserving WhatsApp send state. Then owner key entry, Traefik log check, deployment (calling off), and one controlled call.
No VPS/provider/credential use; no commit/push; HEAD413f5a5.

## LATEST — pilot database MIGRATED: 110a/b/c applied and post-verified; approval consumed

Owner replied "Yes, run it once". Exit0: status=verified, migrationStatus=verified, applied 110a/110b/110c, migrationPostVerified, sourceIdentityUnchanged, providerCalls=0, cleanupVerified.
Fresh pre-migration backup verified with isolated restore (35 tables), container 49a05e5c… removed:
/opt/thaara-v2-pilot-private/phone-backups/phone110-20261031T074616Z-42f07591becbc014d246b60b888fd272, archive SHA256 4c24c3c8c2507bfe5958be1bb44dc79c3d9ea4836227da0bad9021848f67752b,
globals SHA256 9f1ee9261f8e67266a5221fe14a2c2b52d6aecb4cff456f4f9aecd9cd10df4e2. Earlier backup phone110-20261031T073154Z-… also retained. Retain both >=7 days and until disposal approval.
Receipts: node_modules/.cache/phone-migration-110-attempt.json, phone-migration-110-cleanup.json. Receipt-based; no separate reconnect. No service restart/deploy/provider/call.
Unverified: running API/WhatsApp health after the migration (owner to send one pilot WhatsApp test). Pilot API code does not use the new objects until a reviewed deployment.
Calling remains disabled. Next phone steps, each separately approved: secure runtime credentials, production startup integration, Instant Outbound verification, deployment, one owner-number call.

## LATEST — persistent 110a/b/c package built and rehearsed LOCALLY; pilot NOT migrated

Owner replied "Yes, build and rehearse". Added -ApprovedMigration to the reviewed PS1/Python, locked manifest PHONE_MIGRATION_110.review.json (5 pins, gate false), approval document
integrations/phone/PHONE_MIGRATION_110_APPROVAL.md and scripts/phone_migration_local_rehearsal.py. No VPS/SSH/provider/credential use. Fresh backup + restore runs first; migration only follows if verified.
Rehearsal (throwaway, synthetic, pilot bundle + 10821 + 10825): all three applied and post-verified; app role sees 0 rows, DELETE denied; later backup of migrated schema verified after one more exact
reparse line (phone_contacts display name); second run refused; lock on approval_requests gave 110a committed/110b failed, reported truthfully. Containers and volumes removed.
Fresh: Python41/41, transport14/14, bounded5/5 =60/60; backup rehearsal re-verified on final code. All three manifests re-pinned, gates false. Previous VPS backup path remains as recorded; new sources need new approval.
Runner refuses a partly migrated target, so partial failure needs a reviewed forward repair. Next: explicit approval for ONE -ApprovedMigration. Later: credentials, startup wiring, Instant Outbound verification, deploy, one owner-number call.
No commit/push; HEAD413f5a5.

## LATEST — VPS backup and isolated restore VERIFIED; approval consumed

Owner replied "Yes, run it once". Pins and false gates checked, gate true for one attempt, ran once in background, manifest restored in finally. Exit0. Receipt: status=verified,
tableCount=35, countsVerified, rolesVerified, schemaOwnersAclVerified, sourceIdentityUnchanged, sourceMutated=false, restoreContainerRemoved, destructionObserved, cleanupVerified, providerCalls=0.
Protected backup: /opt/thaara-v2-pilot-private/phone-backups/phone110-20261031T073154Z-3e4a7737e3396ce522f60579297965e3
archive SHA256 9a0a56df5f2537a6b255fcd9310353ae3e6da519c344ef0d40980ac723bf993c; globals SHA256 3ad5d3f913454fd7901504653e8241fa4d4687a64aaab81d2b73c6a8423fffce.
Restore container ae5601c5… removed. Retain >=7 days and until separate disposal approval. Globals exclude role passwords, so a real recovery must reset role credentials.
Receipts: node_modules/.cache/phone-backup-restore-attempt-3.json, phone-backup-restore-cleanup-3.json. No migration/deploy/service change/provider request/call.
Backup is a point-in-time copy; take/verify a fresh one immediately before any persistent 110a/b/c. Next phone step: separate approval for persistent migrations.

## LATEST — owner-approved LOCAL rehearsal VERIFIED end to end; VPS backup still NOT done

Owner replied "Yes, rehearse locally". New `scripts/phone_backup_local_rehearsal.py` runs the real run() and real docker/psql/pg_dump/pg_restore on Docker Desktop against a throwaway
pinned-image source: no network, tmpfs, random passwords, real pilot bundle + 10821 + 10825 + 2000 synthetic rows. It refuses a non-desktop-linux context or a different image.
Final: status=verified, 36 tables, counts/roles/DB state/schema match, fixture and source removed, volumesLeft empty, source fingerprint unchanged, no VPS/provider/credential use.
Existing local thaara-v2-postgres untouched. Report: node_modules/.cache/phone-backup-local-rehearsal.json.

Rehearsal found and fixed false failures that would each have consumed a VPS approval: (1) built-in pg_* to pg_* memberships differ by bootstrap grantor, now skipped;
(2) `-- ...; Owner:` headers name the bootstrap for pgcrypto, comment lines now ignored but bootstrap must not appear in restored SQL; (3) Postgres flattens nested ANDs in
one reviewed CHECK constraint, exact-line equivalence only. Any other schema difference fails closed. Python re-pinned in both manifests (PS1 unchanged), gates false.
Fresh: Python36/36, transport11/11, bounded5/5 =52/52 (see final tool output/reports phone-rehearsal-fix-*). App code unchanged; app suites not rerun.

NOT covered locally: real pilot data, Linux root/ownership/private-file paths and SIGALRM deadlines (shimmed on Windows), host-specific docker stderr warnings.
Next: new explicit approval for ONE -ApprovedBackupRestore at current hashes, run in background because SSH budget 720s exceeds the 600s foreground limit. Failure = stop, no retry.
Migrations/deploy/calls stay separately gated. No commit/push; HEAD413f5a5.

## LATEST — second backup attempt STOPPED at database_metadata; client-env defect fixed locally; no retry

Owner approved ONE -ApprovedBackupRestore. Pins/gates checked, gate true for one attempt, ran once (background, 720s SSH budget), manifest restored in finally.
Exit1: status=failed, phase=preflight, preflightStep=database_metadata, category=unclassified_failure, sourceMutated=false, providerCalls=0, cleanupVerified=true,
no backupDirectory/archive hash/restore container. Backup/restore NOT verified. Approval CONSUMED. Independent check: agent PID16792 and temp dir absent, both gates false.
Receipts: phone-backup-restore-attempt-2.json, phone-backup-restore-cleanup-2.json.

Cause reproduced locally on the SAME image ID, no server running (phone-libpq-env-probe.log): `PGSERVICE=` fails `definition of service "" not found`, which alone
stops psql before connecting; `PGPASSFILE=/dev/null` adds a not-a-plain-file warning that stderr-strict readers refuse. Highly likely, not proven on the VPS,
since the receipt category was unclassified. Fix: removed PGSERVICE, PGPASSFILE now a missing path (ignored silently), snapshot/session refusals map to database_preflight.
Compose review shows no PGSERVICE on the source. Corrected env reaches only the expected no-server socket error for psql/pg_dump/pg_dumpall (phone-libpq-env-corrected.log).
Python re-pinned a03050cc… in both manifests (PS1 unchanged), gates false. Fresh: Python33/33 (red first), transport11/11, bounded5/5 =49/49.

**Limit:** mocks hid this; this runner's real psql/dump/restore paths have never completed against a server, so more defects may remain.
Recommended next: owner-approved throwaway LOCAL Postgres rehearsal (synthetic data, no network, removed afterward) before spending another VPS approval.
Then new explicit approval for ONE VPS rehearsal. No migration/deploy/call. No commit/push; HEAD413f5a5.

## LATEST — ONE approved host diagnostic VERIFIED on the VPS; approval consumed; backup not retried

Owner replied "Yes, run it once" to the corrected -ApprovedHostDiagnostic request. Pins and false gates checked first; set diagnostic gate true for this
one attempt, ran once via the reviewed pwsh runtime, restored original manifest bytes in finally. Exit0. Receipt: status=verified, hostHandshakeVerified,
sourceIdentityUnchanged, databaseAccessed=false, resourcesCreated=false, sourceMutated=false, providerCalls=0, cleanupVerified=true.
Evidence: node_modules/.cache/phone-host-diagnostic-attempt.json and phone-host-diagnostic-cleanup.json (independent agent PID22096/temp directory check).
Proves host checks incl. the corrected timeout probe pass on the pilot. Supports, but does not strictly prove, BusyBox as the earlier failure's cause,
since no old-probe run returned a category. Database preflight/backup/restore remain UNVERIFIED and may reveal further issues.
Next: separate explicit approval for ONE -ApprovedBackupRestore rehearsal at current hashes. Reviewed `return` in `finally` (run cleanup): sets failed/cleanupVerified=false first, so it fails closed; only a Python3.14 style warning, no change. Migrations/deploy/calls stay gated.

## LATEST — probable backup-preflight cause found LOCALLY (BusyBox timeout); remote diagnostic still NOT run

New session (Claude) verified branch dev-thaara-continuation, HEAD413f5a5, 79 dirty paths preserved, pins matched, all gates false, no commit/push.
Local postgres:16-alpine has the SAME image ID as the pilot pin (sha256:721873c3…). Its timeout is BusyBox: `timeout --version` exits1 with stderr,
and the preflight required a GNU banner, so that step fails on this image every time. It is the first step past the host checks the earlier
preflight passed. PROBABLE, not proven on the VPS: consumed receipt holds only phase=preflight. Unfixed, the proposed diagnostic would just fail there.

Minimum correction: probe `timeout -k 1s 5s true` requiring exit0/empty output, same flag form as the source clients. Disposable local containers
(--rm, --pull never, --network none, no database started): probe0; 1s deadline143; TERM-ignoring child killed after grace137; child failure propagates;
psql/pg_dump/pg_dumpall/pg_restore/pg_isready present. Runner has no exit-124 dependency. Report: node_modules/.cache/phone-busybox-timeout-probe.log.
Python hash re-pinned to 560c11ec… in both manifests (PS1 unchanged), gates Boolean false. This does NOT renew any approval.
Fresh: Python31/31 (2 new; red first), transport11/11, bounded-process5/5 =47/47, default review-only passed. App files unchanged; suites not rerun.
Python3.14 locally warns `return` in `finally` at the end of run(); affects only that branch, not host_diagnostic; review before any backup retry.
Operator note: pwsh is not on the Claude session PATH; reviewed runtime path is in the diagnostic approval document.

No VPS/SSH/key/agent/provider/SQL/backup/migration/deploy/call this turn. Next: ONE explicit owner approval for the corrected -ApprovedHostDiagnostic.
Backup retry stays separately gated; database preflight/backup/restore remain unverified.

## LATEST — remote diagnostic NOT executed; explicit authorization still required

Owner said continue after local diagnostic package. Attempt to launch the scoped diagnostic was rejected by automatic approval review
BEFORE process creation: prior no-reconnect restriction was not clearly revoked by continue. No SSH/key/agent/remote command or gate change
executed. Local verification afterward: diagnostic and backup manifests both Boolean false, all current source hashes match, no new diagnostic
attempt receipt exists. Do not bypass or indirectly rerun. Ask explicit approval for ONE exact -ApprovedHostDiagnostic command in
integrations/phone/PHONE_BACKUP_DIAGNOSTIC_APPROVAL.md; database/backup restrictions stay in force. No new application tests needed/rerun.

## LATEST — LOCAL database-free diagnostic correction; no remote attempt authorized or made

Owner authorized only local investigation after the failed backup attempt. Confirmed root cause of missing details: Python returned category,
but PowerShell rebuilt the failed receipt with phase alone. Corrected to fixed category + static preflightStep, independently allowlisted in
both languages; unknown/error/private text never forwarded. Distinct missing command, permission, timeout, identity, resource and Docker metadata
categories. This does NOT establish the actual VPS failure cause; it remains unknown. No server fix/tool installation/SQL change proposed.

Prepared host_diagnostic branch shared with host checks only: source/image metadata, timeout --version, protected parent lstat, free disk/RAM,
identity recheck. Explicit return before Snapshot/database/dump/backup/fixture creation. Separate flag -ApprovedHostDiagnostic and manifest
PHONE_BACKUP_DIAGNOSTIC.review.json, gatefalse. Exact review/approval scope: integrations/phone/PHONE_BACKUP_DIAGNOSTIC_APPROVAL.md.
Backup gate remains false; executable hashes revised after LOCAL corrections, so old consumed backup approval cannot apply to current sources.
Original agent-only preflight helper/pins unchanged. Both modes conflict/refuse before authentication. SSH verification/agent/isolation/cleanup
safeguards preserved. No actual key/agent/VPS/Docker/SQL/provider use this turn; only synthetic local children/mocks.

Focused evidence: Python29/29; transport11/11; existing bounded-process5/5 =45/45; Python compile/default review-only passed.
Negative tests first reproduced lost-category/missing-mode failures. Sanitization, mocked failure paths, no-Snapshot host path, source identity
recheck, conflicting flags, pins and locked gates covered. Final read-only scoped security review: no consequential findings. Application files
unchanged this turn; historical app suites not rerun. Branch dev-thaara-continuation HEAD413f5a5, dirty work preserved, no commit/push;
vite.config.ts unchanged. Reports: node_modules/.cache/phone-backup-diagnostic-transport-tests.json and phone-backup-diagnostic-python-tests.log.

Next approval request: ONE metadata-only/database-free diagnostic via exact -ApprovedHostDiagnostic command in the linked document. Requires
new explicit owner approval, pins checked before auth, diagnostic gate resetfalse in finally, exact owned-agent/temp cleanup verification.
Do NOT retry -ApprovedBackupRestore. Even if host diagnostic passes, database preflight/backup/recovery remain unverified and require separate
approval. No production phone migration, deployment/live switch, credentials, provider request/call or integration change authorized.

## LATEST — ONE approved backup/restore attempt STOPPED in remote preflight; no retry

Owner explicitly approved the exact backup/isolated-restore package once. Before execution verified pinned command, both source SHA256s,
fixed protected destination/retention, source identity, container isolation and cleanup against the reviewed package. Branch413f5a5,
existing dirty work preserved. Set ONLY local remoteExecutionAllowed true, invoked exact reviewed pwsh command ONCE, restored original
manifest in finally. Exit1. Both executable hashes unchanged afterward; remote gate exact Boolean false. Approval CONSUMED.

Sanitized returned receipt: status=failed, phase=preflight, hostHandshakeVerified=true, sourceMutated=false, providerCalls=0,
restoreCleanupVerified=true, local cleanupVerified=true. Authentication used reviewed memory-only temporary agent and strict trusted-host pin.
No verified backup path/archive hash or restore container ID returned; backup, restore and schema/consistency verification NOT completed.
Runner preflight precedes dump/fixture creation; no restore container was reached. No database contents printed. No migrations/deployment,
service changes, provider request or real call. Existing integrations untouched. No repair, fallback or automatic retry.

Independent LOCAL cleanup: exact owned agentPID2664 absent; exact owned temp directory
thaara-phone-agent-6d8cc9c54dda47f29779b375d02d4ee5 absent; gate false. No remote cleanup follow-up or second SSH was attempted.
Evidence: node_modules/.cache/phone-backup-restore-attempt.json and phone-backup-restore-cleanup.json.

Diagnostic limitation: Python produces a sanitized category, but pinned transport forwards only failed phase, omitting category.
Exact remote preflight failure cause is UNKNOWN from retained receipt; do not speculate or claim DB metadata queries passed/not attempted.
No protected backup artifact was reported; intended retention remains >=7days plus separate disposal approval if any artifact exists.
Next requires separately scoped diagnostic review/approval; no retry or transport change authorized. Retain original pinned executables.
Phone calling stays disabled; successful recovery rehearsal, persistent110a/b/c, secrets, live-switch/deployment and controlled-call approval
remain outstanding. Prior35/35 local checks and application/PostgreSQL results are historical, unchanged evidence.

## LATEST — backup/isolated-restore package locally verified; execution awaiting approval

Branch `dev-thaara-continuation`, HEAD `413f5a5`; existing dirty work preserved, no commit/push. Prepared separate pinned
`scripts/phone-backup-restore.review.ps1` and `deploy/hostinger-pilot/phone-backup-restore.review.py` plus three local test files.
Exact scope/command/paths/budgets/retention: [ONE backup + isolated restore approval](integrations/phone/PHONE_BACKUP_RESTORE_EXECUTION_APPROVAL.md).
Both new and original preflight artifact hashes match their manifests; both remoteExecutionAllowed gates remain false. Original preflight
helper/payload unchanged. This turn used NO real key/agent/SSH/Docker/SQL/provider or account access.

Fresh verification: Python pure/mock22/22; transport8/8; synthetic bounded-child process5/5 = **35/35**. Python compile and default
review-only mode passed; git diff --check passed; apps/web/vite.config.ts unchanged. Security findings fixed: use immutable LOCAL image ID
(not registry digest syntax), bounded incremental output/async stdin, private files/fsync, final-server readiness, and in-container source-client
deadlines. Final narrow read-only security review found no consequential remaining issue. Reports under node_modules/.cache:
phone-backup-tests.log, phone-backup-transport-tests.json, phone-backup-stream-tests.json. App tests unchanged; reuse historical evidence below.

Proposed run reads only the fixed healthy pilot source, snapshot/dumps/counts; retains root-only private backup (role passwords excluded).
ONE new network=none/tmpfs-only restore fixture, pinned cached image/no pull, fresh temporary bootstrap; actual mount inspection precedes
restore SQL. Compare counts/schema/owners/ACLs/roles/database state and hashes; remove only exact owned fixture with destruction evidence.
No host ports/networks/volumes added; no source restore/mutations or phone migrations. Backup retained >=7days and until separate disposal approval.

Next: obtain ONE explicit scoped approval for exact command in the linked package, then verify pins, set local one-run gate true, run ONCE,
reset false in finally and independently verify auth/fixture cleanup. Failure means stop/no repair or automatic retry. No authorization inferred
for persistent110a/b/c, private secret creation, startup live-switch/deployment, provider requests or real call. Specific Sarvam workspace/key
permission and actual outbound behavior remain unverified; calling stays disabled. Do not repeat completed Sarvam owner setup confirmations.

## LATEST — ONE explicitly approved agent-only SSH host preflight SUCCEEDED; cleanup independently verified

Owner approved exact `pwsh -NoProfile -NonInteractive -File scripts/phone-agent-preflight.review.ps1 -ApprovedAgentOnlyPreflight` once,
with no database commands/writes/provider actions. Verified both artifact SHA256 entries before authentication and again afterward. Set only
local review gate true for this attempt, executed once, reset it to exact Boolean false in finally; no retry/repair. Process exit0.

**Authentication:** reused existing DPAPI-protected dedicated key through helper memory/stdin into its own temporary Git SSH agent; no plaintext
private-key file or credential/config/enrollment change. Existing public host record matched independently trusted ED25519 host pin
`SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`; actual SSH handshake verified under strict checking, no automatic trust/forwarding.

**Verified source:** container `thaara-v2-pilot-postgres-1`, immutable ID
`340a0ab86ef4156d87651433676978473f58c82b32e1fa4c279664261ace7893`; exact project/service labels passed; running/healthy and facts unchanged
on recheck. Image `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea` matches pinned cached image. Protected base path
root-owned0700/no unsafe components; proposed phone-backups child DOES NOT EXIST and was not created. Disk free55826136KiB (~53.24GiB),
MemAvailable4266764KiB (~4.07GiB), point-in-time only, not a resource reservation. No DB identity/size/version/schema query performed; those remain
unverified under the explicit no-database-command limit. No pg_dump/pg_restore/psql/docker exec or additional remote command.

**Cleanup:** helper receipt cleanupVerified=true. Independent readback confirmed owned agent PID22780 absent and owned temp directory
`thaara-phone-agent-1842a5a8701340128aee946c31b123ba` absent; local execution gate false; both hashes unchanged. No deletion/kill of existing
resources. Receipts: `node_modules/.cache/phone-agent-host-preflight-attempt.json`, `phone-agent-host-preflight-cleanup.json`.
No VPS files/services/Docker/images/networks/volumes/app settings changed by payload; no database command, backups/restores/migrations,
provider/campaign/real call, deployment/commit/push. Existing Gmail/Calendar/WhatsApp/n8n/Sarvam inbound preserved. Branch413f5a5, dirty work retained.

One-run approval consumed. Next safe local task: finish the combined backup/isolated-restore execution package pinned to these verified facts,
with its own explicit approval covering readonly DB metadata/snapshot/dump and ONE isolated restore fixture. No persistent source restore or
phone SQL/install/deployment/live switch/call implied. Sarvam endpoint/key permission and actual outbound acceptance remain unverified.

## LATEST — agent-only replacement IMPLEMENTED and locally tested; remote gate remains OFF

Owner requested continuing all steps toward live phone testing. Continued authorized local preparation; no real authentication/deploy/call inferred.
New `scripts/phone-agent-preflight.review.ps1` uses existing Git agent/ssh-add/ssh, per-run protected temp socket, memory-only DPAPI-to-stdin
key load only behind explicit approved remote gate, exact client fingerprint, strict trusted host pin/no forwards, owned PID/temp cleanup.
It has no plaintext private-key file path and no shared/global agent/service change. Actual key-load/remote branches remain UNEXECUTED.
New pinned `deploy/hostinger-pilot/phone-host-preflight.review.sh` has NO database commands/docker exec/mutations/provider traffic. Resolves fixed
source container once, checks immutable ID/project/service/pinned image/healthy status, no-follow root-owned path permissions, disk/RAM, final
identity equality. No backups or other infrastructure changes. `PHONE_AGENT_PREFLIGHT.review.json` pins both files; remoteExecutionAllowed=false.

**Fresh9/9 preparation tests passed**, including artifact tamper, conflicting modes, exact Boolean authorization and syntax. Test processes use
fake USERPROFILE, cannot open real credential files. Initial syntax/authorization-coercion failures were corrected and verified; final report
`phone-agent-preflight-tests.json`. Focused read-only security review passed after exact Boolean/nonempty/exact fingerprint hardening.
Actual EMPTY-agent smoke passed with NO key loaded/remote connection, saved public host record matched. Only local new agent/socket/known_hosts
created; helper cleanup passed. Independent check: PID3688 absent, temp dir `thaara-phone-agent-39fb520132cb42fcbd23461d6698deaf` absent.
Receipt `node_modules/.cache/phone-agent-empty-test.json`. No encrypted-key read/decrypt, key generation, actualSSH, VPS/Docker/database/SQL,
provider call, credentials/config/service/integration changes, deployment/commit/push or real call. Existing key/inbound untouched.

Next exact boundary: [agent-only auth + revised no-database host preflight approval](integrations/phone/PHONE_AGENT_PREFLIGHT_APPROVAL.md).
The previous command set included DB commands, which the conditional approval forbade, so no remote execution of this replacement inferred.
On explicit approval only: recheck pins, set only local review gate true for one attempt, execute exact helper flag, reset gate false in finally,
independently verify owned auth cleanup. No backup/live-phone permission. Then prepare backup/restore + launch review from actual verified facts.
Application live/test guards remain unchanged. Reuse earlier API803/803/web243/243/runtime19/19 and PostgreSQL8/8 as historical scoped evidence.

## LATEST — conditional SSH review: existing helper FOUND; prohibited disk-key path NOT executed

Owner conditional approval requires existing-helper inspection first, prefers a temporary agent, expressly forbids executing decrypted-key-file
paths, requires trusted host verification/cleanup, and forbids database commands. Found actual prior helper at
`node_modules/.cache/thaara-10816-control/remote.ps1`; inspected source only. Corrects earlier unavailable-helper assumption.
Exact mechanism: Import-Clixml existing private-key.clixml; SecureStringToBSTR/PtrToStringBSTR; WriteAllText of unencrypted
`session-<GUID>.pem` inside the existing credential directory; ssh `-i` that file; zero BSTR and Remove-Item in finally. No agent branch.
It uses strict host checks and a fingerprint-checked saved known_hosts, but does not have an agent-only route or payload-hash allowlist.
**Condition4 blocks execution of this helper** regardless of finally cleanup. Did NOT execute it, decrypt/open the encrypted key, create a key file,
start an agent, authenticate or run VPS/preflight/SQL commands. `scripts/new-thaara-vps-identity.ps1` is a generation script, NOT reused/executed.

Saved PUBLIC host record at `node_modules/.cache/thaara-10816-control/known_hosts` matches the independently recorded trusted host fingerprint
`SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`, host76.13.217.50, ED25519, ssh-keygen exit0. This verifies the saved record only,
NOT a live VPS handshake. Do not confuse it with the client key fingerprint in identity.json. No trust entries changed.
Cleanup evidence: no temporary auth files/agent were created by this run; credential-directory `session-*.pem` inventory is0, no cleanup/deletion
required or performed. Other services/integrations/credentials unchanged. Whitespace check passed; no commit/push/deploy/call.

Second scope blocker: earlier exact preflight includes psql metadata SQL and pg_dump/pg_restore version commands; newest approval says NO
database commands and condition9 forbids silently changing the command set. None ran. Next must resolve both: agent-only helper review/reuse
and an explicitly approved preflight without DB commands (or explicit permission for those exact read-only DB metadata commands). No new key,
credential changes or plaintext-on-disk fallback. If a disk-key mechanism is requested instead, it needs separate explicit approval under condition4.

## LATEST — approved read-only VPS preflight stopped at connection-route gate

Owner answered `okay continue` to the exact read-only VPS preflight request. Checked the Hostinger skill and available tools; no Hostinger
connector is exposed. Did not add/connect a server, log in, change settings or inspect account secrets. Local public/non-secret connection
metadata exists under the recorded dedicated credential directory: hostname srv1871828.hstgr.cloud, port22, enrolled DPAPI-protected key.
Only metadata property names and public connection fields were read; `private-key.clixml` was NOT opened or decrypted.

Windows OpenSSH binaries exist, but `ssh-add -l` reports no agent connection (exit2) and default `.ssh/known_hosts` is absent. No currently
usable direct agent-backed/pinned route established. Earlier handoff says sessions used a scratchpad helper that decrypted the existing key to
a temporary file and removed it. That helper is not available in this session; recreating its materialization behavior exceeds the preflight's
explicit no-private-key-read/create rule. The preflight also requires stop if the approved route is unavailable. Stopped BEFORE SSH/network
authentication: no VPS/Docker/database/SQL/path/resource commands, no new files/credentials/trust entries on VPS, no backup/restore or retries.

**Do not confuse fingerprints:** identity.json fingerprint is the CLIENT key fingerprint, not trusted server identity. The trusted HOST pin
recorded in the28Oct handoff is SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4. No new host key was observed/accepted this session.
Next genuine boundary: owner approval to reuse the existing protected key via a reviewed secure helper, allowing temporary current-user-only
key material and temporary host-pin file for authentication, strict host verification, cleanup in finally, no key regeneration/enrollment/global
agent/service/known_hosts change; then the SAME reviewed read-only preflight only. No owner secret/key upload or new key creation requested.
Exact exception scope appended to `PHONE_BACKUP_RESTORE_APPROVAL_2026-10-31.md`. Backup/restore execution remains separately gated.

## LATEST — telephony eligibility confirmed; Instant Outbound contract reviewed; backup preflight request ready

Owner confirmed existing healthy Vobiz managed connection/number ending9780, deployment `inbound_outbound`, bound to Thaara AI Voice Assistant
committed version2. No telephony setup/change needed. Recorded as owner-confirmed in the non-secret review profile; reviewOnly=true,
liveCallingEnabled=false and duration verification/runtime registration gates remain unchanged. Five-minute cap/prepaid balance confirmations stand.

Reviewed official Instant Outbound create/completion docs plus API-key/policy docs (public pages only). Existing adapter matches fixed endpoint,
workspace-key header, agent/version/connection/caller, call_purpose/recipient user_name, AI/language overrides, attempt_id acknowledgement and
after-attempt webhook states/recipient en_text correlation. No campaign/cohort replacement, code change or provider request. Detailed review:
`integrations/phone/SARVAM_INSTANT_OUTBOUND_CONTRACT_REVIEW_2026-10-31.md`. **Workspace/key permission for this specific endpoint still not proven**:
documentation requires a workspace key but does not attest the current key/plan/ACL. Owner telephony confirmation is not endpoint authorization.
Do not send a POST just to check permissions; it places a call. Keep live disabled and existing approval/audit/no-redial/budget controls intact.

Prepared `integrations/phone/PHONE_BACKUP_RESTORE_APPROVAL_2026-10-31.md`. Local publishers identify source container/project/database/image,
but live immutable ID, resource headroom and protected path facts are unverified. Next exact approval request is ONE read-only VPS metadata
preflight only (existing pinned SSH; fixed source labels/image, ID-bound exec, readonly DB name/version/size, no-follow path metadata, RAM/disk).
No dumps, new directories, containers/networks, passwords/env reads, migration/restore or service change in that scope. Fresh live facts will
allow one concrete combined backup+isolated-restore approval package without guessed IDs/resources. Subsequent backup plan requires consistent
snapshot counts, no-role-password globals and new network-disabled tmpfs restore fixture; no source restore/downgrade/pruning. No command executed.

Focused read-only safety review flagged mutable-name exec and path probing before no-follow checks; both corrected in the request before approval.
No executable source changes; reuse historical API803/803, web243/243, runtime19/19, and disposable PostgreSQL8/8 with their original scopes.
No VPS/Docker/SQL/account API/credentials/deployment/commit/push/campaign/call. Public docs GET only. Branch dev-thaara-continuation/HEAD413f5a5,
dirty work preserved. Next: seek exact read-only preflight approval, not backup/restore execution approval or another phone test.

## LATEST — complete API/web coverage verified; outbound eligibility still pending

**Fresh current coverage:** API **803/803 unique tests across72 files**,0 failed/skipped after reconciliation; web **243/243 across21 files**.
The initial full API command exited1 with788passed/1failed across71 files. Its single failure was the local WebSocket upgrade-header test
(`phone-sarvam.test.ts`) under restricted localhost networking. Focused repeat in the same restrictions reproduced12passed/1failed.
The unchanged entire file passed **13/13** with localhost access allowed; no speech/transport/test weakening or provider call was needed.
Runtime hardening's original/new files passed **19/19** after the source change. Retained unchanged passing files, replaced those full-file reports,
and compared the union to the complete72-file inventory: no omissions/extras. **803 is the deduplicated current-source total, not a single green
monolithic command and not a sum of overlapping suites.** Original failing report retained for truthful evidence.
Evidence: `node_modules/.cache/phone-resume-20261031-api-complete.json` records method/provenance; `*-api.json`, `*-runtime-green.json`,
`*-speech-loopback.json`, `*-web.json` and `*-api-inventory.json` hold the source reports. External runtime/integration tests excluded;
historical8/8 disposable PostgreSQL acceptance was not repeated. API build, API/web typechecks and whitespace check passed; vite.config.ts unchanged.

**Changes:** tightened only the unwired `phone-sarvam-runtime.ts`, added14 synthetic permission/callback regressions; recovery/calling docs corrected.
No startup wiring or buildApp live/test guard change. Private metadata unknown=null is refused, not bypassed; verified0400/0600 only; local/IP
callback hosts rejected without network lookup. Defaults remain5 calls/24h and5-minute cap. Focused read-only review found no consequential issue.

**Owner status:** five-minute committed-v2 cap and prepaid balance confirmed31Oct; outbound permission unknown. Recorded as owner-reported,
not independently verified or written into a ready runtime profile. Existing review profile unchanged, reviewOnly=true/liveCallingEnabled=false.
Owner action is only to inspect existing Phone Numbers9780 and obtain read-only Sarvam support confirmation if eligibility is unclear. No campaigns,
test dials, new agent/number/credentials or changes to inbound. After confirmation prepare ONE exact backup/isolated-restore approval request;
do not execute it or access the VPS without approval. Updated recovery plan rejects nonexistent110c rollback/automatic downgrade and requires
no-role-password globals, snapshot-consistent count evidence and isolated restore with no existing volume/network attachment or published port.

No Docker/database/SQL/provider API access, production/VPS/integration changes, credentials, deploy/restart/commit/push or real call.
Branch dev-thaara-continuation/HEAD413f5a5; all Claude/pre-existing dirty work preserved. Gmail/Calendar/WhatsApp/n8n/Sarvam inbound preserved.

## Earlier in this session — initial resume and verification in progress

- Branch `dev-thaara-continuation`, HEAD `413f5a5`; large pre-existing phone dirty tree preserved. Daily-call defaults remain5, maximum20;
  five-minute profile and recipient variable mapping retained. `buildApp` non-test liveCalling/reportVoice guard unchanged; loader NOT wired.
- Read Claude's latest entries, runtime/recovery plan, go-live package, calling guide, review-only profile and task110. No newer dated handover existed.
- Owner reconfirmed two checks: five-minute committed-v2 cap and prepaid balance. Outbound eligibility remains unknown. The campaigns-page
  screenshot is not permission evidence. Existing agent/number/inbound are preserved; no repeated agent/number/key creation requested.
- Local security regressions reproduced: unknown/NaN/zero/owner-executable secret modes admitted; IP/local callback aliases admitted.
  `phone-sarvam-runtime.ts` now refuses unknown/invalid modes before secret reads (verified0400/0600 only, Stat file modes supported), including
  secret re-read/rotation; callback origins require HTTPS DNS-name syntax, no IP literal/local/single-label host, with no DNS lookup.
  This does not establish public resolution/TLS: actual deployment checks remain pending. No real credential files read.
- New `apps/api/test/phone-sarvam-runtime-security.test.ts`:14 synthetic cases. Red run6passed/8failed confirmed the validation gaps;
  after correction original+new runtime tests **19/19 passed** (`phone-resume-20261031-runtime-green.json`). Focused read-only code review:
  no consequential findings. Imports of this unwired module are confined to these two test files.
- Fresh **web243/243,21files**, API+web typechecks passed. **Full API regression is still pending:** exact command
  `pnpm exec vitest run apps/api --exclude "**/*.runtime.test.ts" --exclude "**/*.integration.test.ts" --reporter=json --outputFile=node_modules/.cache/phone-resume-20261031-api.json`.
  Output redirected to corresponding `.log`; no final JSON yet at this checkpoint. Do not claim full API success. Current file inventory72
  (includes the new security test added after the broad run began); reconcile per-file coverage with fresh runtime19 before final reporting.
- Corrected recovery documentation: no110c rollback exists; no automatic downgrade/DROP CASCADE, forward repair and separate authorization.
  Backup planning must avoid role passwords in globals and use consistent-snapshot counts, not later live counts; isolated restore attaches no
  existing volume or network and must not publish a port. Exact backup commands/paths await outbound confirmation and scoped approval.
- Official Sarvam docs checked read-only31Oct: Phone Numbers management and Instant Outbound API; no account-specific outbound toggle assumed.
  Updated `SARVAM_CALLING.md` owner instructions: inspect existing number ending9780; if eligibility not shown, ask Sarvam support for read-only
  confirmation of Instant Outbound on existing connection/v2, with no config change/campaign/call. Never request secrets in chat.
- No VPS, Docker, external database, SQL, provider API, deployment, real call, credential change, commit or push. No n8n/WhatsApp/Gmail/Calendar
  or active Sarvam inbound change. Historical PostgreSQL8/8 acceptance reused as historical only; no new fixture approval requested or run.

Next: finish full API verification, reconcile complete file coverage, save exact results; then await outbound account confirmation before one
concrete backup/isolated-restore approval package. No startup activation/live-switch removal or provider verification without separate scope.

## 31 Oct (Claude) — Phone UI, three fixes, UI-update deploy mode (local only)

- Fixes: Chat call intent accepts greetings (hi/hii/hello/hey/hy/hyy) and "call for/to X and ask" as a top-level owner command only
  (`phone-calling-intent.ts`); `phone-api.ts` uses same origin. The contact krishna (…4634) was refused because it has no recorded consent.
  The Contacts page now shows "Needs your confirmation before calling", and saving the contact again records it. The server checks are unchanged.
- New `apps/web/src/PhonePages.tsx`:
  - Phone page: who / what to ask, Call and Cancel. Call resolves the contact (the owner chooses if several match), prepares the request in
    en-IN and shows the existing call card. One extra click on "Call <name> now" dials. Cancel only clears the form; a prepared request expires
    without dialing.
  - Contacts page: phone-style list with Call on each contact. "Save contact" and "Edit" open a pop-up with name, 10-digit number and one consent
    sentence. Consent is sent as recipient_verbal for 365 days.
  - Call history page: name, masked number, time (from `createdAt`), status and report, with Details.
  - Sidebar: a Phone dropdown with Contacts and Call history. Routes: `/integrations/phone/contacts` and `/integrations/phone/history`, also
    added to `pilot-start.mjs`. Old PhoneScreen / PhoneCallingPanel / PhoneContactsPanel are now unused.
- Deploy prep (review only, all gates false):
  - New publisher mode `--approved-phone-ui-update`. It expects running image `3e21eaef…`, loads the new archive
    `phone110-ui-image.tar.gz` (tag `thaara-v2-pilot-api:phone-110-ui`) and changes only the image. Environment and Sarvam mounts are kept.
    Rollback to `3e21eaef…` uses the existing checks.
  - Post-checks: the two new routes return 200, and the live webhook state is unchanged.
  - Live-on and live-off now accept either known phone build.
  - Runner flag `-ApprovedPhoneUiUpdate` with manifest `PHONE_UI_UPDATE_110.review.json`; all manifests re-pinned.
  - The archive and layer pins (`UI_ARCHIVE_SHA`, `UI_LAYERS_SHA`) are `pending_local_build`, so the mode refuses until the approved local
    build pins them.
- Fresh results:
  - web 264/264 (22 files), typechecks pass, web build passes
  - API 821/821 (standard command, runtime/integration excluded; `apps/api/node_modules/.cache/phone-ui-20261031-api.json`)
  - publisher 14/14, transport 20/20, pilot config 7/7, intent 25/25
- Not run: the local image build and the local image check (both need owner approval). No VPS, deploy, call, SQL or commit.
- MODEL_GATEWAY_NOT_CONFIGURED on the pilot Chat remains a separate open issue.

### 31 Oct (Claude) — UI update DEPLOYED (owner approval "Approve UI deploy", single use, consumed)

- Local build: `thaara-v2-pilot-api:phone-110-ui` = `sha256:a7f8a2107beb2696b4936aa5c05a37a59119bb003e89a9e399826f36dd762fc2`.
  - Archive `node_modules/.cache/phone110-ui-image.tar.gz`, SHA256 `83135d87…f917`; layers pin `10e6138a…2ac0`.
  - Pins are set in the publisher and the UI manifest; all manifests re-pinned.
  - Tests after pinning: publisher 14/14, transport 20/20.
- Local start check passed in all 4 modes (off / durable / live / unsafe), with no containers left and no secrets in logs. Synthetic data only, no VPS.
  - The first invocation used `python -I`, which failed to import the helper module before anything started (0 containers). It was then run once correctly.
- Pilot: one `-ApprovedPhoneUiUpdate` run, receipt `node_modules/.cache/phone-ui-update-110-attempt.json`.
  - status=verified, step=done; image `a7f8a210…`; rollback image `3e21eaef…`.
  - callingEnabled=true (live calling kept, 5/day); send state preserved; other services unchanged; Traefik access log off; providerCalls=0, callsPlaced=0.
  - The agent PID and temp directory were confirmed gone afterwards, and every manifest gate is false.
  - Public checks: `/integrations/phone`, `/contacts`, `/history` and health all return 200.
- Not verified: the new pages in a signed-in browser on the pilot. Still no real call. MODEL_GATEWAY_NOT_CONFIGURED is still open.
- Next: the owner opens Phone → Contacts on the pilot and saves or re-confirms their own number. Then one real test call needs a separate approval.

### 31 Oct (Claude) — Claude Chat connection built locally (owner chose Claude); not deployed

- Cause of "no reply": the pilot has no chat model (MODEL_GATEWAY_NOT_CONFIGURED). The pilot config deliberately refused model keys.
- New `apps/api/src/services/model-gateway-claude.ts`:
  - Uses the official Anthropic SDK, pinned to `@anthropic-ai/sdk` 0.135.0 (released 15 Oct).
  - Model `claude-opus-5-5` by default (`claude-sonnet-5-5` allowed), effort `low`, max 8192 output tokens, 1 retry, 60 s timeout.
  - Server-side refusal fallback (`fallbacks:"default"`).
  - Safe error codes: auth, rate limit, timeout, network, upstream, refused, output limit. The key never appears in output.
  - Uses the same governed system prompt and history builders, which were extracted from the OpenAI adapter with unchanged behaviour.
- Pilot key loader: off unless `THAARA_ANTHROPIC_API_KEY_FILE=/run/secrets/anthropic_api_key`. The key file must be a regular file, mode 0400 or 0600; a refusal leaves Chat not_configured and the API up.
- Pilot config: the key mount and its switch must come together, and the model is restricted to the reviewed list. `pilot-start.mjs` wires the gateway.
- Owner script `pilot-anthropic-key-entry.sh`: hidden prompt, no overwrite, readable only by the API user.
- Publisher modes:
  - `--approved-chat-model-deploy`: expects UI image `a7f8a210…`, loads `phone110-chat-image.tar.gz`, keeps Chat off and installs the entry script.
  - `--approved-chat-model-on` / `-off`: add or remove only the key mount and switch.
  - Runner flags `-ApprovedChatModelDeploy`, `-ApprovedChatModelOn`, `-ApprovedChatModelOff` with `CHAT_MODEL_*.review.json` manifests. All gates false; archive pins are `pending_local_build`.
- Fresh results:
  - API 821 → **839/839** (`apps/api/node_modules/.cache/chat-claude-20261031-api.json`), including Claude gateway 18/18
  - pilot config 8/8, transport 23/23, publisher 18/18, API typecheck clean
- Phone call failure (16:20): refused before ringing, state `failed`. The reason code is in `phone_calls.dispatch_code` on the pilot and has not been read yet.

### 31 Oct (Claude) — phone failure diagnostic, run 1 (owner approval "Run as shown", consumed)

- Priority correction from the owner: Claude Chat work stopped and was not deployed. The local Claude files remain uncommitted and unused.
- Read-only diagnostic: `deploy/hostinger-pilot/phone-call-diagnostic.review.py` + runner flag `-ApprovedPhoneCallDiagnostic` + `PHONE_CALL_DIAGNOSTIC.review.json`.
- Run 1 result:
  - status `failed`, category `unexpected_output`; hostHandshakeVerified=true.
  - databaseWrites=0, providerCalls=0, callsPlaced=0.
  - cleanupVerified=true; agent PID 22016 and temp directory confirmed gone; all gates false.
  - No dispatch_code was obtained. Not retried.
- Likely cause (not confirmed): `json_agg` emits multi-row output across several lines, and the payload required exactly one line. The owner made two attempts.
- Fix: parse the whole output; failure categories are now distinct (output_not_json / unexpected_shape / fields / call_value / event_value).
  - Tests: diagnostic 4/4, transport 24/24.
  - New pin: payload `bcb8dd31…`, runner `51494cd0…`.
- A second run needs new owner approval.

### 31 Oct (Claude) — phone failure diagnostic, run 2 (owner approval "Approve second run", consumed): ROOT CAUSE FOUND

- Receipt: status verified; readOnly; databaseWrites=0, providerCalls=0, callsPlaced=0. cleanupVerified=true; agent PID 29020 and temp directory confirmed gone.
- Two live calls, at 16:18:54 and 16:22:12 IST. Both: state `failed`, dispatchStatus `failed`, **dispatchCode `PHONE_DISPATCH_HTTP_401`**, no provider request id.
  - Event detail was lost in the runner's JSON output (depth 2). Fixed: the runner now uses `-Depth 6`. Transport tests rerun.
- Meaning: Sarvam's Instant Outbound endpoint returned 401 (authentication refused) for the key in `/opt/thaara-v2-pilot-private/secrets/sarvam_api_key`.
  - Thaara's header (`X-API-Key`), URL and ids match the reviewed contract.
  - The key is re-read on every call. So the runtime configuration was loaded, and Sarvam was reached, but it rejected the key.
- Not yet known which key problem it is: a non-Voice-Agents key (e.g. the TTS/STT subscription key), a key from another workspace, or a revoked key. Nobody inspects the key value.
- Smallest next action: the owner copies the workspace API key from Sarvam Voice Agents for the workspace that owns "Thaara AI Voice Assistant", then replaces the VPS key file.
  - Replace it **in place**, keeping the same inode, because Docker file-secret bind mounts pin the inode.
  - No code change is needed for the 401 itself.

### 31 Oct (Claude) — owner replaced the Sarvam key on the VPS (owner-run, in place)

- `pilot-sarvam-key-entry.sh` correctly refused to overwrite the existing key.
- The owner then ran the reviewed in-place block from `SARVAM_KEY_REPLACEMENT.md`.
  - Output: `Saved.` and `Same file, owner and mode: 4722754 UNKNOWN:UNKNOWN 400`. The inode and mode are unchanged.
  - `UNKNOWN` means uid/gid 1000 has no host account name. The numeric owner is still to be confirmed with `stat -c '%u:%g %a'` (expected `1000:1000 400`).
- No restart or deploy. The keyed comparison was not run. Next: one owner-approved test call.
- Two live attempts were used today (both 401), so at most 3 of the 5-per-24-hours limit remain.

### 31 Oct (Claude) — Sarvam 401 resolved at the key level (owner-run, read-only checks)

- The third live attempt (17:43:33 IST) also returned `PHONE_DISPATCH_HTTP_401`. The owner read this with a read-only psql query and pasted only the time, state, status and code.
- The read-only analytics GET with the saved key returned `{"detail":"Invalid API key format."}` (HTTP 401).
  - Key shape: 36 characters, clean.
  - The owner's dashboard showed both earlier keys as `sk_…` **Sarvam API** (speech/LLM platform) keys.
  - Sarvam's own dialog says: "Voice Agents API keys are separate from Sarvam API keys and aren't interchangeable".
- **Confirmed root cause:** the wrong credential type (a Sarvam API subscription key) was saved in place of a Voice Agents workspace key.
- Fix (owner-run): created a key in Voice Agents → Deploy with code and saved it in place (same inode 4722754, mode 400).
- Read-only analytics GET with the new key: **HTTP 422** (missing start/end datetime). Authentication passed for org `01a10103-1b5d…`, workspace `01a10103-1b66…` and the app.
- No code change. Next: one owner-approved test call. Two attempts remain in the 24-hour limit. Optional: the owner may revoke the unused `THAARA V2 PHONE` `sk_` key.

### 31 Oct (Claude) — first real call received; existing Chat/Google restore prepared locally

- The owner received the first real Thaara call (Sarvam). The report in Chat or the card is not yet verified by screenshot.
- The owner asked to restore the ORIGINAL Chat model and activate all features (no new provider).
- Audit:
  - The original Chat model is OpenAI `gpt-4.1-mini` (local `.env`).
  - The pilot startup check denies `OPENAI_API_KEY` and `GOOGLE_*` by design, which is the cause of `MODEL_GATEWAY_NOT_CONFIGURED` and of Gmail/Calendar not being connected.
  - WhatsApp health is unverified.
- Claude code removed. `model-gateway.ts`, `package.json` and `pnpm-lock.yaml` match HEAD.
- New `pilot-providers.ts` (existing adapters, key files), pilot-start/config wiring, owner scripts, and publisher modes chat-model-* / google-*.
- Tests: API 837/837, pilot config 8/8, publisher 19/19, transport 27/27.
- Plan: `docs/integrations/PILOT_ACTIVATION_PLAN_2026-10-31.md`.
- Known limitation: Google tokens are kept in memory, so the owner reconnects after every restart.

### 31 Oct (Claude) — activation steps 1+2 DONE (owner approval "APPROVED: PILOT ACTIVATION STEPS 1 AND 2", consumed)

- Step 1:
  - Local image `thaara-v2-pilot-api:phone-110-chat` = `sha256:38aab6e849a6295fa93d74d203468e10d4ccf2ed36bd71e3d5a5864aad09fb88`.
  - Archive SHA256 `474530e2…d800`; layers pin `ec2fa210…a199`.
  - Contains `pilot-providers.js` and the phone routes; no Claude dependency.
  - Local start check passed in all 4 modes, synthetic only, no containers left.
  - Publisher tests 19/19, transport 27/27.
- Step 2: `-ApprovedChatModelDeploy` ran once.
  - Result: status verified, step done.
  - Image `38aab6e8…`; rollback image `a7f8a210…`.
  - chatEnabled=false, googleEnabled=false, callingEnabled=true.
  - Send state preserved, other services unchanged, Traefik access log off, providerCalls=0, callsPlaced=0.
  - The owner scripts `pilot-openai-key-entry.sh` and `pilot-google-entry.sh` were installed in `/opt/thaara-v2-pilot/`.
- Cleanup: agent PID 10924 and the temp directory confirmed gone; all gates false.
- Public pages: health, /chat, /integrations/phone(+contacts, history), gmail, calendar and whatsapp all return 200.
- Next: the owner saves the OpenAI key with the script, then `-ApprovedChatModelOn` (separate approval).

### 2 Nov (Claude) — Chat model switched on (owner approval "approve chat on", consumed)

- The owner saved the OpenAI key with `pilot-openai-key-entry.sh`. Output: saved privately, no restart.
- `-ApprovedChatModelOn` ran once.
  - Result: status verified, step done, chatEnabled=true, callingEnabled=true.
  - Send state preserved, other services unchanged, Traefik access log off, providerCalls=0, callsPlaced=0.
  - Image unchanged at `38aab6e8…`.
- Cleanup verified (agent PID 24204 gone, temp directory gone); all gates false.
- Not verified yet: a real Chat reply. The owner tests "hi" on the pilot. A `MODEL_AUTH_ERROR` or `MODEL_QUOTA_EXCEEDED` would mean an OpenAI key or credit problem.
