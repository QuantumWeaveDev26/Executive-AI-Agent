# Appointment PostgreSQL acceptance — STOPPED, approval consumed

Owner's "procced" approved one execution of the exact command in
PHONE_APPOINTMENT_STORAGE_APPROVAL_2026-11-04.md.307 source pins and approval-document/manifest hashes
matched before execution; new used marker was absent. The pinned command ran once and exited1.
Manifest SHA256: c681a4a8af96fea19b9005aa0cdf32f67e6f46414df63884d7d5ebacab3e55d7.

## Confirmed results

- Local engine, empty resource names, image, tmpfs/kernel mounts, ownership, network and owned loopback
  transport preflight passed. No production/VPS connection or existing resource was used.
- Parent applied all twelve base migrations successfully.
- Case1 PASS: original112h and113h installed in the new isolated fixture, SQL hashes matched;
  forced RLS/restricted identities checked; temporary fixture LOGIN/passwords provisioned.
- Case2 PASS: actual appointment HTTP endpoint -> restricted principal transaction -> SQL journal/audit
  persisted the synthetic request and preferred slot, with owner readback.
- Case3 PASS: concurrent connections deduplicated requests to one row/audit; conflicting repeat refused.
- Case4 PASS: targeted synthetic audit failure rolled back the request; planned explicit recovery saved once.
- Case5 FAILED: wrong credentials/call binding/revoked/expired identity test. The retained runner receipt
  identifies case5 only; the specific assertion/error was not retained. No SQLSTATE or exact root cause
  can be claimed. Do not assume that all security assertions in this case failed or that unauthorized
  data was written. Database-free diagnosis is the next safe step.
- Cases6–9 were NOT EXECUTED after --bail=1. Vitest's numeric skipped count is0; that does not mean
  these four cases ran. Overall acceptance FAILED:4passed,1failed,4notexecuted.

## Independently verified cleanup

The runner removed only its exact owned container and internal network after checking IDs/image/run
labels and settling the child/relay. Separate approved local read-only verification confirmed:
containerAbsent:true, networkAbsent:true, destroyEventVerified:true, portFree:true, relayClosed:true,
activeChildren:0, activeSockets:0. Port15436 is free. No temporary DB or fixture network retained.

Evidence retained under node_modules/.cache/phone-appointment-storage-v1/:
used.json, fixture.json, result.json, cleanup-independent.json. Never delete/reset/reuse these markers.
No credentials or raw database contents are in this report. Old approval packages/receipts unchanged.

## Boundary

No automatic retry, SQL correction, production migration, deployment, provider request, call, agent/routing,
WhatsApp, n8n, credential or Git commit/push operation occurred. The attempt is consumed even though it failed.
Actual security/reconnect/recovery coverage remains incomplete. No production readiness is established.
Next: local database-free case5 diagnosis and focused regression; any new PostgreSQL execution needs a new
reviewed, checksum-pinned package and explicit owner approval. Preserve original SQL/admission gates.
