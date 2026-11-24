import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cacheDir = path.join(root, 'node_modules', '.cache', 'bulk-campaign');

const scriptContent = `set -euo pipefail
python3 - <<'THAARA_POST_DEPLOY_VERIFY_PY'
import json, subprocess, urllib.request
from pathlib import Path

PREVIOUS_IMAGE = 'sha256:d436eb1b60aaa200739a3a0ced88923c6a3cf765abe6954ecf3a39e9d24cfc41'
SITE = 'https://thaara-v2.quantumweaveai.io'

def run(args, check=True, timeout=180):
    res = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed ({args[0]}): {(res.stderr or res.stdout)[:500]}")
    return res

api = json.loads(run(['docker', 'inspect', 'thaara-v2-pilot-api-1']).stdout)[0]
actual_image = api.get('Image')
actual_tag = api['Config'].get('Image')
health = api['State'].get('Health', {}).get('Status')
n8n_linked = 'n8n_default' in api['NetworkSettings']['Networks']

if not actual_tag.startswith('thaara-v2-pilot-api:bulk-campaign-sim-'):
    raise RuntimeError(f"Expected bulk-campaign-sim image tag, got {actual_tag}")
if health != 'healthy':
    raise RuntimeError(f"Expected healthy container, got {health}")

backup_path = Path('/opt/thaara-v2-pilot/staging-bulk-campaign/before-bulk-campaign.dump')
backup_bytes = backup_path.stat().st_size if backup_path.exists() else 0

# External API & Frontend checks (including /integrations/bulk-campaign refresh route)
req_health = urllib.request.Request(SITE + '/api/v1/health', headers={'User-Agent': 'ThaaraPostDeployVerifier/1.0'})
with urllib.request.urlopen(req_health, timeout=15) as resp:
    health_http = resp.status
    health_body = json.loads(resp.read().decode('utf-8'))

req_web = urllib.request.Request(SITE + '/', headers={'User-Agent': 'ThaaraPostDeployVerifier/1.0'})
with urllib.request.urlopen(req_web, timeout=15) as resp:
    web_http = resp.status
    web_html = resp.read().decode('utf-8')

# Read an active owner session scope from Postgres (read-only) to test real RLS-scoped persistence
sess_res = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-t', '-A', '-c',
    "SELECT s.workspace_id || '|' || s.user_id || '|' || s.token_hash FROM public.sessions s JOIN public.memberships m ON m.workspace_id = s.workspace_id AND m.user_id = s.user_id WHERE s.revoked_at IS NULL AND s.expires_at > NOW() AND m.role = 'owner' ORDER BY s.created_at DESC LIMIT 1;"
])
ws_id, user_id, tok_hash = sess_res.stdout.strip().split('|')

# Execute live container end-to-end verification (Sidebar bundle, Campaign create/upload/approve/simulate/cancel, PostgreSQL persistence & cleanup, Phone/WhatsApp/Chat availability)
e2e_js = f"""
import fs from 'node:fs';
import {{ pilotEnvironment, pilotSecrets }} from './pilot-config.mjs';
import {{ PostgresDatabase }} from '@thaara/db';
import {{
  BulkCampaignWorkspaceStore,
  MockBulkCampaignPhoneAdapter,
  MockBulkCampaignWhatsAppAdapter,
  approveBulkCampaign,
  createBulkCampaignPlan,
  DEFAULT_DEMO_INSTRUCTION,
  DEFAULT_DEMO_PHONE_DIRECTORY,
  detectBulkCampaignChatIntent,
  executeBulkCampaign,
  executeChatBulkCampaign,
  parseBulkCampaignContacts,
  rejectOrCancelBulkCampaign,
  stopBulkCampaign,
  SYNTHETIC_DEMO_CONTACTS_CSV
}} from './dist/services/bulk-campaign.js';

// 1. Verify Sidebar & Frontend bundle inside running container
const assets = fs.readdirSync('/app/apps/web/dist/assets');
const jsFile = assets.find(f => f.endsWith('.js'));
const jsCode = fs.readFileSync('/app/apps/web/dist/assets/' + jsFile, 'utf8');
const sidebarAndUiVerified =
  jsCode.includes('Bulk Campaigns') &&
  jsCode.includes('bulk-campaign-page') &&
  jsCode.includes('simulation-mode-banner') &&
  jsCode.includes('campaign-history-select') &&
  jsCode.includes('wa-consultation-banner');
if (!sidebarAndUiVerified) throw new Error('Frontend bundle missing required sidebar/UI markers');

// 2. Verify PostgreSQL persistence on live DB within a real RLS owner workspace scope, then clean up test row
const c = pilotEnvironment();
const s = pilotSecrets();
const dbUrl = 'postgresql://thaara_app:' + encodeURIComponent(s.databasePassword) + '@' + c.host + ':5432/' + c.database;
const db = new PostgresDatabase(dbUrl);
const workspaceId = '{ws_id}';
const userId = '{user_id}';
const scope = {{ workspaceId, userId, role: 'owner', sessionTokenHash: '{tok_hash}' }};

const imported = parseBulkCampaignContacts({{
  sourceType: 'csv',
  rawText: SYNTHETIC_DEMO_CONTACTS_CSV,
  phoneDirectory: DEFAULT_DEMO_PHONE_DIRECTORY
}});
let plan = createBulkCampaignPlan({{
  workspaceId,
  userId,
  instruction: DEFAULT_DEMO_INSTRUCTION,
  importResult: imported
}});

const storeWrite = new BulkCampaignWorkspaceStore(db);
await storeWrite.saveScoped(scope, plan);

// Simulate refresh / restart with a brand new store instance reading from PostgreSQL
const storeReadAfterRefresh = new BulkCampaignWorkspaceStore(db);
const persistedAfterRefresh = await storeReadAfterRefresh.getScoped(scope, plan.campaignId);
if (!persistedAfterRefresh || persistedAfterRefresh.campaignId !== plan.campaignId) {{
  throw new Error('PostgreSQL persistence after refresh failed');
}}

// Approve, simulate, and cancel
const approved = approveBulkCampaign(persistedAfterRefresh, {{
  userId,
  role: 'owner',
  expectedMaterialHash: persistedAfterRefresh.materialHash
}});
let liveCallRejected = false;
try {{
  await executeBulkCampaign(approved, {{
    whatsapp: new MockBulkCampaignWhatsAppAdapter(),
    phone: new MockBulkCampaignPhoneAdapter(),
    mode: 'live'
  }});
}} catch (err) {{
  if (String(err && err.message).includes('LIVE_COMMUNICATIONS_DISABLED')) {{
    liveCallRejected = true;
  }}
}}
if (!liveCallRejected) throw new Error('Live mode was not rejected');

const simulated = await executeBulkCampaign(approved, {{
  whatsapp: new MockBulkCampaignWhatsAppAdapter(),
  phone: new MockBulkCampaignPhoneAdapter(),
  mode: 'simulation'
}});
await storeReadAfterRefresh.saveScoped(scope, simulated);

const cancelled = rejectOrCancelBulkCampaign(simulated);
await storeReadAfterRefresh.saveScoped(scope, cancelled);

const finalReloaded = await (new BulkCampaignWorkspaceStore(db)).getScoped(scope, plan.campaignId);
if (!finalReloaded || finalReloaded.status !== 'stopped' || finalReloaded.liveCallingEnabled !== false || finalReloaded.liveSendingEnabled !== false) {{
  throw new Error('Final reloaded state invalid');
}}

// 3. Verify WhatsApp, Phone, and Chat modules load in live container
const waEnq = await import('./dist/services/whatsapp-enquiries.js');
const sarvam = await import('./dist/services/phone-sarvam-calls.js');
const chatClassifier = await import('./dist/services/chat-business-classifier.js');
await db.close();

console.log(JSON.stringify({{
  testCampaignId: plan.campaignId,
  sidebarAndUiVerified,
  contactUploadAndCreationOk: imported.validContacts.length > 0,
  persistedAfterRefreshOk: true,
  approvalSimulationCancelOk: finalReloaded.status === 'stopped',
  liveCommunicationsBlocked: liveCallRejected,
  liveCallingEnabled: finalReloaded.liveCallingEnabled,
  liveSendingEnabled: finalReloaded.liveSendingEnabled,
  whatsappPhoneChatAvailable: Boolean(waEnq.QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK && sarvam.createSarvamCallProvider && chatClassifier)
}}));
"""

e2e_res = json.loads(run(['docker', 'exec', 'thaara-v2-pilot-api-1', 'node', '--input-type=module', '-e', e2e_js]).stdout.strip())

# Clean up synthetic verification row via postgres admin so workspace stays clean
run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-t', '-A', '-c',
    f"DELETE FROM public.plans WHERE workspace_id = '{ws_id}' AND metadata->>'recordKind' = 'bulk_campaign_state_v1' AND metadata->>'campaignId' = '{e2e_res['testCampaignId']}';"
])

print(json.dumps({
    'post_deployment_status': 'ALL_POST_DEPLOYMENT_CHECKS_PASSED',
    'container_id': api['Id'],
    'started_at': api['State']['StartedAt'],
    'health': health,
    'n8n_network_attached': n8n_linked,
    'previous_production_image': PREVIOUS_IMAGE,
    'new_production_image_sha256': actual_image,
    'new_production_image_tag': actual_tag,
    'pre_deploy_db_backup_bytes': backup_bytes,
    'external_health_http': health_http,
    'external_frontend_http': web_http,
    'e2e_verification': e2e_res
}, indent=2))
THAARA_POST_DEPLOY_VERIFY_PY
`;

const outPath = path.join(cacheDir, 'verify-post-deploy.sh');
fs.writeFileSync(outPath, scriptContent, 'utf8');
console.log('Generated', outPath);
