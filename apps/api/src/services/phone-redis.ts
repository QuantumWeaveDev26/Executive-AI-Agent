import {createClient} from '@redis/client';
import {createRedisNonceStore,type NodeRedisLike,type PhoneCallbackNonceStore} from './phone-callback-admission.js';

/**
 * Connects the shared callback-nonce store to Redis (pinned @redis/client 6.3.0). The URL comes from configuration
 * (REDIS_URL, a managed TLS endpoint in production); it is never logged. Connection failures surface to the caller at
 * startup; later outages make the store fail closed (callbacks refused, provider retries).
 */
export async function connectRedisNonceStore(url:string,options:{connectTimeoutMs?:number}={}):Promise<{store:PhoneCallbackNonceStore;close():Promise<void>}>{
 const parsed=new URL(url);
 if(parsed.protocol!=='redis:'&&parsed.protocol!=='rediss:')throw new Error('Redis URL must use redis: or rediss:.');
 const client=createClient({url,socket:{connectTimeout:options.connectTimeoutMs??5000,reconnectStrategy:retries=>Math.min(retries*200,2000)}});
 // Without a listener, client errors would crash the process; the store already fails closed per call.
 client.on('error',()=>{});
 await client.connect();
 return {store:createRedisNonceStore({kind:'node-redis',client:client as unknown as NodeRedisLike}),close:async()=>{await client.close();}};
}
