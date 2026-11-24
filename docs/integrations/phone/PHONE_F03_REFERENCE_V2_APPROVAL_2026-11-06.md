# F03 reference capture V2 — one fresh authorization required

V1 stopped before infrastructure because the restricted execution context denied the Docker pipe.
Read-only diagnosis confirmed inventory exit1/permission_denied there and exit0 outside it; the fixed
disposable container name was absent. No Docker settings/credentials changed. No SQL or retry ran.

V2 retains the exact scope of PHONE_F03_REFERENCE_APPROVAL_2026-11-06.md, with these changes only:

- Use the approved tool execution context outside the restriction so Docker pipe access works.
  This does not authorize changing Windows/Docker privileges, credentials or configuration.
- Fresh manifest `PHONE_F03_REFERENCE_V2.review.json`, SHA256
  `943dc7b6e2a846dd2addfa5d6bcca6272f8de52514c4e1a08dc863c1774a98b4`.
- Fresh empty cache `node_modules/.cache/phone-f03-reference-v2`; all V1 markers/receipts retained.
- Child imports the parent manifest-path constant to prevent filename mismatch.

Exact command (NOT executed):

```powershell
node scripts/phone-f03-reference.review.mjs --approved-isolated-f03-reference --manifest-sha256 943dc7b6e2a846dd2addfa5d6bcca6272f8de52514c4e1a08dc863c1774a98b4
```

Scope remains one new disposable container/internal network; pinned existing PG16 image, fresh test
credentials, tmpfs-only storage, owned loopback127.0.0.1:15436 relay/no Docker publication, twelve unchanged
base migrations plus unchanged112h/113h, three ordered environment/catalog checks, stop on first failure,
no retry, verified owned cleanup. No SQL114, old nine-case rerun, VPS, production, provider operations,
deployment, calls, messages, credential/configuration changes or Git operations. Observations stay
unapproved until independent reference/admission review; success does not close F03.

308 pins verified during source-only preparation. Focused manifest/config tests and API typecheck pass;
unchanged lifecycle/ports evidence remains historical49-test aggregate from V1 preparation. No V2
infrastructure, SQL or approval marker exists. Old approved manifest hash remains unchanged.

Authorization text: “Approve ONE isolated F03 reference V2 run using the exact command and checksum
above, outside the Docker access restriction, with the same database, SQL, isolation, stop and cleanup
limits. Preserve all V1 evidence. No automatic retry or production operations.”

The original V1 authorization explicitly permitted one execution only; it cannot authorize this run.
