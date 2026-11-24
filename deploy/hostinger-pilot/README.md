# THAARA AI V2 — private VPS pilot preparation

REVIEW / LOCAL BUILD ONLY. This is not a production deployment or a working hosted WhatsApp integration. Owner preferred trying the existing Hostinger VPS; Neon/Upstash/Infisical setup is deferred, not required for this proposed private synthetic pilot.

## Target and boundaries

- VPS1871828 / srv1871828.hstgr.cloud /76.13.217.50. New project thaara-v2-pilot, networks thaara-v2-pilot-data/entry and volumes thaara-v2-pilot-pgdata/redisdata. Abort on any existing-resource collision; Hostinger project creation can overwrite an existing project.
- PostgreSQL and Redis have no host ports and use an internal data network. API only127.0.0.1:15440 ->3002; no public proxy, DNS, n8n/workflow/provider connection or worker. The application profile is opt-in. Planned public hostname remains thaara-v2.quantumweaveai.io, unchanged.
- Memory limits384MB PostgreSQL +192MB Redis +512MB API; CPU limits0.5+0.25+0.5. Metadata headroom does not replace a load test. Do not alter existing resource limits, ports, volumes or services, especially legacy Thaara5000/8080 and n8n/Traefik80/443.
- Explicit synthetic-only acknowledgement; production environment and inherited database/provider overrides denied. API runs as1000:1000, read-only, no Docker socket, administrator secret or schema permission. No real business data or provider credentials. Secrets must be distinct, strong and readable only by their intended container/user through a protected new host directory; actual ownership/mount behavior is UNTESTED until approved runtime validation.
- PostgreSQL/Redis are self-hosted TEST resources. Production still requires managed services, TLS/backups and managed secrets. Temporary protected-file pilot credentials would be an explicit exception to the deployed managed-secret rule requiring owner approval. That exception is NOT applied by preparing these files. No SQL, credential generation or automatic migration occurs on API startup.

## Files and local evidence

compose.review.json is a review Compose model. pilot-config.mjs rejects unsafe target/name/image/ports/mounts/secret/env/API-entrypoint changes; this complements exact reviewed artifact checksums, not a general arbitrary-Compose security sandbox. pilot-start.mjs checks exact test DB/restricted role/schema before awaiting the existing app factory. It bypasses neither policy nor authorization and never registers a send transport.

Dockerfile.api is a pinned Linux multi-stage build. prepare-build-context.mjs copies only enumerated manifests, TypeScript/SQL source and four named deployment helpers into a new ignored staging directory. No .env, private credentials, .git, local node_modules, logs or TypeScript build caches are copied. The context manifest detects additional/modified files before building application output. Dependency install happens on Linux with the frozen lock and ignored install hooks; host workspace dependencies remain untouched.

stage-built.mjs verifies compiled package copies rather than copying pnpm hardlinks onto themselves. Runtime preserves /app/apps/api and /app/scripts/step74-runtime-guard.mjs because the existing test-only factory has a static repository-relative guard import. The guard is copied unchanged, not removed or made permissive. Full standalone API module import passes inside the image builder, without a listener/database/provider call.

Actual local Linux image build PASS (including compilation, context checksum verification, standalone imports). Final image ID is recorded in the image metadata/evidence file after verification; do not deploy a mutable tag. No containerized pilot services started. Source/lock/root node_modules unchanged; earlier982/982 application regressions and35/35 PostgreSQL results retain their original scope and are reused, not rerun or claimed as VPS acceptance.

Focused guards, context private-canary/tamper test and actual Docker Compose rendering/isolation passed. Static reviewer found that API command/entrypoint overrides and foreign secret paths could bypass startup; failing mutations reproduced it, validation corrected and rechecked. No remote runtime claim follows from those checks.

Local-only build (does not deploy):

```powershell
$context = node deploy/hostinger-pilot/prepare-build-context.mjs
docker build --pull=false -f deploy/hostinger-pilot/Dockerfile.api -t thaara-v2-pilot-api:review-20261027 $context
pnpm.cmd exec vitest run scripts/hostinger-pilot.test.ts scripts/step1085-runtime-guard.test.ts scripts/step74-runtime-guard.test.ts --silent
```

## STOP before remote setup

The API requires NEW database thaara_vps_pilot with reviewed schema installed and a restricted thaara_app login. No target installer is provided yet. Existing1083/1085 SQL is guarded for its original isolated fixture and must NOT be edited/retargeted or bypassed to make this pilot start. Prepare a separately reviewed target-specific installer and runtime acceptance, then obtain explicit remote DB/SQL approval. Missing schema causes generic startup failure rather than simulated readiness.

Artifact transfer/private SSH is also unresolved. Owner does not have the existing n8n-vps-key on this computer and requests a separate connection named THAARA AI V2. No existing keys may be reused or removed. No usable local SSH agent/trusted-host entry confirmed. Hostinger's key-add API adds keys to ROOT; it does not create a restricted V2 account. This powerful new access needs explicit owner approval before any new key generation/enrollment. [Exact proposed access scope](../../docs/integrations/whatsapp/VPS_CONNECTION_APPROVAL.md).

Port22 responds. Windows ssh-keyscan failed due unsupported sntrup761x25519 key-exchange selection; a strong curve25519-sha256 diagnostic retrieved a public host fingerprint while StrictHostKeyChecking=yes correctly blocked untrusted authentication. No firewall or server SSH change is indicated by that diagnostic. Fingerprint remains UNVERIFIED until compared with the trusted Hostinger console. Never disable host checking or enable weak algorithms to proceed.

After private access: inspect exact architecture/Docker/network/mount/path/port baselines read-only, prepare image transfer and approved test-only credential/SQL/health/rollback steps. Only then request one concrete private pilot deployment/infrastructure/migration approval. Public HTTPS/browser/n8n authenticated round trip, real Meta eligibility/assets and one exact message require their later acceptance/authorization. Current local image is backend-only; it does not deliver the web composer/Chat/media or provider sending.
