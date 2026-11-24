# Inbound service principal — local prototype and production dependency review

Local evidence3Nov2026: finalprincipal14/14PASS;49unchangedexistinginboundtests passed in preceding62/62run.
APItypecheck/build verified separately. Independentstaticreview found no blocking defect in the trusted-port scope.
Receipts:node_modules/.cache/phone-inbound-principal-{local,final}-20261103.json. No SQL/provider execution.

The prototype is TEST-ONLY, unregistered and unused by live traffic. It does not enable inbound tools, register a
route, alter any schema or authorize provider actions. No new account/credential setup is required from the owner now.

## Why this boundary is needed

The existing owner report repository requires an authenticated browser session. A long-lived provider tool must
not hold/replay that cookie or be promoted to a generic owner. WhatsApp has its own relay identity; neither its
schema nor its live workflow is reused. A new identity must be specific to inbound report saving.

`phone-inbound-principal.ts` provides an injectable transactional gate, not a production authenticator. It hashes
a bounded dedicated Bearer token and requests a matching grant using a fixed server-owned route. Inside the same
transaction it checks exact workspace/owner/principal/profile fingerprint/revision, current owner membership,
expiry, revocation and callback/completion operation. It returns a frozen distinct `phone_inbound` scope with no
owner role, browser token or credential hash. No source payload can choose that identity. Exceptions are sanitized;
there are no retries. A transaction failure after work completed cannot return the callback's saved receipt.

The profile fingerprint must cover exact approved Sarvam app/version/deployment/number, ingestion policy and
retention configuration; it is NOT a value accepted from a provider body. A route/version change needs a new
reviewed revision. The current prototype accepts the server-supplied fingerprint; its canonical runtime builder
and verified on-server provisioning remain unfinished.

## Required production adapter — not implemented or approved

Update: a test-only injected-pool transaction adapter is now mock-tested (12/12; 26/26 including the identity
gate). It is NOT a production adapter: dedicated DB role, grant/resolver/RLS and append functions are absent.
See `INBOUND_PRINCIPAL_DATABASE_CONTRACT_2026-11-03.md` for the exact remaining database contract and limits.

1. New phone-only principal/grant storage, with token hashes, revision, short expiry, revocation and callback/
   completion allowlist. Provision only after scoped approval. No secret values in SQL, logs or API contracts.
2. A restricted runtime transaction verifies database identity (no superuser/BYPASSRLS/ownership), resolves and
   locks the grant and current owner membership, and rechecks revocation/expiry. Principal lifecycle changes must
   serialize against admission. The injected test port is a trusted boundary, not evidence that a real DB does this.
3. Existing owner-session RLS on SQL112 does NOT admit this identity. Prepare a separate additive reviewed migration
   and narrow RLS/resolver path; never fabricate sessionTokenHash, reuse owner cookies, weaken existing policies,
   disable RLS or silently execute SQL112 again. Owner reads stay on the normal session/owner audit path.
4. Adapt the journal writer to a distinct service scope without granting list/detail/export privileges. Gate both
   callback and completion through the existing typed report-only PolicyGateway; bind report/event to the fixed
   route, approved deployment and interaction. One transaction saves event+audit before returning a receipt.
5. Transaction timeout/expiry must be evaluated against an uncached clock at admission; bounded execution and
   final grant checks prevent grants expiring during a long save from being accepted. The current JS test checks
   admission time only. Real DB/revocation races need isolated multi-connection acceptance before deployment.
6. TLS/private transport, managed secret storage, dedicated authenticated Sarvam HTTPS tools, payload/time bounds,
   shared atomic ingress rate limits, endpoint log redaction, revocation and operational alerts require reviewed
   production configuration. Completion webhook signature/custom headers have not been established; do not expose
   unauthenticated completion intake. Model text/provider variables cannot authorize other actions or a booking.
7. Recording notice/consent and physical expiry purge remain prerequisites for retaining raw transcript/audio;
   leave retention off until installed and verified. Owner appointment requires a real verified Calendar receipt.

## Staged verification and approvals

Local gate tests exercise authentication/binding, exact operations, expiry/revocation and failure semantics with
synthetic transaction ports. They do not prove RLS, real provider delivery or caller identity. Prior111/112memory
approvals are consumed and do not cover new principal SQL. Next authorized local work is a reviewable database
adapter/migration and rate/timeout admission tests. Any new SQL execution needs an exact separately approved
isolated package; persistent installation, credentials, deployment/provider changes and real testing are later
explicit boundaries. No owner payment, secret disclosure or provider setup should be requested prematurely.
