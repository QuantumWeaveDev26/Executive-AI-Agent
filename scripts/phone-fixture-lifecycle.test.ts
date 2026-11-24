// Database-free investigation. Real installed pg-pool; synthetic clients, no SQL or network.
import {afterEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import net from 'node:net';
import {createBinaryRelay} from './step1084-loopback-proxy.mjs';
import {withFreshPhoneFixtureSession} from './phone-fixture-session.mjs';
const requireDb=createRequire(new URL('../packages/db/package.json',import.meta.url));
const {Pool,Client}=requireDb('pg');
const PROBE=Object.freeze({syntheticOnly:true});
const pools:any[]=[];
const block=(ms:number)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);

// Narrow output whitelist: raw messages/objects never go into investigation evidence.
const category=(error:any)=>error?.message==='Connection terminated unexpectedly'?'connection_terminated_unexpectedly':
 error?.message==='Query read timeout'?'query_read_timeout':'unclassified_client_error';

function fixture({idle=40,relay=120,probe=5}:{idle?:number;relay?:number;probe?:number}={}){
 const clients:any[]=[];
 class SyntheticClient extends EventEmitter {
  _queryable=true;_ending=false;connection:any;id:number;relayTimer:any;probeTimer:any;queries=0;
  constructor(){super();this.id=clients.length+1;clients.push(this);this.connection={stream:{destroy:()=>this.end()}};}
  armRelay(){clearTimeout(this.relayTimer);this.relayTimer=setTimeout(()=>{this._queryable=false;this.emit('error',new Error('Connection terminated unexpectedly'));},relay);}
  connect(done:Function){process.nextTick(()=>{this.armRelay();done(null);});}
  query(value:unknown,values:unknown,done:Function){
   if(typeof done!=='function')return new Promise((resolve,reject)=>this.query(value,undefined,(error:any,result:any)=>error?reject(error):resolve(result)));
   if(value!==PROBE)throw Error('Only opaque synthetic probes allowed; SQL is forbidden');
   this.queries++;
   this.probeTimer=setTimeout(()=>{this.armRelay();done(null,{rows:[{clientId:this.id}]});},probe);
  }
  end(done?:Function){this._ending=true;clearTimeout(this.relayTimer);clearTimeout(this.probeTimer);if(done)process.nextTick(done);}
  ref(){} unref(){}
 }
 const pool=new Pool({Client:SyntheticClient,max:1,idleTimeoutMillis:idle,connectionTimeoutMillis:5000});pools.push(pool);
 pool.on('error',()=>{});return {pool,clients};
}

afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();for(const p of pools.splice(0))if(!p.ending)await p.end();});

