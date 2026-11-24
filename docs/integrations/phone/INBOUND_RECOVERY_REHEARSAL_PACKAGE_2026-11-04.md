# Inbound recovery and restore-clone schema rehearsal — proposal

**Not ready for execution approval. Independent security review is pending.**

The new wrapper enforces `independentReviewComplete:false` from its pinned manifest and refuses the
execution flag before loading a key, starting an agent or creating a used marker. Do not flip this bit
to bypass review. Review completion must produce a new final pin and an exact owner approval request.
No executable command is being offered for approval by this proposal.

## Prepared locally

- `scripts/phone-inbound-recovery-rehearsal.review.ps1`: dedicated mode, no unrelated deployment or
  migration flags; default review-only; existing encrypted-key temporary-agent/trusted-host mechanism;
  source/artifact hashes, explicit approval pin, exclusive one-use marker and owned authentication cleanup.
- `deploy/hostinger-pilot/phone-inbound-recovery-rehearsal.review.py`: extracts only the SHA-pinned
  backup/restore core before its persistent-migration entry points; no source migration function loaded.
  Adds a new clone-only112h/113h hook and catalog capture. The old helper is unchanged.
- `PHONE_INBOUND_RECOVERY_REHEARSAL_V1.review.json`: review snapshot, execution held for independent
  review, source database read-only. Old approvals/manifests/markers remain consumed and untouched.
- Python mock and PowerShell review/syntax tests. No new runtime SQL, Docker, SSH or credentials used.

## Proposed exact operation scope for later review

One SSH connection through the previously trusted host fingerprint, existing encrypted dedicated key
loaded only into a new protected temporary agent. No plaintext key file, forwarding or trust changes.
Run reviewed Python through stdin with bytecode writes disabled. No uploaded executable or service change.

Resolve only the existing `thaara-v2-pilot-postgres-1` name to an immutable ID; require exact project/service,
healthy state, cached reviewed image and final identity rechecks. Do not reuse the old31Oct container ID
without verification. All Docker calls use the fixed local Unix socket and isolated process configuration.

Read the source only through bounded local-socket clients with clean environments, no password prompt,
implicit pass/service files or ambient connection overrides. Source clients always receive read-only
defaults and pg_catalog-only search path. Keep the reviewed consistent exported-snapshot backup/count
comparison. Validate the source version/size/schema capabilities, root-owned protected paths, disk and
memory budgets before creating files. Unknown conditions stop, never repair permissions or settings.

Create one NEW protected0700 backup folder:
`/opt/thaara-v2-pilot-private/phone-backups/phone113-rehearsal-<UTC>-<run nonce>`.
Retain custom database archive, schema/globals without role passwords, private snapshot metadata,
checksums and proofs there, files0600. **Backups contain private pilot data and authentication records.**
They remain on the VPS; no contents/rows/tokens copied into chat or this computer. Existing backups
are not overwritten or deleted. Retention: at least7days and until separately approved disposal.

Create at most one NEW uniquely named/labelled restore container from the cached image, no image pull.
Use network=none, no published port, no host directory/bind/volume/Docker-socket attachment, read-only
root and verified actual tmpfs mounts. Preserve existing CPU/memory/PID/shm/no-new-privileges limits.
Fresh temporary bootstrap credentials only. Existing source containers, roles and credentials unchanged.

Restore only into that new clone. Verify consistent row counts, source/restored schema, owners, ACLs,
roles and database state using the existing reviewed comparisons. Unexpected differences fail closed.
Do not loosen canonicalization or adopt unknown objects. Source identity and archive integrity are
rechecked around the clone work.

Only after full clone identity/isolation and restore proof:

1. Revalidate the owned clone, reject any source ID as a mutation target, and verify exact112h bytes.
2. Apply112h ONLY to the clone. Capture the full journal catalog, including types/defaults/collations,
   nullability/identity, constraints, valid indexes, owner, forced RLS, policies and decoded ACLs.
3. Verify113h bytes and apply ONLY to the same clone. Check restricted NOLOGIN roles, no memberships,
   definer ownership, function execute ACLs, denied schema CREATE and minimal principal/column access.
4. Capture complete journal/principal catalogs plus new function definitions/owners/ACLs and role flags.
   Canonical fingerprints use names, not installation-specific OIDs. Reject unexpected/broader journal
   grants. Catalog checks are not replaced by a model judgment or by matching table names.
5. Verify existing restored table counts unchanged and the two new tables empty. Persist private catalog
   JSON, canonical hashes, exact SQL and their file checksums in the new backup folder.
6. Remove only the verified owned clone. Independently verify absence and its destroy event. Preserve
   the backup/proofs. Close the exact new SSH agent and remove only its verified temporary files.

No persistent source SQL, LOGIN/secret provisioning, source permission change, deployment, provider
configuration, Sarvam/n8n/WhatsApp/Gmail/Calendar action, call, message, appointment, commit or push.
No automatic retry or source repair. Stop on failure; report phase/category, retained backup and any
unverified cleanup. Missing receipts are not evidence of successful cleanup.

## Evidence and limitations

Local Python tests mock every subprocess; wrapper tests use a synthetic credential-profile location and
never authenticate. They validate checksum/scope rejection, fixed endpoints, clean client environments,
source read-only enforcement, source-ID mutation denial, catalog normalization/ACL rejection, syntax,
review-only defaults, missing/bad pins and the review gate. No Linux-root/actual-mount/SIGALRM, streaming
restore, PostgreSQL catalog SQL or combined end-to-end runtime success is claimed for this NEW pipeline.
Historical successful backup core and both9/9 Phone database results remain separate evidence.

Independent reviewer credits were exhausted on the preceding safety-kernel review. That review and
this new combined pipeline both need independent review before execution admission. No repeat reviewer
request or paid service was started. The new manifest deliberately remains blocked.

Reviewers must verify: extraction/hook boundaries; read-only source targets; isolated clone/cleanup;
credential and private-backup handling; full catalog and ACL query correctness; cross-instance canonical
stability; timeout/termination behavior; and failure/partial-backup reporting. Determine and approve any
needed fully isolated synthetic runtime validation before touching the real source backup.

## Next boundary

Complete independent review, resolve findings, verify local checks and finalize all artifact pins.
Then prepare ONE exact combined execution request covering encrypted-key use, protected source backup,
new restore clone, clone-only schema SQL, retention and verified cleanup. A success would provide recovery
and catalog-baseline evidence; it would not authorize persistent installation or runtime deployment.
