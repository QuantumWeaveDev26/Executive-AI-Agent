import { describe, it, expect } from 'vitest';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildInputs,prepareBuildContext,verifyBuildContext} from '../deploy/hostinger-pilot/prepare-build-context.mjs';
const module = await import('../deploy/hostinger-pilot/pilot-config.mjs').catch(() => null);
const env = () => ({ NODE_ENV: 'development', THAARA_VPS_PILOT_ACK: 'isolated_synthetic_only', THAARA_WHATSAPP_SEND_ENABLED: 'false' });
describe('private VPS pilot preparation; no infrastructure or credentials created', () => {
  it('assembles a source allowlist excluding private files/caches and detects artifact additions or tampering',()=>{
    const fixture=mkdtempSync(path.join(tmpdir(),'thaara-build-context-'));
    try {
      const repository=fileURLToPath(new URL('../',import.meta.url));
      for(const name of buildInputs(repository).filter((p:string)=>!p.includes('/src/'))){const file=path.join(fixture,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,'synthetic build metadata');}
      for(const dir of ['apps/api/src',...['config','contracts','db','observability','policy'].map(p=>'packages/'+p+'/src')]){mkdirSync(path.join(fixture,dir),{recursive:true});writeFileSync(path.join(fixture,dir,'index.ts'),'export {};');}
      for(const name of ['.env','apps/api/.env','apps/api/src/private.pem','packages/contracts/src/credentials.json','apps/api/src/tsconfig.tsbuildinfo']){writeFileSync(path.join(fixture,name),'synthetic-private-canary');}
      const inputs=buildInputs(fixture);expect(inputs).toContain('apps/api/src/index.ts');expect(inputs.some((p:string)=>/\.env|\.pem|credentials\.json|tsbuildinfo/.test(p))).toBe(false);
      const context=prepareBuildContext(fixture);expect(verifyBuildContext(context)).toBe(inputs.length);
      writeFileSync(path.join(context,'unexpected.env'),'canary');expect(()=>verifyBuildContext(context)).toThrow('Unexpected build context files');
      rmSync(path.join(context,'unexpected.env'));writeFileSync(path.join(context,'apps/api/src/index.ts'),'tampered');expect(()=>verifyBuildContext(context)).toThrow('Build context checksum mismatch');
    } finally {if(!path.resolve(fixture).startsWith(path.resolve(tmpdir())+path.sep+'thaara-build-context-'))throw Error('Unsafe fixture cleanup');rmSync(fixture,{recursive:true,force:true});}
  });
  it('requires explicit test-only intent and never accepts production or provider credentials', () => {
    expect(module).not.toBeNull();
    expect(module!.pilotEnvironment(env())).toMatchObject({ database: 'thaara_vps_pilot', host: 'postgres', port: 3002 });
    for (const update of [{ NODE_ENV: 'production' }, { THAARA_VPS_PILOT_ACK: '' }, { OPENAI_API_KEY: 'private-canary' }, { GOOGLE_CLIENT_SECRET: 'private-canary' }, { N8N_API_KEY: 'private-canary' }, { DATABASE_URL: 'foreign-database' }, { PGHOST: 'foreign' }]) expect(() => module!.pilotEnvironment({ ...env(), ...update })).toThrow('Private synthetic pilot configuration denied');
  });
  it('rejects foreign target, existing resource collisions and unpinned API images', () => {
    expect(module).not.toBeNull();
    const good = { virtualMachineId: 1871828, projectName: 'thaara-v2-pilot', apiImage: 'sha256:' + 'a'.repeat(64), existingProjects: ['n8n','thaara-ai-platform'] };
    expect(module!.pilotTarget(good)).toBeUndefined();
    for (const changes of [{ virtualMachineId: 1 }, { projectName: 'n8n' }, { apiImage: 'thaara:latest' }, { existingProjects: ['thaara-v2-pilot'] }]) expect(() => module!.pilotTarget({ ...good, ...changes })).toThrow();
  });
  it('reads only the fixed secret files, keeps secrets out of errors and rejects shared/invalid credentials', () => {
    expect(module).not.toBeNull(); const seen: string[] = [];
    const values: Record<string,string> = { api_password: 'a'.repeat(43), session_secret: 'b'.repeat(43), csrf_secret: 'c'.repeat(43) };
    const secrets = module!.pilotSecrets((path: string) => { seen.push(path); return values[path.split('/').at(-1)!]; });
    expect(seen.sort()).toEqual(['/run/secrets/api_password','/run/secrets/csrf_secret','/run/secrets/session_secret']);
    expect(secrets.databasePassword).toBe(values.api_password);
    for (const read of [() => 'same'.repeat(12), () => 'private canary invalid', () => { throw Error('private-canary'); }]) {
      try { module!.pilotSecrets(read); expect.fail('must reject'); } catch(e) { expect(String(e)).not.toContain('private-canary'); expect(String(e)).toContain('Pilot credentials unavailable'); }
    }
  });
  it('allows only exact phone switches, and live calling only with durable storage and all Sarvam mounts', () => {
    const model=JSON.parse(readFileSync(new URL('../deploy/hostinger-pilot/compose.review.json',import.meta.url),'utf8'));
    model.services.api.image='sha256:'+'a'.repeat(64);
    const sarvam=['sarvam_api_key','sarvam_webhook_secret','sarvam_profile'];
    const withMounts=(x:any,names=sarvam)=>{for(const n of names){x.secrets[n]={file:'/opt/thaara-v2-pilot-private/secrets/'+n};x.services.api.secrets.push(n);}return x;};
    const live={THAARA_PHONE_DURABLE:'approved',THAARA_PHONE_LIVE_CALLING:'approved',THAARA_SARVAM_PROFILE_FILE:'/run/secrets/sarvam_profile',THAARA_SARVAM_API_KEY_FILE:'/run/secrets/sarvam_api_key',THAARA_SARVAM_WEBHOOK_SECRET_FILE:'/run/secrets/sarvam_webhook_secret',THAARA_PHONE_CALLBACK_ORIGIN:'https://thaara-v2.quantumweaveai.io'};
    const build=(environment:Record<string,string>,names:string[]=[])=>{const x=withMounts(structuredClone(model),names);Object.assign(x.services.api.environment,environment);return x;};
    expect(module!.validatePilotCompose(build({THAARA_PHONE_DURABLE:'approved'}))).toBeUndefined();
    expect(module!.validatePilotCompose(build({THAARA_PHONE_DURABLE:'approved'},sarvam))).toBeUndefined();
    expect(module!.validatePilotCompose(build(live,sarvam))).toBeUndefined();
    expect(module!.validatePilotCompose(build({...live,THAARA_PHONE_DAILY_CALL_LIMIT:'5'},sarvam))).toBeUndefined();
    for(const bad of [build(live),build(live,sarvam.slice(0,2)),build({...live,THAARA_PHONE_DURABLE:'true'},sarvam),build({THAARA_PHONE_LIVE_CALLING:'approved'},sarvam),
      build({...live,THAARA_PHONE_DAILY_CALL_LIMIT:'20'},sarvam),build({...live,THAARA_PHONE_CALLBACK_ORIGIN:'https://evil.example'},sarvam),build({...live,THAARA_SARVAM_API_KEY_FILE:'/tmp/key'},sarvam),
      build({THAARA_PHONE_UNKNOWN:'approved'})])expect(()=>module!.validatePilotCompose(bad)).toThrow();
  });
  it('allows the existing OpenAI chat model and Google only as exact mounts plus switches', () => {
    const model=JSON.parse(readFileSync(new URL('../deploy/hostinger-pilot/compose.review.json',import.meta.url),'utf8'));
    model.services.api.image='sha256:'+'a'.repeat(64);
    const google=['google_client_id','google_client_secret','google_vault_key'];
    const chat={THAARA_OPENAI_API_KEY_FILE:'/run/secrets/openai_api_key'};
    const build=(environment:Record<string,string>,names:string[])=>{const x=structuredClone(model);for(const n of names){x.secrets[n]={file:'/opt/thaara-v2-pilot-private/secrets/'+n};x.services.api.secrets.push(n);}Object.assign(x.services.api.environment,environment);return x;};
    expect(module!.validatePilotCompose(build(chat,['openai_api_key']))).toBeUndefined();
    expect(module!.validatePilotCompose(build({...chat,THAARA_OPENAI_MODEL:'gpt-4.1-mini'},['openai_api_key']))).toBeUndefined();
    expect(module!.validatePilotCompose(build({THAARA_GOOGLE_OAUTH:'approved'},google))).toBeUndefined();
    expect(module!.validatePilotCompose(build({...chat,THAARA_GOOGLE_OAUTH:'approved'},['openai_api_key',...google]))).toBeUndefined();
    for(const bad of [build(chat,[]),build({},['openai_api_key']),build({THAARA_OPENAI_API_KEY_FILE:'/tmp/key'},['openai_api_key']),
      build({...chat,THAARA_OPENAI_MODEL:'gpt-4o'},['openai_api_key']),build({THAARA_OPENAI_MODEL:'gpt-4.1-mini'},[]),
      build({THAARA_GOOGLE_OAUTH:'approved'},google.slice(0,2)),build({},google),build({THAARA_GOOGLE_OAUTH:'true'},google),
      build({...chat,THAARA_OPENAI_BASE_URL:'https://evil.example'},['openai_api_key']),build({OPENAI_API_KEY:'sk-x'} as any,[])])expect(()=>module!.validatePilotCompose(bad)).toThrow();
  });
  it('validates rendered Compose isolation and rejects public ports, socket mounts or foreign volumes', () => {
    expect(module).not.toBeNull();
    const model=JSON.parse(readFileSync(new URL('../deploy/hostinger-pilot/compose.review.json',import.meta.url),'utf8'));
    model.services.api.image='sha256:'+'a'.repeat(64);
    expect(module!.validatePilotCompose(model)).toBeUndefined();
    for (const mutate of [(x:any)=>x.services.api.ports[0].host_ip='0.0.0.0',(x:any)=>x.services.postgres.ports=[{published:'5432'}],(x:any)=>x.services.api.volumes=[{type:'bind',source:'/var/run/docker.sock'}],(x:any)=>x.volumes.pgdata.external=true,(x:any)=>x.networks.data.internal=false,(x:any)=>x.services.api.user='0:0',(x:any)=>x.services.api.secrets.push('admin_password')]) { const x=structuredClone(model); mutate(x); expect(()=>module!.validatePilotCompose(x)).toThrow(); }
    for (const mutate of [(x:any)=>x.services.api.entrypoint=['node'],(x:any)=>x.services.api.command=['dist/server.js'],(x:any)=>x.services.api.environment.NODE_ENV='production',(x:any)=>x.services.api.environment.OPENAI_API_KEY='live-canary',(x:any)=>x.secrets.api_password.file='/root/legacy/.env',(x:any)=>x.services.api.security_opt=[],(x:any)=>x.services.api.secrets[0]={source:'api_password',target:'other'},(x:any)=>x.services.api.cap_drop=[]]) { const x=structuredClone(model); mutate(x); expect(()=>module!.validatePilotCompose(x)).toThrow(); }
  });
  it('hashes pilot owner login passwords with scrypt parameters compatible with API auth login', async () => {
    const { hashPilotPassword, verifyPilotPassword } = await import('../deploy/hostinger-pilot/pilot-owner-login.mjs');
    const { verifyPassword } = await import('../apps/api/src/crypto/password.js');
    const hash = hashPilotPassword('StrongPilotPassword_10818_Test!');
    expect(verifyPilotPassword('StrongPilotPassword_10818_Test!', hash)).toBe(true);
    expect(await verifyPassword('StrongPilotPassword_10818_Test!', hash)).toBe(true);
    expect(await verifyPassword('WrongPassword_10818_Test!', hash)).toBe(false);
    expect(() => hashPilotPassword('short')).toThrow();
  });
});
