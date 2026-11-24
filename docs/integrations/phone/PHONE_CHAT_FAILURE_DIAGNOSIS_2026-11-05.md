# One approved read-only failure diagnosis

ONE read-only SSH investigation completed. No production writes, Docker builds, restart, SQL, provider request or deployment retry. Trusted host and encrypted-key temporary-agent checks passed; owned agent17612/auth directory independently absent. Diagnostic permission consumed.

## Confirmed

- Live API image remains sha256:0287204a4b9ba3db5febc37e5bf022e0d615f4c600d23a4452288f07a7533161, same healthy container.
- All29 present pre-build checks pass: protected path permissions, retained file checksums, exact base/container/other-service identities, compose/link checksums, immutable base layers and Dockerfile content.
- Retained package manifest SHA2563ca7110d3a9b65c0409544557757b598b1896293549eb3acfd0bb5be08c4b6cc matches the original ZIP's internal manifest (distinct from outer execution-manifest hash).
- Transfer/extraction succeeded; required retained source/package files match. No candidate image or validation containers; no API compose/rollback artifacts.
- No build.log,stdout.log,stderr.log or deployment-result.json exists in the scoped retained directory. Reviewed original code did not retain stderr or per-command returncode:run() converts any nonzero result into command_failed; main converts it into deployment_check_failed. Exact historical failing command/exitcode/error are NOT recoverable from retained evidence. Do not label Docker build/FROM reference as confirmed cause; current prerequisite success does not prove all conditions at failure time.
- Docker client/server report29.6.1. This is metadata, not evidence of build success or failure cause.

## Local-only fix

Original pinned source/ZIP/manifest/consumed gate retained unchanged. New UNPACKAGED candidate:
deploy/hostinger-pilot/phone-chat-deploy.v2.review.py. It retains allowlisted operation, numeric exitcode or timeout, and fixed non-sensitive error phrases; unrecognized/surrounding stderr cannot escape. Adds a protected no-overwrite sanitized receipt in a future authorized deployment directory. No raw stderr/config/secrets logged. Nothing executed remotely from this candidate.

Fresh6/6 synthetic regressions pass:build error attribution, exitcode retention, unknown/surrounding secret exclusion, timeout, normal output and output bound. Default invocation returns review_only. Existing Phone/WhatsApp application code and exact-overlay86test evidence unchanged; tests not needlessly repeated.

Original deployment ZIP remains SHA256ada9bb9714c8e398f028270b6fcd8d77180e81c81af9dc4b7d6e719f48f55d69. No new deployment ZIP issued or approval implied. Need separately pinned build-only diagnostic approval to execute the retained Dockerfile with sanitized command/error capture, without any API restart, deployment, SQL, agent change, call or message. Do not reuse consumed deployment marker or alter retained remote files.

Receipt:node_modules/.cache/phone-chat-failure-diagnostic-20261105.json.
