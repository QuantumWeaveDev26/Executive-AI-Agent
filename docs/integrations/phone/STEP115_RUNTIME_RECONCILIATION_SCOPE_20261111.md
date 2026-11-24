# Step 115 runtime reconciliation inspection scope

Prepared for a separate owner decision. Earlier VPS authorization covered nine checksums only and did not authorize exporting source. The comparison found eight mismatches, so whole-file replacement would risk losing the WhatsApp team's current changes.

Proposed action: one read-only extraction of exactly these six compiled application files from the pinned current API container into `node_modules/.cache/phone-step115-current-runtime-source-20261111/`, for local merge review only:

1. `/app/apps/api/dist/app.js`
2. `/app/apps/api/pilot-start.mjs`
3. `/app/apps/api/dist/services/phone-pilot-startup.js`
4. `/app/apps/api/node_modules/@thaara/contracts/dist/index.js`
5. `/app/apps/api/dist/services/phone-calling.js`
6. `/app/apps/api/dist/routes/phone-sarvam-webhook.js`

Target image `sha256:3985893e8cef0ac5117af145e4785c5ae60bb95e3c997a74532b164860bd1cf9`, container `266e7ea1f430fdbc433d5e3dae449068f41628411c3f57644a2a71fe1eae3d60`. Stop if target or file checksums differ from the already approved nine-checksum receipt. Pin exact file paths, reject unexpected symlinks, bound file/output sizes, check file stability and target identity before/after. Refuse export if any file contains a private-key block, credential-like literal, authenticated database URL or other apparent inline secret. Do not print source bodies in the conversation; preserve exact validated bytes only in the ignored local inspection directory, without overwriting existing files.

No `.env`, credential/secret files, environment values, database access, customer records, audio, transcripts or source outside this allowlist are included. No server file export beyond these application modules, server changes, builds, deployment, restart, calls or email. No WhatsApp/Bulk implementation file will be exported or modified. The shared app/entrypoint will be reviewed to retain their current registrations and startup behavior.

This access is needed before preparing the exact compatible runtime patch. It does not authorize production deployment or removing admission guards. Preserve the working Instant Outbound path; absence of a Sarvam campaign does not establish that Instant Outbound is unconfigured.
