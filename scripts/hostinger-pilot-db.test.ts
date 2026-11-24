import { describe, it, expect } from 'vitest';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,mkdirSync,cpSync,writeFileSync,appendFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildPilotDbBundle,callbackBody,PILOT_DATABASE} from '../deploy/hostinger-pilot/pilot-db-bundle.mjs';
import {computeChecksum,Migrator} from '../packages/db/src/migrator.ts';
import {validatePilotCompose} from '../deploy/hostinger-pilot/pilot-config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=(p:string)=>readFileSync(path.join(root,p),'utf8');
function withFixture(mutate:(dir:string)=>void,run:(dir:string)=>void){
  const dir=mkdtempSync(path.join(tmpdir(),'thaara-pilot-db-'));
  try{
    for(const p of ['packages/db/src/migrations','docs/migrations'])cpSync(path.join(root,p),path.join(dir,p),{recursive:true});
    mutate(dir);run(dir);
  }finally{if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'thaara-pilot-db-'))throw Error('Unsafe fixture cleanup');rmSync(dir,{recursive:true,force:true});}
}
describe('private VPS pilot database installer; no database or credentials touched', () => {
  it('keeps the reviewed 1085 body byte-identical and changes only the target guard', () => {
    const review=read('docs/migrations/1085-whatsapp-callback-principal.review.sql');
    const pilot=read('docs/migrations/1089-pilot-callback-principal.review.sql');
    expect(callbackBody(pilot)).toBe(callbackBody(review));
    const guard=pilot.slice(0,pilot.length-callbackBody(pilot).length);
    expect(guard).toContain(`current_database() <> '${PILOT_DATABASE}'`);
    expect(guard).toContain("current_setting('thaara.step1089_pilot_approved',true) IS DISTINCT FROM 'yes'");
    expect(guard).not.toContain('thaara_step1085_test');
    expect(review).toContain("current_database() <> 'thaara_step1085_test'");
  });
  it('builds a deterministic, secret-free bundle whose ledger matches the existing migrator', () => {
    const a=buildPilotDbBundle(root),b=buildPilotDbBundle(root);
    expect(a.sha256).toBe(b.sha256);
    const files=new Migrator({query:async()=>({rows:[]})}).loadMigrationFiles(path.join(root,'packages/db/src/migrations'));
    expect(a.migrations).toEqual(files.map(f=>({version:f.version,name:f.name,checksum:computeChecksum(f.sql)})));
    expect(a.sql).toContain('`cat /run/secrets/api_password`');
    expect(a.sql).not.toMatch(/PASSWORD\s+'[^']/i);
    expect(a.sql.indexOf("current_database() <> 'thaara_vps_pilot'")).toBeLessThan(a.sql.indexOf('CREATE TABLE IF NOT EXISTS schema_migrations'));
    expect(a.sql).toContain('Pilot install postcondition failed');
    // Approval settings are cleared after each reviewed artifact.
    expect(a.sql).toContain("set_config('thaara.step1083_review_approved','',false)");
    expect(a.sql).toContain("set_config('thaara.step1089_pilot_approved','',false)");
  });
  it('refuses tampered, added or retargeted SQL inputs', () => {
    const cases:[string,(d:string)=>void][]= [
      ['base schema manifest mismatch',d=>appendFileSync(path.join(d,'packages/db/src/migrations/0001_initial_schema.sql'),'\n-- tamper')],
      ['base schema manifest mismatch',d=>writeFileSync(path.join(d,'packages/db/src/migrations/0013_extra.sql'),'SELECT 1;')],
      ['1083 checksum mismatch',d=>appendFileSync(path.join(d,'docs/migrations/1083-whatsapp-durable.review.sql'),'\n-- tamper')],
      ['1085 checksum mismatch',d=>appendFileSync(path.join(d,'docs/migrations/1085-whatsapp-callback-principal.review.sql'),'\n-- tamper')],
      ['1089 checksum mismatch',d=>{const p=path.join(d,'docs/migrations/1089-pilot-callback-principal.review.sql');writeFileSync(p,readFileSync(p,'utf8').replace("'thaara_vps_pilot'","'thaara_v2'"));}],
    ];
    for(const [message,mutate] of cases)withFixture(mutate,dir=>expect(()=>buildPilotDbBundle(dir)).toThrow(message));
  });
  it('lets PostgreSQL read only its admin secret and the app login it provisions', () => {
    const model=JSON.parse(read('deploy/hostinger-pilot/compose.review.json'));
    model.services.api.image='sha256:'+'a'.repeat(64);
    expect(validatePilotCompose(model)).toBeUndefined();
    for(const mutate of [(x:any)=>x.services.postgres.secrets.push('session_secret'),(x:any)=>x.services.postgres.secrets=['admin_password'],(x:any)=>x.services.redis.secrets.push('api_password'),(x:any)=>x.services.postgres.secrets[1]={source:'api_password',target:'/tmp/x'}]){
      const x=structuredClone(model);mutate(x);expect(()=>validatePilotCompose(x)).toThrow();
    }
  });
  it('keeps the n8n link scripts to network-only docker commands with no restart, compose, port or workflow change', () => {
    for(const file of ['deploy/hostinger-pilot/n8n-link.sh','deploy/hostinger-pilot/n8n-link-rollback.sh']){
      const code=read(file).split('\n').filter(l=>!l.trim().startsWith('#')).join('\n');
      const commands=[...code.matchAll(/docker\s+([a-z]+(?:\s+[a-z]+)?)/g)].map(m=>m[1].split(/\s+/).slice(0,m[1].startsWith('network')?2:1).join(' '));
      for(const c of commands)expect(['inspect','exec','network inspect','network create','network connect','network disconnect','network rm']).toContain(c);
      expect(code).not.toMatch(/\b(restart|compose|stop|kill|rm -f|-p\s+\d|--publish|sysctl|ufw|iptables|n8n\s+(import|update|execute))\b/);
    }
    expect(read('deploy/hostinger-pilot/n8n-link.sh')).toContain('--internal');
  });
  it('108.16: send stays off unless the explicit flag AND a valid bounded profile AND secret are present', async () => {
    const {pilotSendSettings,pilotEnvironment}=await import('../deploy/hostinger-pilot/pilot-config.mjs');
    const env=(v:string)=>({NODE_ENV:'development',THAARA_VPS_PILOT_ACK:'isolated_synthetic_only',THAARA_WHATSAPP_SEND_ENABLED:v});
    const now=Date.parse('2026-10-28T10:00:00Z'),secret='k'.repeat(43);
    const profile={connectionId:'wa_pilot_meta_test_10813b',recipientId:'owner_test_phone',maxPerDay:1,expiresAt:'2026-10-29T10:00:00Z',webhookPath:'/webhook/thaara-v2-dev-whatsapp-approved-1082',headerName:'X-Thaara-Dispatch'};
    const files=(p:any,s=secret)=>(path:string)=>path.endsWith('send_profile')?JSON.stringify(p):s;
    expect(pilotSendSettings(env('false'),files(profile),now)).toBeNull();
    expect(()=>pilotEnvironment(env('yes'))).toThrow();
    const on=pilotSendSettings(env('true'),files(profile),now)!;
    expect(on.profile).toEqual({connectionId:profile.connectionId,recipientId:profile.recipientId,maxPerDay:1,expiresAt:Date.parse(profile.expiresAt),richMessages:false});
    expect(pilotSendSettings(env('true'),files({...profile,richMessages:true}),now)!.profile.richMessages).toBe(true);
    expect(pilotSendSettings(env('true'),files({...profile,richMessages:false}),now)!.profile.richMessages).toBe(false);
    expect(()=>pilotSendSettings(env('true'),files({...profile,richMessages:'yes'}),now)).toThrow('Pilot send profile denied');
    expect(pilotSendSettings(env('true'),files({...profile,maxPerDay:10}),now)!.profile.maxPerDay).toBe(10);
    expect(pilotSendSettings(env('true'),files({...profile,recipientId:'*',maxPerDay:null}),now)!.profile.maxPerDay).toBeNull();
    expect(pilotSendSettings(env('true'),files({...profile,recipientId:'*',maxPerDay:250,expiresAt:'2027-01-20T00:00:00Z'}),now)!.profile).toMatchObject({recipientId:'*',maxPerDay:250});
    for(const bad of [{...profile,maxPerDay:251},{...profile,maxPerDay:0},{...profile,maxPerDay:1.5},{...profile,expiresAt:'2027-02-01T00:00:00Z'},{...profile,recipientId:'**'},{...profile,recipientId:'a b'},{...profile,expiresAt:'2026-10-27T00:00:00Z'},{...profile,webhookPath:'https://evil/x'},{...profile,headerName:'Authorization'},{...profile,extra:1}])
      expect(()=>pilotSendSettings(env('true'),files(bad),now)).toThrow('Pilot send profile denied');
    expect(()=>pilotSendSettings(env('true'),files(profile,'short'),now)).toThrow('Pilot send profile denied');
    expect(()=>pilotSendSettings(env('true'),()=>{throw Error('missing');},now)).toThrow('Pilot send profile denied');
  });
  it('108.16: compose may enable sending only with both send secrets mounted on the API alone', async () => {
    const {validatePilotCompose}=await import('../deploy/hostinger-pilot/pilot-config.mjs');
    const rendered=JSON.parse(read('scripts/fixtures/hostinger-pilot-rendered-compose.json'));
    const on=structuredClone(rendered);on.services.api.environment.THAARA_WHATSAPP_SEND_ENABLED='true';
    expect(()=>validatePilotCompose(on)).toThrow();
    for(const n of ['n8n_dispatch_secret','send_profile']){on.secrets[n]={name:'thaara-v2-pilot_'+n,file:'/opt/thaara-v2-pilot-private/secrets/'+n};on.services.api.secrets.push({source:n,target:'/run/secrets/'+n});}
    expect(validatePilotCompose(on)).toBeUndefined();
    const leak=structuredClone(on);leak.services.postgres.secrets.push({source:'n8n_dispatch_secret',target:'/run/secrets/n8n_dispatch_secret'});expect(()=>validatePilotCompose(leak)).toThrow();
    const off=structuredClone(on);off.services.api.environment.THAARA_WHATSAPP_SEND_ENABLED='false';expect(()=>validatePilotCompose(off)).toThrow();
  });
  it('keeps the safer v2 link off n8n itself, with auto-rollback and public health proofs', () => {
    for(const file of ['deploy/hostinger-pilot/n8n-link-v2.sh','deploy/hostinger-pilot/n8n-link-v2-rollback.sh']){
      const code=read(file).split('\n').filter(l=>!l.trim().startsWith('#')).join('\n');
      // n8n is never connected to, or disconnected from, any network; only the pilot API moves.
      expect(code).not.toMatch(/network (dis)?connect[^\n]*\$N8N|network (dis)?connect[^\n]*n8n-n8n-1/);
      expect(code).not.toMatch(/\b(restart|compose|stop|kill|--publish|sysctl|ufw|iptables)\b/);
      for(const run of code.match(/docker run[^\n]*/g)??[])expect(run).toMatch(/--rm --network none --read-only --cap-drop ALL --entrypoint true/);
    }
    const v2=read('deploy/hostinger-pilot/n8n-link-v2.sh');
    for(const proof of ['public check after connect','public check after Traefik rebuild','public_watch=12/12','n8n_single_network=yes','forged_callback_status'])expect(v2).toContain(proof);
    expect(read('deploy/hostinger-pilot/n8n-link.sh').split('\n').slice(0,3).join('\n')).toContain('exit 1');
  });
  it('keeps the 108.13b update to the pilot API only, pinned, with automatic image rollback', async () => {
    const u=read('deploy/hostinger-pilot/pilot-api-update-10813b.sh');
    expect(u).toMatch(/NEW=sha256:[a-f0-9]{64}\n/);expect(u).not.toContain('PLACEHOLDER');
    expect(u).toContain('up -d --no-deps api');expect(u).toContain('API_UNHEALTHY: restoring previous image');expect(u).toContain('data_services_untouched=yes');
    expect(u).not.toMatch(/n8n-n8n-1|n8n-traefik-1|\bstop\b|\bkill\b|--publish|ufw|iptables/);
    const fix=read('deploy/hostinger-pilot/pilot-meta-connection-fix.mjs');
    // Real owner IDs live only in the root-only params file on the VPS, never in scripts.
    for(const real of ['276710465536610','356865954168966','1402873856243129','1150709394191450'])expect(fix+u).not.toContain(real);
    expect(fix).not.toMatch(/'claim'|'receipts'/);
    for(const run of u.match(/docker run[^\n]*/g)??[])expect(run).toContain('--network thaara-v2-pilot-data --read-only --user 999:999 --cap-drop ALL');
  });
  it('keeps the 108.12 seed synthetic, events-only, bounded and pinned to the approved image', async () => {
    const {PILOT_SEED}=await import('../deploy/hostinger-pilot/pilot-seed.mjs');
    const seed=read('deploy/hostinger-pilot/pilot-seed.mjs'),runner=read('deploy/hostinger-pilot/n8n-relay-seed.sh');
    // Owner-supplied real Meta asset IDs must never enter synthetic fixtures.
    for(const real of ['276710465536610','356865954168966'])expect(seed+runner).not.toContain(real);
    expect(PILOT_SEED.allowedOperations).toEqual(['events']);expect(PILOT_SEED.principalDays).toBeLessThan(30);
    expect(PILOT_SEED.ownerEmail).toMatch(/\.invalid$/);expect(PILOT_SEED.recipients.every((r:any)=>r.phoneE164.startsWith('+1555'))).toBe(true);
    expect(runner).toContain('sha256:7fbcfa2aa3c5c1f7e5a849e23092a746d0bc5bcb7bdf8b0177d7c6d2ad162018');
    expect(runner).toContain('--network thaara-v2-pilot-data');expect(runner).not.toMatch(/\s-p\s|--publish|restart|compose/);
    expect(seed).not.toMatch(/console\.log\([^)]*(token|relayToken)/i);
  });
  it('validates 108.13 Meta params strictly and keeps the runner pinned and receive-only', async () => {
    const {validateMetaParams}=await import('../deploy/hostinger-pilot/pilot-meta-connection.mjs');
    const good={phoneNumberId:'123456789012345',businessAccountId:'987654321098765',graphVersion:'v23.0',ownerPhoneE164:'+447700900123'};
    expect(validateMetaParams(good)).toEqual(good);
    for(const bad of [{...good,extra:'x'},{...good,phoneNumberId:'100020003000'},{...good,ownerPhoneE164:'+15550000001'},{...good,ownerPhoneE164:'447700900123'},{...good,graphVersion:'latest'},{...good,businessAccountId:good.phoneNumberId},{...good,phoneNumberId:'12a'}])expect(()=>validateMetaParams(bad)).toThrow('Pilot Meta connection denied');
    const runner=read('deploy/hostinger-pilot/n8n-meta-connection.sh');
    expect(runner).toContain('sha256:7fbcfa2aa3c5c1f7e5a849e23092a746d0bc5bcb7bdf8b0177d7c6d2ad162018');
    expect(runner).toContain('--network thaara-v2-pilot-data');expect(runner).not.toMatch(/\s-p\s|--publish|restart|compose/);
    expect(read('deploy/hostinger-pilot/pilot-meta-connection.mjs')).not.toMatch(/'claim'|'receipts'/);
  });
  it('accepts the actual docker compose config rendering from the VPS and still rejects foreign secret targets', () => {
    const rendered=JSON.parse(read('scripts/fixtures/hostinger-pilot-rendered-compose.json'));
    expect(validatePilotCompose(rendered)).toBeUndefined();
    for(const mutate of [(x:any)=>x.services.postgres.secrets[1].target='/tmp/api',(x:any)=>x.services.redis.secrets[0].mode=420,(x:any)=>x.services.postgres.secrets.push({source:'csrf_secret',target:'/run/secrets/csrf_secret'}),(x:any)=>x.services.api.ports[0].host_ip='0.0.0.0']){
      const x=structuredClone(rendered);mutate(x);expect(()=>validatePilotCompose(x)).toThrow();
    }
  });
});

