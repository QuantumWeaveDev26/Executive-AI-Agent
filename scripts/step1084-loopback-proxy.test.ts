import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { Duplex, PassThrough } from 'node:stream';
const implementation = await import('./step1084-loopback-proxy.mjs').catch(() => null);
describe('Step1084 fixture-only binary loopback relay', () => {
  it('rejects an identity, network, mount or loopback binding mismatch', () => {
    expect(implementation?.assertRelayIdentity).toBeTypeOf('function');
    const id='a'.repeat(64), image='sha256:'+'b'.repeat(64);
    const expected={ContainerId:id,ImageId:image};
    const facts={Id:id,Image:image,Name:'/thaara-step1084-postgres',Label:'1084',Running:true,ReadOnly:true,Restarts:0,
      Mounts:[],Tmpfs:{'/var/lib/postgresql/data':'rw','/var/run/postgresql':'rw','/tmp':'rw'},Binds:null,
      Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'15432'}]},Networks:['thaara-step1084-isolated'],Internal:true,Members:[id]};
    expect(()=>implementation!.assertRelayIdentity(expected,facts)).not.toThrow();
    for(const change of [{Id:'c'.repeat(64)},{Mounts:[{Type:'volume'}]},{Internal:false},{Members:[id,'other']},{Ports:{'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'15432'}]}},{Networks:['thaara-ai-agent-v2_thaara-network']},{ReadOnly:false}])
      expect(()=>implementation!.assertRelayIdentity(expected,{...facts,...change})).toThrow();
  });
  it('forwards binary bytes unchanged without decoding or logging credentials', async () => {
    expect(implementation?.createBinaryRelay).toBeTypeOf('function');
    const child:any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;
    child.stdin.pipe(child.stdout);
    const server=implementation!.createBinaryRelay(()=>child);
    const incoming=new PassThrough(),outgoing=new PassThrough();
    const socket:any=Duplex.from({readable:incoming,writable:outgoing});socket.setTimeout=()=>socket;
    server.emit('connection',socket);
    try {
      const result=new Promise<Buffer>((resolve,reject)=>{outgoing.once('data',resolve);socket.once('error',reject);});
      incoming.write(Buffer.from([0,255,13,10,128,65]));
      expect(await result).toEqual(Buffer.from([0,255,13,10,128,65]));
    } finally {socket.destroy();child.stdin.destroy();child.stdout.destroy();server.close(()=>{});}
  });
});
