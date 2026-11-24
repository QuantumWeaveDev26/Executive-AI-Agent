# Hostinger suitability review — 27 October 2026

Status: read-only review COMPLETE. VPS is a **conditional candidate**, not admitted for deployment or LIVE WhatsApp. [Sanitized API evidence](hosting-preflight-2026-10-27.json). All operations below were returned by Hostinger search as readOnly=true. No remote shell, compose/environment contents, credentials, mutation, restart or deployment.

## Verified target and resources

- One VPS returned: ID1871828, srv1871828.hstgr.cloud, running, KVM2,2 CPUs, memory8192/disk102400 in provider metadata, Ubuntu24.04 with n8n template. Public IPv4 candidate76.13.217.50. Existing n8n project and traefik container confirm the intended server.
- Last24-hour metrics requested2026-10-26T07:57:19Z through2026-10-27T07:57:19Z,48 samples each. CPU7.43–10.05%, mean8.3446%; latest8.6%. RAM latest2,976,219,136 bytes, sampled max3,186,405,376 bytes; disk latest35,115,806,720 bytes. Latest reported uptime905,733 seconds. These sampled readings indicate potential headroom, not a load test/guarantee or confirmation of every bare-metal service.
- Nine Compose projects returned. Preserve every existing project/container/path. Existing n8n binds127.0.0.1:5678; its Traefik owns public80/443. Another app binds127.0.0.1:3100. Legacy thaara-ai-platform binds public5000 and8080; its backend/frontend are healthy. Several other application/portal/database projects exist. None may be reused, replaced, copied, reconfigured or restarted for V2.
- Hostinger firewall association null and firewall list total0. OS firewall, host-level listeners and other protection are unverified; this is not proof that the server has no firewall. No firewall changes made.
- Two VPS backup entries:2026-10-25T00:05:09Z and2026-10-17T11:41:05Z. Existence is not a successful restore test, current application-consistent backup, or managed V2 database backup. No snapshot/restore started.
- Shared-hosting website query for thaara returned0; this does not contradict the existing legacy VPS application and does not establish V2 deployment.

## Owner-selected address and DNS preservation

Owner selected **thaara-v2.quantumweaveai.io** for planning only. quantumweaveai.io appears active in the owned domain portfolio. Current zone contains no thaara-v2 label or wildcard. Root/www use Hostinger CDN targets; ftp, rsend/send CNAMEs, root TXT, DKIM TXT and DMARC TXT must survive. No DNS record was added, deleted or changed; no nameserver/email/certificate operation performed. Real TXT contents are omitted from evidence/report.

Proposed future DNS change: add only A/thaara-v2 ->76.13.217.50 after deployment preflight and explicit approval; refresh IP/zone and record rollback first. Do not add AAAA until actual IPv6 routing/TLS is verified. Never point V2 at legacy5000/8080 or alter the apex/www records.

## Proposed isolation, not executed

New project name thaara-v2, new directory/volumes/network, no reuse of /root/thaara-ai-platform or existing database/data/secret material. Exact new path absence, network names and volume conflicts need verification before creation. API/UI should share the selected HTTPS origin, routing /api/v1 to the API with secure cookies and exact CORS. Expose no new database/cache/administrative host ports. New API/web containers must be nonroot, bounded, and receive no Docker socket or existing application volume.

Existing Traefik could route the NEW containers without restarting n8n if its Docker provider/network and certificate resolver support it; these details are NOT established by the metadata endpoint. Do not guess labels, resolver, certificate storage or network names, modify existing compose, or restart the proxy to force it. Required read-only network/mount/proxy/host-port inspection needs a separately authorized, available remote access mechanism. Hostinger Docker project creation can REPLACE an existing project with the same name; any future deployment must abort on name/path collision and identity mismatch.

Production requires dedicated managed PostgreSQL/Redis and a managed secret service. Owner confirmed none exist yet and requested a setup plan. [Proposed services and owner steps](MANAGED_SERVICES_SETUP_PLAN.md). Do not deploy using local fixture data, legacy SQLite, shared legacy accounts, or the tested fixture's admin role.

## Admission gates before deployment

1. Confirm provider selection, actual account/region/tier, least-privilege runtime roles, TLS, budget/quotas and backup/restore requirements. No paid plan/purchase implied by a setup plan.
2. Finish managed-secret/outbound profile admission and reviewed LIVE/test-number mode code/schema. Current domain/schema remain offline_test and transport unregistered; no flip of the false gate is sufficient.
3. Prepare a checksum-pinned target-specific migration/provisioning package and run provider-specific RLS/role/proof/concurrency acceptance after separate approval.1083/1085 review artifacts have fixture-only guards; never bypass them on hosted data.
4. Establish the exact proxy/network/TLS/current-service baseline and deployable artifact checksums. Produce a concrete new-project-only deploy/health/rollback plan before requesting deployment approval.
5. After approved hosting, prove authenticated synthetic n8n/backend HTTPS round trip, scoped secret rotation/revocation, no retries/duplicate or unauthorized sends and mounted browser/CSP acceptance. Preserve all unrelated workflows/services.
6. Confirm missing Meta App ID and owner-reported Messaging Account ID mapping/asset ownership, current provider/signature/version/subscription/eligibility and approved recipient. Then obtain explicit activation and one exact test-message approval. UI/Chat/media remain separately incomplete.

## Operations/evidence and limits

Executed only vps_virtual-machines_list/get/metrics, hosting_websites_list(domain=thaara), vps_docker_list, vps_firewall_list, vps_backups_list, domains_portfolio_list and dns_records_list(quantumweaveai.io), plus read-only operation search. No configuration or code changes on Hostinger. No secrets requested/copied/logged. No credentials created/changed, no Meta/provider message, SQL, infrastructure, Git commit/push or deployment.

Local app source unchanged in this review. Historical approved actual PostgreSQL35/35 and fresh prior982/982 non-runtime/build/lint/typecheck evidence reused without rerunning. This task adds only review documentation/evidence (and ignored temporary management schema/client artifacts); no success claim for hosted runtime.
