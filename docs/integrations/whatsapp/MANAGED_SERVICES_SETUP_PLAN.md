# Thaara V2 managed services — proposed setup plan

OWNER DIRECTION UPDATE: owner asked to try the existing Hostinger VPS. External provider signup is DEFERRED for the proposed PRIVATE synthetic pilot; do not repeat Neon setup as the current blocker. [VPS preparation](../../tasks/108.8-whatsapp-vps-pilot-package.md) is local-only and does not waive production managed-service requirements. Separate server access, test credential-file exception, new infrastructure/SQL/deployment still require explicit scoped approvals. The provider options below remain future production candidates, not services created.

27 October2026. Owner confirmed no dedicated managed PostgreSQL/Redis/secret service exists and requested this plan. **Provider/account/resource/credential setup is not yet approved or executed.** New accounts/projects must be owner-controlled and isolated from legacy services. No purchase, auto-upgrade, API key, secret or database was created while researching this plan.

## Recommended initial pilot candidates

| Purpose | Candidate | Verified public entry tier | Admission condition |
|---|---|---|---|
| Managed PostgreSQL | Neon | Free,$0; no credit card required; current page lists1GB/project and100CU-hours/month/project | Dedicated V2 pilot project, restricted SQL-created app role, tested managed-provider role/RLS/function ownership compatibility, TLS and backup/restore/quotas accepted before use |
| Managed Redis | Upstash Redis | Free,$0;256MB,500K monthly commands,10GB bandwidth | Owner-claimed dedicated database, TLS Redis protocol, bounded usage; no unowned72-hour scratch DB; no automatic paid upgrade |
| Managed secrets | Infisical Cloud | Free,$0;5 human/machine identities, unlimited projects,3 environments | Dedicated V2 project/project-scoped read-only workload identity, short-lived access, verified free-tier access boundaries; no organization-wide admin runtime token |

These are pilot candidates, not certified production tiers or guaranteed compatibility. Production HA, recovery, encryption/access-control requirements and data retention need explicit acceptance/appropriate tiers. Existing Hostinger capacity is reused only after separate deployment approval; no new VPS purchase is proposed. Published pricing can change; verify checkout and limits before account/resource creation. No paid trial/card/upgrade is authorized. Account ownership/login is performed privately by the owner, not in chat.

## Important compatibility checks before creating runtime credentials

Neon Console/API/CLI-created roles inherit neon_superuser membership; do NOT use one as Thaara's application login. Create the restricted app role using the separately reviewed SQL provisioning path, then test no superuser/BYPASSRLS/CREATEROLE/CREATEDB/replication/admin/worker/guard membership under the actual login. Check NOLOGIN definer roles, ownership changes and SECURITY DEFINER behavior under the provider migration role. Do not install Neon Auth/Data API/Realtime or replace Thaara authentication. Use ordinary PostgreSQL/pg transactions. Choose from actual available regions; no Mumbai availability is assumed. Provider-specific acceptance is unrun; the disposable local35 cases do not establish Neon compatibility.

Upstash supports BullMQ over Redis/TLS, but its official guide notes BullMQ polls even while idle and recommends fixed plans for that workload. Keep background workers OFF for the small initial WhatsApp pilot unless a command budget is verified. Fixed pricing currently starts$10/month; that upgrade would require a separate explicit purchase approval. Free-tier limits are not a safe unlimited queue budget. Do not use the documentation's unauthenticated scratch-database creation endpoint: it is unapproved infrastructure and expires after72 hours. Redis/BullMQ command/TLS/latency/reconnect and fail-closed behavior still need actual acceptance; managed compatibility is not inferred from the product name.

Infisical project identities can be limited to their own project and use Viewer access; Universal Auth exchanges private Client ID/Client Secret for short-lived tokens. Verify effective permissions on the selected tier before provisioning. Keep runtime identity separate from migration/bootstrap identity; no client secret in source, browser, workflow export, chat or CLI arguments. Bootstrap secret protection and rotation are still required; a secret manager does not remove that requirement. Managed resolver implementation and failure/revocation tests remain coding work before runtime use.

## Owner/developer sequence

1. Owner approves these candidates/account-connection scope or selects alternatives. No service creation/migration/deployment follows from merely approving a provider name.
2. Owner signs into or creates their own accounts on the official provider sites. Final signup/consent is completed privately. Do not enter a payment card, start a paid trial or purchase a plan for this pilot. Stop if the provider requires payment instead of the stated free plan.
3. Connect the Neon integration using its available plugin only with owner consent; use scoped account access. Provider discovery found a Neon integration, but no corresponding Upstash/Infisical account connector; a Redis documentation plugin is not an Upstash account connection. Do not install unrelated plugins or ask for pasted tokens.
4. Prepare the exact new project/database/environment names, provider region, quotas, managed identities/roles and rollout/rollback. Before any resource creation or credential change, obtain a concrete scope approval. Do not run SQL or migrate an existing database.
5. Implement/review managed driver/profile admission and produce versioned target-specific SQL plus provider acceptance tests. Obtain the distinct new SQL/test approval; use only the newly approved V2 target, never development/legacy/1085 fixture as hosted data. Keep provider sending disabled.
6. Owner creates private credentials only when matching storage/provisioning is ready. Store DATABASE_URL/REDIS_URL/session/CSRF and separate relay/dispatch credentials through the reviewed managed-secret setup; never paste them here. Return only project IDs, region/plan and masked hostname metadata. The developer verifies access with non-secret read-back and approved tests.
7. Finish the concrete Hostinger deploy package for thaara-v2.quantumweaveai.io, including proxy/network/TLS preflight, separate services/data and rollback. Ask one consolidated approval for its actual sensitive changes. Synthetic HTTPS proof precedes separately approved workflow activation and one exact test-number message.

No owner credential creation is requested today merely to fill scaffolding; first select the providers and establish the reviewed matching runtime/provisioning path. Existing dedicated Meta credentials remain preserved. Meta App ID is still missing; provided phone/messaging IDs are not verified asset ownership.

## Official sources reviewed

- [Neon pricing](https://neon.com/pricing), [database roles](https://neon.com/docs/manage/roles), [regions](https://neon.com/docs/introduction/regions).
- [Upstash Redis pricing](https://upstash.com/pricing/redis), [BullMQ/TLS and idle billing guidance](https://upstash.com/docs/redis/integrations/bullmq).
- [Infisical pricing](https://infisical.com/pricing), [project machine identities](https://infisical.com/docs/documentation/platform/identities/machine-identities), [Universal Auth](https://infisical.com/docs/documentation/platform/identities/universal-auth).
