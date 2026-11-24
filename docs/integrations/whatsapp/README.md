# Thaara WhatsApp through n8n — Step 108.2 manual setup and boundaries

FINAL CURRENT CHECKPOINT: [owner API milestone](OWNER_API_RESULTS.md)982/982 non-runtime tests across87 files, full build/lint/typecheck passed; actual approved PostgreSQL35/35 passed including full default API. [Readiness matrix](TEST_READINESS.md), [Hostinger account-access scope](HOSTING_CONNECTION_GATE.md). No whole-integration/LIVE claim. Older underway/UNRUN notes below retain historical scope.

CURRENT: [isolated PostgreSQL35/35 PASS](CALLBACK_RUNTIME_RESULTS.md), including full default API/session/CSRF/stored inbox/reservation/callback/disconnect checks on repeat. Durable owner controls now use scoped PostgreSQL; sends remain false/offline. Owner says backend is not hosted; Hostinger preferred if suitable. [Hosting/account-access gate](HOSTING_CONNECTION_GATE.md) explains the next concrete boundary. Full production profile/managed-secret/LIVE/HTTPS/Meta acceptance and approved pilot remain open. Older UNRUN or missing-workflow/credential claims below must not override this checkpoint.

Latest27 October callback checkpoint: [Step108.5 preflight](CALLBACK_RUNTIME_PREFLIGHT.md). Durable callback HTTP wiring and separate database-owned principal source prepared; fresh188/188 focused tests passed. New SQL/runtime behavior remains UNVERIFIED;35 prepared PostgreSQL cases need a new isolated fixture/SQL approval. No infrastructure or SQL executed. Real sends remain disabled. Older manual credential/import instructions below are historical: both dedicated credentials are owner-reported created/tested and two inactive workflows already exist; do not recreate them or infer assignment absence from sanitized metadata.

Newest source checkpoint: [stored-conversation screen/account discovery](STORED_INBOX_SCREEN.md),184/184 focused and relevant builds/typecheck passed. New panel binds authenticated stored-data APIs, preserves the old demo separately and keeps sending disabled. No new SQL, account/credential/workflow action or service startup. Actual browser/catalog PostgreSQL/LIVE acceptance remains unverified. Resume callback-principal/managed-secret/durable admission work under the same task.

Final27 October verification: backend inbox feature completed, **941/941 tests across82 files** covered in original/resumed runs; build/lint/typecheck passed. Original root verifier ended before summary, so its exit1 is preserved in [exact handover](../../THAARA_DAILY_HANDOVER_2026-10-27.md). No relevant source changed between partitions. App source now has authenticated read-only durable inbox wiring; configured local pages unavailable, no server restart or SQL application. UI/Chat/production callback admission and real WhatsApp remain incomplete.

27 October: [authenticated durable inbox](DURABLE_INBOX.md) implemented in source, backed by existing scoped PostgreSQL store with literal search/stable pagination. New focused15/15 and independent review passed; final full verification is in [latest handover](../../THAARA_DAILY_HANDOVER_2026-10-27.md). Current server/schema not started/applied; UI/Chat binding and machine callback authentication still pending. Permanent owner setup is recorded; sanitized workflow omission must not be treated as proof of missing credentials.

Newest code evidence: [governed outbound transport implementation](TRANSPORT_IMPLEMENTATION.md), **110/110 focused**, API build/typecheck and contracts build passed. New adapter is internal/unregistered; strict endpoint/DNS/TLS/scope/revision/authorization/response/deadline boundaries tested using mocks only. Existing routes remain default-not-configured. No LIVE callback authentication, durable HTTP registration or production secret provisioner delivered by that adapter.

Latest continuation: [synthetic readiness and exact publish/pilot blockers](READINESS_RESULTS.md). Outgoing false-gate checks passed via a temporary manual/sentinel harness, now removed; both workflows remain inactive with no credentials assigned and all I/O disabled. Fresh focused tests 58/58. Local API 3002 refused probes; no authenticated round trip or Meta eligibility proof. Historical 21/21 PostgreSQL acceptance remains unchanged evidence; no new migration or real send.

Current setup: both required remote workflows have now been CREATED with owner authorization and read back inactive with all I/O disabled. Credential/account setup is performed by the owner. Use [current owner setup](OWNER_SETUP.md) for workflow links, credential mappings, required non-secret IDs and remaining runtime dependencies. Earlier no-import/remote-approval-pending statements below describe historical Step 108.2 evidence. Application remains NOT LIVE; no provider call, message or activation occurred.