describe('phone fixture connection lifecycle — no database, SQL, Docker or sockets',()=>{
 it('the installed pool defaults to a 10-second idle limit without starting a connection',()=>{
  const pool=new Pool({max:1});pools.push(pool);expect(pool.options.idleTimeoutMillis).toBe(10000);
  expect(pool.totalCount).toBe(0);
 });
 it('normal idle expiry removes the old client and reconnects before the relay deadline',async()=>{
  const {pool,clients}=fixture();expect((await pool.query(PROBE)).rows[0].clientId).toBe(1);
  await delay(80);expect(pool.totalCount).toBe(0);expect(clients[0]._ending).toBe(true);
  expect((await pool.query(PROBE)).rows[0].clientId).toBe(2);
 });

 it('blocking inspection postpones idle eviction; checkout cancels the overdue idle timer and reuses a stale client',async()=>{
  const {pool,clients}=fixture();await pool.query(PROBE);
  // Represents execFileSync inspection. No timer/socket callbacks can run while blocked.
  block(200);expect(pool.idleCount).toBe(1);expect(clients[0]._queryable).toBe(true);
  const result=await pool.query(PROBE).then(()=>({category:'unexpected_success',sqlstate:null}), (e:any)=>({category:category(e),sqlstate:e.code??null}));
  expect(result).toEqual({category:'connection_terminated_unexpectedly',sqlstate:null});
  expect(clients).toHaveLength(1);expect(clients[0].queries).toBe(2);expect(pool.totalCount).toBe(0);
  // Failure was surfaced, never retried. A distinct, explicitly requested operation reconnects.
  expect((await pool.query(PROBE)).rows[0].clientId).toBe(2);
 });

 it('a short synchronous inspection below both deadlines keeps the connection usable',async()=>{
  const {pool,clients}=fixture({idle:100,relay:300});await pool.query(PROBE);block(10);
  expect((await pool.query(PROBE)).rows[0].clientId).toBe(1);expect(clients).toHaveLength(1);
 });

 it('closing the pool before blocking inspection and opening a new one afterwards avoids stale checkout',async()=>{
  const old=fixture();await old.pool.query(PROBE);await old.pool.end();
  block(200);expect(old.clients[0]._ending).toBe(true);
  const fresh=fixture();expect((await fresh.pool.query(PROBE)).rows[0].clientId).toBe(1);
  expect(fresh.pool.options.idleTimeoutMillis).toBe(old.pool.options.idleTimeoutMillis);
  expect(fresh.pool.options.connectionTimeoutMillis).toBe(5000);
 });

 it('the corrected helper survives blocking verification across phases with the actual pool and synthetic clients',async()=>{
  const created:any[]=[];
  const options={verify:()=>{expect(created.every(f=>f.pool.ended)).toBe(true);block(200);},
   createPool:()=>{const f=fixture();created.push(f);return f.pool;}};
  for(let phase=0;phase<2;phase++)await withFreshPhoneFixtureSession(options,async(db:any)=>{
   await db.query(PROBE);await db.exec(PROBE);expect(created.at(-1).clients).toHaveLength(1);
  });
  expect(created).toHaveLength(2);expect(created.every(f=>f.pool.ended)).toBe(true);
 });

 it('holding one checked-out client preserves synthetic session identity across an otherwise overdue pool idle timeout',async()=>{
  const {pool}=fixture({idle:30,relay:500});const c=await pool.connect();
  await delay(70);expect(pool.idleCount).toBe(0);expect(pool.totalCount).toBe(1);
  expect(c._ending).toBe(false);c.release();
 });

 it('an active connection still fails at the relay deadline; pinning alone does not repair blocking inspection',async()=>{
  const {pool}=fixture();const c=await pool.connect();let observed='none';
  c.on('error',(e:any)=>{observed=category(e);});block(200);await delay(1);
  expect(observed).toBe('connection_terminated_unexpectedly');c.release(new Error('synthetic transport failed'));
 });

 it('the actual driver read-timeout error also has no SQLSTATE, so historical null cannot identify one exact cause',async()=>{
  vi.useFakeTimers();
  const connection=new EventEmitter();
  const client=new Client({host:'synthetic.invalid',port:1,user:'synthetic',database:'synthetic',password:'synthetic-only',ssl:false,connection,query_timeout:45000});
  const callback=vi.fn(),submit=vi.fn(),handleError=vi.fn();
  // Custom operation is never submitted: no connect(), SQL text or protocol traffic.
  client.query({submit,handleError,callback});vi.advanceTimersByTime(45000);
  expect(submit).not.toHaveBeenCalled();expect(callback).toHaveBeenCalledTimes(1);
  expect(category(callback.mock.calls[0][0])).toBe('query_read_timeout');expect(callback.mock.calls[0][0].code).toBeUndefined();
  await new Promise<void>(resolve=>process.nextTick(resolve));expect(handleError).toHaveBeenCalledTimes(1);
 });
});

describe('existing relay idle timeout — mocked sockets and child, unchanged production helper',()=>{
 function relayHarness(){
  vi.useFakeTimers();
  let accept:any;const server={maxConnections:0};
  vi.spyOn(net,'createServer').mockImplementation(((fn:any)=>{accept=fn;return server;}) as any);
  const socket:any=new EventEmitter();socket.destroy=vi.fn();socket.pipe=vi.fn();
  socket.setTimeout=vi.fn((ms:number,fn:()=>void)=>{setTimeout(fn,ms);});
  const child:any=new EventEmitter();child.stdin=new EventEmitter();child.stdout=new EventEmitter();
  child.stdout.pipe=vi.fn();child.stderr={resume:vi.fn()};child.kill=vi.fn();
  const open=vi.fn(()=>child);createBinaryRelay(open);accept(socket);return {socket,child,open,server};
 }
 it('retains the exact 30-second idle limit and destroys the socket only when it expires',()=>{
  vi.useFakeTimers();const {socket,open,server}=relayHarness();
  expect(socket.setTimeout).toHaveBeenCalledWith(30000,expect.any(Function));
  vi.advanceTimersByTime(29999);expect(socket.destroy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);expect(socket.destroy).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);expect(server.maxConnections).toBe(32);
 });
 it('socket closure kills its tunnel child; child exit closes the socket, with no reconnect',()=>{
  const {socket,child,open}=relayHarness();socket.emit('close');expect(child.kill).toHaveBeenCalledTimes(1);
  child.emit('exit',0);expect(socket.destroy).toHaveBeenCalledTimes(1);expect(open).toHaveBeenCalledTimes(1);
 });
 it('tunnel errors close the connection without exposing raw diagnostic content',()=>{
  const {socket,child}=relayHarness();child.emit('error',new Error('synthetic-secret-do-not-log'));
  expect(socket.destroy).toHaveBeenCalledTimes(1);expect(category({message:'synthetic-secret-do-not-log'})).toBe('unclassified_client_error');
 });
});
