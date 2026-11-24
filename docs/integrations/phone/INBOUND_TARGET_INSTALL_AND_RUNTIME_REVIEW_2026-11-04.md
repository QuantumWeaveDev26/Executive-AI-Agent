# Inbound reporting — target-specific install and runtime admission review

REVIEW ONLY. No installer/runtime route is activated and no SQL was executed.

## 5 November update — minimum appointment rollout delta, draft only

The latest hosted-gate validation is the historical 9/9 PASS result in
`PHONE113_HOSTED_GATE_VALIDATION_RESULT_2026-11-04.md`; the earlier unexecuted-gate statements below
describe the original package. Do not repeat that fixture run or reuse its consumed approval.

Fresh database-free source reduction still has 10 unresolved effects and 269 unverified preconditions
(279 blocking, unverified source-bound conditions): one optional-extension schema, three ALL IN SCHEMA
ACL collection-coverage effects, three session search-path effects, one conditional membership-grant
effect and two data-dependent statements. The three collection effects retain the reducer's broader
`acl-effective-grantor-unverified` reason; their ACL blockers identify collection coverage. None is
discharged by UI work or passing local tests. `expectedCatalog:null`, `staticResolutionComplete:false`,
`productionAdmission:false` and `executionAuthorized:false` remain mandatory. There is no safe count
reduction from merely reclassifying these obligations. Fresh focused verification: 80/80 PASS across
three source-model suites, zero failures/skips; `node_modules/.cache/phone-f03-minimum-20261105.json`.

The minimum deployment package must distinguish these two existing local paths:

| Path under `/api/v1` | Trusted identity and remaining configuration |
|---|---|
|`POST /connectors/phone/inbound/reports/:reportId/appointment-proposal`|Owner UI review of an already durable consent-backed report. Existing `requireAuth` and exact current owner-session checks bind workspace/user/role before reading the report. Register and compose the owner route with the admitted journal repository and existing Calendar bridge only after runtime admission review. No Sarvam service token, in-call Calendar delegation or Sarvam tool attachment belongs to this path.|
|`POST /connectors/phone/inbound/appointment-requests/:routeId`|Separate during-call service path. Server-selected profile binds route/workspace/owner/principal/revision/app/version/deployment/number and 300-second limit. `buildAppointmentBinding` derives a distinct fingerprint from the base fingerprint, exact interaction ID and `operation:'appointment_request.v1'`. Provision a separate expiring/revocable grant matching that fingerprint, route and `callback` operation; a generic report grant cannot substitute. Production call-bound resolution/provisioning and trusted owner delegation are still required before attachment.|

Both route/service compositions were test-only and unregistered at this source review; a local UI or
later route-wiring change does not admit production. For the service path, the existing
`resolveProposalOwnerSession` port requires separately delegated, server-only resolution of an actual
existing owner session, then independently checks it against the database. No production resolver is
installed. Never give Sarvam an owner cookie/session/hash or point a Sarvam tool at the owner-review
route. The owner-review path needs no such service delegation, but still needs durable admitted capture
before it can find an inbound request. Provider acknowledgement never confirms a booking: the existing
Calendar approval/PolicyGateway and verified event readback remain required.

Before any provider-tool configuration approval, the concrete package must pin the admitted public
service URL, request/response schemas, exact committed deployment/version/number/profile, supported
secure service authentication and call-scoped grant lifecycle; verify provider transport/direction and
interaction binding; define finite request/shared-rate limits and rollback that leaves live v5 intact.
No supported provider field mapping, grant lifecycle or transport capability is inferred from the
local route. Existing live v5 has no attached custom tool according to the 5 November read-only check.
Owner review can precede this tool attachment once its own durable-runtime prerequisites are met.

Smallest next step is the existing independent review of the conditional source model and approved
base/expected semantic catalog contract, followed by separately authorized exact-version evidence for
the remaining external/data/context obligations at their proper stages. Original base prerequisites
are not instructions to rerun base migrations against hosting. F-03 reference approval, protected
verification and fresh recovery/install/identity/runtime acceptance remain unfinished. No production
execution, credential setup or provider-tool attachment approval package is ready from this delta.
No owner setup is requested now; no approval flags, gates, SQL, kernel or runtime code were changed.

## Prepared artifacts and evidence

`112h-phone-inbound-events.hosted-review.sql` and `113h-phone-inbound-principals.hosted-review.sql`
under `docs/migrations/` are NEW target-specific candidates. Generator/checker:
`scripts/phone-inbound-hosted-install-review.mjs`. Exact SQL hashes and historical inventory receipt
hash appear in `INBOUND_HOSTED_INSTALL_REVIEW_2026-11-04.json` (installationAllowed:false,
runtimeEnabled:false, productionReady:false). Do not edit its flags to authorize installation.

The read-only hosted inventory established expected PostgreSQL16/base schema and absence of the
specific inbound objects/roles at that time. The inventory cannot authorize installation, identify
the Thaara owner, establish current TLS/secret compliance or prove future absence of conflicts.

