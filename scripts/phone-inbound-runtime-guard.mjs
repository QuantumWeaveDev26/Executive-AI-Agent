import {PHONE_RUNTIME,inspectPhoneRuntimeFixture} from './phone-runtime-guard.mjs';
export const INBOUND_RUNTIME=Object.freeze({container:'thaara-phone113-postgres-review',network:'thaara-phone113-network-review',database:'thaara_phone113_review',port:15436,image:PHONE_RUNTIME.image});
const collectorChecks=Object.freeze({'.Id':'collect_id','.Image':'collect_image','.Name':'collect_name','.Config.Labels':'collect_labels','.HostConfig.ReadonlyRootfs':'collect_readonly','.RestartCount':'collect_restarts','.Mounts':'collect_mounts','.HostConfig.Tmpfs':'collect_tmpfs','.HostConfig.Binds':'collect_binds','.NetworkSettings.Networks':'collect_networks','.HostConfig.PortBindings':'collect_requested_ports','.NetworkSettings.Ports':'collect_actual_ports','.State.Running':'collect_running','.HostConfig.Privileged':'collect_privileged','.HostConfig.Memory':'collect_memory','.HostConfig.NanoCpus':'collect_cpu','.HostConfig.PidsLimit':'collect_pids','.HostConfig.LogConfig':'collect_logging','.HostConfig.SecurityOpt':'collect_security','.HostConfig.CapAdd':'collect_capadd'});
const diagnosticChecks=new Set([...Object.values(collectorChecks),'collect_expected_identity','collect_unknown','collect_network','collect_mountinfo','collect_resolved_data','collect_resolved_runtime','collect_resolved_tmp',
 'isolation_unknown','validation_shape','container_expected','container_identity','container_ownership','network_identity','network_ownership','network_membership','container_readonly','container_state','container_privilege','memory_limit','cpu_limit','pids_limit','logging_policy','security_options','mount_metadata','bind_mounts','tmpfs_config','network_attachment','published_ports','actual_ports','requested_publication_present','actual_publication_present','mountinfo_unavailable','resolved_paths','mountinfo_format','root_mount','unexpected_mount','mount_destination','mount_count','mount_source_type','mount_permissions','mount_device','mount_size','mount_nested']);
