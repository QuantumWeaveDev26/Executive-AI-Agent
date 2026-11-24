# F-03 — independent expected schema: local design and test preparation

Status: DESIGN ONLY. F-03 remains OPEN. No approved expected catalog/fingerprint is issued.
Owner reports independent acceptance of F-01/F-02/F-04 local fixes, subject to runtime limitations.
That acceptance does not approve this design, runtime use, or a change to independentReviewComplete.

## Proposed trust chain

1. Independently review the exact raw 112h/113h SQL bytes and the base-schema dependency contract.
   Record hashes, reviewer decision/reference and covered objects. A local source hash proves identity,
   not approval. The existing recovery manifest still has independentReviewComplete:false.
2. From those SQL definitions, author an expected semantic catalog contract without reading a clone
   as the source of truth. Each expected column/type/default/constraint/index/policy/function/ACL maps
   to a source file hash and line range. Review every definition, including complete function bodies,
   definer ownership/search_path, role flags, policy roles/commands and grants on existing base tables.
3. Maintain separate expectations after112 and after113:113 restricts the existing journal owner policy to thaara_app and
   adds guard policies/rights. Never compare the after112 catalog to the post113 shape.
4. Bind canonical expected document to exact server_version_num (not only major16), image ID,
   immutable repository digest, platform, exact SQL hashes, base-contract hash, catalog extractor hash,
   canonicalizer hash and stage. Resolve these only through separately approved evidence. No image
   identity/version is invented here. A changed patch/image requires review, not automatic adoption.
5. An independently authenticated review authorization pins the complete expected-document SHA256,
   scope, reviewer reference and validity interval. It is a protected approval-store input, not a
   boolean inside an upload, an observed catalog, or this checked-in candidate. Runtime access and
   execution authorization remain separate requirements. A trusted timestamp/revocation check is needed.
6. Future verifier recomputes artifact/document hashes and checks approval, freshness and target binding
   BEFORE accepting observations. Missing/extra catalog objects, altered body/grantor, unknown fields,
   expired/unapproved records or any provenance mismatch deny admission with finite reason codes.
7. For persistent installation, recheck approval/provenance at every phase. Verify112 while holding
   the same transaction lock used for113, then verify final113 permissions before commit or admission.
   The existing test-only installation kernel is unchanged; its supplied hash is not independent proof.

## SQL-derived source contract candidate

`INBOUND_EXPECTED_SCHEMA_SOURCE_CANDIDATE_2026-11-04.json` records raw artifact hashes, line anchors
and semantic requirements derived from SQL, not observed catalog values. It is explicitly unapproved.

| Stage/source | Independently authored expected requirements |
|---|---|
|112h:41–60|Journal columns in declared order; UUID workspace/owner FKs; text call/kind/event/digest checks; smallint sequence; JSONB report binding; timestamptz default; primary/two unique keys and callback consent/phone checks. Full expressions must be reviewed, not reduced to names.|
|112h:61–74|History index exact order/direction; RLS enabled+forced; owner session policy USING/WITH CHECK; postgres ownership; app SELECT/INSERT only, no worker/PUBLIC grants.|
|113h:40–68|Two non-login/noninherit/nonprivileged roles; principals columns/defaults/checks/unique keys; forced RLS; guard SELECT plus column UPDATE(revoked_at); membership SELECT and column UPDATE(role); read/lock policies with false mutation checks.|
|113h:70–end|Three exact function signatures and complete bodies, SECURITY DEFINER/search_path; guard ownership, revoked temporary schema CREATE; exact ingest EXECUTE on resolve/append only; journal app/guard policies; audit write permissions and policies.|

Generated PostgreSQL text such as pg_get_expr, pg_get_constraintdef and pg_get_functiondef is version-
dependent. A reviewed SQL AST-to-semantic-contract compiler (or independently reviewed exhaustive manual
contract plus version-specific normalizer) is required. Do not normalize away predicates, casts,
collations, sort direction, function options, role membership, privileges or grantors. Sort set-valued
collections deterministically; preserve column and expression order. Reject unknown forms. The local
model only sorts JSON object keys; ordered arrays must already come from that future extractor.

A separately authorized clean reference database may later validate the SQL-to-contract translation;
its catalog is a cross-check, never auto-approved by copying its hash. Existing base objects need a
separate independently reviewed base contract;112h/113h alone cannot prove their complete definition.
No full canonical expected catalog is manufactured without that work.

