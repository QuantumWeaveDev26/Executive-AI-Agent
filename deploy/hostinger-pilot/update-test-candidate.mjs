import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tarFile = path.join(root, 'node_modules/.cache/whatsapp-appointment/publication.tar.gz');
const testScript = path.join(root, 'node_modules/.cache/whatsapp-appointment/test-candidate-build.sh');

const tarBuf = fs.readFileSync(tarFile);
const tarB64 = tarBuf.toString('base64');

const content = `#!/usr/bin/env bash
set -euo pipefail

STAGED_ARCHIVE_B64="${tarB64}"
BASE_IMAGE="sha256:9d59d01753e2fa95b8df050bbb0b37b893aebb5e9d46c27ec3be1fbc90639e0c"
BASE_TAG="thaara-v2-base:phone-sarvam-rebase"
TAG="thaara-v2-pilot-api:test-candidate-$(date +%s)"
BUILD_DIR="/tmp/test-candidate-build-$(date +%s)"

echo "=== CANDIDATE BUILD DRY RUN ==="
docker tag "$BASE_IMAGE" "$BASE_TAG"

mkdir -p "$BUILD_DIR"
trap 'rm -rf "$BUILD_DIR"' EXIT

echo "$STAGED_ARCHIVE_B64" | base64 -d | tar -xz -C "$BUILD_DIR"

echo "=== BUILDING DOCKER CANDIDATE (ISOLATED / NO-NETWORK) ==="
docker build --no-cache --network=none --pull=false --build-arg "BASE_IMAGE=$BASE_TAG" -t "$TAG" -f "$BUILD_DIR/Dockerfile" "$BUILD_DIR"

CANDIDATE_INSPECT=$(docker inspect "$TAG")
CANDIDATE_ID=$(echo "$CANDIDATE_INSPECT" | jq -r '.[0].Id')
echo "CANDIDATE_IMAGE_ID=$CANDIDATE_ID"

echo "=== CANDIDATE IMAGE MODULE VERIFICATION ==="
docker run --rm --network=none "$TAG" node --input-type=module -e "
import fs from 'node:fs';

const c = await import('@thaara/contracts');
if (!c.WhatsAppConversationEnquirySchema) throw Error('Missing WhatsAppConversationEnquirySchema');
if (!c.WhatsAppConversationEnquirySchema.properties.referredWebsite) throw Error('Schema missing referredWebsite');
if (!c.WhatsAppConversationEnquirySchema.properties.businessType) throw Error('Schema missing businessType');
if (!c.CalendlyBookingEvidenceSchema) throw Error('Missing CalendlyBookingEvidenceSchema');

const enq = await import('./dist/services/whatsapp-enquiries.js');
if (typeof enq.extractCustomerEmail !== 'function') throw Error('Missing extractCustomerEmail in whatsapp-enquiries');
if (enq.QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK !== 'https://wa.me/919972965677') throw Error('Invalid WhatsApp contact link');
if (!enq.CONSULTATION_INVITATION_EN.includes('30-minute consultation')) throw Error('Missing CONSULTATION_INVITATION_EN');

const inboxRoute = fs.readFileSync('/app/apps/api/dist/routes/whatsapp-inbox.js', 'utf8');
if (!inboxRoute.includes('https://calendly.com/team-brandmint/30min')) throw Error('Missing Calendly URL in whatsapp-inbox');
if (!inboxRoute.includes('AWAITING_CUSTOMER_BOOKING')) throw Error('Missing AWAITING_CUSTOMER_BOOKING in whatsapp-inbox');
if (!inboxRoute.includes('/appointments/decline')) throw Error('Missing appointments/decline in whatsapp-inbox');

const sarvam = await import('./dist/services/phone-sarvam-calls.js');
if (typeof sarvam.createSarvamCallProvider !== 'function') throw Error('Missing Sarvam provider');
const sarvamRuntime = await import('./dist/services/phone-sarvam-runtime.js');
if (typeof sarvamRuntime.loadSarvamRuntime !== 'function') throw Error('Missing Sarvam runtime');
if (!fs.existsSync('/app/apps/api/dist/services/phone-sarvam-knowledge-binding.js')) throw Error('Missing Sarvam knowledge binding');

const app = await import('./dist/app.js');
if (typeof app.buildApp !== 'function') throw Error('Missing buildApp');

const assets = fs.readdirSync('/app/apps/web/dist/assets');
const jsBundle = assets.find((n) => n.endsWith('.js'));
if (!jsBundle) throw Error('Missing web JS bundle');
const webJs = fs.readFileSync('/app/apps/web/dist/assets/' + jsBundle, 'utf8');
if (!webJs.includes('wa-consultation-banner') && !webJs.includes('CONFIRM & SEND LINK')) throw Error('Missing WhatsApp consultation UI in web bundle');

console.log('ALL MODULE IMPORTS AND FRONTEND ASSETS VERIFIED SUCCESSFULLY');
"

docker rmi "$TAG"
echo "=== BUILD-ONLY CHECK COMPLETED SUCCESSFULLY ==="
`;

fs.writeFileSync(testScript, content);
console.log('Updated test-candidate-build.sh');
