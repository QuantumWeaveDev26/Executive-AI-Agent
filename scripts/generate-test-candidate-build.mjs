import fs from 'node:fs';
import path from 'node:path';

const archive = fs.readFileSync('node_modules/.cache/whatsapp-appointment/publication.tar.gz');
const b64 = archive.toString('base64');

const script = `STAGED_ARCHIVE_B64="${b64}"
#!/usr/bin/env bash
set -euo pipefail

API='thaara-v2-pilot-api-1'
BASE_IMAGE='sha256:803187b4674123a10bbfe61a030ff2568c28bf49745eff3a953e44abcb6dec80'

echo "=== PREFLIGHT LIVE CHECKS ==="
CONTAINER_INFO=$(docker inspect "$API")
LIVE_ID=$(echo "$CONTAINER_INFO" | jq -r '.[0].Id')
LIVE_IMAGE_DIGEST=$(echo "$CONTAINER_INFO" | jq -r '.[0].Image')
LIVE_CONFIG_IMAGE=$(echo "$CONTAINER_INFO" | jq -r '.[0].Config.Image')
LIVE_HEALTH=$(echo "$CONTAINER_INFO" | jq -r '.[0].State.Health.Status')

echo "Container ID: $LIVE_ID"
echo "Image Digest: $LIVE_IMAGE_DIGEST"
echo "Config Image: $LIVE_CONFIG_IMAGE"
echo "Health: $LIVE_HEALTH"

if [ "$LIVE_IMAGE_DIGEST" != "$BASE_IMAGE" ]; then
  echo "ERROR: Base image mismatch! Expected $BASE_IMAGE, got $LIVE_IMAGE_DIGEST"
  exit 1
fi

if [ "$LIVE_HEALTH" != "healthy" ]; then
  echo "ERROR: Container is not healthy!"
  exit 1
fi

echo "=== CANDIDATE DOCKER BUILD CHECK ==="
BUILD_DIR=$(mktemp -d /tmp/wa-build-test-XXXXXX)
trap 'rm -rf "$BUILD_DIR"' EXIT

BASE_TAG="thaara-v2-base:phone-sarvam-rebase"
docker tag "$BASE_IMAGE" "$BASE_TAG"

echo "$STAGED_ARCHIVE_B64" | base64 -d | tar -xz -C "$BUILD_DIR"

TAG="thaara-v2-candidate:wa-conversation-fix"
docker build --no-cache --network=none --pull=false --build-arg "BASE_IMAGE=$BASE_TAG" -t "$TAG" -f "$BUILD_DIR/Dockerfile" "$BUILD_DIR"

CANDIDATE_INSPECT=$(docker inspect "$TAG")
CANDIDATE_ID=$(echo "$CANDIDATE_INSPECT" | jq -r '.[0].Id')
echo "CANDIDATE_IMAGE_ID=$CANDIDATE_ID"

echo "=== CANDIDATE IMAGE MODULE VERIFICATION ==="
docker run --rm --network=none "$TAG" node --input-type=module -e "
import fs from 'node:fs';

const c = await import('@thaara/contracts');
if (!c.WhatsAppConversationEnquirySchema) throw Error('Missing WhatsAppConversationEnquirySchema');
if (!c.CalendlyBookingEvidenceSchema) throw Error('Missing CalendlyBookingEvidenceSchema');

const enq = await import('./dist/services/whatsapp-enquiries.js');
if (typeof enq.extractCustomerEmail !== 'function') throw Error('Missing extractCustomerEmail in whatsapp-enquiries');
if (enq.QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK !== 'https://wa.me/919972965677') throw Error('Invalid WhatsApp contact link');
if (!enq.CONSULTATION_INVITATION_EN.includes('30-minute consultation')) throw Error('Missing CONSULTATION_INVITATION_EN');

const inboxRoute = fs.readFileSync('/app/apps/api/dist/routes/whatsapp-inbox.js', 'utf8');
if (!inboxRoute.includes('https://calendly.com/team-brandmint/30min')) throw Error('Missing Calendly URL in whatsapp-inbox');
if (!inboxRoute.includes('30-minute consultation')) throw Error('Missing 30-minute consultation in whatsapp-inbox');

const sarvam = await import('./dist/services/phone-sarvam-calls.js');
if (typeof sarvam.createSarvamCallProvider !== 'function') throw Error('Missing Sarvam provider');
const sarvamRuntime = await import('./dist/services/phone-sarvam-runtime.js');
if (typeof sarvamRuntime.loadSarvamRuntime !== 'function') throw Error('Missing Sarvam runtime');
if (!fs.existsSync('/app/apps/api/dist/services/phone-sarvam-knowledge-binding.js')) throw Error('Missing Sarvam knowledge binding');

const app = await import('./dist/app.js');
if (typeof app.buildApp !== 'function') throw Error('Missing buildApp');

console.log('ALL MODULE IMPORTS VERIFIED SUCCESSFULLY');
"

echo "=== BUILD-ONLY CHECK COMPLETED SUCCESSFULLY ==="
`;

fs.writeFileSync('node_modules/.cache/whatsapp-appointment/test-candidate-build.sh', script, 'utf8');
console.log('Created test-candidate-build.sh, bytes:', script.length);
