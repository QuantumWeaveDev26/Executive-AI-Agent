import {describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {withFreshPhoneFixtureSession} from './phone-fixture-session.mjs';

function fixture(){
 const events:string[]=[];
 const client:any=new EventEmitter();client.query=vi.fn(async(value:unknown)=>{events.push('operation');return {rows:[value]};});
 client.release=vi.fn(()=>events.push('release'));
 client.end=vi.fn(async()=>{events.push('client-end');});
 const pool:any=new EventEmitter();Object.assign(pool,{totalCount:1,idleCount:0,waitingCount:0,
  connect:vi.fn(async()=>{events.push('connect');return client;}),end:vi.fn(async()=>{events.push('close');})});
 const options={verify:vi.fn(()=>events.push('verify')),createPool:vi.fn(()=>{events.push('create');return pool;})};
 return {events,client,pool,options};
}
describe('fresh phone fixture session, database-free',()=>{
 it('verifies before creating a pool, pins all operations, then destroys the session and closes the pool',async()=>{
  const f=fixture();const result=await withFreshPhoneFixtureSession(f.options,async(db:any,counts:any)=>{
   expect(counts()).toEqual({totalCount:1,idleCount:0,waitingCount:0});
   await db.query({synthetic:'ack'});await db.query({synthetic:'context'});await db.exec({synthetic:'migration'});return 'complete';
  });
  expect(result).toBe('complete');expect(f.events).toEqual(['verify','create','connect','operation','operation','operation','client-end','release','close']);
  expect(f.pool.connect).toHaveBeenCalledTimes(1);expect(f.client.release).toHaveBeenCalledWith(true);
 });
 it('opens nothing if isolation verification fails',async()=>{
  const f=fixture();f.options.verify.mockImplementation(()=>{throw Error('synthetic isolation refusal');});
  const work=vi.fn();await expect(withFreshPhoneFixtureSession(f.options,work)).rejects.toThrow('synthetic isolation refusal');
  expect(f.options.createPool).not.toHaveBeenCalled();expect(work).not.toHaveBeenCalled();
 });
 it('closes the pool if connection acquisition fails and never retries',async()=>{
  const f=fixture();f.pool.connect.mockRejectedValue(Error('synthetic connection failure'));const work=vi.fn();
  await expect(withFreshPhoneFixtureSession(f.options,work)).rejects.toThrow('synthetic connection failure');
  expect(f.pool.connect).toHaveBeenCalledTimes(1);expect(f.pool.end).toHaveBeenCalledTimes(1);expect(work).not.toHaveBeenCalled();
 });
 it('propagates operation errors without replay and releases/closes in finally',async()=>{
  const f=fixture();f.client.query.mockRejectedValue(Error('synthetic operation failure'));
  await expect(withFreshPhoneFixtureSession(f.options,(db:any)=>db.exec({synthetic:true}))).rejects.toThrow('synthetic operation failure');
  expect(f.client.query).toHaveBeenCalledTimes(1);expect(f.client.release).toHaveBeenCalledTimes(1);expect(f.pool.end).toHaveBeenCalledTimes(1);
 });
 it('surfaces a connection error between operations instead of ignoring it or issuing another operation',async()=>{
  const f=fixture();
  await expect(withFreshPhoneFixtureSession(f.options,async(db:any)=>{
   await db.query({synthetic:true});f.client.emit('error',Error('Connection terminated unexpectedly'));
   await db.query({synthetic:true});
  })).rejects.toThrow('Connection terminated unexpectedly');expect(f.client.query).toHaveBeenCalledTimes(1);
 });
 it('also surfaces a late connection error when the work returns without another query',async()=>{
  const f=fixture();await expect(withFreshPhoneFixtureSession(f.options,async()=>{
   f.client.emit('error',Error('Connection terminated unexpectedly'));return 'unverified';
  })).rejects.toThrow('Connection terminated unexpectedly');expect(f.pool.end).toHaveBeenCalledTimes(1);
 });
 it('finishes the previous session before another isolation check and fresh pool creation',async()=>{
  const f=fixture();await withFreshPhoneFixtureSession(f.options,async()=>{});
  await withFreshPhoneFixtureSession(f.options,async()=>{});
  expect(f.events).toEqual(['verify','create','connect','client-end','release','close','verify','create','connect','client-end','release','close']);
 });
 it('does not return unbounded or arbitrary pool metadata',async()=>{
  const f=fixture();f.pool.totalCount='synthetic-secret';f.pool.idleCount=-1;f.pool.waitingCount=1000000;
  await withFreshPhoneFixtureSession(f.options,async(_:any,counts:any)=>expect(counts()).toEqual({totalCount:null,idleCount:null,waitingCount:null}));
 });
 it('attempts pool shutdown even if client release fails',async()=>{
  const f=fixture();f.client.release.mockImplementation(()=>{throw Error('synthetic release failure');});
  await expect(withFreshPhoneFixtureSession(f.options,async()=>{})).rejects.toThrow('synthetic release failure');
  expect(f.pool.end).toHaveBeenCalledTimes(1);
 });
 it('does not report success when pool shutdown fails',async()=>{
  const f=fixture();f.pool.end.mockRejectedValue(Error('synthetic shutdown failure'));
  await expect(withFreshPhoneFixtureSession(f.options,async()=>{})).rejects.toThrow('synthetic shutdown failure');
 });
 it('awaits actual client shutdown before release and pool closure can report completion',async()=>{
  const f=fixture();let finish!:()=>void;const closing=new Promise<void>(resolve=>{finish=resolve;});
  f.client.end.mockImplementation(()=>closing);
  const run=withFreshPhoneFixtureSession(f.options,async()=>{});
  await vi.waitFor(()=>expect(f.client.end).toHaveBeenCalledTimes(1));
  expect(f.client.release).not.toHaveBeenCalled();expect(f.pool.end).not.toHaveBeenCalled();
  finish();await run;expect(f.client.release).toHaveBeenCalledTimes(1);expect(f.pool.end).toHaveBeenCalledTimes(1);
 });
 it('still releases and closes the pool if explicit client shutdown fails',async()=>{
  const f=fixture();f.client.end.mockRejectedValue(Error('synthetic client shutdown failure'));
  await expect(withFreshPhoneFixtureSession(f.options,async()=>{})).rejects.toThrow('synthetic client shutdown failure');
  expect(f.client.release).toHaveBeenCalledTimes(1);expect(f.pool.end).toHaveBeenCalledTimes(1);
 });
});
