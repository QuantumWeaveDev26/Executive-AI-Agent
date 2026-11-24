# One approved Phone Chat deployment attempt — STOPPED

Owner approved exactly ZIP SHA256 ada9bb9714c8e398f028270b6fcd8d77180e81c81af9dc4b7d6e719f48f55d69 and execution manifest SHA256 efd321d8ebefe74cea70a2948fe63ac2b9b7cfc9d7078dfc3b066ae6f7db5deb. Both independently matched before execution; all source pins matched; one-run gate unused. Exact approved command was executed ONCE, exit1. Gate node_modules/.cache/phone-chat-deploy-20261105.used.json now exists; do not remove/reset/reuse.

SSH host/key checks passed. Sanitized remote result:status=stopped, category=deployment_check_failed, callsPlaced=0. The precise failing operation/stderr was not retained by the reviewed package. Do not claim an exact root cause. No automatic retry or repair performed.

Read-only post-attempt verification (not another deployment):

- Exact original API container c2869c539174596385e614058a6be78b7134bd55fc1c538665b97c780febb072 remains healthy.
- Image unchanged:sha256:0287204a4b9ba3db5febc37e5bf022e0d615f4c600d23a4452288f07a7533161.
- Protected compose SHA256 unchanged:e13802a75cde04912329e34808d9d728fa490b87d5df6d58e05d44131f916267.
- PostgreSQL,Redis,n8n,Traefik container/image/start/restart identities equal the approved baseline.
- Candidate image tag absent; zero validation-labelled containers remain.
- New protected /opt/thaara-v2-pilot-private/handoff/phone-chat-20261105 contains transferred manifest/deployer/Dockerfile. candidate-compose.json,previous-compose.json,rollback-image.txt absent. No API update/rollback reached. Preserve this directory; no deletion authorized.
- Deployment agent8024 and readback agent6524 absent; each exact owned auth directory absent independently.
- No calls/messages/provider changes/SQL/appointments/agent changes/commits/pushes.

Evidence:node_modules/.cache/phone-chat-deploy-readback-20261105.json; original current-baseline-complete receipt; consumed one-run marker. Deployment result was captured in tool output (generic category only).

Live Phone Chat fixes remain NOT deployed. Historical exact-overlay86/86 and preparation17/17 remain local evidence only. Live approval card remains broken; appointment-word routing remains unfixed. WhatsApp preserved through unchanged API/image/compose/storage/services.

Next needs separate diagnostic-only approval: inspect retained package/preflight conditions and identify the failed build/prebuild operation without changing live services or running another deployment/build/validation container. Current evidence cannot distinguish a failed pre-build guard from failed image build; Dockerfile FROM image-ID handling is only a hypothesis. Do not retry the consumed deployment command, alter retained package or repin it silently.
