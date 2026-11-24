import {readFileSync,existsSync} from 'node:fs';
export const POSTGRES_IMAGE='postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';
export const REDIS_IMAGE='redis@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499';
const deny=()=>{throw Error('Private synthetic pilot configuration denied');};
const equalKeys=(value,keys)=>Object.keys(value??{}).sort().join(',')===[...keys].sort().join(',');
export function pilotEnvironment(env=process.env){
 if(env.NODE_ENV!=='development'||env.THAARA_VPS_PILOT_ACK!=='isolated_synthetic_only'||!['false','true'].includes(env.THAARA_WHATSAPP_SEND_ENABLED))deny();
 for(const [k,v]of Object.entries(env))if(v&&(/^(PG|GOOGLE_|GMAIL_|META_|N8N_|WHATSAPP_)/.test(k)||['DATABASE_URL','REDIS_URL','MIGRATION_DATABASE_URL','BOOTSTRAP_DATABASE_URL','WORKER_DATABASE_URL','OPENAI_API_KEY','NODE_OPTIONS','NODE_PATH'].includes(k)))deny();
 return Object.freeze({database:'thaara_vps_pilot',host:'postgres',port:3002});
}
// Separately approved send profile (pilot exception): both files must be present and valid, otherwise startup is denied.
export function pilotSendSettings(env=process.env,read=path=>readFileSync(path,'utf8'),now=Date.now()){
 if(env.THAARA_WHATSAPP_SEND_ENABLED==='false')return null;
 if(env.THAARA_WHATSAPP_SEND_ENABLED!=='true')deny();
 try{
  const p=JSON.parse(read('/run/secrets/send_profile')),secret=read('/run/secrets/n8n_dispatch_secret').trim(),expiresAt=Date.parse(p.expiresAt);
  // richMessages (optional, boolean): only set once the outbound workflow sends template/media messages. Absent = false.
  const keys=['connectionId','recipientId','maxPerDay','expiresAt','webhookPath','headerName'];
  if(!(equalKeys(p,keys)||equalKeys(p,[...keys,'richMessages'])&&typeof p.richMessages==='boolean')||!/^[a-zA-Z0-9_-]{1,128}$/.test(p.connectionId)||!/^(?:\*|[a-zA-Z0-9_-]{1,128})$/.test(p.recipientId)
   ||!(p.maxPerDay===null||Number.isSafeInteger(p.maxPerDay)&&p.maxPerDay>=1&&p.maxPerDay<=250)||!(expiresAt>now)||expiresAt-now>90*86400000
   ||!/^\/webhook\/[a-z0-9][a-z0-9-]{0,79}$/.test(p.webhookPath)||!/^X-[A-Za-z0-9-]{1,60}$/.test(p.headerName)||!/^[A-Za-z0-9_-]{32,256}$/.test(secret))throw Error();
  return Object.freeze({profile:Object.freeze({connectionId:p.connectionId,recipientId:p.recipientId,maxPerDay:p.maxPerDay,expiresAt,richMessages:p.richMessages===true}),dispatch:Object.freeze({webhookPath:p.webhookPath,headerName:p.headerName,secret})});
 }catch{throw Error('Pilot send profile denied');}
}
/** Step 108.28: optional dedicated Meta key (owner-entered, root-only file, mounted to the API alone). Read once; never logged. */
export function pilotMetaAccessToken(read=path=>readFileSync(path,'utf8'),exists=path=>existsSync(path)){
 const file='/run/secrets/meta_access_token';
 if(!exists(file))return null;
 let key;try{key=read(file);}catch{throw Error('Pilot Meta key unavailable');}
 if(typeof key!=='string'||key.length<20||key.length>4096||/[\s\u0000-\u001f\u007f]/.test(key))throw Error('Pilot Meta key format denied');
 return key;
}
/** Dedicated Chat Voice Sarvam key (owner-entered, root-only file, mounted to API alone; never reuses sarvam_api_key). */
export function pilotChatVoiceApiKey(read=path=>readFileSync(path,'utf8'),exists=path=>existsSync(path)){
 const file='/run/secrets/chat_sarvam_api_key';
 if(!exists(file))return null;
 let key;try{key=read(file).trim();}catch{throw Error('Pilot Chat Voice key unavailable');}
 if(typeof key!=='string'||key.length<8||key.length>4096||/[\s\u0000-\u001f\u007f]/.test(key))throw Error('Pilot Chat Voice key format denied');
 return key;
}
export function pilotTarget(target){
 if(target.virtualMachineId!==1871828||target.projectName!=='thaara-v2-pilot'||!/^sha256:[a-f0-9]{64}$/.test(target.apiImage??'')||!Array.isArray(target.existingProjects)||target.existingProjects.includes(target.projectName))deny();
}
export function pilotSecrets(read=path=>readFileSync(path,'utf8')){
 try{
  const names=['api_password','session_secret','csrf_secret'],values=names.map(n=>read('/run/secrets/'+n).trim());
  if(values.some(v=>!/^[A-Za-z0-9_-]{32,256}$/.test(v))||new Set(values).size!==values.length)throw Error();
  return {databasePassword:values[0],sessionSecret:values[1],csrfSecret:values[2]};
 }catch{throw Error('Pilot credentials unavailable');}
}
const networks=v=>Array.isArray(v)?[...v].sort().join(','):Object.keys(v??{}).sort().join(',');
const PHONE_SECRETS=['sarvam_api_key','sarvam_webhook_secret','sarvam_profile'];
const PHONE_FIXED={THAARA_PHONE_DURABLE:'approved',THAARA_PHONE_LIVE_CALLING:'approved',THAARA_SARVAM_PROFILE_FILE:'/run/secrets/sarvam_profile',THAARA_SARVAM_API_KEY_FILE:'/run/secrets/sarvam_api_key',THAARA_SARVAM_WEBHOOK_SECRET_FILE:'/run/secrets/sarvam_webhook_secret',THAARA_PHONE_CALLBACK_ORIGIN:'https://thaara-v2.quantumweaveai.io'};
// Existing integrations on the pilot: Chat model (OpenAI, original gpt-4.1-mini) and Google (Gmail + Calendar).
// Each switch has one exact value and needs its exact key-file mounts; the model is limited to the original one.
const CHAT_FIXED={THAARA_OPENAI_API_KEY_FILE:'/run/secrets/openai_api_key'},CHAT_MODELS=['gpt-4.1-mini'];
const GOOGLE_SECRETS=['google_client_id','google_client_secret','google_vault_key'];
function pilotChatEnvironment(environment){
 const present=Object.keys(environment??{}).filter(k=>/^THAARA_(OPENAI|GOOGLE)_/.test(k));
 for(const k of present)if(k==='THAARA_OPENAI_MODEL'?!CHAT_MODELS.includes(environment[k]):k==='THAARA_GOOGLE_OAUTH'?environment[k]!=='approved':environment[k]!==CHAT_FIXED[k])deny();
 if(environment.THAARA_OPENAI_MODEL&&!environment.THAARA_OPENAI_API_KEY_FILE)deny();
 return present;
}
// Phone switches are optional with exact values only. Live calling requires the durable schema switch.
function pilotPhoneEnvironment(environment){
 const present=Object.keys(environment??{}).filter(k=>/^THAARA_(PHONE|SARVAM)_/.test(k));
 for(const k of present)if(k==='THAARA_PHONE_DAILY_CALL_LIMIT'?!/^[1-5]$/.test(environment[k]):environment[k]!==PHONE_FIXED[k])deny();
 if(environment.THAARA_PHONE_LIVE_CALLING&&!environment.THAARA_PHONE_DURABLE)deny();
 return present;
}
export function validatePilotCompose(model){
 if(model.name!=='thaara-v2-pilot'||!equalKeys(model.services,['api','postgres','redis'])||!equalKeys(model.networks,['data','entry'])||!equalKeys(model.volumes,['pgdata','redisdata']))deny();
 for(const [name,v]of Object.entries(model.volumes))if(v.external||v.driver_opts||v.name!==`thaara-v2-pilot-${name}`)deny();
 for(const [name,v]of Object.entries(model.networks))if(v.external||v.name!==`thaara-v2-pilot-${name}`||v.driver_opts)deny();
 if(model.networks.data.internal!==true)deny();
 const {api,postgres,redis}=model.services;
 const required=['NODE_ENV','THAARA_VPS_PILOT_ACK','THAARA_WHATSAPP_SEND_ENABLED'],phoneEnv=pilotPhoneEnvironment(api.environment),chatEnv=pilotChatEnvironment(api.environment);
 if(api.command!=null||api.entrypoint!=null||!equalKeys(api.environment,[...required,...phoneEnv,...chatEnv]))deny();
 pilotEnvironment(api.environment);
 const base=['admin_password','api_password','redis_password','session_secret','csrf_secret'],sendOn=api.environment.THAARA_WHATSAPP_SEND_ENABLED==='true';
 const metaOn=Object.hasOwn(model.secrets??{},'meta_access_token');
 const chatVoiceOn=Object.hasOwn(model.secrets??{},'chat_sarvam_api_key');
 const phoneSecrets=PHONE_SECRETS.filter(name=>Object.hasOwn(model.secrets??{},name));
 // Each key mount and its switch go together: a mount without the switch, or the switch without all its mounts, is refused.
 const chatOn=Object.hasOwn(model.secrets??{},'openai_api_key');
 if(chatOn!==Boolean(api.environment.THAARA_OPENAI_API_KEY_FILE))deny();
 const googleSecrets=GOOGLE_SECRETS.filter(name=>Object.hasOwn(model.secrets??{},name));
 const googleOn=googleSecrets.length===GOOGLE_SECRETS.length;
 if(googleSecrets.length&&!googleOn||googleOn!==(api.environment.THAARA_GOOGLE_OAUTH==='approved'))deny();
 // All three Sarvam mounts or none. Live calling cannot be switched on without them; they may exist while calling stays off.
 if(phoneSecrets.length&&phoneSecrets.length!==PHONE_SECRETS.length||api.environment.THAARA_PHONE_LIVE_CALLING&&!phoneSecrets.length)deny();
 if(!equalKeys(model.secrets,[...base,...(sendOn?['n8n_dispatch_secret','send_profile']:[]),...(metaOn?['meta_access_token']:[]),...(chatVoiceOn?['chat_sarvam_api_key']:[]),...phoneSecrets,...(chatOn?['openai_api_key']:[]),...googleSecrets]))deny();
 for(const [name,s]of Object.entries(model.secrets))if(!(equalKeys(s,['file'])||equalKeys(s,['file','name'])&&s.name===`thaara-v2-pilot_${name}`)||s.file!==`/opt/thaara-v2-pilot-private/secrets/${name}`)deny();
 if(api.cap_drop?.join(',')!=='ALL'||api.security_opt?.join(',')!=='no-new-privileges:true')deny();
 for(const s of api.secrets??[])if(typeof s!=='string'&&(s.target!==undefined&&s.target!==s.source&&s.target!==`/run/secrets/${s.source}`||s.uid!==undefined||s.gid!==undefined||s.mode!==undefined))deny();
 // PostgreSQL may read only its admin secret and the app login it provisions once; Redis only its own.
 const secretNames=s=>(s.secrets??[]).map(x=>typeof x==='string'?x:x.source).sort().join(',');
 const plainMount=x=>typeof x==='string'||(equalKeys(x,['source'])||equalKeys(x,['source','target']))&&(x.target===undefined||x.target===`/run/secrets/${x.source}`);
 if(secretNames(postgres)!=='admin_password,api_password'||secretNames(redis)!=='redis_password'||![...(postgres.secrets??[]),...(redis.secrets??[])].every(plainMount))deny();
 if(postgres.image!==POSTGRES_IMAGE||redis.image!==REDIS_IMAGE||!/^sha256:[a-f0-9]{64}$/.test(api.image??''))deny();
 for(const [name,s]of Object.entries(model.services)){
  if(s.privileged||s.network_mode||s.pid||s.cap_add||s.build||s.env_file||s.devices||s.external_links||s.read_only!==true)deny();
  if(s.volumes?.some(v=>typeof v==='string'||v.type!=='volume'||(name==='postgres'?(v.source!=='pgdata'||v.target!=='/var/lib/postgresql/data'):name==='redis'?(v.source!=='redisdata'||v.target!=='/data'):true)))deny();
 }
 if(postgres.ports?.length||redis.ports?.length||networks(postgres.networks)!=='data'||networks(redis.networks)!=='data'||networks(api.networks)!=='data,entry')deny();
 if(api.user!=='1000:1000'||api.ports?.length!==1||api.ports[0].host_ip!=='127.0.0.1'||String(api.ports[0].published)!=='15440'||api.ports[0].target!==3002)deny();
 const sources=(api.secrets??[]).map(s=>typeof s==='string'?s:s.source).sort();
 if(sources.join(',')!==['api_password','csrf_secret','session_secret',...(sendOn?['n8n_dispatch_secret','send_profile']:[]),...(metaOn?['meta_access_token']:[]),...(chatVoiceOn?['chat_sarvam_api_key']:[]),...phoneSecrets,...(chatOn?['openai_api_key']:[]),...googleSecrets].sort().join(',')||!(api.profiles??[]).includes('application'))deny();
}
