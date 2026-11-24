# Inbound principal transaction adapter — local review contract

Status: LOCAL TEST-ONLY code and mock tests. No new SQL has been written/applied for this principal, no real
database connected, no runtime registered. Existing SQL111/112 and consumed approval artifacts remain unchanged.
This contract is a dependency for the next reviewed migration; it is not a database installation instruction.

## Adapter and transaction behavior

`apps/api/src/services/phone-inbound-principal-postgres.ts` implements the injectable transaction port of the
existing test-only principal gate. It accepts a dedicated pool supplied by trusted backend composition. It does
not create a pool, read an environment variable/credential or connect during construction. Tests inject mocks.

The future caller must use `createInboundPrincipalGate` around this adapter; `withGrant` is an internal port,
not a public authenticator or independent authorization API. Work is trusted backend code, never model SQL or
provider input. The service identity must never be passed into owner-session repositories.

1. Bound request shape; borrow one connection; BEGIN with a total admission/work budget of8seconds.
2. Apply LOCAL statement3s, lock1s and idle-in-transaction5s timeouts. Require the exact role
   `thaara_phone_ingest`, no superuser/BYPASSRLS/role-creation/database-creation/replication/inherited/elevated
   memberships, no public-table ownership. Require SQL112journal RLS enabled+forced and NO direct table or column
   privileges. Also reject any direct table/column privileges on public application tables/views, including other
   integrations. Missing metadata fails closed. Privileged function EXECUTE permissions need a separate DB-side
   allowlist review; this preflight is not a complete privilege proof. Restrictive-role SQL is not yet verified.
3. Clear LOCAL browser identity settings. Call only the proposed bound resolver with parameterized token hash,
   route and operation. The gate checks all fixed bindings, owner membership, expiry and operation before work.
4. Give trusted work a transaction query handle that refuses use after its callback settles. No exec helper,
   pool, credential, commit or release handle is exposed. The DB role, not JS string matching, must enforce SQL
   access: only narrowly reviewed resolver/append functions should be executable by it.
5. Re-resolve the current grant after work. Compare against a comparison key captured BEFORE invoking work so
   an accidental mutation of the callback argument cannot overwrite admission history. Verify current owner,
   revocation, expiry and deadline; COMMIT once. No retries. Do not return work's saved receipt on commit failure.
6. Roll back on failure. Discard a connection after failed BEGIN/COMMIT/rollback. Release only its borrowed
   connection. A failed COMMIT is UNCERTAIN: the server may have committed despite client error. Future recovery
   must use the same event ID and authenticated receipt lookup; never blindly submit another event/call.

Pool acquisition needs a separate configured connection timeout (proposed2s); the adapter cannot inspect the
supplied pool's configuration. Database timeouts cannot cancel arbitrary JavaScript promises. Work must remain
bounded local database work; a hung callback can still stall its JavaScript caller even if the database closes
the idle transaction. No provider fetch, audio retrieval, Calendar API or long worker is allowed in this callback.
The final check is an authorization checkpoint; exact wall-clock expiry at COMMIT is not proven by mock tests.

## Required future resolver contract — NOT installed

Proposed parameterized read:

```sql
SELECT grant_record FROM public.phone_inbound_resolve_grant($1,$2,$3)
```

Parameters: dedicated credential SHA256, fixed route ID, callback/completion. This function must return exactly
one JSON grant only on a matching active configuration and current owner membership; otherwise no row/error.
JSON fields:routeId,workspaceId,ownerUserId,principalId,revision,profileFingerprint,tokenHash,activeOwner,
revokedAt,expiresAt and operations. These are SERVER-ONLY metadata, never provider/model-selected fields.

Required database-side behavior:

- Narrow SECURITY DEFINER ownership with pinned search_path and schema-qualified objects; no PUBLIC execute;
  no superuser/role escalation for runtime; runtime cannot select grant tables or mutate credentials.
- Resolve tenant/owner/profile from the grant, not caller-supplied tenant GUCs. Validate all hashes/operations
  and current owner membership; no arbitrary tenant impersonation. Set transaction-local service context only.
- Lock grant and owner membership in a defined order so lifecycle changes serialize with admitted writes. Recheck
  clock_timestamp expiry/revocation every time; final resolver call cannot accept a cached grant or ignore changes.
- Do not treat custom GUC assertions alone as proof. Any later report append must reauthenticate/recheck the
  matching hash/route/operation/revision inside its own transaction with the same locked grant context.
- No raw recording/transcript exposure through the resolver. No generic SQL execution, list, export, dial,
  Calendar or unrelated connector capabilities. Audit report saves with principal+operation metadata only.

The eventual scoped append function must validate normalized event binding/phase, perform the existing immutable
journal reconciliation/deduplication and insert its audit atomically. Its privileges/RLS need a NEW separately
reviewed migration. Keep owner-session policies intact; do not grant direct journal access to this runtime role.
No such function is implemented by this adapter; existing SQL112 policies do not authorize service writes.

## Evidence and next gate

Local tests cover lifecycle/order, restricted metadata, grant changes/revocation/expiry, immutable snapshots,
budget failure, query-handle lifetime, failed work/commit/rollback/connection and sanitized errors. They do not
prove SQL syntax/locking, privileges, RLS, DB-side audit atomicity or remote recovery. Actual migration and
multi-connection engine acceptance remain required before any production admission. No owner setup is needed now.

Next safe local work: prepare the phone-only grant/resolver/append schema and scoped-writer composition as a
reviewable additive migration, preserving111/112bytes. Then request ONE exact isolated acceptance approval for
the new schema. Prior approvals are consumed. Deployment, secret provisioning, provider configuration and
real customer testing require separate explicit scopes after those checks pass.
