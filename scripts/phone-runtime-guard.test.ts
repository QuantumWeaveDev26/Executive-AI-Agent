import {describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {phoneRuntimeConfig,assertPhoneRuntimeFixture,PHONE_RUNTIME,runPhoneRuntimeChild,inspectPhoneRuntimeFixture} from './phone-runtime-guard.mjs';
const expected={containerId:'a'.repeat(64),networkId:'b'.repeat(64),imageId:'sha256:'+'c'.repeat(64)};
const mountInfo=()=>[
 '1 0 0:1 / / ro,relatime - overlay overlay rw',
 '2 1 0:2 / /var/lib/postgresql/data rw,nosuid,noexec,relatime - tmpfs tmpfs rw,size=524288k',
 '3 1 0:3 / /run/postgresql rw,nosuid,noexec,relatime - tmpfs tmpfs rw,size=16384k',
 '4 1 0:4 / /tmp rw,nosuid,noexec,relatime - tmpfs tmpfs rw,size=32768k'
].join('\n');
const facts=()=>({Id:expected.containerId,Name:'/'+PHONE_RUNTIME.container,Image:expected.imageId,Labels:{'thaara.step':'110-phone'},ReadOnly:true,Restarts:0,
 MountInfo:mountInfo(),ResolvedPaths:{'/var/lib/postgresql/data':'/var/lib/postgresql/data','/var/run/postgresql':'/run/postgresql','/tmp':'/tmp'},
 Mounts:['/var/lib/postgresql/data','/var/run/postgresql','/tmp'].map(Destination=>({Type:'tmpfs',Destination})),Tmpfs:{'/var/lib/postgresql/data':'rw,noexec,nosuid,size=536870912','/var/run/postgresql':'rw,noexec,nosuid,size=16777216','/tmp':'rw,noexec,nosuid,size=33554432'},Binds:null,
 Networks:{[PHONE_RUNTIME.network]:{NetworkID:expected.networkId}},Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'15435'}]}});