## Local model and tests

`scripts/phone-inbound-expected-schema.mjs` is a pure test-only decision model with no file/network/SQL
IO, no approval writer, and no recovery/install imports. Synthetic tests use fake hashes and a fake
trusted approval port. The model validates bindings/authorization then compares the complete supplied
catalog; returns mock_match with runtimeAdmitted:false. It does not validate that a catalog contract is
complete or independently authored, verify signatures, attest a real image, or implement a SQL parser.

Tests cover a successful synthetic comparison, missing approval/fingerprint, stale/future approval,
wrong scope, changed SQL/base/extractor/canonicalizer/PG/image/platform/stage bindings, tampered expected
definitions and provenance, altered ACL grantor, missing/extra objects, and production-use rejection.
This is preparation for a verifier, not closure of F-03.

## ACL grantor provenance review

Stricter validation IS required in the future contract. Current catalog capture includes grantor, but
existing Python allowlists primarily validate grantee/privilege/grant-option. Do not treat equal rights
with a different grantor as equivalent. Pin exact grantor/grantee/privilege/grant-option tuples for
tables, columns, schema and functions; reject duplicates and unexpected grants/default ACLs/memberships.
For postgres-owned tables, the intended grantor is postgres. For guard-owned functions, PostgreSQL
ownership transfer/ACL rewrite semantics must be independently verified on the pinned version before
choosing the final expected grantor (guard is the candidate, NOT runtime-verified here). Also cover
indirect effective privileges and grants on memberships/audit/base schema, not only new objects.
No live validator or SQL changes made in this task; its stricter contract needs independent review.

## Incremental child-output memory-bound review

Current ReadToEndAsync buffers stdout AND stderr without a streaming memory cap; stdout's32768-character
check occurs after capture, stderr is discarded only after capture. The existing timeout does not bound
memory consumed by a fast child. This is unresolved, not weakened or silently certified.

Proposed separately reviewed fix: a small fixed-size concurrent reader for each stream; independent
and combined byte/character budgets defined explicitly; stdout retained only within32768characters,
stderr drained within a small finite cap without returning raw content. On overflow signal the shared
deadline/cancellation coordinator, kill only the owned child tree, then use existing bounded cleanup.
No PowerShell scriptblock work on .NET pool threads requiring an unavailable runspace. Preserve normal
exit/error semantics, shared deadline, no secret-output logging and cleanup-uncertainty reporting.
Future tests: exact limit, multibyte boundary, stderr flood, both-stream flood, overflow during blocked
stdin, normal outputs, and unverified termination. Existing process helper is unchanged in this task.

## Approval boundary and unresolved work

No VPS/SQL/Docker/key/provider activity, gate changes or runtime wiring. No full approved schema hash,
base contract, real target identity, protected review authorization or streaming-reader implementation.
Next: independent design review of source derivation/coverage, grantor rules and canonicalization;
then local implementation of exhaustive contract/normalizer and tests. Runtime validation would need
a NEW explicit isolated-test approval. Recovery remains capture-only and NOT execution-ready.

## Fresh local verification and changed-file inventory

Command: `pnpm exec vitest run scripts/phone-inbound-expected-schema.test.ts scripts/phone-inbound-install-sequence.test.ts --exclude '**/.agents/worktrees/**' --pool=threads --poolOptions.threads.singleThread --reporter=json --outputFile=node_modules/.cache/phone-expected-schema-design-20261104.json`

Result:38/38 PASS (27 design-model checks,11 unchanged install-sequence checks),0 failures.
No SQL/database/runtime verification or full application rebuild was performed. Prior runtime evidence
is historical and does not validate this new model. The prior recovery runner, SQL and review manifest
are unchanged. Approval manifest SHA remains4bad27600da28ffe3eed2fb2d18a919e652a14016e9d8c5bf94ddb60a04f036a.

New files: this design, source candidate JSON, test-only model mjs and focused test ts. Documentation-
only checkpoint entries added to daily handover, Phone checkpoint and Step111 task. New source hashes
and precise file inventory are recorded in `INBOUND_EXPECTED_SCHEMA_INVENTORY_2026-11-04.json`.
No existing production/recovery code, SQL, auth, app navigation or WhatsApp file was modified.
