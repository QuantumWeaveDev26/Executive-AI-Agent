import {it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({exec:vi.fn(),spawn:vi.fn(),inspectUnpublished:vi.fn(),makeRelay:vi.fn()}));
vi.mock('node:child_process',()=>({execFileSync:mocks.exec,spawn:mocks.spawn}));
vi.mock('./phone-inbound-runtime-guard.mjs',async original=>({...await original(),inspectInboundUnpublishedFixture:mocks.inspectUnpublished}));
vi.mock('./phone-inbound-fixture-relay.mjs',()=>({createOwnedInboundFixtureRelay:mocks.makeRelay}));
vi.mock('node:net',()=>({default:{createServer:()=>({once(){return this;},listen(_p:number,_host:string,cb:()=>void){cb();},close(cb:(e?:Error)=>void){cb();}})}}));
import {createInboundRuntimePorts} from './phone-inbound-postgres-runtime.mjs';
const ids={containerId:'a'.repeat(64),networkId:'b'.repeat(64),imageId:'sha256:'+'c'.repeat(64),runId:'d'.repeat(32)};
beforeEach(()=>{mocks.exec.mockReset();mocks.spawn.mockReset();mocks.inspectUnpublished.mockReset();mocks.makeRelay.mockReset();});
it('requires TCP readiness rather than the entrypoint temporary socket server',async()=>{mocks.exec.mockReturnValue('ready');const p=createInboundRuntimePorts({verifySources:()=>{},inputs:{},environment:{}});await p.waitReady(ids);const args=mocks.exec.mock.calls[0]![1];expect(args.includes('-h')&&args.includes('127.0.0.1')).toBe(true);});
it('touches no Docker or child when source integrity fails',async()=>{const p=createInboundRuntimePorts({verifySources:()=>{throw Error('mismatch');},inputs:{},environment:{}});await expect(p.preflight()).rejects.toThrow();expect(mocks.exec).not.toHaveBeenCalled();expect(mocks.spawn).not.toHaveBeenCalled();});
it('uses a separate hosted-gate database only with explicit private transport',async()=>{
 expect(()=>createInboundRuntimePorts({verifySources:()=>{},inputs:{},validationPlan:'hosted-gates'})).toThrow();expect(mocks.exec).not.toHaveBeenCalled();
 mocks.exec.mockImplementation((_exe:string,raw:string[])=>{const args=raw[0]==='--host'?raw.slice(2):raw;if(args[0]==='context')return JSON.stringify('npipe:////./pipe/dockerDesktopLinuxEngine');if(args[0]==='image')return ids.imageId;if(args[0]==='run')return ids.containerId;return '';});
 const p=createInboundRuntimePorts({verifySources:()=>{},inputs:{},environment:{},transport:'owned-exec-loopback',validationPlan:'hosted-gates'});await p.preflight();await p.createContainer(ids);
 const call=mocks.exec.mock.calls.find(([,a])=>a.includes('run'))!;expect(call[2].env.POSTGRES_DB).toBe('thaara_vps_pilot');expect(call[1]).not.toContain('-p');expect(mocks.spawn).not.toHaveBeenCalled();
});
it('refuses remote Docker contexts before creating anything',async()=>{mocks.exec.mockReturnValue(JSON.stringify('tcp://remote.test:2376'));const p=createInboundRuntimePorts({verifySources:()=>{},inputs:{},environment:{}});await expect(p.preflight()).rejects.toThrow();expect(mocks.exec).toHaveBeenCalledTimes(1);});
for(const [operation,check]of [['context','context_metadata'],['ps','container_inventory'],['network','network_inventory'],['image','image_metadata']]){
 it(`retains only the failed ${check} boundary`,async()=>{
  mocks.exec.mockImplementation((_exe:string,raw:string[])=>{const args=raw[0]==='--host'?raw.slice(2):raw;if(args[0]===operation)throw Object.assign(Error('PRIVATE OUTPUT'),{code:'ETIMEDOUT',stderr:'SECRET'});if(args[0]==='context')return JSON.stringify('npipe:////./pipe/dockerDesktopLinuxEngine');return '';});
  const p=createInboundRuntimePorts({verifySources:()=>{},inputs:{},environment:{},transport:'owned-exec-loopback'});
  const e=await p.preflight().catch(e=>e);expect(e.preflightCheck).toBe(check);expect(e.preflightKind).toBe('command_timeout');expect(JSON.stringify(e)).not.toMatch(/PRIVATE|SECRET/);expect(mocks.spawn).not.toHaveBeenCalled();
 });
}
it('preflights only local metadata and starts a named read-only tmpfs fixture with no secret command argument',async()=>{
 mocks.exec.mockImplementation((_exe:string,args:string[])=>{if(args[0]==='context')return JSON.stringify('npipe:////./pipe/dockerDesktopLinuxEngine');if(args[0]==='image')return ids.imageId;if(args[0]==='run')return ids.containerId;return '';});
 const p=createInboundRuntimePorts({verifySources:()=>{},inputs:{},environment:{}});expect((await p.preflight()).reviewIntegrity).toBe(true);await p.createContainer(ids);
 const [,args,options]=mocks.exec.mock.calls.find(([,a])=>a[0]==='run')!;
 expect(args.includes('--read-only')).toBe(true);expect(args.includes('--pull=never')).toBe(true);expect(args.includes('--tmpfs')).toBe(true);expect(args.includes('127.0.0.1:15436:5432')).toBe(true);expect(args.includes('-v')).toBe(false);
 expect(args.includes(options.env.POSTGRES_PASSWORD)).toBe(false);expect(/^[A-Za-z0-9_-]{43}$/.test(options.env.POSTGRES_PASSWORD)).toBe(true);expect(options.env.POSTGRES_DB==='thaara_phone113_review').toBe(true);expect(mocks.spawn).not.toHaveBeenCalled();
});
it('requires explicit relay mode, no Docker publications and a verified private listener before admission',async()=>{
 const order:string[]=[];mocks.exec.mockImplementation((_exe:string,raw:string[])=>{const args=raw[0]==='--host'?raw.slice(2):raw;if(args[0]==='context')return JSON.stringify('npipe:////./pipe/dockerDesktopLinuxEngine');if(args[0]==='image')return ids.imageId;if(args[0]==='run')return ids.containerId;return '';});
 const relay={start:vi.fn(async()=>{order.push('start');}),waitForIdle:vi.fn(async()=>{order.push('idle');}),verify:vi.fn(()=>{order.push('proof');return {transport:'owned-exec-loopback',loopbackVerified:true,containerBound:true};}),close:vi.fn(async()=>({listenerClosed:true,childrenClosed:true,socketsClosed:true}))};
 mocks.inspectUnpublished.mockImplementation(()=>{order.push('inspect');return {facts:{},network:{}};});mocks.makeRelay.mockReturnValue(relay);
 const ports=createInboundRuntimePorts({verifySources:()=>{},inputs:{},environment:{},transport:'owned-exec-loopback'});await ports.preflight();await ports.createContainer(ids);expect(await ports.verifyIsolation(ids)).toBe(true);expect(order).toEqual(['inspect','start','idle','proof']);
 order.length=0;await ports.verifyIsolation(ids);expect(order).toEqual(['idle','inspect','idle','proof']);expect(relay.start).toHaveBeenCalledTimes(1);
 const [,args]=mocks.exec.mock.calls.find(([,a])=>a.includes('run'))!;expect(args.includes('-p')).toBe(false);expect(args.slice(0,2)).toEqual(['--host','npipe:////./pipe/dockerDesktopLinuxEngine']);await ports.closeConnections();expect(relay.close).toHaveBeenCalledTimes(1);
});
