# Independent review handoff — Thaara Phone recovery package

## Your task

Continue the existing Thaara V2 Phone work as an INDEPENDENT SECURITY/CORRECTNESS REVIEWER.
Review the new recovery/restore-clone package and test-only install-sequence kernel. Do not rebuild
features, repeat completed diagnostics or activate anything. This handoff is not execution approval.

Workspace: `C:\ThaaraProjects\thaara-ai-agent-v2`.
Branch `dev-thaara-continuation`, HEAD `413f5a5`, large uncommitted Phone work. Verify status; preserve
everything. New review files are untracked. No reset/stash/clean/commit/push/merge/cherry-pick.
Antigravity owns `.agents/worktrees/whatsapp-templates`, branch `feat/whatsapp-templates`; leave it,
WhatsApp and shared application/auth/navigation/contracts unchanged.

## Targeted reading order

1. `AGENTS.md` and the current top entries of `docs/THAARA_DAILY_HANDOVER_2026-11-04.md`.
2. `docs/integrations/phone/INBOUND_RECOVERY_REHEARSAL_PACKAGE_2026-11-04.md`.
3. `docs/integrations/phone/INBOUND_INSTALL_SEQUENCE_AND_OWNER_PILOT_2026-11-04.md`.
4. The exact review files listed below. Read dependencies only where necessary.

Do not scan the full repository or reread old handovers. Private reasoning stays internal. Keep a short
evidence checklist, test only relevant paths and distinguish confirmed defects from questions.

## Exact code to review

- `scripts/phone-inbound-recovery-rehearsal.review.ps1`
- `deploy/hostinger-pilot/phone-inbound-recovery-rehearsal.review.py`
- `scripts/phone_inbound_recovery_rehearsal_test.py`
- `scripts/phone-inbound-recovery-rehearsal.test.ts`
- `scripts/phone-inbound-install-sequence.mjs`
- `scripts/phone-inbound-install-sequence.test.ts`
- `docs/integrations/phone/PHONE_INBOUND_RECOVERY_REHEARSAL_V1.review.json`

Dependencies: `deploy/hostinger-pilot/phone-backup-restore.review.py` (unchanged multipurpose legacy
helper; only its prefix before `def migration_inputs():` is embedded), unchanged112h/113h hosted SQL
under `docs/migrations/`, and existing agent-only authentication design. Do not invoke the legacy helper.

Current nine-artifact proposal manifest SHA256:
`f507e678dac8f25d4c3ca007519ac467c0a7c7ab5045692e9be4dffc2563b1db`.
All nine artifact hashes matched at handoff. This is a REVIEW SNAPSHOT, not permission or an execution pin.
`independentReviewComplete:false`; new used marker absent. Do not flip that flag during this review.
The earlier reviewer was unavailable because workspace credits were exhausted. No independent review
of this kernel/combined pipeline has completed; do not rely on earlier reviews of different artifacts.

## What is already verified

- Historical real PostgreSQL journal/service acceptance:9/9 PASS, owned cleanup verified.
- Historical hosted112h/113h gate acceptance:9/9 PASS, owned cleanup verified.
- Historical SSH inventory: expected pilot PostgreSQL16/base schema; inbound journal/principal tables,
  ingest/guard roles and three functions absent. Authentication cleanup independently verified.
- Historical31Oct source backup/isolated restore succeeded for the OLD core; its approval is consumed.
- New local preparation:21 Vitest checks PASS (4wrapper +11sequence +6hosted-review) and11 Python
  mock checks PASS. Whitespace check passed. No actual new backup/restore/catalog SQL/SSH operation.

Evidence: `node_modules/.cache/phone-inbound-recovery-preparation-20261104.json`;
`phone113-owned-relay-v2/result.json`; `phone113-hosted-gates-v1/result.json`;
`phone-inbound-host-inventory-v1.result.json` and `.cleanup.json` in the same cache root.
Preserve every consumed marker/result. Historical results do not validate the new combined pipeline.

## Intended package boundary

