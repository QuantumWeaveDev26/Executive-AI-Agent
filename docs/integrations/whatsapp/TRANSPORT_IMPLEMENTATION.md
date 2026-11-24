# Governed outbound n8n transport — 26 October 2026

Implemented under the existing WhatsApp master task. This is a complete internal HTTP adapter feature slice, not LIVE runtime admission. It is deliberately **not instantiated or registered** by the API/server. No real secret, HTTP/DNS request, provider call, workflow edit, migration, service restart, commit or push was made in this slice. Network dependencies in tests are mocked.

## Source and behavior

- `apps/api/src/services/whatsapp-dispatch-http.ts`: `WhatsAppDispatchHttpTransport`. Constructor accepts a trusted server profile bound to workspace/owner/connection/revision and managed credential reference. HTTPS origin cannot come from a submitted dispatch. No default authorizer or credential resolver exists.
- `packages/contracts/src/whatsapp-n8n.ts`: additive shared `N8nWhatsAppDispatchAcknowledgementSchema` and type. Exact `{dispatchId,status,verified:false}`, only not_configured/unverified, no additional properties. Aligns with the current outgoing workflow's Return nodes; no sent/delivered/read claim from an acknowledgement.
- `apps/api/test/whatsapp-dispatch-http.test.ts`: focused safety/behavior/failure coverage. Original memory transport and HTTP route behavior preserved.

Submission receives explicit authenticated scope, UUID dispatch ID and exact revision. It snapshots scope/profile, rejects owner/tenant/viewer/session mismatches, checks fresh authorization, validates all DNS answers, rechecks authorization before managed secret resolution and once more before transmitting. Payload contains only opaque dispatch ID and revision. Directional token appears only in the Authorization header; never in URLs, payload, response or errors.

The socket uses one resolved public address with the original hostname for certificate/SNI verification, no shared connection agent, strict TLS and no redirects. Rejects private/reserved/multicast/mapped/local/documentation addresses and mixed DNS answers. Total 3-second deadline covers authorization, DNS, credential resolution, connection and response body; late dependencies cannot transmit after cancellation. Response cap 16 KiB, JSON-only exact acknowledgement and matching dispatch ID. No automatic retries; any post-request uncertainty returns a sanitized unverified error. Before-request failures remain unavailable/denied rather than fabricating a provider result.

## Review and verification

- Initial test run failed because the new implementation did not exist. First implementation passed 45 cases. Review identified revocation during DNS before secret access; a deferred-DNS regression reproduced it. Protocol alignment tests reproduced the missing `verified:false` mismatch against the real workflow. Both corrected.
- Added deferred DNS/credential/partial-body timeout and resolver-error redaction regressions. A credential resolver throwing ForbiddenError originally leaked its classification/details; the new regression failed, then passed after resolver errors were sanitized locally.
- Independent narrow security review confirmed the DNS correction and acknowledgement alignment, with no remaining consequential finding in that revision. Final resolver-error wrapper is an additional restrictive correction with its own failing/passing regression.
- Latest focused acceptance: **110/110**, five files (52 transport, 19 original bridge, 22 durable domain, 14 PostgreSQL query-boundary, 3 HTTP protocol), zero failed/skipped, exit 0. API build/typecheck and contracts build passed. Exact final test timing is recorded in the master task after output confirmation.
- Historical real PostgreSQL **21/21** remains applicable to unchanged repository/SQL. Historical full application **872/872** is retained baseline evidence, not a fresh full run and not evidence for this new adapter. Full integrated regression is required at production principal/route admission, which is not delivered here. Current focused tests exercise the new module and additive contract.

## Remaining runtime boundary

This adapter's authorization dependency is an interface, **not an implemented production policy/audit/session service**. Do not register it with permissive callbacks. The production implementation must atomically verify durable reservation, exact active approval, policy, owner/membership, profile/revision and audit admission; retain one-use claims and uncertain-outcome deduplication. Current durable repository requires a real authenticated user session; machine callbacks require a separately reviewed service principal and RLS design. Never fabricate a browser session hash. No automatic schema or production configuration change is included.

Owner Meta credential mappings, non-secret asset IDs, public owned HTTPS callback origin, two separate backend secrets in managed storage, callback authorization/durable repository wiring, supported provider version/signature checks, WABA subscription and Meta AI eligibility remain pending. Current workflows remain inactive with closed gates as last verified. Activation, subscriptions, production migration/deployment/restart and one exact real-message pilot require concrete separate approval after readiness gates pass. See [readiness report](READINESS_RESULTS.md) and [owner setup](OWNER_SETUP.md).
