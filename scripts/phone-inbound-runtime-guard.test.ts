import {it,expect} from 'vitest';
import {assertInboundRuntimeFixture,assertInboundUnpublishedFixture,inspectInboundRuntimeFixture,readInboundIsolationDiagnostic,INBOUND_RUNTIME} from './phone-inbound-runtime-guard.mjs';
const expected={containerId:'a'.repeat(64),networkId:'b'.repeat(64),imageId:'sha256:'+'c'.repeat(64),runId:'d'.repeat(32)};
function fixture(){
 const labels={'thaara.step':'113-inbound','thaara.run':expected.runId};
 const facts:any={Id:expected.containerId,Name:'/'+INBOUND_RUNTIME.container,Image:expected.imageId,Labels:labels,ReadOnly:true,Restarts:0,
  Mounts:[],Binds:null,Tmpfs:{'/tmp':'rw,noexec,nosuid,size=33554432','/var/run/postgresql':'rw,noexec,nosuid,size=16777216','/var/lib/postgresql/data':'rw,noexec,nosuid,size=536870912'},
  Networks:{[INBOUND_RUNTIME.network]:{NetworkID:expected.networkId}},Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'15436'}]},ActualPorts:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'15436'}]},
  ResolvedPaths:{'/tmp':'/tmp','/var/run/postgresql':'/run/postgresql','/var/lib/postgresql/data':'/var/lib/postgresql/data'},
  MountInfo:['1 0 0:1 / / ro,relatime - overlay overlay rw','2 1 0:2 / /var/lib/postgresql/data rw,nosuid,noexec - tmpfs tmpfs rw,size=524288k','3 1 0:3 / /run/postgresql rw,nosuid,noexec - tmpfs tmpfs rw,size=16384k','4 1 0:4 / /tmp rw,nosuid,noexec - tmpfs tmpfs rw,size=32768k'].join('\n'),
  Running:true,Privileged:false,Memory:805306368,NanoCpus:1000000000,PidsLimit:128,LogConfig:{Type:'none',Config:{}},SecurityOpt:['no-new-privileges:true'],CapAdd:null};
 return {facts,network:{Id:expected.networkId,Name:INBOUND_RUNTIME.network,Internal:true,Labels:labels,Containers:{[expected.containerId]:{}}}};
}
it('admits only actual isolated tmpfs with exact owned identities and loopback publication',()=>{const f=fixture();expect(()=>assertInboundRuntimeFixture(expected,f.facts,f.network)).not.toThrow();});
it('separates unpublished isolation from direct-publication proof without fabricating metadata',()=>{
 const f=fixture();f.facts.Ports={};f.facts.ActualPorts={'5432/tcp':[]};
 expect(()=>assertInboundUnpublishedFixture(expected,f.facts,f.network)).not.toThrow();expect(()=>assertInboundRuntimeFixture(expected,f.facts,f.network)).toThrow();
 const direct=fixture();expect(()=>assertInboundUnpublishedFixture(expected,direct.facts,direct.network)).toThrow();
});
it('refuses unknown publication, actual host mappings and unsafe storage in unpublished mode',()=>{
 for(const change of [(f:any)=>f.facts.ActualPorts=null,(f:any)=>f.facts.ActualPorts={'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'15436'}]},(f:any)=>f.facts.MountInfo=f.facts.MountInfo.replace('tmpfs tmpfs','ext4 /host')]){
  const f=fixture();f.facts.Ports={};f.facts.ActualPorts={'5432/tcp':[]};change(f);expect(()=>assertInboundUnpublishedFixture(expected,f.facts,f.network)).toThrow();
 }
});
for(const [name,change] of Object.entries({
 'persistent Docker volume':(f:any)=>f.facts.Mounts.push({Type:'volume',Destination:'/tmp'}),
 'host directory bind':(f:any)=>f.facts.Binds=['/host:/tmp'],
 'missing actual tmpfs':(f:any)=>f.facts.MountInfo=f.facts.MountInfo.split('\n').slice(0,3).join('\n'),
 'wrong actual source':(f:any)=>f.facts.MountInfo=f.facts.MountInfo.replace('tmpfs tmpfs','tmpfs /host'),
 'writable root':(f:any)=>f.facts.MountInfo=f.facts.MountInfo.replace('/ / ro,','/ / rw,'),
 'extra mount':(f:any)=>f.facts.MountInfo+='\n5 1 0:5 / /host rw - ext4 /dev/host rw',
 'wrong size':(f:any)=>f.facts.MountInfo=f.facts.MountInfo.replace('524288k','1024k'),
 'wrong permission':(f:any)=>f.facts.MountInfo=f.facts.MountInfo.replace('rw,nosuid,noexec','rw,nosuid'),
 'unverified path':(f:any)=>f.facts.ResolvedPaths['/tmp']='/elsewhere',
 'public host port':(f:any)=>f.facts.Ports['5432/tcp'][0].HostIp='0.0.0.0',
 'unpublished actual port':(f:any)=>f.facts.ActualPorts=null,
 'foreign network member':(f:any)=>f.network.Containers['e'.repeat(64)]={},
 'foreign ownership':(f:any)=>f.facts.Labels={...f.facts.Labels,'thaara.run':'e'.repeat(32)},
 'privileged container':(f:any)=>f.facts.Privileged=true,
 'unbounded memory':(f:any)=>f.facts.Memory=0,
 'persistent logs':(f:any)=>f.facts.LogConfig.Type='json-file',
 'extra capabilities':(f:any)=>f.facts.CapAdd=['SYS_ADMIN']
}))it('rejects '+name,()=>{const f=fixture();change(f);expect(()=>assertInboundRuntimeFixture(expected,f.facts,f.network)).toThrow();});

it('identifies rejected checks without recording the rejected value',()=>{
 for(const [key,value,check]of [['ActualPorts',null,'actual_ports'],['SecurityOpt',['PRIVATE-UNTRUSTED'],'security_options'],['Memory',0,'memory_limit'],['MountInfo','PRIVATE-UNTRUSTED','mountinfo_format']] as const){
  const f=fixture();f.facts[key]=value;let error;try{assertInboundRuntimeFixture(expected,f.facts,f.network);}catch(e){error=e;}
  expect(readInboundIsolationDiagnostic(error)).toEqual({check,kind:'validation_failed'});expect(JSON.stringify(readInboundIsolationDiagnostic(error))).not.toContain('PRIVATE');
 }
});
function collector(f=fixture()){
 const fields:Record<string,unknown>={'.Id':f.facts.Id,'.Image':f.facts.Image,'.Name':f.facts.Name,'.Config.Labels':f.facts.Labels,'.HostConfig.ReadonlyRootfs':true,'.RestartCount':0,'.Mounts':f.facts.Mounts,'.HostConfig.Tmpfs':f.facts.Tmpfs,'.HostConfig.Binds':null,'.NetworkSettings.Networks':f.facts.Networks,'.HostConfig.PortBindings':f.facts.Ports,'.NetworkSettings.Ports':f.facts.ActualPorts,'.State.Running':true,'.HostConfig.Privileged':false,'.HostConfig.Memory':f.facts.Memory,'.HostConfig.NanoCpus':f.facts.NanoCpus,'.HostConfig.PidsLimit':128,'.HostConfig.LogConfig':f.facts.LogConfig,'.HostConfig.SecurityOpt':f.facts.SecurityOpt,'.HostConfig.CapAdd':null};
 return (args:string[])=>args[0]==='network'?JSON.stringify([f.network]):args[0]==='exec'?(args[2]==='cat'?f.facts.MountInfo:f.facts.ResolvedPaths[args[4]!]):JSON.stringify(fields[args[2]!.slice('{{json '.length,-2)]);
}
it('preserves successful metadata collection and attributes core collector failures',()=>{
 expect(()=>inspectInboundRuntimeFixture(collector(),expected)).not.toThrow();
 for(const [matches,check]of [
  [(a:string[])=>a[2]==='{{json .Name}}','collect_name'],
  [(a:string[])=>a[0]==='network','collect_network'],
  [(a:string[])=>a[0]==='exec'&&a[2]==='cat','collect_mountinfo'],
  [(a:string[])=>a[0]==='exec'&&a[4]==='/tmp','collect_resolved_tmp']
 ] as const){const base=collector();let error;try{inspectInboundRuntimeFixture((args:string[])=>{if(matches(args))throw Error('PRIVATE');return base(args);},expected);}catch(e){error=e;}expect(readInboundIsolationDiagnostic(error)).toEqual({check,kind:'command_failed'});}
});
it('retains finite collector failure location and timeout kind without raw Docker errors',()=>{
 for(const mode of ['timeout','json']){
  const base=collector();let error;try{inspectInboundRuntimeFixture((args:string[])=>{
   if(args[2]==='{{json .HostConfig.Memory}}'){if(mode==='json')return '{PRIVATE MALFORMED';throw Object.assign(Error('PRIVATE CREDENTIAL CONTENT'),{code:'ETIMEDOUT'});}return base(args);
  },expected);}catch(e){error=e;}
  expect(readInboundIsolationDiagnostic(error)).toEqual({check:'collect_memory',kind:mode==='timeout'?'command_timeout':'invalid_json'});
  expect(JSON.stringify(readInboundIsolationDiagnostic(error))).not.toContain('PRIVATE');
 }
});
it('retains optional port-projection failures swallowed by the shared collector without accepting missing ports',()=>{
 for(const mode of ['timeout','json']){const base=collector();let error;try{inspectInboundRuntimeFixture((args:string[])=>{if(args[2]==='{{json .NetworkSettings.Ports}}'){if(mode==='json')return '{PRIVATE';throw Object.assign(Error('PRIVATE'),{code:'ETIMEDOUT'});}return base(args);},expected);}catch(e){error=e;}
  expect(readInboundIsolationDiagnostic(error)).toEqual({check:'collect_actual_ports',kind:mode==='timeout'?'command_timeout':'invalid_json'});
 }
});
it('never reflects arbitrary diagnostic properties or throwing getters',()=>{
 expect(readInboundIsolationDiagnostic({isolationCheck:'PRIVATE',isolationKind:'PRIVATE'})).toEqual({check:null,kind:null});
 expect(readInboundIsolationDiagnostic(Object.defineProperty({},'isolationCheck',{get(){throw Error('PRIVATE');}}))).toEqual({check:null,kind:null});
});
