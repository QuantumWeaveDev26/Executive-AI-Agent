# One read-only Phone runtime check — 6 November 2026

Prepared only; NOT executed. Needed because Sarvam v7 has the company KB, but the real call did not answer a company question and its dashboard omits the version used. A deployment cannot safely select a replacement without knowing the actual running profile and current image.

Exact command:
```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-runtime-metadata-20261106.readonly.ps1 -ApprovedPhoneRuntimeReadOnly
```

Manifest SHA256: `6b8b52ee1afa75a9f770fd821a149b7c7594cc1efe12c0a11ca4b74e20d593aa`

One connection to existing VPS 1871828. Existing encrypted dedicated SSH key through the reviewed temporary agent only; trusted host-key pin and owned cleanup retained. Consume a NEW local one-use marker before authentication. Do not reuse any previous approval or marker.

Remote commands: fixed Docker metadata inspection of thaara-v2-pilot-api-1 before and after one docker exec of a fixed read-only Node program. Check compose ownership, health, unchanged container/image. Node reads only THAARA_SARVAM_PROFILE_FILE and ONLY the non-secret /run/secrets/sarvam_profile JSON when that exact path is configured. Unknown path => no profile file is read. It returns agent version, duration, reviewed KB/version metadata and profile hash; no account identifiers or credential values. No API-key/webhook-secret files, general environment listing or process arguments.

No Sarvam/provider requests; no SQL; no builds, restarts, uploads, configuration changes, deployments or calls. Local receipt/one-run marker are retained; temporary authentication material is removed and own agent terminated. Stop on mismatches, no repair/retry. If the configured profile path differs, report that blocker without reading it.

Expected output: unchanged healthy image/container and either sanitized Phone runtime metadata or a truthful stopped/unavailable category. This does not authorize modifying the profile or switching any version.

Local preparation: 6 Python mock tests PASS (fixed scope, wrong identity, unknown path, output allowlist, malformed metadata, concurrent image change). Wrapper ReviewOnly mode PASS; no authentication or remote command ran.

Pinned files:
- `scripts/phone-runtime-metadata-20261106.readonly.ps1` — `36beb3c02226abc9072b269871ee90fb764f231474dca9a418842450df742df6`
- `deploy/hostinger-pilot/phone-runtime-metadata-20261106.readonly.py` — `707e434cb342b9eaf30730aab0dc817ebaac27c448f99409bb1bd5613aa01d6d`

Owner approval text: I approve ONE read-only Phone runtime metadata check using the exact command and manifest hash above, including existing encrypted-key agent-only authentication and verified temporary-auth cleanup. No changes, provider requests, SQL or calls.
