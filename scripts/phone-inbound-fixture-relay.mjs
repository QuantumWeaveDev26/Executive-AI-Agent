import {spawn} from 'node:child_process';
import {createBinaryRelay} from './step1084-loopback-proxy.mjs';
import {assertInboundUnpublishedFixture,INBOUND_RUNTIME} from './phone-inbound-runtime-guard.mjs';
const reasons=new Set(['relay_configuration','relay_not_started','relay_fault','relay_connections_active','relay_tunnel_limit','relay_tunnel_handle','relay_tunnel_spawn','relay_tunnel_process','relay_listener_address','relay_start_repeated','relay_start_timeout','relay_bind_failed','relay_idle_timeout','relay_shutdown_unverified']);
export function readOwnedRelayDiagnostic(error){try{const reason=error?.fixtureTransportReason;return typeof reason==='string'&&reasons.has(reason)?reason:null;}catch{return null;}}
const error=(message,reason)=>Object.assign(Error(message),{fixtureTransportReason:reasons.has(reason)?reason:'relay_fault'});
const deny=(reason='relay_configuration')=>{throw error('INBOUND_RELAY_PROOF_DENIED',reason);};
const engines=['npipe:////./pipe/dockerDesktopLinuxEngine','npipe:////./pipe/docker_engine'];
/** Inert until start(). Trusted fixture-only dependencies; never exposed to application/model input. */
export function createOwnedInboundFixtureRelay({expected,inspection,dockerEndpoint,spawnTunnel,makeRelay=createBinaryRelay,settleMs=5000}){
 const target=Object.freeze({containerId:expected.containerId,networkId:expected.networkId,imageId:expected.imageId,runId:expected.runId});
 if(Object.values(target).some(v=>typeof v!=='string'))deny();
 assertInboundUnpublishedFixture(target,inspection.facts,inspection.network);
 if(!engines.includes(dockerEndpoint)||!Number.isSafeInteger(settleMs)||settleMs<1||settleMs>5000||typeof target.containerId!=='string')deny();
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|COMSPEC|PATHEXT|DOCKER_CONFIG)$/i.test(k)));
 env.DOCKER_HOST=dockerEndpoint; // Pin the verified local endpoint; do not depend on later context changes.
 const open=spawnTunnel??(owner=>spawn('docker',['--host',dockerEndpoint,'exec','-i',owner.containerId,'nc','127.0.0.1','5432'],{env,stdio:['pipe','pipe','pipe'],windowsHide:true}));
 const children=new Set(),sockets=new Set(),listeners=new Set();let closing=false,fault=false,faultReason=null,attempted=false,started=false,startPending=false,startFailed=false,listenerClosed=false,closePromise;
 const notify=()=>{for(const fn of [...listeners])fn();};
 const waitFor=(predicate,reason='relay_shutdown_unverified')=>{
  if(predicate())return Promise.resolve();
  return new Promise((resolve,reject)=>{
   const changed=()=>{if(predicate()){clearTimeout(timer);listeners.delete(changed);resolve();}},timer=setTimeout(()=>{listeners.delete(changed);reject(error('INBOUND_RELAY_SHUTDOWN_UNVERIFIED',reason));},settleMs);
   listeners.add(changed);changed();
  });
 };
 const server=makeRelay(()=>{
  if(closing||fault)deny('relay_fault');if(!started)deny('relay_not_started');if(children.size>=16)deny('relay_tunnel_limit');
  let child;try{child=open(target);}catch{fault=true;faultReason='relay_tunnel_spawn';deny(faultReason);}
  if(!child||typeof child.once!=='function'||typeof child.kill!=='function'||children.has(child)){fault=true;faultReason='relay_tunnel_handle';deny(faultReason);}
  children.add(child);child.once('close',()=>{children.delete(child);notify();});child.on('error',()=>{fault=true;faultReason='relay_tunnel_process';notify();});return child;
 });
 server.maxConnections=16;
 server.on('connection',socket=>{if(socket.destroyed)return;sockets.add(socket);socket.once('close',()=>{sockets.delete(socket);notify();});});
 server.on('error',()=>{fault=true;faultReason='relay_bind_failed';notify();});server.on('close',()=>{listenerClosed=true;notify();});
 const addressProof=()=>{const a=server.address();if(!server.listening||!a||typeof a!=='object'||a.address!=='127.0.0.1'||a.family!=='IPv4'||a.port!==INBOUND_RUNTIME.port||server.maxConnections!==16)deny('relay_listener_address');};
 return Object.freeze({
  start(){
   if(attempted||closing||fault) return Promise.reject(error('INBOUND_RELAY_PROOF_DENIED','relay_start_repeated'));attempted=true;startPending=true;
   return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=reason=>{if(settled)return;settled=true;clearTimeout(timer);server.removeListener('error',failed);reason?reject(error('INBOUND_RELAY_PROOF_DENIED',reason)):resolve();};
    const failed=()=>{startPending=false;startFailed=true;finish('relay_bind_failed');};
    const timer=setTimeout(()=>{fault=true;faultReason='relay_start_timeout';server.unref?.();finish(faultReason);},settleMs);
    server.once('error',failed);
    try{server.listen(INBOUND_RUNTIME.port,'127.0.0.1',()=>{
     startPending=false;started=true;
     if(closing||fault){try{server.close(()=>{listenerClosed=true;notify();});}catch{/* Unknown close remains unverified. */}finish(faultReason??'relay_fault');return;}
     try{addressProof();finish(null);}catch{fault=true;faultReason='relay_listener_address';finish(faultReason);}
    });}catch{startPending=false;startFailed=true;finish('relay_bind_failed');}
   });
  },
  verify(current){
   if(closing||fault)deny('relay_fault');if(!started)deny('relay_not_started');if(children.size||sockets.size)deny('relay_connections_active');
   assertInboundUnpublishedFixture(target,current.facts,current.network);addressProof();
   return Object.freeze({transport:'owned-exec-loopback',loopbackVerified:true,containerBound:true,noDockerPublication:true});
  },
  waitForIdle(){return waitFor(()=>children.size===0&&sockets.size===0,'relay_idle_timeout');},
  diagnostic(){return Object.freeze({faultReason,activeChildren:children.size,activeSockets:sockets.size,startPending,started,closing,listenerClosed});},
  close(){
   if(closePromise)return closePromise;closing=true;
   closePromise=(async()=>{
    for(const socket of sockets)try{socket.destroy();}catch{fault=true;}
    for(const child of children)try{child.kill('SIGKILL');}catch{fault=true;}
    if(server.listening)try{server.close(()=>{listenerClosed=true;notify();});}catch{/* Must prove close, never infer it from a request. */}
    else if(!attempted||startFailed&&!startPending)listenerClosed=true;
    try{await waitFor(()=>listenerClosed&&children.size===0&&sockets.size===0);}
    catch{
     // Keep failure unverified and block container deletion, but do not pin the runner on an unknown child.
     server.unref?.();for(const child of children){try{child.stdin?.destroy?.();child.stdout?.destroy?.();child.stderr?.destroy?.();child.unref?.();}catch{/* No cleanup-success inference. */}}
     throw error('INBOUND_RELAY_SHUTDOWN_UNVERIFIED','relay_shutdown_unverified');
    }
    return Object.freeze({listenerClosed:true,childrenClosed:true,socketsClosed:true});
   })();return closePromise;
  }
 });
}
