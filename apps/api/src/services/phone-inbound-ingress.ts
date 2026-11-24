import {performance} from 'node:perf_hooks';

export interface InboundIngressOptions {
 maxRequests?:number;
 windowMs?:number;
 maxInFlight?:number;
 /** Trusted test clock only; production admission must use a monotonic server clock. */
 now?:()=>number;
}

/** Constant-size, process-local protection; not authentication or a distributed production rate limit. */
export function createInboundIngressLimiter(options:InboundIngressOptions={}) {
 const maxRequests=options.maxRequests===undefined?60:options.maxRequests,windowMs=options.windowMs===undefined?60000:options.windowMs,maxInFlight=options.maxInFlight===undefined?4:options.maxInFlight;
 const now=options.now===undefined?(()=>performance.now()):options.now;
 if(!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>120
  ||!Number.isSafeInteger(windowMs)||windowMs<1000||windowMs>60000
  ||!Number.isSafeInteger(maxInFlight)||maxInFlight<1||maxInFlight>8||typeof now!=='function') {
  throw new Error('Invalid inbound ingress limits.');
 }
 let windowStarted:number|undefined,lastTime:number|undefined,count=0,inFlight=0;
 return Object.freeze({
  retryAfterSeconds:Math.ceil(windowMs/1000),
  allowRequest():boolean {
   let time:number;
   try{time=now();}catch{return false;}
   if(!Number.isFinite(time)||time<0||lastTime!==undefined&&time<lastTime)return false;
   lastTime=time;
   if(windowStarted===undefined||time-windowStarted>=windowMs){windowStarted=time;count=0;}
   if(count>=maxRequests)return false;
   count++;return true;
  },
  acquire():(()=>void)|null {
   if(inFlight>=maxInFlight)return null;
   inFlight++;let released=false;
   return ()=>{if(!released){released=true;inFlight--;}};
  }
 });
}
