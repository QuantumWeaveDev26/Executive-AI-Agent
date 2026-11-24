"""Step 108.31 approved pilot publisher: private backup, pinned 10831 SQL, WhatsApp API+Web overlay, link restore.
Preserves current live sending state; keeps customer auto-replies disabled. Never logs secrets."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time
import urllib.request

BASE = 'sha256:9fb2739d92ba3c5bc38c1c5927b8ef3614da816e03a9dac107497b2b842f652c'
CANDIDATE_IMAGE = 'sha256:b1b13df2fb1b51817765f099c2645e25bafa6934251add0d71c890c6f29d7117'
ARCHIVE_SHA = '4839c483defbe7db83da9df67ab2ddaeb242bac290329f31e9e2ef485ebc87e1'
SQL_SHA = '756bc7c55251a0e9dc728dd8bcd37abfec60526f21fac4fe0a7110411b39c584'
SQL_NAME = '10832-whatsapp-relay-principal-sync.review.sql'
SQL_10833_SHA = '6346aac5bd59442b1b1d2788c6e759cb6598a85d8a55e995ba9be11b6b8c50b9'
SQL_10833_NAME = '10833-whatsapp-dynamic-customer-scale.review.sql'
LINK_SHA = '2885a39671346932339a87cb5b616b2a117ef593eb2ee9d32fa5f267cb273016'
P = Path('/opt/thaara-v2-pilot')
API = 'thaara-v2-pilot-api-1'
PG = 'thaara-v2-pilot-postgres-1'
DB = 'thaara_vps_pilot'
LINK = P / 'n8n-link-v2.sh'
SITE = 'https://thaara-v2.quantumweaveai.io'
ALLOWED = ['Dockerfile', 'manifest.json', SQL_NAME, SQL_10833_NAME, '10833-whatsapp-dynamic-customer-scale.rollback.sql', 'contracts', 'db', 'api-services', 'api-routes', 'api-app', 'web-dist']
TABLES = ['whatsapp_n8n_connections', 'whatsapp_n8n_messages', 'whatsapp_n8n_dispatches', 'whatsapp_n8n_status_events']

def run(args, check=True, env=None, timeout=240, stdin=None):
    result = subprocess.run(args, capture_output=True, text=True, env=env, timeout=timeout, input=stdin)
    if check and result.returncode:
        raise RuntimeError('Command failed; output withheld: ' + args[0])
    return result

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]

def identity(facts):
    return (facts['Id'], facts['State']['StartedAt'], facts['RestartCount'])

def sql(query):
    out = run(['docker', 'exec', '--user', 'postgres', PG, 'psql', '-X', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', 'BEGIN READ ONLY; ' + query + '; ROLLBACK;']).stdout
    return next(json.loads(line) for line in out.splitlines() if line.startswith('{'))

def database_facts():
    per_table = ','.join(f"""'{t}',(SELECT json_build_object('rows',(SELECT count(*) FROM public.{t}),'rls',c.relrowsecurity AND c.relforcerowsecurity,'acl',md5(coalesce(c.relacl::text,'')),
      'policies',(SELECT md5(coalesce(string_agg(pg_get_expr(polqual,polrelid)||coalesce(pg_get_expr(polwithcheck,polrelid),''),';' ORDER BY polname),'')) FROM pg_policy WHERE polrelid=c.oid),
      'triggers',(SELECT md5(coalesce(string_agg(pg_get_triggerdef(oid),';' ORDER BY tgname),'')) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)) FROM pg_class c WHERE c.oid='public.{t}'::regclass)""" for t in TABLES)
    return sql(f"""SELECT json_build_object('database',current_database(),'tables',json_build_object({per_table}),
      'audit_rows',(SELECT count(*) FROM public.audit_events),
      'media_check',EXISTS(SELECT 1 FROM pg_constraint WHERE conname='whatsapp_n8n_media_metadata_10821_check'),
      'principals',to_regclass('public.whatsapp_n8n_relay_principals') IS NOT NULL,
      'step10825',(SELECT count(*) FROM pg_constraint WHERE conname IN ('whatsapp_n8n_dispatch_draft_10825_check','whatsapp_n8n_audit_action_10825_check')),
      'step10831',(SELECT count(*) FROM pg_constraint WHERE conname IN ('whatsapp_n8n_failure_metadata_10831_check','whatsapp_n8n_auto_reply_metadata_10831_check')),
      'issuer_owner',(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.issue_whatsapp_audit_proof()'::regprocedure))""")

def unchanged_except_schema(before, after, allow_trigger_change_on=None):
    for t in TABLES:
        b, a = before['tables'][t], after['tables'][t]
        trigger_ok = (a['triggers'] == b['triggers']) if t != allow_trigger_change_on else True
        assert a['rows'] >= b['rows'] and all(a[k] == b[k] for k in ['rls', 'acl', 'policies']) and trigger_ok, 'check=table_unchanged ' + t
    assert after['audit_rows'] >= before['audit_rows'], 'check=audit_rows_not_reduced'

def wait_api():
    for _ in range(40):
        if inspect(API)['State'].get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(3)
    raise RuntimeError('Pilot API health timeout')

def restore_link():
    if 'n8n_default' in inspect(API)['NetworkSettings']['Networks']:
        raise RuntimeError('Unexpected existing API link before restoration')
    result = run(['bash', str(LINK)], check=False, timeout=240)
    markers = ['n8n_to_pilot_health=200', 'forged_callback_status=403', 'public_watch=12/12 ok', 'n8n_single_network=yes', 'n8n_not_restarted=yes']
    for line in result.stdout.splitlines():
        if any(line.startswith(marker.split('=')[0] + '=') for marker in markers):
            print(line, flush=True)
    if result.returncode or not all(marker in result.stdout for marker in markers):
        raise RuntimeError('Private link acceptance failed')

def send_state():
    env = [e for e in inspect(API)['Config']['Env'] if e.startswith('THAARA_WHATSAPP_SEND_ENABLED=')]
    rich = run(['docker', 'exec', '-w', '/app/apps/api', API, 'node', '--input-type=module', '-e',
                "const m=await import('./pilot-config.mjs');const s=m.pilotSendSettings();console.log(s?String(s.profile.richMessages):'off')"]).stdout.strip()
    return (env, rich)

def status(path, method='GET'):
    return run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', '-X', method, SITE + path]).stdout

def update_compose_and_env(env_path, compose_path, original_compose_bytes, base_image, target_image):
    compose_doc = json.loads(original_compose_bytes.decode('utf-8'))
    current_image = compose_doc.get('services', {}).get('api', {}).get('image')
    assert current_image in (base_image, '${THAARA_PILOT_API_IMAGE}'), 'check=compose_base_image ' + str(current_image)
    compose_doc['services']['api']['image'] = target_image
    env_path.write_text('THAARA_PILOT_API_IMAGE=' + target_image + '\n', encoding='utf-8')
    compose_path.write_text(json.dumps(compose_doc, indent=2) + '\n', encoding='utf-8')

def rollback_compose_and_env(env_path, compose_path, original_env_bytes, original_compose_bytes, compose_cmd, old_env, base_image, inspect_fn=inspect, run_fn=run, wait_api_fn=wait_api, restore_link_fn=restore_link):
    env_path.write_bytes(original_env_bytes)
    compose_path.write_bytes(original_compose_bytes)
    cur = inspect_fn(API)
    if cur['Image'] != base_image or cur['State'].get('Health', {}).get('Status') != 'healthy':
        run_fn(compose_cmd + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env)
        wait_api_fn()
    if 'n8n_default' not in inspect_fn(API)['NetworkSettings']['Networks']:
        restore_link_fn()
    final_api = inspect_fn(API)
    assert final_api['Image'] == base_image and 'n8n_default' in final_api['NetworkSettings']['Networks'], 'check=rollback_verified'

def publish(payload):
    assert os.getuid() == 0
    os.umask(0o077)
    ps_out = run(['ps', '-eo', 'args']).stdout
    active_deploy = [l for l in ps_out.splitlines() if ('docker build' in l or 'docker compose' in l or 'publish-phone' in l) and 'ps -eo' not in l]
    assert not active_deploy, 'check=no_concurrent_phone_deploy'
    assert hashlib.sha256(LINK.read_bytes()).hexdigest() == LINK_SHA, 'check=link_script_pinned'
    api = inspect(API)
    assert api['Image'] == BASE and api['State']['Health']['Status'] == 'healthy', 'check=base_image_healthy'
    base_image = BASE
    state_before = send_state()
    print('send_state_before=' + json.dumps(state_before), flush=True)
    assert list(inspect('n8n-n8n-1')['NetworkSettings']['Networks']) == ['n8n_default'], 'check=n8n_single_network'
    services = [PG, 'thaara-v2-pilot-redis-1', 'n8n-n8n-1', 'n8n-traefik-1']
    before = {name: identity(inspect(name)) for name in services}
    facts = database_facts()
    assert facts['database'] == DB and facts['media_check'] and facts['principals'] and facts['step10825'] == 2, 'check=expected_base_schema'
    assert facts['issuer_owner'] == 'thaara_whatsapp_audit_guard', 'check=issuer_owner_before'
    raw = base64.b64decode(payload, validate=True)
    assert hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA, 'check=archive_sha'
    directory = Path('/opt/thaara-v2-pilot-private/handoff') / ('whatsapp-10831-' + time.strftime('%Y%m%dT%H%M%SZ'))
    directory.mkdir(mode=0o700, exist_ok=False)
    context = directory / 'context'
    context.mkdir(mode=0o700)
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = archive.getmembers()
        assert len(members) < 60, 'check=archive_size'
        for member in members:
            path = Path(member.name)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in member.name and (member.isfile() or member.isdir()) and path.parts[0] in ALLOWED, 'check=archive_member'
        archive.extractall(context)
    manifest = json.loads((context / 'manifest.json').read_text(encoding='utf-8'))
    for item in manifest:
        path = Path(item['Path'])
        assert not path.is_absolute() and '..' not in path.parts
        assert hashlib.sha256((context / path).read_bytes()).hexdigest() == item['SHA256'], 'check=manifest ' + item['Path']
    sql_file = context / SQL_NAME
    assert hashlib.sha256(sql_file.read_bytes()).hexdigest() == SQL_SHA, 'check=sql_sha'
    print('artifact_checksums=verified files=' + str(len(manifest)), flush=True)
    cand_inspect = run(['docker', 'image', 'inspect', CANDIDATE_IMAGE], check=False) if CANDIDATE_IMAGE else None
    if cand_inspect and cand_inspect.returncode == 0:
        new = json.loads(cand_inspect.stdout)[0]
        run(['docker', 'tag', CANDIDATE_IMAGE, 'thaara-v2-whatsapp-enquiries:10831'])
        (directory / 'build.log').write_text('reused_candidate_image=' + CANDIDATE_IMAGE + '\n')
    else:
        tag = 'thaara-v2-base:10831'
        run(['docker', 'tag', base_image, tag])
        build = run(['docker', 'build', '--no-cache', '--network=none', '--pull=false', '--build-arg', 'BASE_IMAGE=' + tag, '-t', 'thaara-v2-whatsapp-enquiries:10831', str(context)], check=False, timeout=300)
        (directory / 'build.log').write_text(build.stdout + build.stderr)
        if build.returncode:
            raise RuntimeError('Overlay build failed before backup/SQL; nothing changed; private build.log retained')
        new = json.loads(run(['docker', 'image', 'inspect', 'thaara-v2-whatsapp-enquiries:10831']).stdout)[0]
    old = json.loads(run(['docker', 'image', 'inspect', base_image]).stdout)[0]
    image = new['Id']
    if CANDIDATE_IMAGE:
        assert image == CANDIDATE_IMAGE, 'check=candidate_image_pinned ' + image
    assert new['RootFS']['Layers'][:len(old['RootFS']['Layers'])] == old['RootFS']['Layers'], 'check=layer_prefix'
    for key in ['Cmd', 'Entrypoint', 'Env', 'User', 'WorkingDir', 'ExposedPorts', 'Healthcheck', 'Volumes', 'StopSignal']:
        assert new['Config'].get(key) == old['Config'].get(key), 'check=config ' + key
    print('overlay_build=passed image=' + image, flush=True)
    env_path = P / '.env'
    compose_path = P / 'compose.json'
    original = env_path.read_bytes()
    original_compose = compose_path.read_bytes()
    (directory / 'previous-image.env').write_bytes(original)
    (directory / 'previous-compose.json').write_bytes(original_compose)
    compose = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(compose_path), '--profile', 'application']
    old_env, new_env = dict(os.environ, THAARA_PILOT_API_IMAGE=base_image), dict(os.environ, THAARA_PILOT_API_IMAGE=image)
    backup = directory / 'before-10831.dump'
    with backup.open('xb') as stream:
        dump = subprocess.run(['docker', 'exec', '--user', 'postgres', PG, 'pg_dump', '-U', 'postgres', '-d', DB, '-Fc'], stdout=stream, stderr=subprocess.PIPE, timeout=120)
    assert dump.returncode == 0 and backup.stat().st_size > 100, 'check=backup_created'
    with backup.open('rb') as stream:
        listing = subprocess.run(['docker', 'exec', '-i', '--user', 'postgres', PG, 'pg_restore', '-l'], stdin=stream, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60)
    assert listing.returncode == 0, 'check=backup_listing'
    (directory / 'database-before.json').write_text(json.dumps(facts))
    print('private_backup=created_and_archive_list_validated', flush=True)
    assert facts['step10831'] == 2 and facts['issuer_owner'] == 'thaara_whatsapp_audit_guard', 'check=10831_already_installed'
    trg_status = sql("SELECT json_build_object('exists', to_regprocedure('public.sync_whatsapp_relay_principal_revision()') IS NOT NULL)")
    if not trg_status['exists']:
        res = subprocess.run(['docker', 'exec', '-i', '--user', 'postgres', PG, 'psql', '-X', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1'], input=sql_file.read_bytes(), capture_output=True, timeout=30)
        assert res.returncode == 0, 'check=10832_applied'
        print('step10832_sql=applied_successfully', flush=True)
    else:
        print('step10832_sql=already_installed', flush=True)

    scale_status = sql("SELECT json_build_object('scale_50', EXISTS (SELECT 1 FROM pg_constraint WHERE conname='whatsapp_n8n_connections_check' AND pg_get_constraintdef(oid) LIKE '%<= 50%'))")
    sql_10833_file = context / SQL_10833_NAME
    assert hashlib.sha256(sql_10833_file.read_bytes()).hexdigest() == SQL_10833_SHA, 'check=sql_10833_sha'
    if not scale_status['scale_50']:
        res = subprocess.run(['docker', 'exec', '-i', '--user', 'postgres', PG, 'psql', '-X', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1'], input=sql_10833_file.read_bytes(), capture_output=True, timeout=30)
        assert res.returncode == 0, 'check=10833_applied'
        print('step10833_sql=applied_successfully', flush=True)
    else:
        print('step10833_sql=already_installed', flush=True)
    after_sql = database_facts()
    assert sql("SELECT json_build_object('scale_50', EXISTS (SELECT 1 FROM pg_constraint WHERE conname='whatsapp_n8n_connections_check' AND pg_get_constraintdef(oid) LIKE '%<= 50%'))")['scale_50'], 'check=10833_installed'
    unchanged_except_schema(facts, after_sql, allow_trigger_change_on='whatsapp_n8n_connections' if not trg_status['exists'] else None)
    (directory / 'database-after-sql.json').write_text(json.dumps(after_sql))
    print('step10833_sql=verified rows_rls_grants_policies=unchanged', flush=True)
    changed = False
    try:
        update_compose_and_env(env_path, compose_path, original_compose, base_image, image)
        changed = True
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=new_env)
        wait_api()
        restore_link()
        assert inspect(API)['Image'] == image, 'check=api_image'
        state_after = send_state()
        assert state_after == state_before, 'check=send_state_preserved'
        print('send_state_after=' + json.dumps(state_after), flush=True)
        assert all(identity(inspect(name)) == value for name, value in before.items()), 'check=other_services_unchanged'
        assets = 0
        for item in manifest:
            if item['Path'].startswith('web-dist/'):
                asset = item['Path'][len('web-dist/'):]
                for _ in range(10):
                    try:
                        with urllib.request.urlopen(SITE + '/' + ('' if asset == 'index.html' else asset), timeout=12) as response:
                            got = (response.status, hashlib.sha256(response.read()).hexdigest())
                    except Exception:
                        got = (0, '')
                    if got == (200, item['SHA256']):
                        break
                    time.sleep(3)
                assert got == (200, item['SHA256']), 'check=public_asset ' + asset + ' status=' + str(got[0]) + ' sha=' + got[1][:12]
                assets += 1
        print('trusted_public_assets=' + str(assets) + '/' + str(assets), flush=True)
        durable = '/api/v1/connectors/whatsapp/n8n/durable'
        for path, method, expected in [('/api/v1/health', 'GET', '200'), ('/integrations/phone', 'GET', '200'), ('/api/v1/auth/me', 'GET', '401'),
                                       ('/api/v1/connectors/phone/ai/requests', 'GET', '401'), (durable + '/connections', 'GET', '401'),
                                       (durable + '/wa_pilot_meta_test_10813b/inbox', 'GET', '401')]:
            assert status(path, method) == expected, 'check=public_path ' + path
            print('public_path=' + path + ' status=' + expected, flush=True)
        final_facts = database_facts()
        unchanged_except_schema(after_sql, final_facts)
        assert final_facts['step10831'] == 2, 'check=10831_still_installed'
        rt_verify = run(['docker', 'exec', '-w', '/app/apps/api', API, 'node', '--input-type=module', '-e',
            "const cfg=await import('./pilot-config.mjs');"
            "const dispMod=await import('./dist/services/whatsapp-pilot-dispatch.js');"
            "const enqMod=await import('./dist/services/whatsapp-enquiries.js');"
            "const readMod=await import('./dist/services/chat-whatsapp-read.js');"
            "const phoneMod=await import('./dist/services/phone-calling.js');"
            "const chatPhoneMod=await import('./dist/services/chat-phone-calling.js');"
            "const s=cfg.pilotSendSettings();"
            "const d=dispMod.createPilotWhatsAppDispatcher({webhookPath:'/webhook/test',headerName:'X-Test',secret:'a'.repeat(40)});"
            "const nowIso=new Date().toISOString();"
            "const e1=enqMod.extractWhatsAppCustomerEnquiry({connectionId:'wa_test',recipientId:'rec_1',contactName:'Customer',messages:[{direction:'inbound',textPreview:'Hi, what is Quantum Weave and how much does it cost?',timestamp:nowIso}]});"
            "const r1=enqMod.buildQuantumWeaveCustomerReply({enquiry:e1,latestCustomerMessage:'Hi, what is Quantum Weave and how much does it cost?',optedIn:true,windowOpen:true,hasPriorReply:false});"
            "const e2=enqMod.extractWhatsAppCustomerEnquiry({connectionId:'wa_test',recipientId:'rec_1',contactName:'Customer',messages:[{direction:'inbound',textPreview:'Hi',timestamp:nowIso},{direction:'outbound',textPreview:r1.replyText,timestamp:nowIso},{direction:'inbound',textPreview:'We need WhatsApp automation. Can I book an appointment tomorrow at 4 PM?',timestamp:nowIso}]});"
            "const r2=enqMod.buildQuantumWeaveCustomerReply({enquiry:e2,latestCustomerMessage:'We need WhatsApp automation. Can I book an appointment tomorrow at 4 PM?',optedIn:true,windowOpen:true,hasPriorReply:true});"
            "console.log(JSON.stringify({sendConfigured:Boolean(s),autoReplyEnabled:Boolean(d.autoReplyEnabled),knowledgePass:r1.allowed&&r1.replyText.includes('Quantum Weave')&&!r1.replyText.includes('999'),noPricingPass:r1.replyText.includes('Our team can understand your requirements and guide you on the next steps.'),appointmentRequestPass:r2.allowed&&r2.replyText.includes('REQUESTED')&&!r2.replyText.includes(\"I'm Thaara\"),enquiryExtractPass:e2.enquirySummary.includes('Appointment: REQUESTED')&&typeof readMod.executeChatWhatsAppRead==='function',phonePreserved:typeof phoneMod.PhoneCallingService==='function'&&typeof chatPhoneMod.executeChatPhoneCalling==='function'}));"
        ]).stdout.strip()
        print('runtime_verification=' + rt_verify, flush=True)
        final = {'image': image, 'archive_sha256': ARCHIVE_SHA, 'sql_sha256': SQL_SHA, 'send_state': state_after, 'other_services_unchanged': True, 'rollback_directory': str(directory)}
        (directory / 'result.json').write_text(json.dumps(final))
        print(json.dumps(final), flush=True)
    except Exception:
        print('publication_failed=attempting_API_rollback step10831_schema_retained=yes', flush=True)
        if changed:
            rollback_compose_and_env(env_path, compose_path, original, original_compose, compose, old_env, base_image)
            print('API_rollback=verified', flush=True)
        raise

if __name__ == '__main__':
    try:
        assert globals().get('OWNER_APPROVED_10831') is True
        publish(globals()['PAYLOAD'])
    except Exception as error:
        print('Step10831 stopped: ' + str(error) if isinstance(error, (AssertionError, RuntimeError)) else 'Step10831 stopped; private diagnostics withheld', flush=True)
        raise SystemExit(1)
