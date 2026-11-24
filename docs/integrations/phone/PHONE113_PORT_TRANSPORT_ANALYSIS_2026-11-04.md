# Port transport analysis — LOCAL ONLY, 4 November 2026

No Docker command, new fixture, SQL, listener, provider request or credential operation was performed.
All earlier execution approvals remain consumed. No guard or existing relay/session implementation changed.

## Confirmed evidence

1. Latest isolation-only receipt reports actual_ports/validation_failed. It does not retain the raw field;
   null/empty/wrong/extra publication entries remain indistinguishable for that specific fixture.
2. Older retained `phone110-runtime/isolation.json` at stage tests contains a single requested loopback mapping
   but actual `5432/tcp` entries are an EMPTY ARRAY. That older result receipt records8passed/0failed.
3. The older Phone110 runner explicitly starts the reviewed `createBinaryRelay` path when actual publication
   is absent. Therefore its8/8 result is not evidence that direct Docker host publication works here.
4. The new113 direct-publication guard requires exactly one actual loopback mapping. Empty arrays fail that
   condition correctly. The code does not misparse them as a successful mapping.

Historical record and current check are consistent with an unavailable direct-publication transport, but the
underlying Docker/platform cause and latest raw shape are NOT proven. Do not retroactively label the latest
field empty or claim an endpoint was reachable/public/closed. Metadata matching is not a TCP/authentication test.

Sanitized retained analysis with SHA256 lineage, not raw host metadata:
`node_modules/.cache/phone113-port-analysis-20261104.json`.
Source receipts were read only; none were edited or replayed.

## Local reproduction and implementation

`scripts/phone-inbound-port-evidence.mjs` is an informational pure function. It distinguishes absent/null/empty/
one/multiple/unexpected/unreadable metadata using finite outputs, never prints arbitrary addresses/keys, and
requires a real one-entry match for both requested and actual mappings. Empty-array all()/every() vacuous truth
cannot count as confirmation. It grants no connection, fallback, transport selection or policy authorization.

Fresh main-workspace-only52/52testsPASS in4files:5new evidence tests,33unchanged inspector,12fixture-session,
2legacy relay tests. Receipt `node_modules/.cache/phone113-port-analysis-main-only-20261104.json`.
Independent read-only review found no concrete blocker in the evidence summary, conclusion or proposed scope.
An earlier verifier discovered2duplicate legacy helper tests under the WhatsApp worktree; those ran read-only,
no source changes, and are excluded from the52main-workspace total. All future commands must exclude
`**/.agents/worktrees/**`; do not edit shared Vitest configuration without coordination.

## Minimum safe proposed correction — NOT implemented or activated

Do not remove/relax the direct actual-publication check. Prepare a separate, explicitly selected test transport:

- No Docker published ports for that new transport; verify absence of publication and full owned container/
  network/tmpfs/privilege/resource isolation. Never transform metadata to pass the direct-publication guard.
- A supervisor-owned loopback listener on127.0.0.1:15436 forwards only through `docker exec` to the NEW immutable
  owned container ID and its127.0.0.1:5432. No arbitrary target, existing resource, remote context or silent fallback.
- Require proof of the actual listener's address/port and its fixed owner/target binding before any SQL. Requested
  configuration, a caller-provided boolean, or an empty Docker mapping alone is never sufficient.
- Reuse the existing binary piping implementation only after reviewing supervisor lifecycle. It already uses
  backpressure,32connection cap,30s socket timeout and discarded stderr; it does NOT await killed tunnel children.
  Add bounded tracking of owned sockets/children and confirmed close before container/network removal. Unknown
  termination must stop cleanup and retain owned IDs for separate recovery, not falsely claim destruction.
- Reuse the tested fresh-session lifecycle: verify topology before creating a SQL pool; await actual client end,
  discard it, close pool before any later Docker inspection. Do not insert slow metadata calls into PostgreSQL
  authentication handshakes or keep idle transactions across those calls.
- Keep direct mode unchanged. New transport must be opt-in by a NEW reviewed command/manifest/one-use gate;
  no consumed marker reset, reused approval, automatic relay or extra retry. Test all negative cases locally first.

Next authorized LOCAL development: implement/review the owned fixture-transport supervisor and guarded runner
mode with mocks, then prepare one consolidated explicit transport+isolated-acceptance approval package. The
first stage must prove transport/isolation before schema or tests. No additional blind diagnostic run is needed
merely to reread the same missing-publication category. No actual run is authorized by this document.

The proposal is a temporary TEST fixture transport, never production architecture, a live Sarvam change, a
WhatsApp/n8n network attachment or permission to touch pilot data. Production admission remains separately gated.
