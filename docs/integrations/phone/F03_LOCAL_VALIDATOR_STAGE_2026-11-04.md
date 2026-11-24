# F-03 local validator stage — independent code review required

Status: F-03 OPEN. No runtime integration, expected-schema approval, execution authorization or gate change.
This is one bounded implementation stage following independent findings F03-01 through F03-06.

## Implemented locally

| Finding | This stage | Still required |
|---|---|---|
|F03-01 HIGH|Closed PG16 representation validates table/column/default/constraint/index/policy/role/function/ownership/ACL/grantor/default-privilege fields; stage-specific minimum objects; duplicate/unknown fields rejected. Complete raw source evidence captures14 SQL artifacts/864 statements including complete function bodies.|Exhaustive source-to-semantic expected catalog, dependency closure and actual extractor are NOT implemented. Shape validation/minimum objects do not prove completeness.|
|F03-02 HIGH|Ed25519 review verification with separately pinned reviewer/authority identities, exact document+provenance hashes, scope/time/lifetime limits, signed revocation snapshots, per-instance rollback/equivocation rejection; caller boolean has no trust effect.|Protected key enrollment/distribution, independently verified reviewer identity, durable anti-rollback floor, trusted clock/revocation transport and actual approved document. No real keys were loaded or created.|
|F03-03 HIGH|PG16-specific closed typed representation, exact definition strings, deterministic set sorting, ordered columns, exact server_version_num equality during comparison; unsupported types/languages/features fail closed.|Version-specific PostgreSQL extractor, SQL AST derivation and validated formatting mapping. No SQL equivalence is inferred by trimming/reformatting expressions. A structurally valid synthetic record can still contain contradictory SQL text; source/body semantic validation remains pending.|
|F03-04 HIGH|Existing installation kernel remains unchanged and test-only; new modules reject non-test use.|Real transaction-bound driver, independently pinned schema/approval integration and authorized verification, as specified below.|
|F03-05 MEDIUM|All12 ordered base SQL artifacts are pinned with complete byte-preserving statement evidence, plus112h/113h.|Independently reviewed final base contract is NOT issued.14 artifacts are the known local base inputs, not proof of the hosted schema or complete dependency closure.|
|F03-06 MEDIUM|Exact grantor/grantee/privilege/grant-option tuples retained and compared; duplicates/impossible object-type privileges denied; grantor drift tests.|Expected real grantor values following ownership transfer remain unverified; no observed or guessed value is approved.|

## Files and trust boundaries

- `scripts/phone-schema-pg16.mjs`: pure, test-only representation validator/comparator. It is NOT a
  PostgreSQL catalog reader or SQL parser. It requires explicit empty parents/triggers/rules, denying
  nonempty representations until those features are modeled/reviewed. It covers only regular permanent
  tables and enumerated scalar types/languages; unknown legitimate structures stop rather than pass.
  All function definitions and policy/default/check/index expressions are preserved as exact strings.
  Cross-field parsing of those strings and exhaustive dependency closure are not claimed.
- `scripts/phone-schema-review-verifier.mjs`: local cryptographic verification boundary prototype.
  Constructor-only public trust registries are copied; request envelopes cannot enroll a key. Reviewer
  and revocation-authority key material must differ even under different IDs. Signatures cover canonical
  payloads. Each call rechecks exact document/provenance hash, scope, time and signed revocation state.
  Accepted newer revocation snapshots advance the in-memory floor even when review admission fails.
  Only returns local_review_verified/executionAuthorized:false; no runtime capability is issued.
  Key registries themselves must eventually originate from protected independently reviewed configuration.
  The prototype verifies any correctly signed document hash; it does not itself prove that document's
  schema coverage, provenance assertions or SQL semantics are correct. Composition is still required.
- `scripts/phone-schema-source-evidence.mjs`: pure UTF-8 lexical statement-boundary evidence builder.
  Preserves raw content, comments, quoting, nested block comments and dollar-quoted bodies; no SQL
  execution. Unknown escaped/unicode literal forms, invalid UTF-8 and unterminated source fail closed.
  This is NOT semantic parsing or validation of SQL grammar.
- `docs/integrations/phone/INBOUND_SCHEMA_COMPLETE_SOURCE_EVIDENCE_2026-11-04.json`: unapproved source
  evidence; artifact hashes, per-statement byte offsets/lengths/hashes, complete statement text and trailing
  comments/whitespace. Expected catalog and review authorization remain null. Source-only DDL evidence
  cannot stand in for an independently reviewed semantic expected schema.