describe('108.16 send enable/disable scripts', () => {
  it('pins the send image, bounds the profile, never prints the secret, and the disable script fully reverts', () => {
    const on=read('deploy/hostinger-pilot/pilot-send-enable-10816.sh'),off=read('deploy/hostinger-pilot/pilot-send-disable-10816.sh');
    expect(on).toMatch(/NEW=sha256:[a-f0-9]{64}\n/);expect(on).not.toContain('PLACEHOLDER');
    expect(on).toContain('"maxPerDay":10');expect(on).toContain("+24 hours");expect(on).toContain('up -d --no-deps api');
    expect(on).not.toMatch(/cat [^\n]*n8n_dispatch_secret|echo [^\n]*\$\(cat/);
    expect(on+off).not.toMatch(/n8n-n8n-1|n8n-traefik-1|--publish|ufw|iptables|\brestart\b/);
    expect(off).toContain("ARRAY['events']");expect(off).toContain('shred -u -z');expect(off).toContain('compose.json.before-10816');
    const send=JSON.parse(read('deploy/hostinger-pilot/compose.send.review.json'));expect(send.services.api.environment.THAARA_WHATSAPP_SEND_ENABLED).toBe('true');
  });
});

describe('108.16 retry: sanitized workflow answer shown to the owner', () => {
  it('CLI failure reports an unknown send outcome without echoing arbitrary error text', () => {
    // No acknowledgement: exits before opening any database, reading secrets or making requests.
    const result=spawnSync(process.execPath,[path.join(root,'deploy/hostinger-pilot/pilot-send-cli.mjs'),'approve'],{
      env:{...process.env,THAARA_PILOT_SEND_CLI_ACK:'not_authorized'},encoding:'utf8'
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Send outcome is unknown; check the stored receipt before any retry.');
    expect(result.stderr).not.toContain('Nothing was sent');
    expect(result.stderr).not.toContain('Usage:');
  });
  it('keeps only outcome fields and masks phone numbers; drops anything else', async () => {
    const { sanitizeWorkflowAnswer } = await import('../deploy/hostinger-pilot/pilot-send-cli.mjs');
    expect(sanitizeWorkflowAnswer({ status: 'failed', verified: false, providerErrorCode: '131030', providerErrorMessage: '(#131030) Recipient phone number 447700900123 not in allowed list', headers: { 'x-thaara-dispatch': 'SECRET' }, token: 'EAAxyz' }))
      .toEqual({ status: 'failed', verified: false, providerErrorCode: '131030', providerErrorMessage: 'Recipient is not allowed for this sender.' });
    expect(sanitizeWorkflowAnswer(null)).toEqual({});
    expect(JSON.stringify(sanitizeWorkflowAnswer({ providerErrorMessage: 'x'.repeat(500) })).length).toBeLessThan(260);
  });
  it('never echoes credentials embedded inside an allowed error field or trusts workflow verification',async()=>{
    const {sanitizeWorkflowAnswer}=await import('../deploy/hostinger-pilot/pilot-send-cli.mjs');
    const answer=sanitizeWorkflowAnswer({status:'sent',verified:true,providerErrorCode:'EAAprivateToken123',providerErrorMessage:'Authorization failed; Bearer SECRET; access_token=EAAprivateToken123'});
    expect(answer).toEqual({verified:false,providerErrorCode:'unknown',providerErrorMessage:'Provider authentication failed.'});
    expect(JSON.stringify(answer)).not.toMatch(/SECRET|EAAprivate/);
  });
});