const diagnosticKinds=new Set(['validation_failed','command_timeout','command_failed','invalid_json','unexpected_error']);
export function readInboundIsolationDiagnostic(error){
 try{const check=error?.isolationCheck,kind=error?.isolationKind;return {check:typeof check==='string'&&diagnosticChecks.has(check)?check:null,kind:typeof kind==='string'&&diagnosticKinds.has(kind)?kind:null};}
 catch{return {check:null,kind:null};}
}
const deny=(check='isolation_unknown',kind='validation_failed')=>{throw Object.assign(Error('INBOUND_RUNTIME_ISOLATION_DENIED'),{isolationCheck:diagnosticChecks.has(check)?check:'isolation_unknown',isolationKind:diagnosticKinds.has(kind)?kind:'unexpected_error'});};
const keys=o=>Object.keys(o??{}).sort().join(',');
const mounts=Object.freeze({'/var/lib/postgresql/data':{canonical:'/var/lib/postgresql/data',bytes:536870912},'/var/run/postgresql':{canonical:'/run/postgresql',bytes:16777216},'/tmp':{canonical:'/tmp',bytes:33554432}});
const paths=Object.keys(mounts);
const decode=s=>s.replace(/\\([0-7]{3})/g,(_,n)=>String.fromCharCode(parseInt(n,8)));
export function assertInboundOwnedContainer(expected,f){
 if(!expected||!/^[a-f0-9]{64}$/.test(expected.containerId)||!/^sha256:[a-f0-9]{64}$/.test(expected.imageId)||! /^[a-f0-9]{32}$/.test(expected.runId))deny('container_expected');
 if(!f||f.Id!==expected.containerId||f.Image!==expected.imageId||f.Name!=='/'+INBOUND_RUNTIME.container)deny('container_identity');
 if(f.Labels?.['thaara.step']!=='113-inbound'||f.Labels?.['thaara.run']!==expected.runId)deny('container_ownership');
}
export function assertInboundOwnedNetwork(expected,n,{empty=false}={}){
 if(!expected||!/^[a-f0-9]{64}$/.test(expected.networkId)||! /^[a-f0-9]{32}$/.test(expected.runId)||!n||n.Id!==expected.networkId||n.Name!==INBOUND_RUNTIME.network||n.Internal!==true)deny('network_identity');
 if(n.Labels?.['thaara.step']!=='113-inbound'||n.Labels?.['thaara.run']!==expected.runId)deny('network_ownership');
 if(keys(n.Containers)!==(empty?'':expected.containerId))deny('network_membership');
}
export function assertInboundRuntimeFixture(expected,f,n){
 try{return checkInboundRuntimeFixture(expected,f,n,false);}catch(error){if(readInboundIsolationDiagnostic(error).check)throw error;deny('validation_shape','unexpected_error');}
}
/** Container isolation ONLY, not host connectivity. Requires a separate owned relay proof before any SQL. */
export function assertInboundUnpublishedFixture(expected,f,n){
 try{return checkInboundRuntimeFixture(expected,f,n,true);}catch(error){if(readInboundIsolationDiagnostic(error).check)throw error;deny('validation_shape','unexpected_error');}
}
function checkInboundRuntimeFixture(expected,f,n,unpublished){
 assertInboundOwnedContainer(expected,f);assertInboundOwnedNetwork(expected,n);
 const port=p=>keys(p)==='5432/tcp'&&p['5432/tcp']?.length===1&&p['5432/tcp'][0].HostIp==='127.0.0.1'&&p['5432/tcp'][0].HostPort===String(INBOUND_RUNTIME.port);
 if(f.ReadOnly!==true)deny('container_readonly');
 if(f.Restarts!==0||f.Running!==true)deny('container_state');
 if(f.Privileged!==false||f.CapAdd?.length)deny('container_privilege');
 if(f.Memory!==805306368)deny('memory_limit');if(f.NanoCpus!==1000000000)deny('cpu_limit');if(f.PidsLimit!==128)deny('pids_limit');
 if(f.LogConfig?.Type!=='none'||keys(f.LogConfig.Config)!=='')deny('logging_policy');
 if(JSON.stringify(f.SecurityOpt)!=='["no-new-privileges:true"]')deny('security_options');
 if(!Array.isArray(f.Mounts)||![0,3].includes(f.Mounts.length)||f.Mounts.some(m=>m.Type!=='tmpfs'||!paths.includes(m.Destination)||m.Source&&m.Source!=='tmpfs'||m.RW===false)||new Set(f.Mounts.map(m=>m.Destination)).size!==f.Mounts.length)deny('mount_metadata');
 if(f.Binds?.length)deny('bind_mounts');if(keys(f.Tmpfs)!==[...paths].sort().join(','))deny('tmpfs_config');
 if(keys(f.Networks)!==INBOUND_RUNTIME.network||f.Networks[INBOUND_RUNTIME.network].NetworkID!==expected.networkId)deny('network_attachment');
 if(!unpublished){if(!port(f.Ports))deny('published_ports');if(!port(f.ActualPorts))deny('actual_ports');}
 else{
  if(!(f.Ports===null||typeof f.Ports==='object'&&!Array.isArray(f.Ports)&&keys(f.Ports)===''))deny('requested_publication_present');
  if(!f.ActualPorts||typeof f.ActualPorts!=='object'||Array.isArray(f.ActualPorts)||keys(f.ActualPorts)!=='5432/tcp'
   ||!(f.ActualPorts['5432/tcp']===null||Array.isArray(f.ActualPorts['5432/tcp'])&&f.ActualPorts['5432/tcp'].length===0))deny('actual_publication_present');
 }
 if(typeof f.MountInfo!=='string'||!f.MountInfo.trim()||f.MountInfo.length>262144)deny('mountinfo_unavailable');
 if(keys(f.ResolvedPaths)!==[...paths].sort().join(','))deny('resolved_paths');
 const actual=f.MountInfo.trim().split('\n').map(line=>{
  const [a,b,...extra]=line.split(' - '),left=a?.split(' '),right=b?.split(' ');
  if(extra.length||left?.length<6||right?.length!==3)deny('mountinfo_format');
  return {device:left[2],root:decode(left[3]),destination:decode(left[4]),options:left[5].split(','),type:right[0],source:decode(right[1]),superOptions:right[2].split(',')};
 });
 const roots=actual.filter(m=>m.destination==='/');if(roots.length!==1||!roots[0].options.includes('ro')||roots[0].options.includes('rw')||!['overlay','fuse.overlayfs'].includes(roots[0].type))deny('root_mount');
 for(const m of actual){
  if(m.destination==='/'||Object.values(f.ResolvedPaths).includes(m.destination))continue;
  if(/^\/(proc|sys|dev)(\/|$)/.test(m.destination)&&['proc','tmpfs','sysfs','cgroup','cgroup2','devpts','mqueue','devtmpfs','securityfs','tracefs','debugfs','fusectl','pstore','configfs','bpf'].includes(m.type))continue;
  const generated=m.destination.match(/^\/etc\/(hosts|hostname|resolv\.conf)$/);if(generated&&m.root.endsWith('/containers/'+f.Id+'/'+generated[1]))continue;
  deny('unexpected_mount');
 }
 const devices=new Set();for(const [p,wanted]of Object.entries(mounts)){
  const destination=f.ResolvedPaths[p];if(destination!==wanted.canonical&&!(p==='/var/run/postgresql'&&destination===p))deny('mount_destination');
  const rows=actual.filter(m=>m.destination===destination);if(rows.length!==1)deny('mount_count');const m=rows[0];
  const size=m.superOptions.find(o=>o.startsWith('size='))?.match(/^size=(\d+)([kmg])?$/i);
  if(m.type!=='tmpfs'||m.source!=='tmpfs'||m.root!=='/')deny('mount_source_type');
  if(!m.options.includes('rw')||m.options.includes('ro')||!m.options.includes('nosuid')||!m.options.includes('noexec')||!m.superOptions.includes('rw')||m.superOptions.includes('ro'))deny('mount_permissions');
  if(!/^\d+:\d+$/.test(m.device)||devices.has(m.device)||m.device===roots[0].device)deny('mount_device');
  if(!size||Number(size[1])*({k:1024,m:1048576,g:1073741824}[size[2]?.toLowerCase()]??1)!==wanted.bytes)deny('mount_size');
  if(actual.some(child=>child.destination.startsWith(destination+'/')))deny('mount_nested');
  devices.add(m.device);
 }
}
/** Reuse only the unchanged metadata collector, never transform facts to satisfy the outbound110 guard. */
function collectInboundRuntimeFixture(docker,expected){
 let check='collect_expected_identity',kind='validation_failed',optionalPortsFailure=null;
 const observedDocker=args=>{
  check=args[0]==='inspect'?(collectorChecks[args[2]?.slice('{{json '.length,-2)]??'collect_unknown')
   :args[0]==='network'?'collect_network':args[0]==='exec'&&args[2]==='cat'?'collect_mountinfo'
   :args[0]==='exec'&&args[2]==='readlink'?({'/var/lib/postgresql/data':'collect_resolved_data','/var/run/postgresql':'collect_resolved_runtime','/tmp':'collect_resolved_tmp'}[args[4]]??'collect_unknown'):'collect_unknown';
  kind='unexpected_error';
  try{const result=docker(args);kind=['inspect','network'].includes(args[0])?'invalid_json':'unexpected_error';
   if(check==='collect_actual_ports')try{JSON.parse(result);}catch{optionalPortsFailure={check,kind:'invalid_json'};}
   return result;
  }catch(error){let code;try{code=error?.code;}catch{/* Never inspect or reflect raw messages. */}kind=code==='ETIMEDOUT'?'command_timeout':'command_failed';if(check==='collect_actual_ports')optionalPortsFailure={check,kind};deny(check,kind);}
 };
 let inspection;try{inspection=inspectPhoneRuntimeFixture(observedDocker,expected);}catch{deny(check,kind);}
 // Shared110collector treats this projection as optional; inbound already rejects its null fallback.
 if(optionalPortsFailure&&inspection.facts.ActualPorts===null)deny(optionalPortsFailure.check,optionalPortsFailure.kind);
 const extra={Running:'.State.Running',Privileged:'.HostConfig.Privileged',Memory:'.HostConfig.Memory',NanoCpus:'.HostConfig.NanoCpus',PidsLimit:'.HostConfig.PidsLimit',LogConfig:'.HostConfig.LogConfig',SecurityOpt:'.HostConfig.SecurityOpt',CapAdd:'.HostConfig.CapAdd'};
 for(const [key,field]of Object.entries(extra)){
  try{inspection.facts[key]=JSON.parse(observedDocker(['inspect','--format','{{json '+field+'}}',expected.containerId]));}catch{deny(check,kind);}
 }
 return inspection;
}
export function inspectInboundRuntimeFixture(docker,expected){const inspection=collectInboundRuntimeFixture(docker,expected);assertInboundRuntimeFixture(expected,inspection.facts,inspection.network);return inspection;}
export function inspectInboundUnpublishedFixture(docker,expected){const inspection=collectInboundRuntimeFixture(docker,expected);assertInboundUnpublishedFixture(expected,inspection.facts,inspection.network);return inspection;}
