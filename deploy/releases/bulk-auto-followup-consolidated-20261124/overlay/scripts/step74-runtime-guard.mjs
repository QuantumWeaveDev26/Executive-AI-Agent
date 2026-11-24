// Shared by Step 74 runtime suites and guarded initialization children. No I/O.
export const TEST_DATABASE_NAME='thaara_step74_test';
const definitions=[
  ['DATABASE_URL','thaara_app','appUrl'],
  ['MIGRATION_DATABASE_URL','postgres','migrationUrl'],
  ['BOOTSTRAP_DATABASE_URL','postgres','bootstrapUrl'],
  ['WORKER_DATABASE_URL','thaara_worker_user','workerUrl'],
  ['REDIS_URL','','redisUrl']
];
const fail=key=>{throw new Error('[Step 74 isolation] Invalid or missing '+key);};
export function assertIsolatedPostgresUrl(value,role) {
  let url;try{url=new URL(value);}catch{fail('PostgreSQL target');}
  if(!['postgresql:','postgres:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='15432'||
     url.pathname!=='/'+TEST_DATABASE_NAME||url.search||url.hash||!url.username||!url.password||
     (role&&url.username!==role))fail('PostgreSQL target');
  return url;
}
export function getIsolatedRuntimeConfig(env=process.env) {
  if(env.THAARA_TEST_MODE!=='step74')fail('THAARA_TEST_MODE');
  const config={databaseName:TEST_DATABASE_NAME,host:'127.0.0.1',port:'15432'};
  for(const [alias,role,property]of definitions) {
    const key='THAARA_TEST_'+alias;
    if(!env[key])fail(key);
    if(alias==='REDIS_URL') {
      let url;try{url=new URL(env[key]);}catch{fail(key);}
      if(url.protocol!=='redis:'||url.hostname!=='127.0.0.1'||url.port!=='16379'||url.pathname!=='/0'||
         url.username||!url.password||url.search||url.hash)fail(key);
    } else assertIsolatedPostgresUrl(env[key],role);
    config[property]=env[key];
    if(env[alias]!==undefined&&env[alias]!==env[key])fail(alias);
  }
  const expected={
    TASK004_DATABASE_URL:config.appUrl,TASK004_MIGRATION_DATABASE_URL:config.migrationUrl,
    PGHOST:'127.0.0.1',PGPORT:'15432',PGDATABASE:TEST_DATABASE_NAME,PGUSER:'postgres',
    PGPASSWORD:decodeURIComponent(new URL(config.migrationUrl).password)
  };
  for(const [key,value]of Object.entries(expected))if(env[key]!==undefined&&env[key]!==value)fail(key);
  for(const key of ['PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGHOSTADDR'])
    if(env[key]!==undefined&&env[key]!=='')fail(key);
  if(env.ALLOW_OFFLINE_RUNTIME_SKIP!==undefined&&env.ALLOW_OFFLINE_RUNTIME_SKIP!=='false')fail('offline skip');
  return Object.freeze(config);
}
export function isolatedRoleUrl(config,username,password) {
  const allowed=/^(thaara_(admin|worker|seeder)_user|unprivileged_tester(_t003(_purge|_stream)?)?)$/;
  if(!allowed.test(username)||!password)fail('derived role');
  const url=assertIsolatedPostgresUrl(config.migrationUrl,'postgres');
  url.username=username;url.password=password;
  assertIsolatedPostgresUrl(url.href,username);
  return url.href;
}
export function childEnvironment(env=process.env) {
  const config=getIsolatedRuntimeConfig(env);
  const child={...env,NODE_ENV:'test',ALLOW_OFFLINE_RUNTIME_SKIP:'false'};
  for(const [alias,,property]of definitions)child[alias]=config[property];
  Object.assign(child,{TASK004_DATABASE_URL:config.appUrl,TASK004_MIGRATION_DATABASE_URL:config.migrationUrl,
    PGHOST:config.host,PGPORT:config.port,PGDATABASE:config.databaseName,PGUSER:'postgres',
    PGPASSWORD:decodeURIComponent(new URL(config.migrationUrl).password)});
  for(const key of ['PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGHOSTADDR','NODE_OPTIONS','NODE_PATH'])delete child[key];
  getIsolatedRuntimeConfig(child);
  return child;
}

export function withoutCommandOutput(command) {
  try { return command(); }
  catch { throw new Error('[Step 74 isolation] Docker inspection failed'); }
}
