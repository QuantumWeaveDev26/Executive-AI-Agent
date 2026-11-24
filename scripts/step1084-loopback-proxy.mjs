// Fixture-only relay for Docker internal bridges that suppress published host ports.
// No credentials, arbitrary target, application wiring, provider traffic or payload logging.
import fs from 'node:fs';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const fail=()=>{throw Error('Step1084 fixture identity mismatch');};
export function assertRelayIdentity(expected,f) {
  if(!/^[a-f0-9]{64}$/.test(expected.ContainerId||'')||f.Id!==expected.ContainerId||f.Image!==expected.ImageId||f.Name!=='/thaara-step1084-postgres'||f.Label!=='1084'||!f.Running||!f.ReadOnly||f.Restarts!==0||
    f.Mounts.some(m=>m.Type!=='tmpfs')||(f.Binds&&f.Binds.length)||!f.Tmpfs?.['/var/lib/postgresql/data']||!f.Tmpfs?.['/var/run/postgresql']||!f.Tmpfs?.['/tmp']||
    JSON.stringify(f.Networks)!==JSON.stringify(['thaara-step1084-isolated'])||!f.Internal||JSON.stringify(f.Members)!==JSON.stringify([expected.ContainerId])||
    Object.keys(f.Ports).join()!=='5432/tcp'||f.Ports['5432/tcp'].length!==1||f.Ports['5432/tcp'][0].HostIp!=='127.0.0.1'||f.Ports['5432/tcp'][0].HostPort!=='15432')fail();
}
export function createBinaryRelay(openTunnel) {
  const server=net.createServer(socket=>{
    let child;try{child=openTunnel();}catch{socket.destroy();return;}
    socket.setTimeout(30000,()=>socket.destroy());
    socket.on('error',()=>{});child.on('error',()=>socket.destroy());
    child.stdin.on('error',()=>socket.destroy());child.stdout.on('error',()=>socket.destroy());
    child.stderr.resume(); // Never log protocol bytes or container output.
    socket.pipe(child.stdin);child.stdout.pipe(socket);
    socket.on('close',()=>child.kill());child.on('exit',()=>socket.destroy());
  });server.maxConnections=32;return server;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  if(process.argv.slice(2).join()!=='--approved-fixture')fail();
  const expected=JSON.parse(fs.readFileSync(new URL('../node_modules/.cache/step1084/identity.json',import.meta.url),'utf8'));
  const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000}).trim();
  function verify(){
    const fields={Id:'.Id',Image:'.Image',Name:'.Name',Label:'.Config.Labels',State:'.State',ReadOnly:'.HostConfig.ReadonlyRootfs',Restarts:'.RestartCount',Mounts:'.Mounts',Tmpfs:'.HostConfig.Tmpfs',Binds:'.HostConfig.Binds',Ports:'.HostConfig.PortBindings',Networks:'.NetworkSettings.Networks'};
    const format='{'+Object.entries(fields).map(([key,value])=>JSON.stringify(key)+':{{json '+value+'}}').join(',')+'}';
    const facts=JSON.parse(docker(['inspect','--format',format,expected.ContainerId]));
    const network=JSON.parse(docker(['network','inspect','thaara-step1084-isolated']))[0];
    assertRelayIdentity(expected,{...facts,Label:facts.Label['thaara.step'],Running:facts.State.Running,Networks:Object.keys(facts.Networks),Internal:network.Internal,Members:Object.keys(network.Containers||{})});
  }
  verify();
  // The immutable container ID cannot be reassigned. The runner rechecks topology before mutations.
  // Do not block each PostgreSQL authentication handshake on Docker metadata subprocesses.
  const server=createBinaryRelay(()=>spawn('docker',['exec','-i',expected.ContainerId,'nc','127.0.0.1','5432'],{stdio:['pipe','pipe','pipe'],windowsHide:true}));
  server.on('error',()=>{console.error('Step1084 loopback relay unavailable; no fallback target.');process.exitCode=1;});
  server.listen(15432,'127.0.0.1',()=>console.log('Verified Step1084 fixture relay listening only on 127.0.0.1:15432.'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
