import {pilotChatVoiceApiKey,pilotEnvironment,pilotMetaAccessToken,pilotSecrets,pilotSendSettings} from './pilot-config.mjs';
// No automatic SQL, owner provisioning, transport registration or secret generation.
try {
 const c=pilotEnvironment();const s=pilotSecrets();const send=pilotSendSettings();
 const dbPassword=encodeURIComponent(s.databasePassword);
 process.env.DATABASE_URL=`postgresql://thaara_app:${dbPassword}@${c.host}:5432/${c.database}`;
 process.env.SESSION_SECRET=s.sessionSecret;process.env.CSRF_SECRET=s.csrfSecret;
 // Redis has no active worker/client in this API-only pilot. No private Redis password is mounted here.
 process.env.REDIS_URL='redis://redis:6379';process.env.PORT=String(c.port);process.env.HOST='0.0.0.0';
 process.env.CORS_ORIGIN='https://thaara-v2.quantumweaveai.io';process.env.COOKIE_SECURE='true';process.env.LOG_LEVEL='warn';
 const {PostgresDatabase}=await import('@thaara/db');const db=new PostgresDatabase(process.env.DATABASE_URL);
 try {
  const result=await db.query(`SELECT current_database() AS db,current_user AS actor,
   (SELECT count(*)::int FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication) AS restricted,
   pg_has_role(current_user,'thaara_admin','MEMBER') OR pg_has_role(current_user,'thaara_worker','MEMBER') OR pg_has_role(current_user,'thaara_whatsapp_audit_guard','MEMBER') AS elevated,
   to_regclass('public.whatsapp_n8n_relay_principals') IS NOT NULL AS schema_ready`);
  const row=result.rows[0];if(row?.db!==c.database||row.actor!=='thaara_app'||row.restricted!==1||row.elevated||!row.schema_ready)throw Error();
 }finally{await db.close();}
 // Use the same app factory but await startup here, without local .env loading,
 // live Google injection or the unawaited main() in the general entrypoint.
 const {loadConfig}=await import('@thaara/config');
 const {buildApp}=await import('./dist/app.js');
 // Sending is wired only for a separately approved, bounded profile; otherwise claims stay dispatchEnabled=false.
 const whatsappSend=send?{profile:()=>send.profile,dispatcher:(await import('./dist/services/whatsapp-pilot-dispatch.js')).createPilotWhatsAppDispatcher(send.dispatch)}:undefined;
 // Owner-entered Meta key (optional): only media preview/download, template catalog and upload adapters receive it.
 // Absent key => those features report not_configured. Sending still depends solely on the separate send profile.
 // A refused (malformed) key must not take the API down: features stay not_configured.
 let metaKey=null;try{metaKey=pilotMetaAccessToken();}catch{console.warn('Pilot Meta key refused; media/template features stay not configured.');}
 const meta=metaKey?{accessToken:()=>metaKey}:null;
 const metaProviders=meta?{
  whatsappMedia:(await import('./dist/services/whatsapp-media-preview.js')).createMetaWhatsAppMediaProvider(meta),
  whatsappTemplates:(await import('./dist/services/whatsapp-templates.js')).createMetaWhatsAppTemplateProvider(meta),
  whatsappMediaUpload:(await import('./dist/services/whatsapp-media-upload.js')).createMetaWhatsAppMediaUploader(meta)}:{};
 // Phone (Step 110): off unless the explicit switches are set. A refused live check leaves calling disabled and the API up.
 const phone=await (await import('./dist/services/phone-pilot-startup.js')).createPhoneStartup(process.env);
 if(phone.status==='refused')console.warn('Pilot phone live calling refused: '+phone.reasons.join(','));
 // Existing Chat model (OpenAI gpt-4.1-mini) and existing Gmail/Calendar: each off unless its key files are mounted.
 // A refusal leaves that feature not_configured and the API up.
 const providers=await import('./dist/services/pilot-providers.js');
 const chatModel=await providers.createPilotChatModel(process.env);
 if(chatModel.status==='refused')console.warn('Pilot chat model refused: '+chatModel.reason);
 const google=await providers.createPilotGoogle(process.env,s.sessionSecret);
 if(google.status==='refused')console.warn('Pilot Google refused: '+google.reason);
 let chatVoiceKey=null;try{chatVoiceKey=pilotChatVoiceApiKey();}catch{console.warn('Pilot Chat Voice key refused; Chat Voice stays not configured.');}
 const chatSpeech=chatVoiceKey?(await import('./dist/services/chat-voice-sarvam.js')).createSarvamChatSpeech({enabled:true,key:()=>chatVoiceKey}):undefined;
 const app=await buildApp({config:loadConfig(),whatsappSend,...metaProviders,...(chatSpeech?{chatSpeech}:{}),...(phone.phoneCalling?{phoneCalling:phone.phoneCalling}:{}),...(phone.phoneOwnerCalendarReview?{phoneOwnerCalendarReview:true}:{}),...(chatModel.status==='ready'?{modelGateway:chatModel.gateway}:{}),...(google.status==='ready'?google.integration:{})});
 const {existsSync,readFileSync}=await import('node:fs');
 const path=await import('node:path');
 const webRoot=path.resolve('/app/apps/web/dist');
 if(existsSync(path.join(webRoot,'index.html'))){
  const indexHtml=readFileSync(path.join(webRoot,'index.html'));
  const sendIndex=(_req,reply)=>reply.header('cache-control','no-store').type('text/html; charset=utf-8').send(indexHtml);
  for(const route of ['/','/index.html','/dashboard','/chat','/new-conversation','/history','/conversation-history','/automations','/integrations/gmail','/gmail','/integrations/whatsapp','/whatsapp','/integrations/phone','/phone','/integrations/phone/contacts','/integrations/phone/history','/integrations/phone/inbound','/phone/inbound','/integrations/calendar','/calendar','/integrations/bulk-campaign','/integrations/bulk-campaign/create','/integrations/bulk-campaign/history','/integrations/bulk-campaign/history/:campaignId','/bulk-campaigns/create','/bulk-campaigns/history','/bulk-campaigns/history/:campaignId','/integrations/bulk-campaigns','/bulk-campaign','/bulk-campaigns','/settings','/customizations'])app.get(route,sendIndex);
  app.get('/assets/:file',(req,reply)=>{
   const file=String(req.params?.file??'');
   if(!/^[A-Za-z0-9._-]{1,128}\.(js|css)$/.test(file))return reply.code(404).send({error:'Not found'});
   const assetsRoot=path.join(webRoot,'assets'),full=path.resolve(assetsRoot,file);
   if(!full.startsWith(assetsRoot+path.sep)||!existsSync(full))return reply.code(404).send({error:'Not found'});
   return reply.header('cache-control','public, max-age=31536000, immutable').type(file.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8').send(readFileSync(full));
  });
 }
 await app.listen({port:c.port,host:'0.0.0.0'});
}catch{console.error('Private pilot startup denied or unavailable. No migration or provider request was attempted.');process.exitCode=1;}
