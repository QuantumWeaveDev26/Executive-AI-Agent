# Phone inbound — hosted read-only inventory PASS

## Approved execution

Owner explicitly approved one SSH inventory, fixed read-only catalog query, encrypted-key authentication,
reviewed access and cleanup. Manifest SHA256
`1417eb943fc8d1d2525bcd6b3a4b495c9100722a44c48f82b801d38982e05d53` and all four artifact pins verified.
Exact approved command executed ONCE, exit0. Previous automatic approval rejection never started SSH.
This successful authorization is now consumed; never reset the marker or automatically repeat inspection.

## Confirmed facts

| Check | Result |
|---|---|
| Recorded host key matched and strict SSH handshake verified | PASS |
| Expected PostgreSQL container/image/project/service, healthy state and final recheck | PASS |
| Fixed local Docker socket and isolated client environment | Used by pinned payload |
| Fixed local PostgreSQL socket; transaction READ ONLY, catalog-only search path/time bounds | PASS |
| Expected pilot database matched, PostgreSQL16 | PASS |
| Required workspaces/users/memberships/audit/scope functions | Present |
| Inbound event journal table | Absent |
| Inbound principal table | Absent |
| Ingest and guard role names | Both absent |
| Append, resolve-grant and scope-match Phone functions | All absent |

No conflicts at those exact object/role names were found. This is a bounded catalog inventory, not
a complete schema dependency/ownership/privilege validation or permission to install anything.
No customer rows, credentials, environment files or secret contents queried. Existing encrypted SSH
key was used only through the temporary agent; no plaintext private-key file written.

## Cleanup

Helper cleanupVerified:true. Independent LOCAL readback confirmed the exact owned agent PID absent
and exact owned temporary directory absent. No generic process kills, additional remote command,
credential modification or cleanup repair was needed. The first local readback rejected the JSON PID's
Int64 representation before performing checks; the corrected bounded integer validation then confirmed
absence. This did not reconnect, rerun the payload or change any remote state.

Retained local receipts:

- `node_modules/.cache/phone-inbound-host-inventory-v1.used.json`
- `node_modules/.cache/phone-inbound-host-inventory-v1.result.json`
- `node_modules/.cache/phone-inbound-host-inventory-v1.cleanup.json`

## Remaining gates and next safe work

Actual Thaara tenant/owner identity, managed/TLS and secret-storage posture, ingress/replica topology,
fresh recovery evidence and live provider/tool authentication were NOT verified by this inspection.
Do not infer them from a healthy database. Existing inboundv5/outboundv6 and integrations are unchanged.

Next authorized LOCAL work: use confirmed target/version/base-schema and absent-object facts to prepare
target-specific install/admission review, dependency/role/RLS preconditions and recovery plan. Preserve
disabled drafts and consumed receipts; do not remove the draft's blocking exception to activate it.
An executable installer must be a NEW independently reviewed, source-pinned artifact with exact scoped
approval. Backup/restore, persistent SQL/identity provisioning, secret setup, deployment, provider
configuration and one controlled live test require their respective explicit approvals.

No migration, database row/permission change, backup, deployment, service restart, provider request,
real call/message/appointment, WhatsApp/n8n/Gmail/Calendar change, Git commit or push occurred.