Fresh15/15 local checks PASS, covering both SQL transformations, source changes, disabled draft guards,
exact historical receipt checks and rejection of uncertain/conflicting facts. Receipt:
`node_modules/.cache/phone-inbound-hosted-install-review-20261104.json`. Text-only candidate check PASS;
whitespace PASS. Independent review found no blocking defect in the review-only transformation.
Earlier9/9 actual PostgreSQL tests cover the unchanged schema/service body; NEW hosted admission
preconditions have NOT been executed in PostgreSQL. Do not claim those gates runtime-validated.

## SQL admission and installation sequence

Both candidates require exact `thaara_vps_pilot`, PostgreSQL16, session/current installer `postgres`
without role substitution, and a NEW separately approved step-specific installation setting.
Transactions retain lock3s/statement30s timeouts and set pg_catalog-only search path before admission.
Check required base tables/functions, app/worker role presence and dangerous direct flags, forced RLS
on membership/session/audit tables and collisions with the new policy namespace before DDL.
112h additionally refuses service roles/principals/functions already present. Original object-collision
checks and the complete tested schema/privilege/RLS body remain unchanged.

Required future runner sequence: verify immutable source/target identities and all source pins; apply
112h ONCE; verify its exact resulting columns/types/constraints/owner/RLS/policies/grants against the
approved schema; only then apply113h ONCE. Recheck source pins and target identity between phases.
113h alone currently checks journal existence, not its full definition. It must never adopt an
unverified existing112 journal. A confirmed same-run112 receipt plus catalog verification is mandatory.
The future runner/verification is NOT implemented by this review package.

No migrations discovered automatically, no CREATE IF NOT EXISTS adoption, no LOGIN/password/membership
provisioning inside these candidates. Service identities are created NOLOGIN; guard never becomes a
general login or grants membership. App/worker/role-membership privileges and base-object ownership
require exact independent review before any install; current checks are not a complete privilege audit.

## Runtime admission design — remain disabled

Preserve every existing NODE_ENV=test guard until a separately reviewed runtime composition is ready.
Never use NODE_ENV=test in hosting to bypass them. Admission must resolve the actual authenticated
Thaara workspace and active owner; no Sarvam workspace substitution or synthetic-owner inference.
Dedicated expiring/revocable principal binds exact route, revision, committed inboundv5 deployment,
number and canonical profile fingerprint. Token hashes are provisioned only through approved secure
identity setup; no token, password or file contents in this artifact or chat.

Use distinct restricted ingest and owner-session read pools. Keep existing per-request grant/membership
checks and transaction-scoped policy+append+audit. Owner feed uses current owner session/RLS and audits
full Details access. Provider credentials do not grant owner access; owner cookies do not grant ingestion.
No receipt before commit; failed/uncertain commit yields unconfirmed response and no invented callback.

Shared ingress limits, body/connection/statement bounds, replica topology and sensitive proxy/application
log suppression must be admitted explicitly. Existing process-local tests do not prove shared limits.
Provider direction/auth/metadata and save-acknowledgement contract remain unverified for live integration.
Never infer direction or approval from model variables alone.

Callback consent produces callback_requested, not booked_appointment. Calendar booking remains disabled
unless an approved backend creates/verifies the exact event. Recording/transcript retention stays off
until supported authenticated retrieval, caller notice, access/expiry/deletion controls are approved.
Keep outboundv6 admission/dispatch and all existing calling approval/limit controls unchanged.

## Recovery and preservation

Fresh protected backup and verified isolated restore are required immediately before persistent SQL.
The successful31Oct backup/restore is historical; do not repeat it or use consumed approval without
a new scoped package. No data is restored over the pilot under this plan.

Each candidate is transactional. If112h fails, stop; transaction rolls back. If113h fails after112h
committed, keep reporting disabled, preserve both receipts and existing data, and prepare forward repair.
Do not rerun112h, adopt partial objects, DROP CASCADE, downgrade schema or restore an old full backup.
For runtime/provider failure, disable the NEW reporting path or restore only its separately approved
configuration; preserve working inboundv5 telephony and all integrations. Exact disable operations
must be part of the eventual approved deployment, not improvised during an incident.

## Hosting and approval boundaries

AGENTS.md requires managed services, TLS/backups and managed secrets for production. The existing
Hostinger README's self-hosted resources are for a synthetic pilot; the inventory did not extend that
exception to customer callback data or private-file runtime secrets. Before real-customer persistence,
either meet production requirements or obtain a specific controlled private-pilot exception with scope,
retention, owners and expiry. Existing VPS preference alone is not that exception. No new account or
credential is requested now, and no payment or infrastructure change is authorized.

Next safe preparation: a new exact disposable fixture package to validate the NEW hosted gates,
including wrong target/version/installer, absent approval, role/RLS/policy collisions and no mutation
on refusal. Requires new local infrastructure/SQL approval before running. Reuse unchanged body/service
acceptance evidence rather than rerunning it without reason.

After gate validation, prepare scoped recovery/install/identity/secret/runtime/provider/deployment and
one controlled owner-made inbound acceptance packages. Every external action needs its concrete owner
approval. No current permission to connect again, create databases, install, deploy, provision or call.
Preserve Chat/Gmail/Calendar/WhatsApp/n8n/outbound and Antigravity's worktree; no shared source changes,
merge, commit or push. All previous consumed markers and evidence remain intact.
