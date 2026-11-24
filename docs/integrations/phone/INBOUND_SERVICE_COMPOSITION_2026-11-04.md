# Inbound payload/service composition — 4 November 2026

Status: PARTIAL / LOCAL TEST-ONLY. No live route registration or provider configuration.

## Implemented locally

- Shared Sarvam payload normalizer reused by the existing intake and the new dedicated service.
- Canonical server-owned binding covers tenant, owner, principal, revision, agent version, deployment,
  agent number and fixed report-only policy. Payload fields cannot select authorization scope.
- Authenticate the dedicated grant before normalization; normalize, validate policy, append/audit and
  check the returned snapshot within the same transaction. Return minimal saved receipts after commit.
- Existing versioned test routes accept this service without an additional endpoint implementation.
- Callback and completion reconciliation preserves saved details, deduplicates phases and honors withdrawal.
  Explicit withdrawal is now recognized even in the first caller turn. Positive consent still requires
  an agent offer recapping the caller number followed by an explicit affirmative response.
- Completion permission intentionally includes importing transcript-confirmed callback consent after a call;
  it is not reconciliation-only. Neither operation authorizes dialing or Calendar writes.
- Service composition disables Calendar and transcript/recording retention. Provider booking claims do not
  become booked appointments. Missing information remains missing; raw media URLs are not fetched.

The 300-second profile setting binds the intended provider configuration. It does not remotely hang up a
call or prove provider enforcement. Preserve actual observed duration rather than concealing overruns.
Provider transcript/variables are untrusted evidence; reports remain provider-unverified.

## Verification

Red/green: four new regression assertions failed before the two corrections and passed afterward.
Focused API: 74/74 passed in seven files; receipt:
`node_modules/.cache/phone-inbound-service-final-20261104.json`.
API typecheck/build and whitespace checks passed. Web source is unchanged by this slice;
historical 272/272 web evidence is retained, not claimed as a fresh run.
Independent final read-only review found no concrete correctness/security blockers in this bounded composition.
API non-runtime milestone coverage: 104/104 expected files covered, 1,068 tests passed, 47 gated tests
skipped, zero remaining failures; eight `.runtime.test.ts` files excluded. Combined machine-readable evidence:
`node_modules/.cache/phone-inbound-service-api-coverage-20261104.json` (per-file test-source hashes).
The broad command selected runtime suites, completed 108 files and then stopped producing output without
a final report. It was interrupted; retained completed-file results were reused, not rerun. The three
remaining non-runtime files passed 5/5 in `phone-inbound-service-api-remainder-20261104.json`.
One existing WebSocket test failed with local connection EACCES in the restricted environment; the unchanged
file passed 13/13 with local network permission (`phone-sarvam-loopback-verified-20261104.json`).
No provider request or voice code correction. Do not describe the interrupted broad command as successful.
The previous 3 November full run has no retained final report and is not counted as a pass.

Earlier SQL113 10/10 embedded-engine acceptance applies to the earlier pinned journal implementation,
not this new raw-payload composition. Do not reset/reuse or regenerate consumed approval manifests.
This slice executed no new SQL or database-infrastructure runner.

## Remaining gates

1. Shared ingress rate/concurrency limits and production profile admission; all test-only guards stay.
2. Separately approved real PostgreSQL multi-connection/restart acceptance of the combined path.
3. Owner-approved principal/secret provisioning, persistent schema installation and deployment.
4. Verify actual Sarvam tool/event payload, trusted call-direction context, delivery authentication,
   save-result acknowledgement behavior and provider-side duration enforcement before live configuration.
5. Owner-only feed wiring, bounded pagination and retention/purge/media access where separately supported.

No live Sarvam v5/v6, outbound workflow, Chat, Gmail, Calendar, WhatsApp, n8n or VPS changes.
No real calls, messages, appointments, credential changes, commits or pushes. No owner setup needed for local work.