- `scripts/phone-schema-security.test.ts`: synthetic representation and signed-envelope tests. Signing
  keypairs exist only in test-process memory; these are not provider/VPS keys or enrolled credentials.

The original synthetic trustedReview model is unchanged for historical design tests. It remains
test-only and must NEVER be selected as a runtime trust path. The new crypto prototype is detached too.

## Proposed next local stage

1. Independent review of these validators, signed-payload format, lexical evidence and test gaps.
2. Implement an exhaustive SQL-to-semantic compiler/curated contract with independently reviewed mappings
   for every112h/113h object and all relevant base functions/tables/roles/policies/ACLs/dependencies.
   Source evidence identifies bytes; it cannot certify that the final effects of successive ALTER/DROP/
   CREATE/GRANT statements were correctly derived. Unknown source constructs must block compilation.
3. Implement strict catalog extraction and explicit unsupported-object detection. Bind exact PostgreSQL
   version, immutable image/platform identity, extractor/normalizer/compiler hashes and complete base/source
   contract hashes into the expected document. Compare the same reviewed semantic format on both sides.
4. Compose source/target binding, full representation validation, signed review verification and exact
   comparison through a protected driver. None of the detached prototypes authorizes execution alone.
5. Only after independent code review prepare any separately authorized isolated runtime validation.

## Future transaction-bound driver requirements (not implemented or activated)

Separate owner execution approval and independent schema approval are both mandatory. Pin exact SQL,
semantic contract, verifier/extractor, image/version/platform and target identity before any operation.
Revalidate backup/isolated-restore proof and protected current revocation floor; deny all missing/stale
proof. The expected source must never be an auto-adopted observed clone catalog.

Use reviewed read/DDL transactions with bounded locks/timeouts. After112, extract/compare its stage-specific
schema. For113, acquire appropriate table/catalog/object locks and verify112 in the SAME transaction
that mutates113; resolve function identities/owners/ACLs and dependencies without a check/use race.
Verify final113 objects/privileges inside that transaction and recheck authorization before committing.
After commit, independently verify and retain exact receipts; a lost commit acknowledgement is uncertain,
never a reason to replay. Keep reporting disabled on any mismatch/partial state. No automated rollback,
grant repair, expected-hash replacement, identity provisioning or driver fallback is admitted.

Exact lock coverage and PostgreSQL ownership/ACL rewrite semantics need independent review and a NEW
scoped runtime test authorization. This document is not such authorization.

## Verification

Test-first progression retained failing evidence for absent validators, revocation rollback and invalid
object-type ACL privileges, then passing focused verification. Fresh command:

`pnpm exec vitest run scripts/phone-schema-security.test.ts scripts/phone-inbound-expected-schema.test.ts scripts/phone-inbound-install-sequence.test.ts --exclude '**/.agents/worktrees/**' --pool=threads --poolOptions.threads.singleThread --reporter=json --outputFile=node_modules/.cache/phone-f03-local-stage-20261104.json`

Result:103/103 PASS (65 new checks+27 earlier model+11 unchanged install tests),0 failures. No database,
Docker, VPS, provider, real credential, live-service or Git mutation operation occurred. Full API/web
regression not rerun because no app/runtime code changed. Recovery package and all manifest pins unchanged.
Source hashes and exact changed/new-file inventory are in `F03_LOCAL_VALIDATOR_INVENTORY_2026-11-04.json`.

## Open security limitations

No exhaustive expected catalog or independent approval exists; F03-01/F03-05 remain implementation gaps.
The PG16 representation cannot yet cover all real base objects; it fails closed on unsupported forms.
Signed-review verification still needs protected real trust anchors, external identity validation,
durable revocation anti-rollback and reviewed composition, so F03-02 remains open for runtime.
Actual PostgreSQL normalization/extraction/ownership-transfer behavior is untested (F03-03/F03-06).
Default privileges, inherited effective rights and all transitive dependencies need exhaustive source
derivation and final-state review; source hashing alone is insufficient. No production admission, key
enrollment or driver was installed. The child-output streaming memory limitation from prior review is
unchanged and not addressed by this schema-validator stage. Independent code review is required next.