Latest evidence: [Step108.4 approved runtime validation](../../tasks/108.4-whatsapp-postgresql-runtime-results.md) passed 21/21 restricted PostgreSQL tests and 38/38 focused follow-up checks. New corrected SQL was applied only to the disposable fixture. Earlier pending runtime wording below is historical. Production connection and real messages remain disabled; no remote workflow/credential/Meta action was authorized or performed. Continue the same master task with the next scoped remote-setup approval.

**State: offline foundation only. No workflow was imported, registered, activated or executed in n8n. No Meta account, credential or phone registration was created.**

## Architecture

Thaara Chat/UI -> authenticated Thaara backend -> n8n -> official Meta WhatsApp Cloud API.

Meta -> official n8n WhatsApp Trigger -> authenticated HTTP relay -> Thaara-owned inbox/receipt processing.

Thaara remains the authority for workspace/user membership, contacts, recipient binding/opt-in, approval records, PolicyGateway, duplicate suppression, durable storage and outcome verification. n8n is a transport/automation boundary, not an approval authority. Incoming messages never connect to a send or Chat-agent node.

## New local exports

- `THAARA_V2_DEV_WHATSAPP_INBOUND_1082.json`: one WhatsApp Trigger handles both inbound text and sent/delivered/read/failed status events; HTTP Request relays its event value to Thaara.
- `THAARA_V2_DEV_WHATSAPP_OUTGOING_1082.json`: Header-auth Webhook accepts an opaque dispatch reference; HTTP Request asks Thaara to claim it; a strict IF gate leads to the official WhatsApp Business Cloud send node and an acknowledgement callback. The false branch returns not_configured.
- Matching `.workflow-sdk.ts` files were checked by n8n's read-only workflow validator. They are validation sources, not an installed project dependency.
- All exports have `active: false`, no top-level workflow ID and no credential references/values. Provider, trigger and HTTP nodes are disabled. The send gate contains a literal false condition that no request can enable. Future media-upload/template nodes are disabled and disconnected; validator warnings about those disconnected nodes are intentional.
- Execution payload retention is off for successful, failed and manual executions. Check instance-level logging/access restrictions too before live data is permitted.
- Callback URLs use reserved `https://thaara.invalid` placeholders. Do not change them or enable nodes as an accidental way of activating this foundation.

## Backend interfaces

User routes (existing cookie authentication and CSRF for mutations):

- GET `/api/v1/connectors/whatsapp/n8n/status`
- GET `/api/v1/connectors/whatsapp/n8n/messages`
- POST `/api/v1/connectors/whatsapp/n8n/dispatches` with `{ draft, approvalId }`
- DELETE `/api/v1/connectors/whatsapp/n8n/connection`

Machine callbacks use a distinct, per-connection Bearer credential, never browser sessions:

- POST `/api/v1/connectors/whatsapp/n8n/relay/<connectionId>/events` with `{ event }`
- POST `/api/v1/connectors/whatsapp/n8n/relay/<connectionId>/claim` with `{ dispatchId, connectionRevision }`
- POST `/api/v1/connectors/whatsapp/n8n/relay/<connectionId>/receipts` with `{ dispatchId, providerMessageId, recipientAddress }`

The connection ID selects a trusted server binding; payload workspace/user claims are rejected. Exact envelope keys are checked before JSON validation can strip extras. The standard app auth plugin still owns actual user sessions/CSRF. New HTTP tests use clearly labelled database-free fixture guards, not a claim of new database/RLS testing.

The bridge is dependency-injected ONLY in NODE_ENV=test. Default development/production status is not_configured; no real HTTP transport is configured. The provided HTTP transport requires an explicitly injected mock fetch, fixed HTTPS webhook path, header-only credential and redirect refusal. Existing create-only n8n REST transport/permissions are unchanged and are not reused for dispatching.

The backend sends n8n only an opaque dispatch ID and revision. n8n obtains recipient/body/sender only from a fresh authenticated backend claim. A claim checks the original exact approval, owner/workspace, sender/revision, recipient allowlist, opt-in, reply context and 24-hour window again. Claims are one-use and expire after 60 seconds. This step always returns dispatchEnabled=false. Even synthetic correlated sent/delivered/read events remain mode=offline_test and verified=false. HTTP acknowledgement alone is unverified; uncertain dispatches are never automatically resubmitted.

## Authentication and secret ownership

