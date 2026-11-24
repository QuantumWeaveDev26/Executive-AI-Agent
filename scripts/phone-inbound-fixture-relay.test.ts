import {expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
const spawnMock=vi.hoisted(()=>vi.fn());
vi.mock('node:child_process',()=>({spawn:spawnMock}));
import {createOwnedInboundFixtureRelay,readOwnedRelayDiagnostic} from './phone-inbound-fixture-relay.mjs';
const target={containerId:'a'.repeat(64),networkId:'b'.repeat(64),imageId:'sha256:'+'c'.repeat(64),runId:'d'.repeat(32)};
it('retains only finite transport reasons without exposing arbitrary error data',()=>{
 expect(readOwnedRelayDiagnostic({fixtureTransportReason:'relay_idle_timeout'})).toBe('relay_idle_timeout');
 expect(readOwnedRelayDiagnostic({fixtureTransportReason:'PRIVATE'})).toBeNull();
 expect(readOwnedRelayDiagnostic(Object.defineProperty({},'fixtureTransportReason',{get(){throw Error('PRIVATE');}}))).toBeNull();
});
function inspection(){const labels={'thaara.step':'113-inbound','thaara.run':target.runId};return {facts:{Id:target.containerId,Name:'/thaara-phone113-postgres-review',Image:target.imageId,Labels:labels,ReadOnly:true,Restarts:0,Mounts:[],Binds:null,Tmpfs:{'/tmp':'rw','/var/run/postgresql':'rw','/var/lib/postgresql/data':'rw'},Networks:{'thaara-phone113-network-review':{NetworkID:target.networkId}},Ports:{},ActualPorts:{'5432/tcp':[]},ResolvedPaths:{'/tmp':'/tmp','/var/run/postgresql':'/run/postgresql','/var/lib/postgresql/data':'/var/lib/postgresql/data'},MountInfo:['1 0 0:1 / / ro - overlay overlay rw','2 1 0:2 / /var/lib/postgresql/data rw,nosuid,noexec - tmpfs tmpfs rw,size=524288k','3 1 0:3 / /run/postgresql rw,nosuid,noexec - tmpfs tmpfs rw,size=16384k','4 1 0:4 / /tmp rw,nosuid,noexec - tmpfs tmpfs rw,size=32768k'].join('\n'),Running:true,Privileged:false,Memory:805306368,NanoCpus:1000000000,PidsLimit:128,LogConfig:{Type:'none',Config:{}},SecurityOpt:['no-new-privileges:true'],CapAdd:null},network:{Id:target.networkId,Name:'thaara-phone113-network-review',Internal:true,Labels:labels,Containers:{[target.containerId]:{}}}};}
function fixture({hang=false,address='127.0.0.1',useDefaultSpawn=false,uniqueChildren=false}={}){
 let opener!:()=>any;const child=Object.assign(new EventEmitter(),{kill:vi.fn(()=>{if(!hang)child.emit('close',0);return true;})});
 const server=Object.assign(new EventEmitter(),{listening:false,maxConnections:0,unref:vi.fn(),address:()=>({address,family:'IPv4',port:15436}),listen:vi.fn((_p:number,_host:string,cb:()=>void)=>{server.listening=true;cb();}),close:vi.fn((cb:()=>void)=>{server.listening=false;server.emit('close');cb();})});
 const spawnTunnel=vi.fn(()=>{if(!uniqueChildren)return child;const c=Object.assign(new EventEmitter(),{kill:vi.fn(()=>{c.emit('close',0);return true;})});return c;}),makeRelay=vi.fn((open:()=>any)=>{opener=open;return server;});
 if(useDefaultSpawn)spawnMock.mockReset().mockReturnValue(child);
 const controller=createOwnedInboundFixtureRelay({expected:target,inspection:inspection(),dockerEndpoint:'npipe:////./pipe/dockerDesktopLinuxEngine',spawnTunnel:useDefaultSpawn?undefined:spawnTunnel,makeRelay,settleMs:10});
 return {controller,server,child,spawnTunnel,makeRelay,open:()=>opener()};
}
it('does not listen or spawn at construction, then proves exact loopback listener and fixture identity',async()=>{
 const f=fixture();expect(f.server.listen).not.toHaveBeenCalled();expect(f.spawnTunnel).not.toHaveBeenCalled();expect(()=>f.controller.verify(inspection())).toThrow();
 await f.controller.start();expect(f.server.listen.mock.calls[0]?.slice(0,2)).toEqual([15436,'127.0.0.1']);expect(f.controller.verify(inspection())).toMatchObject({transport:'owned-exec-loopback',loopbackVerified:true,containerBound:true});expect(await f.controller.close()).toEqual({listenerClosed:true,childrenClosed:true,socketsClosed:true});
});
it('rejects unsafe publication and remote engine before creating a listener',()=>{
 const unsafe=inspection();unsafe.facts.ActualPorts={'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'15436'}]} as never;const makeRelay=vi.fn();
 expect(()=>createOwnedInboundFixtureRelay({expected:target,inspection:unsafe,dockerEndpoint:'npipe:////./pipe/docker_engine',makeRelay})).toThrow();expect(()=>createOwnedInboundFixtureRelay({expected:target,inspection:inspection(),dockerEndpoint:'tcp://remote',makeRelay})).toThrow();expect(makeRelay).not.toHaveBeenCalled();
});
it('pins immutable target ID and permits only a bounded number of owned tunnels',async()=>{
 const f=fixture();await f.controller.start();const child=f.open();expect(child).toBe(f.child);expect(f.spawnTunnel.mock.calls[0]?.[0]).toMatchObject(target);expect(Object.isFrozen(f.spawnTunnel.mock.calls[0]?.[0])).toBe(true);
 expect(()=>f.controller.verify(inspection())).toThrow();expect(await f.controller.close()).toMatchObject({childrenClosed:true});expect(f.child.kill).toHaveBeenCalledTimes(1);
});
it('rejects unexpected listener addresses instead of accepting requested configuration',async()=>{
 const f=fixture({address:'0.0.0.0'});await expect(f.controller.start()).rejects.toThrow();await f.controller.close();
});
it('does not claim shutdown if an owned child ignores termination',async()=>{
 vi.useFakeTimers();try{const f=fixture({hang:true});await f.controller.start();f.open();const close=f.controller.close().catch(e=>e);await vi.advanceTimersByTimeAsync(10);expect((await close).message).toBe('INBOUND_RELAY_SHUTDOWN_UNVERIFIED');expect(f.child.kill).toHaveBeenCalledTimes(1);}finally{vi.useRealTimers();}
});
it('rechecks ownership/storage on proof and closes idempotently',async()=>{
 const f=fixture();await f.controller.start();const changed=inspection();changed.network.Containers={['f'.repeat(64)]:{}};expect(()=>f.controller.verify(changed)).toThrow();const first=f.controller.close();expect(f.controller.close()).toBe(first);await first;
});
it('fixes the default command to the verified local endpoint and exact owned container',async()=>{
 const f=fixture({useDefaultSpawn:true});await f.controller.start();f.open();expect(spawnMock.mock.calls[0]?.slice(0,2)).toEqual(['docker',['--host','npipe:////./pipe/dockerDesktopLinuxEngine','exec','-i',target.containerId,'nc','127.0.0.1','5432']]);await f.controller.close();
});
it('enforces the tunnel cap before spawning and settles only its owned children',async()=>{
 const f=fixture({uniqueChildren:true});await f.controller.start();for(let n=0;n<16;n++)f.open();expect(()=>f.open()).toThrow();expect(f.spawnTunnel).toHaveBeenCalledTimes(16);await f.controller.close();
});
it('refuses uncertain startup rather than claiming listener cleanup',async()=>{
 vi.useFakeTimers();try{const f=fixture();f.server.listen.mockImplementation(()=>{});const starting=f.controller.start().catch(e=>e);await vi.advanceTimersByTimeAsync(10);expect((await starting).message).toBe('INBOUND_RELAY_PROOF_DENIED');const closing=f.controller.close().catch(e=>e);await vi.advanceTimersByTimeAsync(10);expect((await closing).message).toBe('INBOUND_RELAY_SHUTDOWN_UNVERIFIED');}finally{vi.useRealTimers();}
});