const network=()=>({Id:expected.networkId,Name:PHONE_RUNTIME.network,Internal:true,Labels:{'thaara.step':'110-phone'},Containers:{[expected.containerId]:{}}});
describe('phone PostgreSQL isolation gate, database-free',()=>{
 it('reads safety fields separately even when the optional runtime-port projection is truncated',()=>{
  const values={'.Id':expected.containerId,'.Image':expected.imageId,'.Name':facts().Name,'.Config.Labels':facts().Labels,'.HostConfig.ReadonlyRootfs':true,'.RestartCount':0,'.Mounts':facts().Mounts,'.HostConfig.Tmpfs':facts().Tmpfs,'.HostConfig.Binds':null,'.NetworkSettings.Networks':facts().Networks,'.HostConfig.PortBindings':facts().Ports};
  const query=vi.fn((args:string[])=>{
   if(args[0]==='network')return JSON.stringify([network()]);
   if(args[0]==='exec')return args[2]==='cat'?mountInfo():facts().ResolvedPaths[args[4] as keyof ReturnType<typeof facts>['ResolvedPaths']];
   expect(args[3]).toBe(expected.containerId);
   const field=args[2].slice('{{json '.length,-2);
   if(field==='.NetworkSettings.Ports')return '{"5432/tcp":';
   expect(field in values).toBe(true);return JSON.stringify(values[field as keyof typeof values]);
  });
  const result=inspectPhoneRuntimeFixture(query,expected);
  expect(result.facts.ActualPorts).toBe(null);
  expect(()=>assertPhoneRuntimeFixture(expected,result.facts,result.network)).not.toThrow();
  expect(query.mock.calls.some(([args])=>args[2]?.startsWith('{"Id"'))).toBe(false);
 });
 it('does not waive mandatory port binding or mount metadata on parse failure',()=>{
  const query=vi.fn((args:string[])=>{
   if(args[2]==='{{json .Id}}')return JSON.stringify(expected.containerId);
   return '{invalid';
  });
  expect(()=>inspectPhoneRuntimeFixture(query,expected)).toThrow(/metadata/);
 });
 it('bounds a hung verifier and kills only its supplied child',async()=>{
  const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn()});
  await expect(runPhoneRuntimeChild(child,{timeoutMs:10})).rejects.toThrow(/bound/);expect(child.kill).toHaveBeenCalledTimes(1);expect(child.kill).toHaveBeenCalledWith('SIGKILL');
 });
 it('handles interruption and preserves a normal child result without killing it',async()=>{
  const child=()=>Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn()});
  const interrupted=child(),controller=new AbortController(),run=runPhoneRuntimeChild(interrupted,{signal:controller.signal});controller.abort();
  await expect(run).rejects.toThrow(/interrupted/);expect(interrupted.kill).toHaveBeenCalledTimes(1);expect(interrupted.kill).toHaveBeenCalledWith('SIGKILL');
  const normal=child(),ok=runPhoneRuntimeChild(normal);normal.stdout.emit('data','synthetic result');normal.emit('exit',0);
  expect(await ok).toEqual({code:0,output:'synthetic result'});expect(normal.kill).not.toHaveBeenCalled();
 });
 it('accepts only the dedicated owned tmpfs fixture',()=>expect(()=>assertPhoneRuntimeFixture(expected,facts(),network())).not.toThrow());
 it('accepts empty Docker Mounts only with actual verified temporary filesystems',()=>{
  expect(()=>assertPhoneRuntimeFixture(expected,{...facts(),Mounts:[]},network())).not.toThrow();
  expect(()=>assertPhoneRuntimeFixture(expected,{...facts(),Mounts:[],MountInfo:undefined},network())).toThrow();
 });
 it.each([
  {MountInfo:mountInfo().split('\n').slice(0,-1).join('\n')},
  {MountInfo:mountInfo().replace('tmpfs tmpfs rw,size=524288k','ext4 /dev/sda1 rw')},
  {MountInfo:mountInfo().replace('tmpfs tmpfs rw,size=524288k','tmpfs /host/directory rw,size=524288k')},
  {MountInfo:mountInfo().replace('0:2 / /var/lib','0:2 /host-subdirectory /var/lib')},
  {MountInfo:mountInfo().replace('/tmp rw,nosuid,noexec','/tmp ro,nosuid,noexec')},
  {MountInfo:mountInfo().replace('/ / ro,relatime','/ / rw,relatime')},
  {MountInfo:mountInfo().replace('524288k','1048576k')},
  {MountInfo:mountInfo().replace('0:4','0:2')},
  {MountInfo:mountInfo()+'\n5 2 8:1 / /var/lib/postgresql/data/nested rw - ext4 /dev/sda1 rw'},
  {MountInfo:mountInfo()+'\n5 1 8:1 /host /unexpected rw - ext4 /dev/sda1 rw'},
  {MountInfo:mountInfo()+'\n5 1 8:1 /host /dev/host rw - ext4 /dev/sda1 rw'},
  {MountInfo:mountInfo()+'\n5 1 8:1 /containers/foreign/hosts /etc/hosts rw - ext4 /dev/sda1 rw'},
  {ResolvedPaths:{...facts().ResolvedPaths,'/var/lib/postgresql/data':'/host/data'}},
  {Mounts:[{Type:'bind',Source:'/host',Destination:'/tmp'}]},
  {Mounts:[{Type:'volume',Name:'existing',Destination:'/var/lib/postgresql/data'}]}
 ])('rejects missing, persistent or unsafe actual storage: %j',bad=>expect(()=>assertPhoneRuntimeFixture(expected,{...facts(),...bad},network())).toThrow());
 it('recognizes only Docker-generated files belonging to this exact container',()=>{
  const extra=`\n5 1 8:1 /var/lib/docker/containers/${expected.containerId}/hosts /etc/hosts rw - ext4 /dev/sda1 rw`;
  expect(()=>assertPhoneRuntimeFixture(expected,{...facts(),Mounts:[],MountInfo:mountInfo()+extra},network())).not.toThrow();
 });
 it.each([
  {Name:'/existing-postgres'},{ReadOnly:false},{Restarts:1},{Image:'sha256:'+'d'.repeat(64)},
  {Mounts:[{Type:'volume',Destination:'/var/lib/postgresql/data'}]},{Binds:['existing:/data']},
  {Ports:{'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'15435'}]}},{Networks:{existing:{NetworkID:expected.networkId}}},{Tmpfs:{}}
 ])('refuses an unsafe container: %j',bad=>expect(()=>assertPhoneRuntimeFixture(expected,{...facts(),...bad},network())).toThrow());
 it('refuses external or shared networks',()=>{
  expect(()=>assertPhoneRuntimeFixture(expected,facts(),{...network(),Internal:false})).toThrow();
  expect(()=>assertPhoneRuntimeFixture(expected,facts(),{...network(),Containers:{...network().Containers,foreign:{}}})).toThrow();
 });
 it('rejects existing/environment-selected databases and missing approval',()=>{
  const env={THAARA_PHONE_RUNTIME_APPROVED:'yes',THAARA_PHONE_TEST_ADMIN_URL:'postgresql://postgres:fresh@127.0.0.1:15435/thaara_phone110_test',THAARA_PHONE_TEST_APP_URL:'postgresql://thaara_app:fresh2@127.0.0.1:15435/thaara_phone110_test'};
  expect(phoneRuntimeConfig(env).database).toBe(PHONE_RUNTIME.database);
  for(const bad of [{THAARA_PHONE_RUNTIME_APPROVED:'no'},{DATABASE_URL:env.THAARA_PHONE_TEST_ADMIN_URL},{THAARA_PHONE_TEST_APP_URL:env.THAARA_PHONE_TEST_APP_URL.replace('15435','5432')},{THAARA_PHONE_TEST_ADMIN_URL:env.THAARA_PHONE_TEST_ADMIN_URL.replace('thaara_phone110_test','thaara_vps_pilot')}])expect(()=>phoneRuntimeConfig({...env,...bad})).toThrow();
 });
});
