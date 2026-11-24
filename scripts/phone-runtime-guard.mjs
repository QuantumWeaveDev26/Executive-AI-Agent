export const PHONE_RUNTIME=Object.freeze({container:'thaara-phone110-postgres',network:'thaara-phone110-isolated',database:'thaara_phone110_test',port:15435,
 image:'postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'});
export const PHONE_SQL_PINS=Object.freeze({
 '110a-phone-contacts.review.sql':'7c2066959edd4b129751bf858e31af1dbed5ae9b300226597e4ce4e160c06a8e',
 '110b-phone-calls.review.sql':'1030cd5b9d2015cad94221cce19c34699fa049b541606f9b081f65f6acc5aa6e',
 '110c-phone-live-mode.review.sql':'479c06d456577a120a95382b25f29d703366ac624dcae71f1d4839e346a67b5d'
});
const fail=()=>{throw Error('Phone disposable PostgreSQL isolation denied');};
const keys=o=>Object.keys(o??{}).sort().join(',');
const paths=['/var/lib/postgresql/data','/var/run/postgresql','/tmp'];
const expectedMounts={
 '/var/lib/postgresql/data':{canonical:'/var/lib/postgresql/data',bytes:536870912},
 '/var/run/postgresql':{canonical:'/run/postgresql',bytes:16777216},
 '/tmp':{canonical:'/tmp',bytes:33554432}
};
const decodeMountPath=s=>s.replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));
function verifyActualStorage(f){
 if(typeof f.MountInfo!=='string'||!f.MountInfo.trim()||f.MountInfo.length>262144||keys(f.ResolvedPaths)!==[...paths].sort().join(','))fail();
 const mounts=f.MountInfo.trim().split('\n').map(line=>{
  const [before,after,...extra]=line.split(' - '),left=before?.split(' '),right=after?.split(' ');
  if(extra.length||left?.length<6||right?.length!==3)fail();
  return {device:left[2],root:decodeMountPath(left[3]),destination:decodeMountPath(left[4]),options:left[5].split(','),type:right[0],source:decodeMountPath(right[1]),superOptions:right[2].split(',')};
 });
 const roots=mounts.filter(m=>m.destination==='/');
 if(roots.length!==1||!roots[0].options.includes('ro')||roots[0].options.includes('rw')||!['overlay','fuse.overlayfs'].includes(roots[0].type))fail();
 // Docker's kernel mounts and its three generated per-container files are not user-provided storage.
 // Everything else must be one of our verified data/runtime tmpfs mounts.
 const approvedDestinations=Object.values(f.ResolvedPaths);
 for(const m of mounts){
  if(m.destination==='/'||approvedDestinations.includes(m.destination))continue;
  if(/^\/(proc|sys|dev)(\/|$)/.test(m.destination)&&['proc','tmpfs','sysfs','cgroup','cgroup2','devpts','mqueue','devtmpfs','securityfs','tracefs','debugfs','fusectl','pstore','configfs','bpf'].includes(m.type))continue;
  const generated=m.destination.match(/^\/etc\/(hosts|hostname|resolv\.conf)$/);
  if(generated&&m.root.endsWith('/containers/'+f.Id+'/'+generated[1]))continue;
  fail();
 }
 const devices=new Set();
 for(const [path,expected]of Object.entries(expectedMounts)){
  const destination=f.ResolvedPaths[path];
  if(destination!==expected.canonical&&!(path==='/var/run/postgresql'&&destination===path))fail();
  const rows=mounts.filter(m=>m.destination===destination);
  if(rows.length!==1)fail();const m=rows[0];
  if(m.type!=='tmpfs'||m.source!=='tmpfs'||m.root!=='/'||!m.options.includes('rw')||m.options.includes('ro')||!m.options.includes('nosuid')||!m.options.includes('noexec')
   ||!m.superOptions.includes('rw')||m.superOptions.includes('ro')||!/^\d+:\d+$/.test(m.device)||devices.has(m.device)||m.device===roots[0].device)fail();
  const size=m.superOptions.find(o=>o.startsWith('size='))?.match(/^size=(\d+)([kmg])?$/i);
  if(!size||Number(size[1])*({k:1024,m:1048576,g:1073741824}[size[2]?.toLowerCase()]??1)!==expected.bytes)fail();
  if(mounts.some(child=>child.destination.startsWith(destination+'/')))fail();
  devices.add(m.device);
 }
}
/** Never build a composite template: an unsupported trailing field can truncate the entire JSON object. */
export function inspectPhoneRuntimeFixture(docker,expected){
 if(!/^[a-f0-9]{64}$/.test(expected.containerId)||!/^[a-f0-9]{64}$/.test(expected.networkId))fail();
 const fields={Id:'.Id',Image:'.Image',Name:'.Name',Labels:'.Config.Labels',ReadOnly:'.HostConfig.ReadonlyRootfs',Restarts:'.RestartCount',Mounts:'.Mounts',Tmpfs:'.HostConfig.Tmpfs',Binds:'.HostConfig.Binds',Networks:'.NetworkSettings.Networks',Ports:'.HostConfig.PortBindings'};
 const facts={};
 for(const [name,field]of Object.entries(fields)){
  try{facts[name]=JSON.parse(docker(['inspect','--format','{{json '+field+'}}',expected.containerId]));}
  catch{throw Error('Phone Docker metadata unavailable: '+name);}
 }
 // Optional connectivity hint only. HostConfig.PortBindings remains mandatory and strictly loopback-only in the guard.
 try{facts.ActualPorts=JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Ports}}',expected.containerId]));}
 catch{facts.ActualPorts=null;}
 // Read only from the exact newly created container. Verify actual filesystems, not just Docker's requested configuration.
 facts.MountInfo=docker(['exec',expected.containerId,'cat','/proc/self/mountinfo']);
 facts.ResolvedPaths=Object.fromEntries(paths.map(path=>[path,docker(['exec',expected.containerId,'readlink','-f',path]).trim()]));
 let network;try{network=JSON.parse(docker(['network','inspect',expected.networkId]))[0];}catch{throw Error('Phone Docker network metadata unavailable');}
 return {facts,network};
}
export function assertPhoneRuntimeFixture(expected,f,network){
 if(!/^[a-f0-9]{64}$/.test(expected.containerId)||!/^[a-f0-9]{64}$/.test(expected.networkId)||!/^sha256:[a-f0-9]{64}$/.test(expected.imageId)
  ||f.Id!==expected.containerId||f.Image!==expected.imageId||f.Name!=='/'+PHONE_RUNTIME.container||f.Labels?.['thaara.step']!=='110-phone'||f.ReadOnly!==true||f.Restarts!==0
  ||!Array.isArray(f.Mounts)||![0,3].includes(f.Mounts.length)||f.Mounts.some(m=>m.Type!=='tmpfs'||!paths.includes(m.Destination)||m.Source&&m.Source!=='tmpfs'||m.RW===false)
  ||new Set(f.Mounts.map(m=>m.Destination)).size!==f.Mounts.length||keys(f.Tmpfs)!==[...paths].sort().join(',')||f.Binds?.length
  ||keys(f.Networks)!==PHONE_RUNTIME.network||f.Networks[PHONE_RUNTIME.network].NetworkID!==expected.networkId
  ||keys(f.Ports)!=='5432/tcp'||f.Ports['5432/tcp']?.length!==1||f.Ports['5432/tcp'][0].HostIp!=='127.0.0.1'||f.Ports['5432/tcp'][0].HostPort!==String(PHONE_RUNTIME.port)
  ||network.Id!==expected.networkId||network.Name!==PHONE_RUNTIME.network||network.Internal!==true||network.Labels?.['thaara.step']!=='110-phone'
  ||keys(network.Containers)!==expected.containerId)fail();
 verifyActualStorage(f);
}
export function phoneRuntimeConfig(env){
 if(env.THAARA_PHONE_RUNTIME_APPROVED!=='yes'||Object.entries(env).some(([k,v])=>v&&(/^(PG|SARVAM_|META_|GOOGLE_)/.test(k)||['DATABASE_URL','MIGRATION_DATABASE_URL','BOOTSTRAP_DATABASE_URL','WORKER_DATABASE_URL','REDIS_URL','NODE_OPTIONS','NODE_PATH'].includes(k))))fail();
 const urls={admin:env.THAARA_PHONE_TEST_ADMIN_URL,app:env.THAARA_PHONE_TEST_APP_URL};
 for(const [name,value]of Object.entries(urls)){
  let u;try{u=new URL(value);}catch{fail();}
  if(u.protocol!=='postgresql:'||u.hostname!=='127.0.0.1'||u.port!==String(PHONE_RUNTIME.port)||u.pathname!=='/'+PHONE_RUNTIME.database||u.username!==(name==='admin'?'postgres':'thaara_app')||!u.password||u.search||u.hash)fail();
 }
 return Object.freeze({...urls,database:PHONE_RUNTIME.database});
}
/** Only the runner's own child is supplied. A hung verifier or interruption must release the runner to its exact-ID finally cleanup. */
export function runPhoneRuntimeChild(child,{signal,timeoutMs=300000}={}){
 return new Promise((resolve,reject)=>{
  let output='',settled=false;
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const stop=()=>{if(settled)return;settled=true;cleanup();reject(Error('Phone runtime child interrupted or exceeded its bound'));try{child.kill('SIGKILL');}catch{}};
  const abort=()=>stop(),timer=setTimeout(stop,timeoutMs);
  child.stdout.on('data',d=>{if(settled)return;output+=d;if(output.length>5000000)stop();});child.stderr.on('data',()=>{});
  child.once('error',()=>stop());
  child.once('exit',code=>{if(settled)return;settled=true;cleanup();resolve({code,output});});
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)stop();
 });
}
