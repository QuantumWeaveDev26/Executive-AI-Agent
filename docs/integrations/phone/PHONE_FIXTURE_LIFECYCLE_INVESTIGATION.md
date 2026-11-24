# Phone PostgreSQL fixture — database-free lifecycle investigation

30 October 2026. Owner authorized inspection, synthetic reproduction and focused tests only.
No Docker commands, network listeners/connections, databases, SQL execution, migrations, production access or provider calls were used.
Owner subsequently approved the exact proposed fixture-only correction with `PROCEED`. It is implemented locally and verified database-free;
no runtime/infrastructure retry is authorized. SQL, isolation inspector/tests, relay and eight-test acceptance suite retain their previous hashes.

## Findings and evidence

- Runner `verify()` invokes synchronous `execFileSync` Docker metadata calls while the existing admin pool is still open after base-schema work.
  Inspector performs 18 sequential subprocess calls (11 mandatory fields, optional actual ports, mountinfo, three canonical paths, network).
- Installed `pg`8.23.0 / `pg-pool`3.14.0: runner has max1, connection timeout5000ms, server statement timeout30000ms, client query timeout45000ms.
  Pool default idle timeout is10000ms. The unchanged relay has a30000ms socket idle timeout and closes its exact tunnel child with the socket.
- Synchronous inspection blocks the same Node event loop that handles pool eviction, relay traffic and timeout callbacks.
- **Confirmed in a controlled synthetic reproduction:** after a block exceeds both idle deadlines, the installed pool still holds its idle client.
  The next checkout runs through `process.nextTick`; `_pulseQueue()` cancels the overdue idle-removal timer and acquires that client without an
  elapsed-idle-age check. The overdue synthetic transport timeout then fails the in-flight operation. Sanitized observation:
  `connection_terminated_unexpectedly`, SQLSTATE absent, one failed operation and no automatic retry.
- Without blocking, idle eviction removes the old client and a subsequent operation creates a new one. A short block below the deadlines works.
  Closing the pool before the blocking interval and creating a fresh one afterwards succeeds with identical timeout settings in the model.
  Pinning a checked-out client alone does not prevent transport timeout during blocking inspection.
- The actual driver also emits `query_read_timeout` without SQLSTATE for an unsubmitted synthetic operation. Therefore SQLSTATE=null from the
  previous disposable run cannot retrospectively distinguish these failures. Its exact raw client error was deliberately not retained.
  The historical failure remains consistent with, but not conclusively attributed to, the reproduced lifecycle race. No SQL defect established.

## Tests actually executed

`pnpm exec vitest run scripts/phone-fixture-lifecycle.test.ts scripts/phone-runtime-guard.test.ts scripts/phone-migration-diagnostic.test.ts --reporter=json --outputFile=node_modules/.cache/phone-fixture-investigation.json`

**48/48 passed,0 failed:**11 lifecycle tests, all33 existing inspector tests,4 existing diagnostic tests.
Tests use the real installed pool with synthetic EventEmitter clients and opaque probes, not SQL strings; relay tests use its existing helper with
mocked sockets/children and fake timers. A real driver timeout is exercised using an unsubmitted custom operation and mock connection, never connect().
No database infrastructure or runtime acceptance runner was started. Synthetic pool/relay deadlines are scaled down in the blocking tests;
the actual helper's exact30000ms setting is independently asserted. This is database-free evidence, not PostgreSQL runtime acceptance.

## Exact correction — owner approved and implemented locally

1. In the fixture runner only, close/await the current admin pool and clear its reference **before every blocking isolation verification following
   database work**. Perform the complete unchanged inspection/assertion with no live admin connection. If it fails, stop; open no replacement.
2. After a successful inspection, construct a fresh bounded admin pool using the same approved fixture endpoint and all existing timeouts/max1.
   Acquire one dedicated client for that migration phase. Execute review acknowledgement, diagnostic context and reviewed migration on that one
   session. Release it in finally and close the pool before the next blocking inspection. Preserve server/target validation and cleanup ownership.
3. Do not change the Docker inspector, relay, any SQL, storage/network guards or acceptance tests. Do not increase/disable timeouts, add keepalive
   queries, skip verification, or automatically replay failed SQL. Diagnostic mode must still stop at110a regardless of success.
4. Add diagnostic enums for an exact allowlist of known client errors (e.g. connection termination/read timeout and known Node transport codes),
   before interpreting a code as SQLSTATE. Record phase, bounded elapsed duration and pool counts only. Never copy raw error text, URLs or credentials.
5. Verify the correction database-free first. Any further disposable database creation/SQL run needs new explicit approval;110b/110c and the eight
   acceptance tests remain separately gated under the current diagnostic restriction.

The helper also awaits `client.end()` before release(true) and pool.end(): installed pg-pool removes a released client from its internal list
before the client's shutdown callback completes, so pool.end() by itself cannot prove actual connection shutdown. Failed release/shutdown remains
an error and still attempts the remaining owned session cleanup. Connection errors between queries are latched and surfaced, never ignored.

Fresh correction verification: **73/73 passed,0 failed**,12 lifecycle tests,12 fresh-session tests,16 diagnostics tests and all33 inspector tests.
Command: `pnpm exec vitest run scripts/phone-fixture-session.test.ts scripts/phone-migration-diagnostic.test.ts scripts/phone-fixture-lifecycle.test.ts scripts/phone-runtime-guard.test.ts --reporter=json --outputFile=node_modules/.cache/phone-session-final.json`.
Runner/session/diagnostic syntax checks passed. A focused read-only code review found no consequential issue; its missing context-failure test was
added and passed. No actual PostgreSQL acceptance claim. New source pins: `PHONE_POSTGRES_RUNTIME_APPROVAL.lifecycle-v1.json`; previous manifests
preserved. Runtime execution remains unauthorized. A separately approved instrumented run is still needed for actual PostgreSQL schema readiness.
