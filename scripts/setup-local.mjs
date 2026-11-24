import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Generates credentials only for a fresh, isolated developer database.
// Never reads another environment file, copies credentials, or connects to a server.
const secret=()=>randomBytes(32).toString('hex');
const postgres=secret(),app=secret(),worker=secret();
const values={
 NODE_ENV:'development',PORT:'3002',HOST:'127.0.0.1',CORS_ORIGIN:'http://localhost:5173',
 COOKIE_SECURE:'false',LOG_LEVEL:'info',
 THAARA_LOCAL_POSTGRES_PASSWORD:postgres,
 MIGRATION_DATABASE_URL:`postgresql://postgres:${postgres}@127.0.0.1:15432/thaara_v2_local`,
 DATABASE_URL:`postgresql://thaara_app:${app}@127.0.0.1:15432/thaara_v2_local`,
 EPHEMERAL_APP_SECRET:app,
 WORKER_DATABASE_URL:`postgresql://thaara_worker_user:${worker}@127.0.0.1:15432/thaara_v2_local`,
 THAARA_DB_ADMIN_PASSWORD:secret(),THAARA_DB_WORKER_PASSWORD:worker,THAARA_DB_SEEDER_PASSWORD:secret(),
 PGDATABASE:'thaara_v2_local',REDIS_URL:'redis://127.0.0.1:16379',
 SESSION_SECRET:secret(),CSRF_SECRET:secret(),
 THAARA_WHATSAPP_SEND_ENABLED:'false',THAARA_BULK_CAMPAIGN_LIVE_ENABLED:'false'
};
try {
 writeFileSync(resolve('.env.local-dev'),Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{flag:'wx',mode:0o600});
 console.log('Created .env.local-dev with fresh local-only credentials. No values displayed. Keep this file private.');
 if(process.platform==='win32')console.log('On Windows, keep the checkout in your private user folder and restrict this file through Properties > Security.');
} catch(error) {
 if(error.code==='EEXIST')console.error('Stopped: .env.local-dev already exists; existing credentials were not changed.');
 else console.error('Could not create the local configuration. Check folder permissions.');
 process.exitCode=1;
}
