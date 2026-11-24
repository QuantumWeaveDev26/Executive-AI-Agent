# One read-only Phone release baseline refresh — prepared only

Calendar now shows **Connected (Live)** in the existing signed-in Thaara owner session. No booking was
attempted. A fresh public page read identifies `index-BiqDT2zG.js`; the earlier Chrome page still used
`index-BuFC9B_6.js`. The new public HTML, JS and CSS match Antigravity's retained compiled build.
Its current source rebuild differs, so the current web-source handoff must still be reconciled.
Do not deploy the old Phone candidate. Its build manifest is disabled. The current API image is unknown;
`44387266…` is the last verified image, not assumed current.

**Exact approval:** Approve ONE read-only baseline refresh on VPS 1871828 using this package,
including existing protected SSH authentication and verified cleanup. Check the three pinned public
web files and the same four compiled API files as the previous export. Retain bytes locally only for
compiled files whose hashes changed. No build, service change, SQL, credential change, deployment or call.

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-release-refresh-20261107.readonly.ps1 -ApprovedPhoneBaselineRefresh -ManifestSha256 a01901467165d71bc13d8ff6c67e30f48a44422f78f1327e5130eea63b449762
```

Manifest: `PHONE_RELEASE_REFRESH_20261107.review.json`. SHA256:
`a01901467165d71bc13d8ff6c67e30f48a44422f78f1327e5130eea63b449762`.

One SSH connection with the same temporary agent and trusted host fingerprint. Read only the known
API container's ID, actual image ID, health, service labels, start time, read-only-root flag and mount
destinations. Stop if it is unhealthy, writable, mounted over `/app`, or changes during the check.
Use only the local Docker socket. Compare the installed public `index.html`, `index-BiqDT2zG.js` and
`index-Co2o2hIb.css` against the manifest before opening any compiled API file. Stop if the frontend
changed again. The four API paths remain `dist/app.js`, `pilot-start.mjs`,
`dist/services/phone-pilot-startup.js` and installed `@thaara/contracts/dist/index.js` under the API root.
Use bounded regular-file reads, reject unsafe redirects, verify SHA256, and keep changed code only
in the local receipt. Console output has code file names, sizes, hashes and changed flags only.

No application secret files, profile values, environment values, customer records, provider calls,
database commands, Docker build/create/start, remote file writes, configuration changes, service
restart, deployment, Calendar mutation or Git operation. The existing encrypted SSH key is only
loaded in memory by the established authentication helper. No automatic retry. Verify local owned
agent/temp cleanup. Preserve old markers. New `.used.json` and `.result.json` share prefix
`node_modules/.cache/phone-release-refresh-20261107` and are absent before approval.

Local evidence: **9/9** refresh checks and `ReviewOnly` passed. The build-only draft's **15/15**
synthetic checks are separate local evidence; that draft was never executed and is stale. A successful
refresh permits local reconciliation only. It does not authorize a candidate build, feature enablement,
inbound F-03 admission, Calendar event or deployment.
