# Inbound reporting — install-sequence rehearsal and controlled owner pilot

LOCAL REVIEW ONLY. No production installer, remote command or calling approval is created here.

## Implemented safety rehearsal

`scripts/phone-inbound-install-sequence.mjs` is a TEST-ONLY sequencing kernel with no CLI, SQL,
database/SSH/provider imports or live ports. It refuses non-test use before touching any dependency.
The mock ports are trusted test fixtures, not an authorization API accepting provider/model assertions.

Required sequence:

1. Capture immutable source manifest/112h/113h hashes and an expected full112 catalog fingerprint.
   Refuse missing fingerprints. Capture exact container/image/database/PostgreSQL16 identity.
2. Verify same-run schema-only approval, initial security preconditions and target-bound verified backup,
   isolated restore and restore cleanup. Rehearsal recovery proof must be no older than30minutes;
   this conservative candidate rule requires review in the actual install package.
3. Recheck sources, target, approval and recovery before112. Accept only an exact same-run committed
   receipt with expected SQL hash; a missing/contradictory acknowledgement makes state uncertain.
4. Require the exact expected112 catalog fingerprint, linked to the same run and112 SQL hash.
5. Recheck sources, target, approval and recovery before113. Future trusted113 driver must also lock
   and verify112 inside its mutation transaction, and return that exact fingerprint/lock attestation.
   A prior standalone catalog read is insufficient against concurrent schema changes.
6. Verify final privileges. Return only known committed steps and finite failure phase/uncertainty.
   Keep reporting disabled. Never retry, downgrade, drop schema or claim a rollback from an exception.

This is a mock rehearsal contract, NOT proof of a real transaction lock, full catalog verifier,
authenticated approval ledger, cancellation/timeout behavior or persistent database commit. The real
bounded driver and atomic SQL composition remain pending review. Do not host with NODE_ENV=test.

Tests cover blocked initial approval/recovery/target/catalog, source/target drift and revoked approval
after112, stale/future/wrong-source backups, failed cleanup evidence, invalid clocks, wrong-run receipts,
uncertain commit,113 locked-catalog attestation, final-privilege failure and non-test refusal.
No database tests were repeated; earlier two9/9 PostgreSQL milestones remain separate evidence.

Fresh26/26 focused checks PASS across four files (11sequence cases plus15existing draft/admission
checks); whitespace PASS. Receipt `node_modules/.cache/phone-inbound-install-sequence-20261104.json`.
Final privilege receipts are also bound to the same run and113 SQL hash. Independent review was
requested but did NOT complete because the reviewer workspace ran out of credits; no independent
approval is claimed. Keep that review pending before any persistent driver/admission package.

## Consolidated recovery preparation

The next executable package should combine a FRESH protected pilot backup and isolated restore with
112h/113h rehearsal INSIDE ONLY that new restore clone. This avoids a persistent write while producing
both fresh recovery proof and the missing exact catalog baseline. No backup command is authorized here.

Preserve previous retained backups. Use no-role-password globals, private destination/permissions and
consistent snapshot comparison as in the reviewed backup design. No customer contents in reports.
Pin source identity, reviewed image, exact SQL, paths, retention, temporary resources and cleanup.
Do not reuse consumed backup approvals or modify the source database/roles.

Catalog fingerprints must canonically include columns/types/defaults/nullability, all constraints and
indexes, owner names, enabled+forced RLS, exact policies/roles/expressions and grants; functions/roles
require corresponding final verification. Normalize object/role references to names, not installation-
specific OIDs, timestamps or row contents. Compare at fixed PostgreSQL16/image/search-path conditions.
Do not invent a baseline hash, accept only matching column names or infer schema equivalence from a
table's existence. Catalog verification occurs in the actual mutation boundary too.

If clone rehearsal succeeds, prepare the separate persistent install approval. If it fails, preserve
backup/receipts, clean only owned clone resources and stop without source repair or retry. A fresh
backup is still required immediately before persistent installation if this proof becomes stale.

## Proposed first live acceptance: owner-only private pilot

First target should be ONE authenticated Thaara owner, ONE consenting owner-controlled mobile and
synthetic business/enquiry details. No real customers, marketing/public rollout or automatic dialing.
This is a proposed scope, not an approved exception or authorization to record personal data.

- Any temporary use of self-hosted PostgreSQL or protected-file secrets needs a specific, time-limited
  private-pilot exception, distinct from production approval. Production retains managed/TLS/secrets
  requirements. Suggested pilot window: at most7days, requiring owner review before extension.
- Ingestion must be fenced to that pilot scope using TRUSTED provider call identity/caller metadata,
  not a caller/model-supplied number or call_purpose. If that cannot be proven, do not add tools to
  activev5; prepare an independently approved isolated provider test arrangement instead.
- Actual owner/tenant and expiring/revocable principal must be bound from authenticated Thaara records.
  Only approved callback/completion capabilities; no owner-cookie impersonation or general provider key.
- Save minimal owner-test contact/enquiry/callback data only after consent; media retention stays off,
  pricing figures are not quoted, no Calendar booking is invented and outbound remains unchanged.
- Use an explicit expiry and reviewed data-cleanup procedure. No automatic seven-day purge is claimed
  or implemented by this plan; data deletion requires its own reviewed scope. Do not enable real-customer
  collection without working retention/access controls and approved hosting/privacy readiness.
- One owner-made inbound test must show committed callback once in the owner list and Details; test
  failed-save wording and no false confirmation. Preserve working inboundv5 and every other integration.

## Owner setup and approvals, when ready

No account creation or credential entry is needed now. Do not ask for secret values in chat.
The next boundary is the exact new recovery/restore-clone rehearsal package, prepared before requesting
approval. Later require scoped hosting exception, persistent installation, identity/secret setup, runtime
deployment, provider configuration and one live acceptance call. No previous approval grants those steps.
Nothing here purchases services, changes VPS files, modifies provider settings or sends anything.
