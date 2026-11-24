# ONE approved build-only diagnostic — FAILED, root cause reproduced

Before execution:diagnostic payload SHA2560d5ed5b79a8839e0cb94979ce8478cc2f429eabc24958e70b9a5bfefd873e5de;
diagnostic manifest SHA256d0f4e5e7e884687a9944b0b5c50ba8195740321b232b19c2d311684d64a28c59.
Original approved ZIP matched ada9bb9714c8e398f028270b6fcd8d77180e81c81af9dc4b7d6e719f48f55d69.
Protected retained files, base/layers, healthy exact live container/config and other services matched before build.

Executed EXACTLY ONCE:

```sh
docker build --network none --pull=false -t thaara-v2-pilot-api:phone-chat-20261105 -f /opt/thaara-v2-pilot-private/handoff/phone-chat-20261105/Dockerfile /opt/thaara-v2-pilot-private/handoff/phone-chat-20261105
```

Stage:docker_build; exit1. Sanitized errors:

- failed to resolve source metadata for docker.io/library/sha256
- pull access denied
- repository does not exist or may require authorization
- insufficient_scope: authorization failed

Confirmed current diagnostic cause:the Dockerfile's FROM sha256:<config/imageID> was resolved as a registry
repository/tag docker.io/library/sha256, instead of the already present local image. This reproduces the failed
build operation with retained error evidence; historical discarded stderr remains unavailable.

Post-checks:live image sha256:0287204a4b9ba3db5febc37e5bf022e0d615f4c600d23a4452288f07a7533161;
same container healthy; compose/link hashes and four other-service identities unchanged; health/Phone/
WhatsApp public endpoints200. Candidate image NONE. No validation/runtime container started; no deployment,
restart, SQL, credentials/config/agent changes, call or message. No remote diagnostic files created. Owned
agent18552 and authentication directory independently absent. One-run marker preserved/consumed; NO RETRY.
Receipt:node_modules/.cache/phone-chat-build-diagnostic-20261105.json.

## Local correction — prepared, NOT executed

V2 build-only script chooses only an EXISTING thaara-v2-pilot-api local image tag, independently verifies
it resolves to the pinned live imageID, and supplies a Dockerfile through stdin changing only FROM. Four
COPY instructions/context/package bytes stay unchanged. No remote file/tag writes. Missing/changed tag
stops before build; tag rechecked after. Eight local synthetic regressions pass; wrapper syntax/review-only
checks pass. No corrected remote build occurred; no deployment readiness claim.

New payload SHA256196a528ff5ec3653c4ed769bc7c4c1bba8041bc0b1c5b4d81fb0f521cd526514.
New approval manifest PHONE_CHAT_BUILD_DIAGNOSTIC_V2_20261105.review.json SHA256
e18b4f85b6f552dff5b3282f5758fe5e22b01770c60686f46daf41e26488d1ca.

Next requires separate approval for ONE corrected build-only diagnostic, existing retained package and
unchanged live baseline; no deployment/restart/SQL/agent/calls/messages. If successful retain candidate
image and stop; activation still requires separate approval.

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-chat-build-diagnostic.v2.review.ps1 -ApprovedBuildOnlyDiagnosticV2 -ManifestSha256 e18b4f85b6f552dff5b3282f5758fe5e22b01770c60686f46daf41e26488d1ca
```