Future separately approved operation: one SSH session, existing encrypted key loaded only into a NEW
temporary agent, strict previously trusted host-key verification; a protected consistent READ-ONLY
source backup; restore into ONE NEW network-none/tmpfs/read-only-root container; apply112h/113h ONLY
inside that verified clone; capture canonical metadata and verify original table counts unchanged;
retain protected backup/proofs and remove only the owned clone and temporary authentication artifacts.

No persistent source DDL/DML/roles, no API/provider call, no source credential/config changes, deployment,
service restart, new live webhook, real call/message/appointment or Gmail/Calendar/WhatsApp/n8n change.
No plaintext private-key file. Database backups contain private data but must stay protected ON the VPS;
no raw data, credentials, dumps, environment values or stderr in reports. Do not read real credentials.

The payload compiles a hash-verified backup-only source prefix into a separate namespace, strips later
persistent migration entry points, interposes fixed local Docker/clean client execution, and adds a hook
after restore verification. The source ID is resolved from exact name/labels/image for that one run.
Every source client is read-only; clone DDL explicitly rejects the source ID. New files/retention are
proposed under a new phone113-rehearsal backup directory. Nothing has run.

## Review priorities

1. Prefix extraction, hash checks, execution-mode/review/one-use gates and absence of reachable legacy
   persistent-migration or deployment paths. Validate the source namespace/proxy behavior, not comments.
2. Exact source versus clone identity, actual mount/namespace/resource checks before SQL, and no
   inherited Docker/libpq endpoints, password/service files, options, configuration or credentials.
3. Source snapshot/count/dump consistency, read-only bounds, protected path ownership/symlinks,
   archive integrity, role-password exclusion and retained private-data handling.
4. Full clone-hook handoff and failure paths. Existing tests mostly validate components; add local
   mock coverage for the full hook if useful. Do not confuse a passing fake with a real restore.
5. PostgreSQL catalog query correctness and completeness. Canonical hashes must be stable across
   role/object OID changes, cover ownership/RLS/policies/ACLs/constraints/index validity, and reject
   broader permissions. Check actual SQL expressions/types/aggregation semantics carefully.
6. Source table-count preservation and final role/function/schema privilege checks; unexpected source
   defaults or existing-role memberships must not silently become an approved insecure baseline.
7. Deadlines, pipe/child termination, clone destruction proof, partial backup reporting and independent
   local auth cleanup. Missing receipts/unknown termination must never become success.
8. Kernel receipt provenance: same-run112, expected catalog,113 transaction-bound lock attestation,
   final privileges, fresh recovery proof and partial/uncertain commit states. It has NO real driver;
   confirm non-test refusal and identify remaining atomicity/bounded-driver requirements.

## Allowed verification — local/database-free only

Use focused reads, static analysis and mocks. These commands require no Docker/SQL/key/SSH:

```powershell
& C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe -B scripts/phone_inbound_recovery_rehearsal_test.py
pnpm exec vitest run scripts/phone-inbound-recovery-rehearsal.test.ts scripts/phone-inbound-install-sequence.test.ts scripts/phone-inbound-hosted-install-review.test.ts --exclude '**/.agents/worktrees/**' --pool=threads --poolOptions.threads.singleThread --reporter=dot
pwsh -NoProfile -NonInteractive -File scripts/phone-inbound-recovery-rehearsal.review.ps1 -ReviewOnly
git diff --check
```

The wrapper tests use a synthetic credential-profile location, no real key or agent. Preserve the
worktree exclusion in every root Vitest command. Do not run any Approved flag, legacy rehearsal command,
Docker command, SQL, SSH, paid tool/provider operation or infrastructure test. No actual cleanup needed.
If static/mocked review cannot answer a question, label it unverified and propose a new scoped validation.

## Required review output

Return concrete findings with severity, exact file/line, failure mechanism, evidence and minimum fix.
Separate confirmed defects, unresolved questions and explicitly untested runtime behavior. State tests
actually run. Do not claim production or execution readiness from mocks or from historic acceptance.

Initial task is review-only: report findings rather than modifying source or permission flags. After
findings are resolved through safe local fixes, a final review/pin snapshot and exact owner approval
request must cover backup, restore-clone SQL, private-data retention and cleanup. Neither this handoff
nor a clean review authorizes execution. Preserve working live inboundv5, outboundv6 and all safeguards.
