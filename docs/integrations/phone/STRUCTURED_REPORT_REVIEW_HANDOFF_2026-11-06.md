# Phone structured-report delta — independent review

REVIEW ONLY. No execution, deployment, provider operation or approval is granted by this package.
F-03 remains OPEN; production admission remains disabled. This is a separate proposed delta,
not a claim that new SQL114 belongs to the previously reviewed14-source expected contract.

## Problem and implementation

Existing callback SQL preserves recipient lines but does not persist the ordered both-speaker report.
The candidate adds one atomic report/completion function over existing Phone tables, with no new
tables, roles, contacts, dial permission or Calendar authorization. A test-only callback store calls
that function; startup still uses the existing store without completeReport.
The webhook retains the exact dispatch attempt authenticated during admission rather than substituting
a second lookup. Database functions must independently recheck that attempt under their transaction.

## Review order and checks

1. Read AGENTS.md and this handoff. Inspect SQL114 against unchanged110a/110b/110c dependencies.
2. Validate role ownership, forced RLS, security-definer search path, exact privileges/grantors,
   function-to-function authority, audit writes, deployment actor and default privileges under PG16.
   Current SQL checks are not a complete independently approved privilege fingerprint.
3. Check call/attempt/provider binding, row locking, ordered evidence bounds, duplicate/conflicting
   events, terminal-call fencing, rollback on audit failure and prior-evidence preservation.
4. Check synthetic ringing/answered transitions inherit existing lifecycle semantics; they are not
   independent proof of call progression. Provider-connected completion remains unverified.
5. Check source/type validation parity, provider-English translation labels, unknown speakers,
   one shared report renderer, no invented dialogue and no success claim for requested work.
6. Review exact authenticated attempt retention for both optional and legacy write paths. A stale
   attempt must be rejected by the database, never silently rebound to a newer attempt.

## Local evidence and limits

`node node_modules/vitest/vitest.mjs run apps/api/test/phone-structured-callback-store.test.ts apps/api/test/phone-sarvam-calls.test.ts apps/api/test/phone-sarvam-results.test.ts --exclude '**/.agents/**'`

Latest30/30 PASS; API typecheck PASS. New regression first failed because a second lookup changed
the attempt; corrected code retains the admitted ID. Earlier29/29 is superseded for these files.
Tests use mocked SQL/provider calls and existing approved in-memory fixtures only. SQL114 has NEVER
been applied, parsed by PostgreSQL or tested for its actual transactional/ACL behavior.

Focused local reviewer found prior verbatim provenance could be relabelled and evidence links lost.
Fixed by rejecting incompatible source before lifecycle mutations and preserving prior evidence IDs.
Reviewer rechecked that fix and attempt retention: no further blocking defect confirmed in this narrow
delta. Also bounded raw turn length, not only trimmed length. Three source-only regression checks pass
in scripts/phone-structured-report-sql.test.ts; all failed before their corresponding correction.
This local review does not provide a signed expected-catalog reference, PG16 runtime proof or F03 closure.

The ZIP is a source-review excerpt, not a standalone runnable checkout or approved migration bundle.
Package hashes establish integrity only, not reviewer approval. No credentials, runtime profile,
guard marker, logs containing customer records or private keys are included.

## Required next boundary

Independent code/SQL review first. If accepted, prepare a separately checksum-pinned isolated PG16
validation using the existing disposable framework. It must verify success, duplicates/conflicts,
wrong attempts/calls, terminal fencing, concurrent completion, restricted-role ACL/RLS and audit-failure
rollback. Request explicit owner authorization before Docker or SQL. No production installation,
deployment, old-report repair or backfill is authorized. F03 reference/target evidence remains separate.