1. Meta provider credentials live in n8n, not Thaara or the browser. Use NEW credentials, not any existing workflow's credentials.
2. n8n -> Thaara uses a separate relay secret, stored in an n8n **Bearer Auth** credential for the HTTP Request nodes. Thaara's future managed vault must hold the matching scoped verifier.
3. Thaara -> n8n uses a DIFFERENT dispatch secret. Outgoing Webhook selects **Header Auth**; credential header name is `Authorization`, with full value `Bearer <privately provisioned dispatch secret>`. Thaara uses its matching server-side secret. These are not n8n administrative API keys.
4. The test bridge reuses WhatsAppVault AES-256-GCM with workspace/user AAD and a connection/revision purpose. Only synthetic secrets are supplied today. No real secret was requested, generated or added to .env. Do not reuse Google vault keys or session secrets.
5. Original Meta challenge/signature ownership moves to the official n8n Trigger. Current official source validates raw-body X-Hub-Signature-256 using Client Secret and emits change.value plus field, dropping the original WABA envelope. Thaara authenticates the separate n8n relay and verifies the trusted phone ID; it does NOT fabricate/re-sign an original Meta envelope or claim independent Meta signature verification.

## Mandatory gates before connecting anything

### Step 108.3 durability preparation

The coordinated master task prepares an audit-provenance correction before PostgreSQL authorization. The revised SQL has four domain tables plus a DB-controlled proof ledger. Proofs bind full transaction ID, owner/connection/action, next connection version and dispatch identity where applicable; child writes require the carrier's exact audit ID. Source WhatsApp audits are guarded against mutation/relabeling. Static review and repository tests are not runtime proof: the artifact remains unapplied and all 21 PostgreSQL cases remain unrun. Use the current checksum/approval scope in [Step 108.4](../../tasks/108.4-whatsapp-postgresql-safe-preflight.md), then resume the [same master task](../../tasks/108-whatsapp-integration-master.md). Database approval does not authorize workflow imports/activation or sending.

The separate `DurableWhatsAppService` and `PostgresWhatsAppStateStore` implement an offline storage/claim boundary. The PostgreSQL store locks an owner-scoped connection row, reads messages/dispatches/status events, resolves locked approvals, and commits changes with audit correlation. Disconnect retains a revision tombstone and idempotency/receipt records. Consumed claims remain unverified until correlated synthetic status evidence; they never become reusable after a crash or an unknown outcome. All results remain offline_test/verified=false and claims return dispatchEnabled=false.

The additive [1083 SQL review artifact](../../migrations/1083-whatsapp-durable.review.sql) is OUTSIDE automatic migration discovery and has NOT been executed. It proposes four forced-RLS owner/tenant tables, restricted grants, unique deduplication/idempotency/provider keys and audited immutable-transition guards. Its explicit approval/target-database guard must not be bypassed. The separately gated `whatsapp-durable.runtime.test.ts` contains no schema installation and remains pending authorized isolated PostgreSQL preparation. Transactional-double and query-boundary tests are not PostgreSQL persistence/RLS evidence.

Current HTTP routes still use the preserved Step 108.2 test bridge and default to not_configured. The new durable service is not registered in buildApp and accepts authenticated server scope only; it is not a browser-controlled callback principal. Production callback principal/relay authentication, repository admission, secret lifecycle, retention/purge/export, bounded capacity/archival and real transport are separate reviewed gates. No real callback or data should be pointed at this foundation.

The kickoff read-only n8n inventory found credential metadata “Thaara WhatsApp Test” and “Thaara WhatsApp Trigger”, but no matching Step 108.2 workflow names. Do not recreate, inspect values or attach those credentials automatically. Names do not prove asset binding, dedicated app ownership or valid token scopes. No remote changes were made.

- Implement/review durable Thaara-owned inbox, dispatch reservations/claims, receipt correlation and deduplication with tenant/user authorization, RLS, transaction atomicity, revisions/tombstones and crash recovery. Current memory maps are bounded synthetic scaffolding, not persistent or multi-worker protection. No migration was applied here; storage/schema changes need their own approval.
- Wire production approval repositories, active-membership checks, audits and transport authorization. Test callbacks are not a production service principal. Ensure claim approval/revocation checks run immediately before sending.
- Establish an owned HTTPS Thaara callback and n8n webhook origin, HTTPS certificate validation, request/rate limits, service credentials and deployment key management. Never use public request-bin sites or payload-supplied callback URLs.
- Verify the deployed n8n version/WhatsApp node actually includes Meta signature validation and uses a currently supported Graph API. Thaara's inherited test binding graphVersion is compatibility metadata, not control of the n8n node's provider version.
- Resolve Meta Business Platform business-use and AI-provider eligibility. n8n does not bypass Meta terms, opt-in/opt-out, template approvals or the 24-hour messaging window. No unrestricted personal account/history/contact access is provided.
- Keep all send/trigger/HTTP nodes disabled, both workflows inactive and the hard false gate intact until a separately approved deployment/test procedure. Do not permit node-by-node manual execution against real credentials.

