# Phone110 — pilot backup/isolated restore approval preparation

Preparation only. Nothing executed. This document does not authorize remote access, backups, SQL or infrastructure.

Current executable package: [ONE backup + isolated restore approval](PHONE_BACKUP_RESTORE_EXECUTION_APPROVAL.md).
Prepared and locally verified35/35; remote gate false. Older preparation details below are historical; no backup rehearsal has run.

## Latest source preflight outcome — verified, no backup/restore authorization

The separate agent-only host preflight was explicitly approved and executed once successfully. Trusted host handshake verified; source ID
`340a0ab86ef4156d87651433676978473f58c82b32e1fa4c279664261ace7893`, expected project/service and healthy status passed; pinned source image
`sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea` matched. Protected existing base is root-owned0700/no unsafe
components, phone-backups directory absent. Disk53.24GiB/RAM4.07GiB available at inspection. Source DB name/size/server version/schema/role facts
were NOT queried because all database commands were excluded. Auth cleanup/gate reset independently verified; one-run authorization consumed.
These facts can now pin the next combined backup/isolated-restore package. That package needs complete executable commands, resource/source
guards, snapshot-consistent manifests, artifact hashes and separate owner approval before any DB query/dump/new restore fixture. No such
execution or source restore/deployment/phone migration/call authorized yet. See latest31Oct handover for receipts; older blockers below are history.

Latest continuation: an agent-only replacement and no-database remote metadata payload are now prepared, with9/9 local tests and a successful
empty-agent/cleanup test (no real key/VPS). [Exact revised approval package](PHONE_AGENT_PREFLIGHT_APPROVAL.md). Its remote gate remains false;
the older disk-key helper and DB-command preflight below are historical and must not be executed under the newer restrictions.

## Latest conditional SSH review — STOPPED, no authentication

Existing helper located and inspected: `node_modules/.cache/thaara-10816-control/remote.ps1`. It imports the DPAPI CLIXML key, converts it to
plaintext in memory, writes `%USERPROFILE%/.codex/credentials/thaara-ai-v2-vps1871828/session-<GUID>.pem`, then runs `ssh -i <that-file>`.
Finally it zeroes its BSTR buffer and deletes that exact file. There is NO temporary-agent path. The newest approval's condition4 explicitly
prohibits executing this decrypted-file path; the helper was NOT executed or modified. Its presence corrects the earlier unavailable-helper note.

The helper's saved public known_hosts entry was checked locally and matches the trusted ED25519 HOST fingerprint
SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4 for76.13.217.50. No live handshake occurred. No encrypted-key read/decrypt, temp auth
file or agent creation; session-*.pem inventory0. No credentials exposed or changed; no cleanup needed because no auth resources were created.

Newest scope also forbids ALL database commands, whereas the previously reviewed preflight below includes psql metadata and database-tool version
commands. Condition9 forbids substituting a different command set silently. None ran. Resolve the command set explicitly before any remote run.
Preferred next path: prepare/review an agent-only helper reusing only the existing key, with no plaintext key file, and approve a reduced metadata
preflight without DB commands. Alternatively those exact readonly DB commands need explicit permission. Do not execute the old disk-key helper
without the separate exception demanded by condition4. Earlier temporary-disk-key proposal below remains UNAPPROVED and superseded by this condition.

## Connection gate outcome and next authentication approval

Owner approved the read-only preflight. No remote preflight command ran: local agent is unavailable and default known_hosts is absent.
The28Oct handoff records a DPAPI-to-temporary-file authentication helper; it is not available in this session. Protected key file untouched.
The scope below explicitly says "Do not create/read/display private keys" and stop if the existing approved route is unavailable, so no new
helper/materialization, host trust entry or alternate connection was attempted. The source database/path/resource facts remain unverified.

Requested exception, if owner approves: prepare/review a helper that reuses ONLY the existing DPAPI-protected dedicated key, never exposes its
contents, and permits a temporary current-user-only private-key file plus ephemeral host-pin file solely for this authentication. Compare server
identity to the trusted handoff HOST pin SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4; use strict host-key checking, no global trust update.
Never substitute identity.json's CLIENT-key fingerprint. Any pin/decryption/ACL failure stops before commands; no bypass or alternate key.
Use a fresh isolated local temp directory with exclusive file creation and protected ACLs; try/finally cleanup only these exact owned temp files,
verify removal, never overwrite/delete existing credential files. Temporary removal is not a forensic-erasure guarantee. No key generation,
rotation, enrollment, server credential write, SSH-agent/service change, private-key display/upload to chat or persistent plaintext key copy.
After authentication, execute only the already-reviewed read-only preflight commands below, then disconnect/clean up. No backup/restore,
container/network/directory creation on the VPS, SQL migration, deployment or provider call. This exception is NOT yet approved or executed.

## Known local targets; live facts still need verification

