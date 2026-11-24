# Inbound reporting — disabled installation and admission drafts

## Completed locally

- `docs/migrations/112p-phone-inbound-events.install-draft.sql`
- `docs/migrations/113p-phone-inbound-principals.install-draft.sql`
- `docs/integrations/phone/sarvam-inbound-admission.draft.json`
- Text-only generator/checker `scripts/phone-inbound-install-draft.mjs` and focused tests.

These are review artifacts, not a production installer or runtime loader. Nothing imports the JSON from
startup. Existing NODE_ENV=test guards remain unchanged. No existing SQL, credentials or runtime config edited.

Each SQL draft checks the exact original source SHA256 and preserves the full schema, privilege, RLS,
prerequisite and object-collision body byte-for-byte. It replaces ONLY the old in-memory admission gate
with an unconditional RAISE inside BEGIN, before any DDL. It deliberately cannot install anything as-is.
This is not the final target-specific installation gate; never remove the exception to deploy it.
The previously tested112r/113r files remain unchanged and restricted to their disposable database.

The JSON preserves intended committed inboundv5, existing agent/deployment/number, five-minute limit,
report-only callback/completion operations, explicit consent, no Calendar booking, no raw media retention
and no outbound dispatch. Current provider/auth/hosting checks remain false until independently verified.
Thaara workspace/owner/principal/route/revision/fingerprint/expiry and secret references stay null.
No Sarvam organisation/workspace identifier is repurposed as a Thaara tenant. No secret path guessed.

## Verification

Fresh51/51 focused checks PASS across eight files, API typecheck PASS, whitespace PASS.
Nine new checks cover exact source/body preservation, unconditional pre-DDL block, changed-source/gate
rejection, disabled draft metadata, identity separation and production constructor refusal before storage.
Receipt: `node_modules/.cache/phone-inbound-disabled-admission-20261104.json`.
Text-only `node scripts/phone-inbound-install-draft.mjs --check-drafts` PASS; sqlExecuted:false.
Independent security review found no blockers, including generated drafts and import side effects.

Earlier9/9 real PostgreSQL acceptance remains historical evidence for the unchanged schema/service path.
No new SQL, Docker, SSH, provider, browser call or full regression executed in this milestone.
Production admission itself is NOT implemented/verified by these artifacts. Changing flags grants nothing.

## Next preparation and approval boundaries

Before a target-specific installer or active runtime composition can be finalized, establish exact hosting
and database facts: current pilot build/schema/roles, authenticated Thaara owner/workspace, distinct ingest
and owner-read connection identities, recovery evidence, TLS/secret-storage posture, and ingress topology.
Use a separately reviewed read-only hosting inventory package; do not read credential values/customer rows.
Do not reuse consumed preflight approvals. No such connection is authorized by these drafts.

Then prepare a NEW pinned installer/composition with verified target and source assumptions, collision and
privilege preconditions, disabled-by-default live admission, explicit secret references, revocation, limits
and failure tests. Hosted changes require exact separate approvals for backup/restore verification,
persistent SQL/identity provisioning, secrets, deployment and provider callback/tool configuration.
Keep inboundv5 operational, and disable reporting rather than dropping schema during recovery.

Final acceptance must show one owner-made inbound enquiry/callback saved once, visible to that owner in
the app, accurately classified, and absent on failed save. Booked appointment still requires a verified
Calendar event. Recording retrieval/retention and outboundv6 admission remain separate workstreams/gates.

No owner setup is required for reviewing these local drafts. Do not ask for API keys or passwords in chat.
No shared auth/startup/navigation/contracts, WhatsApp worktree or live integration changed; no commit/push.