## Exact future manual Meta/n8n setup (requires separate approval)

1. **Check eligibility and inventory first.** Confirm the business purpose and authority over the NEW number. Use a dedicated Meta app for these new workflows; never reuse an app/credential already receiving another workflow's callbacks. Meta allows only one WhatsApp webhook/Trigger per app. Testing or activating a Trigger can register/replace subscriptions, so do not click Listen/Test/Publish today.
2. **Prepare Meta assets manually after approval.** Meta developer account -> authorized Business Portfolio -> dedicated business app -> WhatsApp product -> API Setup. Start with the Meta-provided test number and explicitly authorized test recipients. Record non-secret WABA ID and phone-number ID accurately; they are different identifiers.
3. **For the user's new real number later:** verify business ownership and number control through Meta's official setup/OTP flow, check display-name/business-verification requirements and current billing rules, and obtain any required business permissions. A number already registered elsewhere needs a separately reviewed official migration/coexistence plan; never delete its existing registration to force onboarding. None of these actions is authorized/executed by this task.
4. **Create NEW n8n credentials privately after approval:** WhatsApp Trigger OAuth2 credential uses Meta App ID as Client ID and App Secret as Client Secret. WhatsApp Business Cloud API credential uses Access Token and WhatsApp Business Account ID. Scope tokens to the intended assets/permissions and review expiry/rotation. Never paste values into Thaara source, exports, logs, screenshots or this chat.
5. **Import as NEW inactive workflows only.** Check n8n for both exact names before import; stop on a conflict. Import each JSON through n8n's Import from File workflow, never over an existing workflow. Do not attach existing credentials or change existing workflows. Confirm inactive state and disabled nodes after import. Import was NOT performed here.
6. **Confirm public HTTPS origins and trusted profiles.** The future callback endpoints follow the paths above. Outgoing n8n endpoint must be `https://<N8N_ORIGIN>/webhook/thaara-v2-dev-whatsapp-approved-1082`. Replace only reviewed placeholder origins/connection IDs in NEW exports after server-side storage/authorization is ready. No inbound data may supply URLs, tenant IDs or secrets.
7. **Bind separate credentials and verify callback ownership after explicit connection approval.** WhatsApp Trigger handles the challenge automatically using its node ID; there is no user-specified verify-token field in its credential. If Meta manually requests a verify token, use the exact node ID shown/generated by n8n, never the old Step 108.1 backend verify token. Confirm the same dedicated app is subscribed to the correct WABA; checking test-event delivery alone does not prove this. Do not remove or replace another app's subscriptions.
8. **Only then plan a limited authorized exercise.** Prove inbound authentication, no automatic replies, duplicate handling and truthful statuses before separately approving any outbound message. Enabling sends requires more than credential mapping: reviewed durable backend grants/leases, a reviewed change to the hard deployment gate and node enablement are still required. Do not enable retries on non-idempotent send nodes.

## Supported scope and future work

Current inbound parser supports synthetic text/status events only. Media and approved templates are present as disconnected future nodes, not working media/template runtime features. In-thread replies require confirming the deployed official node's context support before claiming provider-native threading. Existing WhatsApp UI/Chat remain their preserved mock/offline implementation; the new backend API is ready for synthetic integration, not fake LIVE conversation display.

Follow-up: Step 108.4 should separately authorize disposable PostgreSQL-only schema/RLS/concurrency validation of the Step 108.3 SQL and runtime suite, without enabling application callbacks or sending. Review runtime findings before later production repository/principal/secret/transport wiring. Dedicated Meta setup, workflow imports, activation and any test-recipient send remain separate approvals. Do not register/send from the new real number under these foundations.

## Official references

- https://docs.n8n.io/integrations/builtin/credentials/whatsapp/
- https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.whatsapptrigger/
- https://raw.githubusercontent.com/n8n-io/n8n/master/packages/nodes-base/nodes/WhatsApp/WhatsAppTrigger.node.ts
- Node definitions/versions and both SDK graphs were read-only validated through the official n8n plugin. No workflow/credential/execution write tool was called.
