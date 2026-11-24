# F-03 composition stage — LOCAL ONLY, F-03 OPEN

Independent review accepted the preceding local implementation for continued development, not runtime
admission. This stage implements a connected local consistency check, not a final expected-schema
compiler, PostgreSQL driver or real schema approval. No execution authorization is issued.

## Exact code changes

1. NEW `scripts/phone-schema-composition.mjs`: composes existing SQL source evidence, schema validator,
   signed review verification and exact comparison. Constructor-only binding/reference pins and14 exact
   source inputs are cloned/hashed. Submitted documents cannot enroll a reference or replace the target.
   The complete submitted expected-document hash, provenance, ordered source/statement coverage and
   object-name coverage must match the protected reference. Catalog shape/required objects are validated
   independently of the signature/pin. Grantor evidence must match a separately provisioned hash and
   exact ACL/ownership projection. Any invalid/unsupported observation denies the comparison.
   Success is ONLY synthetic_composed_match, productionAdmission:false, executionAuthorized:false.
2. NEW `scripts/phone-schema-pg16-extractor.mjs`: strict version/binding-bound projection decoder.
   Renames a closed set of PostgreSQL projection sections into the existing validator representation.
   Exact patch version, source/image/extractor/normalizer/stage binding and explicit empty unsupported
   inventory required. Unknown/missing fields and unsupported objects stop. Expressions/full definitions
   pass through unchanged; no SQL formatting equivalence is claimed. It is NOT a raw PostgreSQL catalog
   reader: the actual reviewed catalog SQL/query-to-projection driver remains unimplemented.
3. MODIFIED `scripts/phone-schema-review-verifier.mjs`: optional constructor-only protected checkpoint
   port, preserving existing in-memory-only design tests. Reads a validated persisted sequence/hash
   and requires atomic compare-and-advance of authenticated fresh revocation evidence. A matching
   returned checkpoint receipt is mandatory. Failure/wrong receipt/stale concurrent state denies.
   Revoked/invalid-document decisions still advance authenticated revocations before denying admission.
   Existing caller-boolean rejection, independent key separation and test-only guard remain intact.
4. NEW `scripts/phone-schema-composition.test.ts`:39 local tests, synthetic signing keys and atomic-store
   fixtures only. Covers the full happy consistency path, signed malformed expectations, source/version/
   image/pin/coverage changes, missing grantor evidence, altered ACL grantor/observation, unsupported
   projections, expiration/revocation, persistent-store failure/rollback/restart/concurrency, wrong
   receipts and production-use denial. Also denies the actual unapproved source-candidate JSON.

Existing recovery Python/PowerShell, hosted SQL, source evidence, installation kernel, previous model,
normalizer and65 prior security tests are unchanged. No app/auth/navigation/WhatsApp files were edited.
Previous inventories remain immutable historical snapshots; this stage has its own new hash inventory.

## Disposition of review findings

| Finding | Local result | Remaining gap |
|---|---|---|
|R1 HIGH|Exact14-source/statement coverage, submitted object inventory and independent reference pins are enforced in composition.|No final effective expected schema for the real864 statements is authored/independently reviewed. Object coverage is a consistency check, NOT proof of exhaustive semantic derivation. R1 remains OPEN.|
|R2 HIGH|A signature alone cannot produce a composed match: reference/source/provenance/schema/grantor/observation checks must also pass. No result grants execution.|A genuinely complete independently reviewed contract and protected configuration are still missing. Synthetic positive fixtures are intentionally not real SQL contracts. Runtime trust is not established.|
|R3 HIGH|Strictly version-bound projection decoder rejects unsupported/missing representations and compares exact validated definitions.|Actual catalog-query/extraction SQL, exhaustive unsupported-object discovery and version-specific SQL-to-schema derivation are NOT implemented or verified. R3 remains OPEN.|
|R4 MEDIUM|Protected checkpoint-store port is connected; restart/concurrent-verifier/rollback/failure behavior tested with atomic synthetic state.|Real protected trust-anchor storage and durable store adapter are absent. Mock state surviving function reconstruction is not fsync/crash/security verification.|
|R5 MEDIUM|Exact ACL/grantor evidence hash must be independently pinned and signed into the reference document; observed values are never adopted.|No real ownership-transfer result is known. No real grantor-test evidence or approved grantor expectation exists. Missing proof stops; R5 remains OPEN for actual PostgreSQL behavior.|

## Protected storage design, not provisioned

Trust anchors and independently reviewed reference pins must come from a dedicated OS/service-identity-
protected configuration store outside caller-writable application/workspace data. Enroll/revoke reviewer
and authority keys only through separately audited administration. Verify reviewer identity independently
of the key; labels alone do not prove independence. Reviewer schema approval and owner execution
authorization must remain separately scoped and independently verified. This composition implements
no owner execution path and cannot substitute a review signature for execution permission.

The future checkpoint store must atomically compare-and-advance per-authority sequence AND signed-
snapshot digest, reject same-sequence equivocation, persist before acknowledging, and protect against
rollback after process/host restart. Return exact stored receipt only after commit. Missing/unavailable/
corrupt state must stop; never recreate an empty floor. Bind store/key epoch and authority-set identity
to configuration; support independent trust-anchor rotation. Do not use an ordinary caller JSON file.
Tests currently use one synthetic authority; multi-authority epoch transitions require additional design.
Windows/Linux filesystem ACLs, locks/transactions, durable flush, rollback-resistant storage, clock
trust and crash/fault recovery require implementation and authorized verification. No files/keys/store
records were provisioned by this stage; test signing keys live only in test-process memory.

## Limits that must not be hidden by composition

The constructor is a trusted boundary in these tests, NOT a deployed protected loader. A caller able
to choose all constructor pins/trust keys can invent a synthetic world; production use remains blocked.
The reference pin must only be issued after full independent semantic review. The checked-in source
candidate still has null expected catalog/approval and is explicitly denied. The14-source count is not
proof of target identity or exhaustive dependency closure. Source-to-object coverage is not a SQL AST
compiler; consistency does not prove the supplied final schema follows from successive source DDL.
The decoder's unsupported inventory is asserted by its future trusted observation driver; no driver
yet establishes that inventory from PostgreSQL. Image and extractor hashes are pinned inputs, not local
attestations of a real server. Exact PostgreSQL definitions may vary by patch; no equivalence is inferred.
No reference hash, grantor test receipt or independently reviewed final contract was invented or issued.

## Fresh verification and next action

Command:
`pnpm exec vitest run scripts/phone-schema-composition.test.ts scripts/phone-schema-security.test.ts scripts/phone-inbound-expected-schema.test.ts scripts/phone-inbound-install-sequence.test.ts --exclude '**/.agents/worktrees/**' --pool=threads --poolOptions.threads.singleThread --reporter=json --outputFile=node_modules/.cache/phone-f03-composition-stage-20261104.json`

Result:142/142 PASS (39 composition+65 existing security+27 old model+11 unchanged install).
New behavior was tested first with failures for absent composition/reference enforcement, then passed.
No full app rebuild was needed; no app/runtime source changed. No PostgreSQL/SQL/Docker/VPS/provider/
real-credential/live-service operation occurred. No gates, Git history or WhatsApp worktree changed.

`F03_COMPOSITION_INVENTORY_2026-11-04.json` records current source hashes and exact changed-file list.
Another independent code review is required for the checkpoint extension/composition before trusting
these components. Next implementation gaps are R1's actual expected contract and R3's trusted
catalog-query projection, followed by protected storage/driver work. F-03 remains OPEN; no production
execution approval is requested or justified by these mocks.
