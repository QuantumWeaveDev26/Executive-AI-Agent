# Phone F-03 admission review — 5 November 2026

REVIEW ONLY. F-03 OPEN. Not a finalized PG16 expected catalog or execution approval.

## Exact local changes
- PG16 normalizer now preserves structured source triggers: identity, complete definition, function, firing mode, constraint/deferral flags. Unknown/mismatched/transition representations fail closed. Definitions are compared exactly; no SQL semantic equivalence is claimed.
- Disconnected catalog query now includes thaara_definer, structured trigger fields and fail-closed detection of disabled internal or unsupported user triggers. This query has NOT been executed against PostgreSQL.
- All269 preconditions/15 kinds have exact original IDs, source bindings, stages, predicates and evidence requirements. None is marked verified. The original10 unresolved effects remain blocking.

## Fresh verification
134/134 tests in security/query/composition suites;1/1 added source-inventory coverage test (other tests intentionally skipped in that targeted command). Previous80/80 unchanged source-model evidence is historical, not rerun. All14 migration SQL byte hashes unchanged. Only the read-only catalog-query candidate SQL changed.

## Required independent review
1. Check the query/normalizer trigger representation against PG16, all15 source triggers and the referenced functions. Confirm no security fields or enforcement states are omitted.
2. Confirm all269 evidence requirements match exact helper/guard semantics at original source positions. Do not treat proof requirements as proof or repeat the full source against an existing target.
3. Resolve the original10 effects using version/image-bound pgcrypto contents, full ALL IN SCHEMA collection inventories, actual transaction/search_path context, exact conditional membership branch/options/grantor and the2 data transforms.
4. Finalize the complete independently specified expected catalog from14 source definitions and separately reviewed PG16 realization; current expectedCatalog is NULL. pgcrypto native routines and all generated/base semantics still need independent reference coverage. Never copy a target/clone hash into the expected reference.
5. Verify exact stage/source/version/image/provenance bindings and the protected reviewer/revocation boundary. Source assertions and old empty-fixture acceptance do not prove current target data or role/ACL state.

## Next authorization boundary
After review, prepare one checksum-pinned isolated source-reference/evidence collection using the EXISTING disposable framework, plus separately scoped read-only target evidence if necessary. There is no execution authorization in this ZIP. No production install/deployment package is ready before exact expected/reference, target evidence and reviewer approval are verified. Then request only the minimum backup/restore,112h/113h install, restricted identity, endpoint deployment and Sarvam tool attachment actually required. Owner Calendar review uses owner login; Sarvam must never receive it.

## Preservation
Live Sarvam v5, committed outboundv7, WhatsApp worktree, approval gates, original14 migration SQL sources and recovery/install kernel untouched. No VPS, SQL execution, Docker, credentials, calls, deployments or Git commits/pushes.

Official field references: https://www.postgresql.org/docs/16/catalog-pg-trigger.html and https://www.postgresql.org/docs/16/functions-info.html.

Focused review commands (Node22+, Vitest2.1.9 in an isolated review copy):
`node node_modules/vitest/vitest.mjs run scripts/phone-schema-security.test.ts scripts/phone-schema-query-adapter.test.ts scripts/phone-schema-composition.test.ts`
`node node_modules/vitest/vitest.mjs run scripts/phone-schema-effective-contract.test.ts -t "binds every precondition evidence"`
These tests use local mocks/source parsing only. They do not authorize PostgreSQL, Docker or any production action.
