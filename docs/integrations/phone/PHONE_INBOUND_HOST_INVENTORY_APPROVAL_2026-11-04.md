# Phone inbound — one read-only hosted inventory approval

Status: CONSUMED — one explicitly approved inspection completed successfully.

Manifest and four artifact pins verified; trusted-host handshake and memory-only key authentication
passed. One read-only catalog query confirmed expected PostgreSQL16/base schema and absence of the
expected inbound objects/roles. No remote writes or retry. Helper and independent local checks verified
owned agent/temp removal. Evidence/result: `PHONE_INBOUND_HOST_INVENTORY_RESULT_2026-11-04.md`.
Do not reuse this approval or reset its one-use marker. Original reviewed scope follows.

## Exact approval requested

Approve ONE SSH connection to the existing pilot using the existing encrypted dedicated key, its
reviewed temporary-agent mechanism and trusted host fingerprint. Permit only fixed Docker metadata
and one read-only PostgreSQL catalog transaction described below, followed by verified local auth cleanup.
Use the development tool's separately reviewed access permission if required. No automatic retry.

Exact command:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-inbound-host-inventory.review.ps1 -ApprovedInboundInventory -ManifestSha256 1417eb943fc8d1d2525bcd6b3a4b495c9100722a44c48f82b801d38982e05d53
```

Manifest `PHONE_INBOUND_HOST_INVENTORY_V1.review.json` pins four artifacts (wrapper, payload, two test
files). Its exact SHA256 above and all artifact hashes are verified before authentication. Stop on mismatch.
No old approval, gate, secret or used marker is changed. New exclusive local marker prevents repeat use.

## Authentication and ownership

Reuse the existing encrypted key only; no generation, enrollment, replacement or plaintext private-key
file. Decode in memory, pass through stdin to a NEW empty temporary agent, TTL120seconds, verify expected
key fingerprint. Existing protected key-directory/file checks remain. Managed-memory forensic erasure
is not claimed. Never print key values or raw process errors.

Strict SSH host checking against the previously trusted ED25519 fingerprint
`SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`. Temporary protected known_hosts contains only
that recorded public key. One connection attempt; no agent/port forwarding or trust/config updates.
Run reviewed payload via `python3 -B -` stdin (no uploaded script or bytecode cache).

## Exact remote read scope

All Docker operations use `/usr/bin/docker --host unix:///var/run/docker.sock` in a clean environment,
with Docker configuration disabled. No inherited remote Docker context or credential configuration.

1. Inspect only `thaara-v2-pilot-postgres-1` to obtain immutable ID.
2. Inspect the fixed reviewed cached PostgreSQL image identity. No image pull.
3. Inspect that immutable container's image, running/healthy state, restart count and exact existing
   compose project/service labels (`thaara-v2-pilot`/`postgres`). Fail closed on mismatch.
4. Execute ONLY the fixed PostgreSQL client in this verified container, with an empty environment:
   `/usr/bin/env -i` plus explicit PATH/HOME, null password/service files and five-second connection timeout;
   `/usr/local/bin/psql -X -w -q -A -t -h /var/run/postgresql -p 5432 -U postgres -d thaara_vps_pilot -v ON_ERROR_STOP=1`.
   Fixed local Unix socket; no network database, password prompt or implicit credential/service file.
5. Re-inspect the same immutable container facts after the query; reject identity/state drift.

The sole SQL input is `CATALOG_SQL` in the pinned payload: BEGIN READ ONLY; transaction-local
search_path=pg_catalog, lock_timeout3s, statement_timeout5s; one JSON-producing SELECT; COMMIT.
No persistent settings changes. No application rows, user IDs, tokens, provider secrets, environment
files or database contents read. Normal read locks/connection logging may occur; no service restart.

## Expected result

Only booleans: source healthy, image matched, catalog read-only, exact target database/PostgreSQL16/base
schema confirmed; presence of inbound journal/principal table, ingest/guard roles and three known Phone
functions. Presence is inventory, NOT approval to adopt/overwrite an existing object or readiness proof.
No names/IDs/rows/raw stderr/secret values in the receipt. Failure returns finite local phase and,
where available, remote phase/kind only. Stop at the first error; no retry, repair or fallback.

This does NOT verify actual tenant ownership, TLS/managed hosting compliance, secret storage, complete
grants/RLS semantics, runtime configuration or Sarvam eligibility. Those remain separately established
gates; do not infer them from catalog presence or from the historical9/9 synthetic acceptance.

## Cleanup and retained evidence

Terminate only the newly created agent PID. Remove only its verified owned protected temp directory,
known_hosts and socket. Preserve all existing agents/keys/files. Independently confirm that exact PID
and temp path are absent; no generic process-name kill or prefix-based deletion. Report cleanup failure.

New LOCAL retained files only:
`node_modules/.cache/phone-inbound-host-inventory-v1.used.json` and `.result.json`.
Never reset/delete them. Existing remote files, databases, containers, networks and volumes unchanged.

Excluded: migrations/DDL, database rows or permission changes, backups/restores, secret/credential changes,
config edits, services/restarts, live Sarvam v5/v6/provider requests, calls/messages/appointments, deployment,
WhatsApp/n8n/Gmail/Calendar changes, Git commits/pushes. Stop and report after this single inspection.

## Local evidence

Eight Python mock tests PASS; four wrapper checks PASS (syntax, review-only, missing/bad pin rejection,
trusted auth safeguards). Wrapper tests use a synthetic credential-profile location and do not load a key
or start an agent. Payload tests fake every subprocess and execute no SQL. Default review mode verified.
Receipt `node_modules/.cache/phone-inbound-host-inventory-local-20261104.json`; whitespace PASS.
Independent security review blockers resolved: fixed local Docker endpoint, isolated libpq/socket and
catalog-only search path. All final artifacts repinned; new used marker absent.

Simple owner approval wording: “I approve one SSH read-only hosted inventory, including the fixed
read-only catalog query, existing encrypted-key authentication, reviewed access and verified cleanup.”
