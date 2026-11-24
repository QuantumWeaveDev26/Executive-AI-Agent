# Inbound production and PostgreSQL review baseline — 4 November 2026

REVIEW ONLY. This is not a database execution approval, live connection package or completed runtime runner.
Source integrity cannot establish provider readiness or authorize an external action.

## Existing evidence and boundaries

Raw-payload service composition, dedicated grant/policy/audit transaction and local ingress are test-only.
Latest focused83/83PASS; historical embedded SQL11310/10PASS. No combined multi-connection PostgreSQL or
process-restart proof exists. No production constructors may be enabled from these results.
The older phone110 runner/inspector binds fixed110resource names, port and ownership labels. Leave it and all
consumed approval manifests/markers intact. Do not point it at inbound SQL or transform metadata to pass it.

## Proposed isolated validation environment (not authorized)

- One new disposable PostgreSQL16 container, immutable reviewed image digest, one new internal network.
- Proposed names `thaara-phone113-postgres-review` / `thaara-phone113-network-review`, database
  `thaara_phone113_review`, only `127.0.0.1:15436`. Refuse existing names or occupied port; never reuse/remove them.
- Fresh random administrator and restricted ingest-role test credentials; no environment-derived connection URL,
  existing secret or provider key. Keep credentials in memory, not commands/logs/artifacts.
- Read-only root, no bind mounts/volumes, verified distinct tmpfs data512MiB/runtime16MiB/tmp32MiB with nosuid,
  noexec and exact mountinfo type/source/destination/read-write properties. Inspect actual mounts, not flags alone.
- Verify exact created IDs, image, labels, port, internal-only network membership, privilege/capability/resource
  limits and permissions BEFORE SQL. Reject ambiguity. No existing Docker resource may be attached or changed.
- Apply only exact12base migrations, reviewed112then113 and separately reviewed fixture role/identity provisioning.
  SQL111 is not needed by this journal path. Do not apply phone110 or discover extra SQL automatically.
- Real separate administrator, owner and restricted service connections; no session-role multiplexing from the
  embedded fixture. Service identity must satisfy the existing adapter's exact current/session role checks.
- Stop at first unexpected failure, no repair/retry. Cleanup only verified IDs/labels from this run; retain
  sanitized receipts and independent container/network/port removal evidence. Never delete volumes or old markers.

## Required runtime acceptance suite (to implement and review before approval)

1. Authenticated raw callback/completion through the actual restricted pool, same transaction and saved receipt.
2. Parallel identical deliveries create one phase row/audit; conflicting digest rejected, no automatic retry.
3. Concurrent phases/withdrawal reconcile without revival; caller/deployment/version/tenant binding preserved.
4. Owner reads allowed; foreign workspace/owner/member denied; direct service table access/escalation denied.
5. Concurrent revocation/expiry/membership changes serialize against admission; revoked work cannot confirm.
6. Transactional audit failure rolls back report; failed/uncertain commit produces no saved receipt.
7. Missing caller, interrupted calls and first-turn withdrawal stay truthful; no forged booking or raw media.
8. Close/reopen real service pool and verify persistence/replay; separately test PostgreSQL process restart if
   included in final reviewed runner. A container restart destroys tmpfs and is not persistent-storage proof.
9. Route rate/concurrency refusal cannot invoke SQL/provider work or return a successful confirmation.

The runner, complete concurrency assertions, fixture role provisioning, timeout/cleanup tests and exact shell
command are NOT READY. This document deliberately supplies no infrastructure command to approve prematurely.
Next authorized local work: implement/review them, pin their final bytes and present one exact execution request.

## Production admission package (separate later approvals)

Require managed/TLS database and secret storage per AGENTS.md; document any pilot exception explicitly rather
than silently treating temporary/private files as production compliance. Verify backup/isolated recovery before
persistent changes. Review additive112/113install and rollback/disable-only behavior; no schema downgrade.
Provision a distinct expiring/revocable inbound credential/principal, never owner cookies or WhatsApp relay keys.
Pin canonical tenant/owner/agent-version/deployment/number/policy and grant revision. Shared replica-aware ingress,
body/connection/time limits, disabled sensitive request logging and owner-only feed/session/RLS admission are gates.

Sarvam live inbound v5 stays unchanged. Independently verify supported tool/event auth, trusted direction and
interaction metadata, actual caller consent, five-minute enforcement and save-acknowledgement handling before
configuring any live callback tool. Never confirm a callback before commit. Callback is not a booked appointment;
Calendar/media retention remain disabled until their own verified integration/privacy gates pass.
Deploy and perform one controlled owner-made inbound test only after separately scoped approvals. Preserve
outboundv6, all approval/no-redial/cost safeguards, Chat/Gmail/Calendar/WhatsApp/n8n and existing data.

## Safe local commands

`node scripts/phone-inbound-release-preflight.mjs --verify-review-only`

This reads only the pinned local review files and SQL filenames, verifies hashes/exact sets and always reports
executionAllowed:false and productionReady:false. It does not import a database, spawn a process, contact Docker,
SSH or a provider, read environment credentials, set/reset execution gates or consume any prior authorization.
Manifest preparation uses --prepare-review once with exclusive creation; it refuses overwrite. Any later source
change invalidates this snapshot. Prepare a separately named review revision rather than rewriting consumed pins.
