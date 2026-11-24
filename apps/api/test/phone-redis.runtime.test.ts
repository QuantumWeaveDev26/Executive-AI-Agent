import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {connectRedisNonceStore} from '../src/services/phone-redis.js';

// Local development Redis only (default redis://localhost:6379 or THAARA_TEST_REDIS_URL). Random nonces, 2 s expiry.
const url=process.env.THAARA_TEST_REDIS_URL??'redis://localhost:6379';
let available=true;
try{const probe=await connectRedisNonceStore(url,{connectTimeoutMs:1500});await probe.close();}catch{available=false;}

describe.skipIf(!available)('Redis nonce store against a real local Redis (@redis/client 6.3.0)',()=>{
 it('accepts a nonce once across two independent connections and expires it',async()=>{
  const a=await connectRedisNonceStore(url),b=await connectRedisNonceStore(url);
  try{
   const nonce='runtime-'+randomUUID();
   const [first,second]=await Promise.all([a.store.remember(nonce,2000),b.store.remember(nonce,2000)]);
   expect([first,second].filter(Boolean)).toHaveLength(1);
   expect(await a.store.remember(nonce,2000)).toBe(false);
   await new Promise(r=>setTimeout(r,2300));
   expect(await b.store.remember(nonce,2000)).toBe(true);
  }finally{await a.close();await b.close();}
 },15000);
 it('rejects non-Redis URLs before connecting',async()=>{
  await expect(connectRedisNonceStore('https://example.com')).rejects.toThrow(/redis:/);
 });
});
