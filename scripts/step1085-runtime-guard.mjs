import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
export const CALLBACK_DATABASE='thaara_step1085_test';
export const CALLBACK_CONTAINER='thaara-step1085-callback-postgres';
export const CALLBACK_NETWORK='thaara-step1085-isolated';
const fail=()=>{throw Error('Step1085 isolated fixture unavailable or mismatched');};
export function getCallbackRuntimeConfig(env=process.env){
  if(env.THAARA_STEP1085_RUNTIME_APPROVED!=='yes')fail();
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','BOOTSTRAP_DATABASE_URL','WORKER_DATABASE_URL','REDIS_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGHOSTADDR','NODE_OPTIONS','NODE_PATH'])if(env[key])fail();
  const result={databaseName:CALLBACK_DATABASE};
  for(const [key,role,property]of [['THAARA_STEP1085_ADMIN_URL','postgres','migrationUrl'],['THAARA_STEP1085_APP_URL','thaara_app','appUrl']]){
    let u;try{u=new URL(env[key]);}catch{fail();}
    if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||u.port!=='15433'||u.pathname!=='/'+CALLBACK_DATABASE||u.username!==role||!u.password||u.search||u.hash)fail();
    result[property]=u.href;
  }
  return Object.freeze(result);
}
export function assertCallbackFixture(expected,f,network){
  if(!/^[a-f0-9]{64}$/.test(expected.ContainerId||'')||f.Id!==expected.ContainerId||f.Image!==expected.ImageId||f.Name!=='/'+CALLBACK_CONTAINER
    ||f.Labels?.['thaara.step']!=='1085'||!f.State?.Running||f.Restarts!==0||f.ReadOnly!==true||f.Mounts.some(m=>m.Type!=='tmpfs')
    ||f.Binds?.length||Object.keys(f.Tmpfs||{}).sort().join(',')!=='/tmp,/var/lib/postgresql/data,/var/run/postgresql'
    ||Object.keys(f.Networks||{}).join(',')!==CALLBACK_NETWORK||network.Id!==expected.NetworkId||network.Name!==CALLBACK_NETWORK||network.Internal!==true
    ||network.Labels?.['thaara.step']!=='1085'||Object.keys(network.Containers||{}).join(',')!==expected.ContainerId
    ||Object.keys(f.Ports||{}).join(',')!=='5432/tcp'||f.Ports['5432/tcp'].length!==1||f.Ports['5432/tcp'][0].HostIp!=='127.0.0.1'||f.Ports['5432/tcp'][0].HostPort!=='15433')fail();
}
export function verifyCallbackFixture(){
  try{
    const expected=JSON.parse(fs.readFileSync(new URL('../node_modules/.cache/step1085/identity.json',import.meta.url),'utf8'));
    const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000}).trim();
    const fields={Id:'.Id',Image:'.Image',Name:'.Name',Labels:'.Config.Labels',State:'.State',ReadOnly:'.HostConfig.ReadonlyRootfs',Restarts:'.RestartCount',Mounts:'.Mounts',Tmpfs:'.HostConfig.Tmpfs',Binds:'.HostConfig.Binds',Ports:'.HostConfig.PortBindings',ActualPorts:'.NetworkSettings.Ports',Networks:'.NetworkSettings.Networks'};
    const format='{'+Object.entries(fields).map(([k,v])=>JSON.stringify(k)+':{{json '+v+'}}').join(',')+'}';
    const facts=JSON.parse(docker(['inspect','--format',format,expected.ContainerId]));
    const network=JSON.parse(docker(['network','inspect',CALLBACK_NETWORK]))[0];
    assertCallbackFixture(expected,facts,network);return {expected,facts};
  }catch{fail();}
}
