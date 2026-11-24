# SQ-01 local correction and six source-pinned helper recipes

F-03 OPEN. LOCAL ONLY; not execution-ready. No generated definition/grantor/fingerprint approved.

## Finding reproduction and changes

SQ-01 was reproduced with INHERITS, PARTITION BY, storage/tablespace suffixes, arbitrary trailing tokens
and conflicting or matching CREATE TABLE IF NOT EXISTS definitions. The old reducer accepted these
without unresolved effects. Additional fixtures reproduced ignored owner/drop/index/trigger/schema/
role/control suffixes and partial prefix mutation in a failed multi-action ALTER TABLE.

- NEW `scripts/phone-schema-ddl-grammar.mjs`: bounded structural grammar checks before reduction.
  Supported statements must consume all structural tokens. Unknown trailing clauses become
  unsupported-ddl-syntax. Covers table/column/constraint, function declaration/options, policy,
  index, trigger, schema, role, ownership/drop and control forms. Function parameter identities are
  derived from recognized parameters, including IN/OUT/defaults and names that are type keywords.
- MODIFIED `scripts/phone-schema-effective-contract.mjs`: uses that guard; snapshots/restores reducer
  state per statement so a rejected suffix cannot leave a recognized prefix applied. Existing conditional
  table/column/index/schema definitions remain unchanged and become conditional-object-exists, even
  if their spelling matches. Conditional creations on the source-absent branch require explicit absence
  preconditions; host absence is NOT assumed verified. Search-path effects are now explicitly unresolved.
  Helper application follows the same original864-statement loop. Temporary helper DROP/replacement
  updates the active definition map; an old recipe cannot survive a dropped or changed definition.
- NEW `scripts/phone-schema-helper-recipes.mjs`: semantic recipes for six exact known helper bodies,
  pinned to their original statement hashes (eight byte variants, including comment-only differences).
  These are source identity pins, NOT independent review authorization. Unknown bodies/overloads/
  nonliteral or unsupported arguments fail closed. No SQL or PLpgSQL is evaluated.
- MODIFIED `scripts/phone-schema-effective-contract.test.ts`:38 checks including SQ-01 structural tails,
  conditional presence and atomicity. NEW `scripts/phone-schema-helper-recipes.test.ts`:25 checks
  covering every recipe, failures, source-order interleaving, replacement/drop and literal-only inputs.
- REGENERATED `F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json`: same original14 inputs/864 statements,
  now records245 modeled helper effects,204 unresolved records and240 required preconditions.
  expectedCatalog:null, staticResolutionComplete:false, productionAdmission:false and
  executionAuthorized:false remain unchanged in meaning. The candidate is provisional, not final.

## Exact helper behavior modeled locally

| Helper | Calls | Behavior and remaining proof |
|---|---:|---|
|assert_column|147|Preserves existing default; validates typname; strengthens NOT NULL only as requested. Missing column requires non-null default argument or stops. Data/default compatibility is a precondition, not a passed row check.|
|assert_unique|20|Accepts an existing ordered primary/unique key regardless of name. Otherwise adds the requested named key conditionally; duplicate-group proof includes NULL grouping.|
|assert_fk|23|Matches ordered source/target keys and requested delete-action comparison. The pinned body actually emits ON DELETE RESTRICT for a missing match, even if p_deltype differs; the recipe preserves this source behavior. Orphan/dependency/name checks remain required.|
|assert_check|34|Preserves an existing named CHECK without replacing its expression. Missing checks require no false-expression rows; SQL NULL is not a violation in the helper's WHERE NOT(expression) query.|
|assert_rls|12|Requires the known source table and models enable+force flags. Missing table or unpinned helper fails.|
|assert_trigger|9|Validates name and procedure basename exactly as the pinned helper does; never invents a missing trigger.|

All245 calls are modeled, NOT verified on PostgreSQL. Global unresolved procedural/ACL effects can
still invalidate provisional object state. Helper-generated text is source-effect notation, not a
PostgreSQL deparser-equivalence claim or approved canonical catalog. Implicit/generated constraint
identities and unsupported inline rewrites remain conservative; availability/dependency proofs are
required rather than invented. Unsupported input variants stay unresolved.

## Remaining counts and next implementation order

204 unresolved records:30 procedural blocks,169 ordered ACL/default-ACL effects,2 data-dependent DML
steps and3 newly explicit search-path preconditions. The original245 helper records have actual recipe
implementations and source/body provenance now; they were not removed merely by relabeling them.

240 separate UNVERIFIED preconditions:86 conditional-create absence checks,20 no-duplicate-key-group
checks,77 constraint-name availability checks,34 no-false-expression-row checks and23 orphan checks.
None was tested against real rows. They must remain admission blockers until appropriately verified.

Next implementation order stays:30 procedural bodies, ordered169 GRANT/REVOKE/default-privilege effects,
then the two data-dependent steps; resolve search-path state and prerequisite proof at the correct
source positions. Always replay all864 statements in original order, never regroup their execution.
Review these grammar/helper changes independently before relying on the derived contract. No runtime
approval or deployment is requested by this local milestone.

## Verification

Fresh command:
`pnpm exec vitest run scripts/phone-schema-effective-contract.test.ts scripts/phone-schema-helper-recipes.test.ts scripts/phone-schema-query-adapter.test.ts scripts/phone-schema-composition.test.ts scripts/phone-schema-security.test.ts scripts/phone-inbound-expected-schema.test.ts scripts/phone-inbound-install-sequence.test.ts --exclude '**/.agents/worktrees/**' --pool=threads --poolOptions.threads.singleThread --reporter=json --outputFile=node_modules/.cache/phone-f03-sq01-helpers-stage-20261104.json`

222/222 PASS:38 reducer+25 helper+16 adapter+40 composition+65 security+27 earlier model+11 unchanged
installation checks.53 checks added since169. Initial failing regressions were observed before fixes.
No full app build/API suite repeated: app/runtime source unchanged. PostgreSQL grammar/runtime semantics
remain unverified. Opaque expression/function bodies are retained, not parsed as a full SQL language;
this bounded guard is NOT a PostgreSQL parser or proof that every invalid SQL expression is rejected.
The catalog query/adapter and protected checkpoint interface were not modified or executed against DB.

Original SQL14, recovery scripts, installation kernel, approval gates, all prior Phone work and
Antigravity's WhatsApp worktree preserved. No VPS, SQL engine, Docker, real credentials, call, service,
deployment, commit, push or merge action. Owner separately authorized a Team Sync progress update;
it was posted to the existing Thaara AI V2 project and read back, explicitly keeping F-03 open.
Exact changed files/hashes: `F03_SQ01_HELPER_INVENTORY_2026-11-04.json`.