Existing checked-in pilot publishers identify VPS `srv1871828.hstgr.cloud`, project `thaara-v2-pilot`, source container
`thaara-v2-pilot-postgres-1`, database `thaara_vps_pilot`, administrative Unix-socket role `postgres`, PostgreSQL16 and image
`postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.
Those are **local deployment evidence, not fresh live observations**. Do not invent an immutable container ID, available RAM/disk,
current image or protected-path ownership. An exact backup/restore execution package cannot honestly pin those facts yet.

Proposed private backup base: `/opt/thaara-v2-pilot-private/phone-backups/`; new run child `phone110-<UTC>-<UUID>` only,0700 directory/0600 files.
Never overwrite/chmod an existing directory/file, follow a symlink, copy backups off the VPS, or print dump contents/role passwords/customer rows.

## NEXT EXACT APPROVAL REQUEST — read-only VPS preflight ONLY

Request permission for ONE read-only session to the existing VPS via the already configured, host-key-pinned SSH route. Do not create/read/display
private keys, change SSH/credentials, bypass host-key checks, install tools or open ports. No secret env file/full Docker config inspection.

Only these command families are in scope (fixed names, source database and explicit outputs below). Capture the ID once; require64 lowercase hex.
Before any exec, require project=`thaara-v2-pilot`, service=`postgres`, running=true/healthy, and source.Image equal to the cached reviewed image ID.
The only accepted source identity is that verified immutable ID. If any guard fails, stop without executing the remaining commands.

```sh
PG_ID="$(docker inspect --format '{{.Id}}' thaara-v2-pilot-postgres-1)"
docker inspect --format '{{.Id}} {{.Image}} {{.State.Running}} {{.State.Health.Status}} {{.RestartCount}} {{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}}' "$PG_ID"
docker image inspect --format '{{.Id}} {{json .RepoDigests}}' postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
```

After the identity/image guards pass (do not paste the two blocks together without those checks):

```sh
docker exec --user postgres "$PG_ID" pg_dump --version
docker exec --user postgres "$PG_ID" pg_restore --version
docker exec --user postgres "$PG_ID" psql -X -qAt -U postgres -d thaara_vps_pilot -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT json_build_object('database',current_database(),'version',current_setting('server_version_num')::int,'size_bytes',pg_database_size(current_database())); COMMIT;"
namei -n -l /opt/thaara-v2-pilot-private/phone-backups
```

Validate path components before disk probing: no symlink/non-directory components, all existing components root-owned with no group/other write;
existing private base must be0700 and root-owned. Missing final `phone-backups` is allowed and must not be created. Any other unsafe/missing component
or unknown metadata stops the preflight. Then only:

```sh
df -Pk /opt/thaara-v2-pilot-private
awk '/^MemAvailable:/ {print $2}' /proc/meminfo
docker inspect --format '{{.Id}} {{.Image}} {{.State.Running}} {{.State.Health.Status}} {{.RestartCount}}' "$PG_ID"
```

Require exact project/service labels, running/healthy source and PostgreSQL16; cached image must resolve to the reviewed digest. Report only
bounded non-secret metadata, immutable IDs, versions, disk/RAM totals and path existence/ownership/mode. Final identity/image/restart count must
match initial observations; a source restart/replacement is a failure, not something to repair. No roles/password hashes, env/config
values, customer data, table rows or SQL payload logging. `namei` may show a missing final backup directory; record it, do not create it.
If the approved SSH route, a required tool, source identity, digest, version, path component or other assumption is unavailable/mismatched,
stop and report; no alternate target, image pull, retry, repair, directory creation or expanded command scope.
The SELECT/transaction above is read-only metadata, not a migration. No pg_dump/pg_restore data operation is authorized by this preflight.

Approval expressly EXCLUDES: dump creation, restore container/network/volume creation, key/secret changes, source mutations, service restarts,
existing volume changes,110a/b/c installation, deployment, calls/provider HTTP requests, campaigns/cohorts, n8n/WhatsApp/Sarvam changes and commits/pushes.
No cleanup is needed because preflight creates no persistent resources. Close the SSH session and record the non-secret preflight evidence.

## Subsequent combined backup + isolated restore request (not yet executable/approved)

After preflight, pin exact source ID/image, protected resolved paths, source-size/resource bounds, executable artifact hashes and complete commands
into ONE further approval request. Include:

1. New protected run directory only; enough free disk/RAM and bounded runtime. Do not modify the source service or any existing path permissions.
2. Read-only consistent source snapshot and table inventory/count manifest, bounded lock/statement deadlines. Keep export transaction open only
   through backup/count capture, then close it; do not keep it open for restore verification. No later-live-count comparison while integrations write.
3. `pg_dump --format=custom --snapshot=<that_exported_snapshot>` on the exact source ID/database; `pg_dumpall --globals-only --no-role-passwords`;
   metadata/checksums/sizes only in reports. Role definitions, dumps and detailed inventories stay private; no existing login credentials copied.
4. ONE newly labelled owned restore container using the pinned cached PostgreSQL16 image, network=none, no published ports, no existing bind/volume,
   read-only root and separately verified tmpfs destinations. Fresh temporary restore-only credentials; bounded memory/CPU/storage. No image pull.
5. Restore required reviewed roles without passwords and full dump only into the new database; fail on any unexpected SQL/error. Do not install
   phone SQL in the shared pilot or edit the dump to make it pass. Full schema/data/owner/ACL restore checks and snapshot-consistent counts required;
   archive listing alone is not a restore rehearsal. Dump extensions/role capabilities must be reviewed against the isolated image before execution.
6. On failure stop, retain protected backup/evidence, no automatic retry/forward repair. No restore over the shared pilot and no phone downgrade.
7. Verify the new container's exact ID/run label before removing only it. Never prune/delete existing volumes or backup folders. Verify destruction,
   new container absence and no published port. Retain source backup privately under an explicitly approved retention period; do not auto-delete it.

This split is necessary because no remote source identity/path/resource preflight is authorized yet. It is not permission to execute a backup
based on guessed IDs or an untested recovery chain. All earlier disposable PostgreSQL approvals are consumed and do not cover customer-data backup.
