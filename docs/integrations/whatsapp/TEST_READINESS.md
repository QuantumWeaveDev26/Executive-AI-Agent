# WhatsApp test readiness — current checkpoint

Current owner direction: [VPS-only private pilot package](../../tasks/108.8-whatsapp-vps-pilot-package.md) locally built/checked,54 focused tests passed. External provider signup deferred. No hosted API or running pilot yet: dedicated new SSH access needs explicit root-key approval/trusted server identity, then new target-specific SQL/runtime/private-deployment approval. Production managed-service and LIVE/Meta/message gates remain unchanged. Do not describe a local image build as end-to-end WhatsApp readiness.

Latest hosting update: [read-only Hostinger review](HOSTING_PREFLIGHT_RESULTS.md) complete; planned thaara-v2.quantumweaveai.io owner-selected, VPS conditional candidate. Managed data/secret services absent; [setup proposal](MANAGED_SERVICES_SETUP_PLAN.md) awaiting provider/account selection. No hosted backend, deployment, migration or sending enabled. Earlier account-access gap is resolved; production/LIVE gates remain open.

**Ready for isolated synthetic backend tests; not ready for a real-number message.** Same coordinated master task. No new prompt needed per feature.

| Capability | Evidence / remaining gate |
|---|---|
| Durable storage, tenant/owner/RLS and audit boundary |35/35 real PostgreSQL cases pass in the approved isolated fixture; [results](CALLBACK_RUNTIME_RESULTS.md). No production installation. |
| Authenticated n8n callback principal | Real restricted-role PostgreSQL and full registered API injection passed. Distinct machine identity, operation/revision/expiry/revocation; no fake session. |
| Owner status, approved reservation and disconnect | Scoped durable API and existing dispatch path use durable reserve.5/5 new focused tests, full API PostgreSQL assertions passed. Auth/CSRF/exact approval/idempotency/disconnect fencing. No provider submit. |
| Stored conversation screen and catalog | Source and earlier184 focused tests passed; catalog/inbox now also exercised against real fixture SQL/default API/session. Mounted browser/CSP remains unverified because browser tooling cannot initialize. Composer/Chat sending still uses preserved offline foundations; no LIVE claim. |
| Required n8n workflows | Existing incoming/outgoing IDs preserved and freshly read inactive, no active version, I/O disabled, literal false send gate. Remote graphs still have placeholder backend origin/connection. Dedicated Meta credential setup owner-reported done; sanitized mapping output inconclusive. |
| Actual public backend | Owner confirmed NOT HOSTED. Hostinger preferred if suitable; [read-only account connection gate](HOSTING_CONNECTION_GATE.md). No public Thaara origin yet. |
| Outbound profile and private secrets | Internal HTTP adapter has focused tests but is unregistered. Hosted managed-secret/profile admission, rotation/revocation and distinct backend/webhook credentials still pending. Existing durable schema permits offline_test only. |
| Provider acceptance and eligibility | App/WABA/phone/test recipient binding, deployed node/provider version/signature, correct subscription, business purpose and applicable Meta AI eligibility must be established. No Meta API call or registration done here. |
| Workflow activation and one-number pilot | NOT AUTHORIZED/NOT RUN. Only after PostgreSQL, hosted authentication, admission and Meta gates pass, request explicit activation and one exact test message approval. Never infer delivery from acknowledgement. |
| Media, templates, Chat and natural commands | Future nodes/scaffolding do not establish supported functionality. Complete/review under the same master task after their dependencies; no fabricated success. |

Owner setup principles: retain completed dedicated Meta credentials; never request tokens/App Secret/OTP/private keys in chat. Owner privately signs in or creates credentials only when matching backend storage/configuration exists. Account access, deployment, production migrations, service changes and real sends remain distinct explicit sensitive approvals.

Verification milestone: full build/lint/typecheck passed; fresh982/982 non-runtime tests across87 files passed, zero failed/skipped, exact inventory verified with retained batch JSON. [Final evidence](OWNER_API_RESULTS.md). Historical941 baseline is not relabelled as this run.
