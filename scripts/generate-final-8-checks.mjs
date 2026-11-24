import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const cacheDir = path.join(root, 'node_modules', '.cache', 'bulk-campaign');
const archivePath = path.join(cacheDir, 'publication.tar.gz');
const archiveBytes = fs.readFileSync(archivePath);
const archiveSha = crypto.createHash('sha256').update(archiveBytes).digest('hex');
const b64Payload = archiveBytes.toString('base64');

const scriptContent = `set -euo pipefail
python3 - <<'THAARA_FINAL_8_CHECKS_PY'
import base64, hashlib, io, json, shutil, subprocess, tarfile
from pathlib import Path

PRIOR_BULK_IMAGE = 'sha256:88cb497a4c19e7cd1e81a130d622c65673e4844c7ac4af26c3a23197dcd37cc5'
EXPECTED_LIVE_IMAGE = 'sha256:061f4cfc0bd4a3a9eac7131d2eece4c063788b56490159a98ae12e7286aa4b09'
ARCHIVE_SHA = '${archiveSha}'
PAYLOAD = '${b64Payload}'

def run(args, check=True, timeout=300):
    res = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed ({args[0]}): {(res.stderr or res.stdout)[-1200:]}")
    return res

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]

# Check 1: Verify actual production Docker Compose directory
p_v2 = Path('/opt/thaara-v2-pilot')
p_wrong = Path('/opt/thaara-pilot')
compose_file = p_v2 / 'compose.json'
env_file = p_v2 / '.env'
link_file = p_v2 / 'n8n-link-v2.sh'
compose_doc = json.loads(compose_file.read_text(encoding='utf-8'))
env_keys = [line.split('=', 1)[0].strip() for line in env_file.read_text(encoding='utf-8').splitlines() if '=' in line and not line.strip().startswith('#')]

# Check 2 & Requirement 10: Reverify currently running production image & check recent images on VPS
api_before = inspect('thaara-v2-pilot-api-1')
actual_live_image = api_before.get('Image')
actual_live_tag = api_before['Config'].get('Image')
compose_labels = {
    'working_dir': api_before['Config']['Labels'].get('com.docker.compose.project.working_dir'),
    'config_files': api_before['Config']['Labels'].get('com.docker.compose.project.config_files'),
}
n8n_attached = 'n8n_default' in api_before['NetworkSettings']['Networks']
recent_images = run(['docker', 'images', '--format', '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.CreatedAt}}']).stdout.strip().splitlines()[:12]
if actual_live_image != EXPECTED_LIVE_IMAGE:
    raise RuntimeError(f"Live image changed unexpectedly! Expected {EXPECTED_LIVE_IMAGE}, got {actual_live_image}")

# Always build a fresh candidate image from the updated publication.tar.gz on top of EXPECTED_LIVE_IMAGE (sha256:061f4cfc...)
raw_archive = base64.b64decode(PAYLOAD)
actual_sha = hashlib.sha256(raw_archive).hexdigest()
if actual_sha != ARCHIVE_SHA:
    raise RuntimeError("Archive SHA mismatch")

cand_tag = 'thaara-v2-candidate:bulk-campaign-sim'
stage = Path('/tmp/thaara-bulk-campaign-final-8-checks')
check_cand = subprocess.run(['docker', 'inspect', cand_tag], capture_output=True, text=True)
if check_cand.returncode != 0:
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(raw_archive), mode='r:gz') as tf:
        tf.extractall(stage)
    base_tag = 'thaara-v2-base:bulk-campaign-rebase'
    run(['docker', 'tag', EXPECTED_LIVE_IMAGE, base_tag])
    run([
        'docker', 'build',
        '--no-cache',
        '--network=none',
        '--pull=false',
        '--build-arg', f'BASE_IMAGE={base_tag}',
        '-t', cand_tag,
        '-f', str(stage / 'Dockerfile'),
        str(stage)
    ])
    shutil.rmtree(stage, ignore_errors=True)
cand_inspect = inspect(cand_tag)
cand_id = cand_inspect['Id']

# Check 3 & Check 6: Compare SHA256 hashes of cross-team files between EXPECTED_LIVE_IMAGE (latest WhatsApp release) and candidate image
files_to_hash = [
    '/app/apps/api/dist/routes/whatsapp-inbox.js',
    '/app/apps/api/dist/services/whatsapp-durable.js',
    '/app/apps/api/dist/services/whatsapp-enquiries.js',
    '/app/apps/api/dist/services/chat-whatsapp-assistant.js',
    '/app/apps/api/dist/routes/phone-calling.js',
    '/app/apps/api/dist/services/phone-sarvam-calls.js',
    '/app/apps/api/dist/services/phone-sarvam-runtime.js',
    '/app/apps/api/dist/services/phone-sarvam-knowledge-binding.js',
    '/app/apps/api/dist/services/chat-business-classifier.js',
    '/app/apps/api/dist/services/chat-attachments.js',
    '/app/apps/web/dist/assets/index-DIN8wIft.js',
    '/app/apps/web/dist/assets/index-Bal4nBrO.css',
]
hash_cmd = "import crypto from 'node:crypto'; import fs from 'node:fs'; import { dirname, join } from 'node:path'; import { fileURLToPath } from 'node:url'; const cDir = dirname(fs.realpathSync(fileURLToPath(import.meta.resolve('@thaara/contracts')))); const list = [...(" + json.dumps(files_to_hash) + "), join(cDir, 'phone-sarvam-compat.js'), join(cDir, 'whatsapp-n8n.js')]; console.log(JSON.stringify(Object.fromEntries(list.map(f => [f, fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : null]))));"
base_hashes = json.loads(run(['docker', 'run', '--rm', '--network=none', '--entrypoint', 'node', EXPECTED_LIVE_IMAGE, '--input-type=module', '-e', hash_cmd]).stdout)
cand_hashes = json.loads(run(['docker', 'run', '--rm', '--network=none', '--entrypoint', 'node', cand_tag, '--input-type=module', '-e', hash_cmd]).stdout)
all_cross_team_identical = (base_hashes == cand_hashes) and all(v is not None for v in cand_hashes.values())
if not all_cross_team_identical:
    raise RuntimeError(f"Cross-team file hash mismatch: base={base_hashes} cand={cand_hashes}")

# Clean up any leftover test row from an interrupted run before counting
run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-t', '-A', '-c',
    "DELETE FROM public.plans WHERE metadata->>'recordKind' = 'bulk_campaign_state_v1' AND metadata->'campaignState'->>'governedApprovalId' = '77777777-7777-4777-8777-777777777777';"
])

# Fetch a valid (workspace_id, created_by_user_id) and count of standard_plan rows via postgres superuser (since thaara_app requires RLS app.workspace_id)
seed_row = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-t', '-A', '-c',
    "SELECT workspace_id::text || '|' || created_by_user_id::text FROM public.plans LIMIT 1;"
]).stdout.strip().splitlines()[0]
ws1_id, user1_id = seed_row.split('|', 1)

before_cnt = int(run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-t', '-A', '-c',
    "SELECT count(*)::int FROM public.plans WHERE COALESCE(metadata->>'recordKind', 'standard_plan') = 'standard_plan';"
]).stdout.strip())

# Check 3, 4, 5, 6 & Real PostgreSQL Persistence Verification inside candidate container against live thaara_vps_pilot
deep_pg_js = f"""
import fs from 'node:fs';
import {{ PostgresDatabase }} from '@thaara/db';
import {{ pilotEnvironment, pilotSecrets }} from './pilot-config.mjs';
import {{
  BulkCampaignWorkspaceStore,
  MockBulkCampaignPhoneAdapter,
  MockBulkCampaignWhatsAppAdapter,
  approveBulkCampaign,
  createBulkCampaignPlan,
  DEFAULT_DEMO_INSTRUCTION,
  DEFAULT_DEMO_PHONE_DIRECTORY,
  executeBulkCampaign,
  parseBulkCampaignContacts,
  prepareCampaignPhoneDrafts,
  rejectOrCancelBulkCampaign,
  stopBulkCampaign,
  SYNTHETIC_DEMO_CONTACTS_CSV,
  updateBulkCampaignPlan
}} from './dist/services/bulk-campaign.js';

// Check 3: Verify WhatsApp Consultation & Calendly markers inside whatsapp-enquiries.js & whatsapp-inbox.js
const waEnq = fs.readFileSync('./dist/services/whatsapp-enquiries.js', 'utf8');
if (!waEnq.includes('wa.me/919972965677') || !waEnq.includes('30-minute consultation')) {{
  throw new Error('WhatsApp consultation markers missing');
}}
const waInboxRoute = fs.readFileSync('./dist/routes/whatsapp-inbox.js', 'utf8');
if (!waInboxRoute.includes('calendly.com/team-brandmint/30min')) {{
  throw new Error('Calendly handoff marker missing in whatsapp-inbox.js');
}}

// Verify bulk-campaign.js uses description column, RETURNING id, and BULK_CAMPAIGN_PERSISTENCE_FAILED
const bcCode = fs.readFileSync('./dist/services/bulk-campaign.js', 'utf8');
if (!bcCode.includes('INSERT INTO plans (workspace_id, created_by_user_id, title, description, status, version, metadata)') ||
    !bcCode.includes('BULK_CAMPAIGN_PERSISTENCE_FAILED') ||
    bcCode.includes('INSERT INTO plans (workspace_id, created_by_user_id, title, objective')) {{
  throw new Error('Compiled bulk-campaign.js missing description/BULK_CAMPAIGN_PERSISTENCE_FAILED fix');
}}

// Connect to real PostgreSQL thaara_vps_pilot using thaara_app RLS credentials
const c = pilotEnvironment();
const s = pilotSecrets();
const dbUrl = 'postgresql://thaara_app:' + encodeURIComponent(s.databasePassword) + '@' + c.host + ':5432/' + c.database;
const db = new PostgresDatabase(dbUrl);

const ws1 = '{ws1_id}';
const user1 = '{user1_id}';
const ws2 = '22222222-2222-4222-8222-222222222222';
const scope1 = {{ workspaceId: ws1, userId: user1, role: 'owner', sessionTokenHash: 'pg-verify-1' }};
const scope2 = {{ workspaceId: ws2, userId: user1, role: 'owner', sessionTokenHash: 'pg-verify-2' }};

// Build campaign with classifications, drafts, AI phone script, approval, and simulation history
const imported = parseBulkCampaignContacts({{
  sourceType: 'csv',
  rawText: SYNTHETIC_DEMO_CONTACTS_CSV,
  phoneDirectory: DEFAULT_DEMO_PHONE_DIRECTORY
}});
let state = createBulkCampaignPlan({{
  workspaceId: ws1,
  userId: user1,
  instruction: DEFAULT_DEMO_INSTRUCTION,
  importResult: imported
}});

const checkLocks = (st, step) => {{
  if (st.liveCallingEnabled !== false || st.liveSendingEnabled !== false) {{
    throw new Error('Safety lock violated at ' + step);
  }}
}};
checkLocks(state, 'create');

// Step 1: Save initial campaign to real PostgreSQL public.plans (INSERT ... description ... RETURNING id)
const store1 = new BulkCampaignWorkspaceStore(db);
await store1.saveScoped(scope1, state);

// Step 2: Update drafts, AI call script, prepare phone drafts, approve, and run simulation, saving to PostgreSQL (UPDATE ... version = version + 1 ... RETURNING id)
const waAdapter = new MockBulkCampaignWhatsAppAdapter();
const phoneAdapter = new MockBulkCampaignPhoneAdapter();
state = updateBulkCampaignPlan(state, {{
  channels: ['whatsapp', 'phone', 'email'],
  whatsappMessagePreview: 'Persisted WhatsApp draft for {{{{1}}}} — reply YES.'
}});
state = await prepareCampaignPhoneDrafts(state, phoneAdapter);
checkLocks(state, 'updatePlanAndDrafts');
state = {{
  ...approveBulkCampaign(state, {{ userId: user1, role: 'owner', expectedMaterialHash: state.materialHash }}),
  governedApprovalId: '77777777-7777-4777-8777-777777777777'
}};
checkLocks(state, 'approve');
let liveBlocked = false;
try {{
  await executeBulkCampaign(state, {{ whatsapp: waAdapter, phone: phoneAdapter, mode: 'live' }});
}} catch (err) {{
  if (String(err && err.message).includes('LIVE_COMMUNICATIONS_DISABLED')) liveBlocked = true;
}}
if (!liveBlocked) throw new Error('mode: live was not blocked');
state = await executeBulkCampaign(state, {{ whatsapp: waAdapter, phone: phoneAdapter, mode: 'simulation' }});
checkLocks(state, 'simulate');
await store1.saveScoped(scope1, state);

// Verify directly in PostgreSQL public.plans that row is committed with description, version=2, governance_version=2
const rawPgRow = await db.withScopedTransaction(scope1, async (client) => {{
  return client.query(
    "SELECT id, title, description, status, version, governance_version, metadata->>'recordKind' AS record_kind, metadata->>'campaignId' AS campaign_id FROM public.plans WHERE workspace_id = $1 AND metadata->>'recordKind' = 'bulk_campaign_state_v1' AND metadata->>'campaignId' = $2",
    [ws1, state.campaignId]
  );
}});
if (rawPgRow.rows.length !== 1) {{
  throw new Error('Expected 1 committed row in public.plans, found ' + rawPgRow.rows.length);
}}
const committedRow = rawPgRow.rows[0];
if (committedRow.version !== 2 || committedRow.governance_version !== 2 || !committedRow.description) {{
  throw new Error('Committed public.plans row has unexpected columns: ' + JSON.stringify(committedRow));
}}

// Step 3 & 4: Simulate API container restart with a brand-new BulkCampaignWorkspaceStore(db) (empty memory Map)
const storeAfterRestart = new BulkCampaignWorkspaceStore(db);
const recovered = await storeAfterRestart.getScoped(scope1, state.campaignId);
const listedWs1 = await storeAfterRestart.listScoped(scope1);
const byApproval = await storeAfterRestart.findByGovernedApprovalScoped(scope1, '77777777-7777-4777-8777-777777777777');
const listedWs2 = await storeAfterRestart.listScoped(scope2);

if (!recovered || recovered.campaignId !== state.campaignId) {{
  throw new Error('Restart recovery via getScoped failed');
}}
if (recovered.status !== 'completed' || recovered.executionMode !== 'simulation') {{
  throw new Error('Recovered status/executionMode mismatch');
}}
const phoneDraftsPreparedCount = recovered.contacts.filter(c => Boolean(c.phoneDraft)).length;
if (recovered.whatsappPlan.messagePreview !== 'Persisted WhatsApp draft for {{{{1}}}} — reply YES.' ||
    !recovered.callScript?.aiDisclosure ||
    !recovered.callScript?.eventPitch ||
    recovered.governedApprovalId !== '77777777-7777-4777-8777-777777777777' ||
    !recovered.approval?.approvedMaterialHash ||
    recovered.contacts.length !== state.contacts.length ||
    phoneDraftsPreparedCount === 0 ||
    recovered.importSummary.duplicates.length === 0 ||
    recovered.importSummary.invalidEntries.length === 0) {{
  throw new Error('Recovered drafts/script/approvals/classifications/history incomplete');
}}
if (!byApproval || byApproval.campaignId !== state.campaignId) {{
  throw new Error('findByGovernedApprovalScoped recovery failed after restart');
}}
if (!listedWs1.some(c => c.campaignId === state.campaignId)) {{
  throw new Error('listScoped recovery failed after restart');
}}
if (listedWs2.length !== 0) {{
  throw new Error('Workspace isolation failed: ws2 saw ws1 campaigns');
}}

// Step 6: Verify NO silent fallback to runtime memory when PostgreSQL fails
const brokenDb = {{
  async withScopedTransaction() {{
    throw new Error('connection terminated unexpectedly');
  }}
}};
const brokenStore = new BulkCampaignWorkspaceStore(brokenDb);
let saveFailedLoudly = false;
try {{
  await brokenStore.saveScoped(scope1, state);
}} catch (err) {{
  if (String(err && err.message).includes('BULK_CAMPAIGN_PERSISTENCE_FAILED')) {{
    saveFailedLoudly = true;
  }}
}}
let getFailedLoudly = false;
try {{
  await brokenStore.getScoped(scope1, state.campaignId);
}} catch (err) {{
  if (String(err && err.message).includes('BULK_CAMPAIGN_PERSISTENCE_FAILED')) {{
    getFailedLoudly = true;
  }}
}}
if (!saveFailedLoudly || !getFailedLoudly) {{
  throw new Error('Silent fallback detected! Broken DB did not throw BULK_CAMPAIGN_PERSISTENCE_FAILED');
}}
if (brokenStore.list(ws1).length !== 0) {{
  throw new Error('Broken DB mutated in-memory map!');
}}

await db.close();

console.log(JSON.stringify({{
  deep_pg_check: 'ALL_10_REQUIREMENTS_VERIFIED_ON_REAL_POSTGRES',
  committedPlanRowId: committedRow.id,
  committedCampaignId: state.campaignId,
  committedVersion: committedRow.version,
  committedGovernanceVersion: committedRow.governance_version,
  descriptionColumnUsed: Boolean(committedRow.description),
  recoveredAcrossRestart: true,
  recoveredContactsCount: recovered.contacts.length,
  recoveredPhoneDraftsCount: phoneDraftsPreparedCount,
  recoveredDuplicatesCount: recovered.importSummary.duplicates.length,
  recoveredInvalidEntriesCount: recovered.importSummary.invalidEntries.length,
  approvalLookupVerified: true,
  ws2Isolated: listedWs2.length === 0,
  saveFailedLoudlyWithoutFallback: saveFailedLoudly,
  getFailedLoudlyWithoutFallback: getFailedLoudly,
  liveBlocked
}}));
"""

env_flags = [item for e in api_before['Config'].get('Env', []) for item in ('-e', e)]
deep_res_raw = run([
    'docker', 'run', '--rm',
    *env_flags,
    '--volumes-from', 'thaara-v2-pilot-api-1:ro',
    '--network', 'container:thaara-v2-pilot-api-1',
    '--entrypoint', 'node',
    cand_tag,
    '--input-type=module', '-e', deep_pg_js
]).stdout.strip()
deep_res = json.loads(deep_res_raw.splitlines()[-1])

# Clean up the temporary test row from public.plans using postgres superuser so public.plans stays 100% clean
cleanup_res = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-t', '-A', '-c',
    f"DELETE FROM public.plans WHERE id = '{deep_res['committedPlanRowId']}' AND metadata->>'recordKind' = 'bulk_campaign_state_v1' RETURNING id;"
])

pg_res = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-t', '-A', '-c',
    "SELECT COALESCE(metadata->>'recordKind', 'standard_plan') || ':' || count(*) FROM public.plans GROUP BY metadata->>'recordKind' ORDER BY 1;"
])

api_after = inspect('thaara-v2-pilot-api-1')
if api_after['Id'] != api_before['Id'] or api_after['State']['StartedAt'] != api_before['State']['StartedAt']:
    raise RuntimeError("Live container touched!")

print(json.dumps({
    'check_1_compose_dir': {
        'actual_dir': str(p_v2),
        'compose_file_exists': compose_file.exists(),
        'wrong_dir_exists': p_wrong.exists(),
        'compose_service_api_image': compose_doc['services']['api']['image'],
        'env_keys': env_keys,
        'container_compose_labels': compose_labels
    },
    'check_2_live_image_and_coordination': {
        'container_id': api_after['Id'],
        'started_at': api_after['State']['StartedAt'],
        'health': api_after['State'].get('Health', {}).get('Status'),
        'image_tag': actual_live_tag,
        'image_digest': actual_live_image,
        'recent_vps_images': recent_images[:6]
    },
    'check_3_cross_team_preservation': {
        'all_cross_team_files_byte_identical': all_cross_team_identical,
        'n8n_network_attached': n8n_attached,
        'n8n_link_script_exists': link_file.exists(),
        'verified_files_count': len(cand_hashes)
    },
    'check_4_simulation_locks': {
        'liveCallingEnabled': False,
        'liveSendingEnabled': False,
        'liveModeBlockedWithError': deep_res['liveBlocked']
    },
    'check_5_real_postgres_persistence_and_isolation': {
        'verification': deep_res,
        'cleaned_up_test_plan_id': cleanup_res.stdout.strip(),
        'live_db_plans_by_record_kind_after_cleanup': pg_res.stdout.strip().splitlines()
    },
    'check_6_whatsapp_inbox_untouched': {
        'whatsapp_inbox_route_sha256_match': base_hashes['/app/apps/api/dist/routes/whatsapp-inbox.js'] == cand_hashes['/app/apps/api/dist/routes/whatsapp-inbox.js'],
        'whatsapp_durable_service_sha256_match': base_hashes['/app/apps/api/dist/services/whatsapp-durable.js'] == cand_hashes['/app/apps/api/dist/services/whatsapp-durable.js'],
        'whatsapp_enquiries_service_sha256_match': base_hashes['/app/apps/api/dist/services/whatsapp-enquiries.js'] == cand_hashes['/app/apps/api/dist/services/whatsapp-enquiries.js']
    },
    'candidate_image_tag': cand_tag,
    'candidate_image_digest': cand_id,
    'archive_sha256': ARCHIVE_SHA
}, indent=2))
THAARA_FINAL_8_CHECKS_PY
`;

const outPath = path.join(cacheDir, 'verify-final-8-checks.sh');
fs.writeFileSync(outPath, scriptContent, 'utf8');
console.log('Generated', outPath);
