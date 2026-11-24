# F-03 source-effect reducer and disconnected catalog reader

Status: F-03 OPEN. Local deliverables only. Actual expected-schema contract is NOT complete.
No PostgreSQL/SQL execution, Docker, VPS, credential, provider or live-service access occurred.

## Delivered code and artifacts

- NEW `scripts/phone-schema-effective-contract.mjs`: reduces direct sequential source DDL across all14
  artifacts, retaining original full definitions and statement-level provenance. Models table creation,
  column/constraint/default/not-null changes, RLS flags, function replacement/overloads/drops and owner
  changes, policy creation/drop/role changes, indexes, triggers, schemas and direct role definitions.
  Does not execute SQL or PLpgSQL, infer grantors, invent generated constraint names or discard unknown
  effects. Inputs are copied before lexing; output is a new source-derived candidate, never an approval.
- NEW `F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json`: reproducible candidate from all14 inputs/864
  statements. Contains30 tables,63 current persistent functions,57 policies,53 indexes,15 triggers,
  complete retained function definitions, provenance and unresolved-effect records. This is a
  PROVISIONAL static-effects view: unmodeled procedural/helper/ACL/data effects may invalidate any
  recorded object. Never use it as a final catalog. expectedCatalog:null, staticResolutionComplete:false,
  productionAdmission:false and executionAuthorized:false remain explicit.
- NEW `F03_PG16_CATALOG_QUERY.review.sql`: read-only catalog SELECT candidate, no migration. Projects
  public/platform table/column/default/constraint/index/policy/RLS metadata, function definitions/options/
  owners, relevant role flags/memberships, schema/table/column/function/default ACLs with grantors,
  dependency-graph digest and unsupported-object inventory. Reads catalog metadata, not customer table
  rows or password columns. Detects unscoped schemas/roles, nonordinary relations/routines, event triggers,
  unstable indexes and preserves trigger/rule/inheritance evidence so existing validation rejects
  unsupported forms rather than hiding them. It has NOT been parsed/executed by PostgreSQL.
- NEW `scripts/phone-schema-query-adapter.mjs`: query-hash-pinned query-to-projection adapter. There is
  no PostgreSQL client or default connection. NODE_ENV=test and a constructor-only synthetic snapshot
  port are required. Verifies exact patch version, READ ONLY, REPEATABLE READ, standard strings and
  pg_catalog search_path before the catalog query and rechecks afterward. Uses bound stage parameter;
  rejects unexpected rows/fields and unsupported observations through existing decoder/normalizer.
  Enforces one callback/owned return result, no retry, finite denial and no raw exception text.
  A real connection/transaction adapter is NOT installed; the query is only recorded by local mocks.
- MODIFIED `scripts/phone-schema-pg16.mjs`: permits a distinct pg16-dependency-graph observation kind.
  This is observed metadata, NOT an independently reviewed base contract. Graph digests are neither
  copied into expected approval nor treated as proof of semantic completeness.
- NEW `scripts/phone-schema-effective-contract.test.ts` and
  `scripts/phone-schema-query-adapter.test.ts`:10 and16 checks respectively. Includes preservation of
  policy predicates through role changes, function replacement/ownership, overloads, columns/default
  expressions, index schema resolution, drops, unresolved effects, exact14-source candidate reproduction,
  snapshot settings/version failures, bad/unsupported projections, forged ports and production denial.
- MODIFIED `scripts/phone-schema-composition.test.ts`: one immutable-source-input regression.
  Verified evidence is captured at initialization; modifying original buffers/list cannot change it.
  A fresh verifier observing invalid changed inputs refuses them. Future installation must use the
  SAME verified immutable bytes, or reread/revalidate all source hashes immediately before use.

## Unresolved source effects — explicit counts

| Effect class | Statements | Why it cannot be silently skipped |
|---|---:|---|
|Procedural DO blocks|30|Conditional role creation, grants/default privileges/ownership and precondition logic need exact pinned semantic recipes; cannot assume assertion-only.|
|SELECT helper calls|245|The six pg_temp.assert_* helpers can change columns, uniqueness/FKs/checks or RLS. Their verified source bodies must be modeled, not treated as read-only assertions.|
|ACL/default-ACL effects|169|An ordered exact ACL program is retained; final grantor/ownership-transfer effects remain unverified. No grantee or grantor tuple is invented.|
|Data-dependent effects|2|Preset initialization and governance update require explicit reviewed state/data preconditions, not simulated SQL execution.|

All446 are listed with source path/ordinal/SHA. No unrecognized direct statement was silently omitted.
This reducer is a bounded SQL source-effect interpreter, not a full PostgreSQL parser. Initial postgres
execution identity/declared-object absence are explicit unverified assumptions, not observed facts.
Generated object names, inline constraint identity, procedural effects and PG deparser formatting still
need independent semantics review. Recorded direct effects cannot certify final schema equivalence.

## Query adapter limitations

The SQL query and translation code are concrete reviewable deliverables, but no real SQL result has
been verified. Mock projection data is intentionally synthetic. Exact version is pinned by supplied
binding; no actual server patch/image identity was discovered. The future trusted snapshot port must
establish one protected read-only transaction, bounded timeout/output limits and cleanup; mock callback
proofs are not real transaction proof. The query's fixed schema/role scope and dependency digest need
independent completeness review against the finished source contract. Cross-scope references stop.
Current normalizer still rejects nonempty user trigger/rule/inheritance representations and unsupported
types/languages; real base schema may be rejected until those are explicitly modeled. This is safe
denial, not evidence that the real database is compatible. No SQL-string pretty formatting is accepted
as semantic equivalence. Dependency text/digest and actual deparser output are version-dependent.

Membership fields and index flags were checked against official PostgreSQL16 documentation:
[pg_auth_members](https://www.postgresql.org/docs/16/catalog-pg-auth-members.html) and
[pg_index](https://www.postgresql.org/docs/16/catalog-pg-index.html). Documentation checks are not runtime tests.

## Verification and preservation

Fresh command:
`pnpm exec vitest run scripts/phone-schema-effective-contract.test.ts scripts/phone-schema-query-adapter.test.ts scripts/phone-schema-composition.test.ts scripts/phone-schema-security.test.ts scripts/phone-inbound-expected-schema.test.ts scripts/phone-inbound-install-sequence.test.ts --exclude '**/.agents/worktrees/**' --pool=threads --poolOptions.threads.singleThread --reporter=json --outputFile=node_modules/.cache/phone-f03-source-query-stage-20261104.json`

169/169 PASS:10 reducer+16 adapter+40 composition+65 security+27 old model+11 installation tests.
27 checks added over the prior142. Test-first failures reproduced missing adapter/reducer, truncated
default expressions, index schema handling and forged snapshot returns before fixes. No DB engine ran.
No full app regression/build repeated; app/runtime code unchanged. Existing14 SQL artifacts, recovery
scripts, revocation checkpoint interface, installation kernel and approval gates are unchanged.
WhatsApp worktree was not accessed. No source/expected fingerprint was approved or promoted.
Exact files and hashes: `F03_SOURCE_QUERY_INVENTORY_2026-11-04.json`.

## Next required work

Independent code review of the query/adapter and direct-effect reducer. R1 remains HIGH and incomplete:
implement source-hash-pinned semantic rules for the six helper functions and30 procedural blocks,
then exact ACL/default ACL effects and data preconditions, followed by full dependency closure and
version-specific expected representation. Review real grantor assumptions before any isolated SQL test.
The finished contract must be independently reviewed before provisioning reference pins. No live
approval or production execution request is justified by169 passing mocks. R3 now has a disconnected
query/adapter candidate, still awaiting syntax/runtime/scope validation under separate authorization.
Durable revocation anti-rollback remains a protected-storage interface and mocked behavior only;
no durable store was implemented, provisioned, reviewed or runtime-tested in this stage.
