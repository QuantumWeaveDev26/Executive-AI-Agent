import {expect,it} from 'vitest';
import {createInboundIngressLimiter} from '../src/services/phone-inbound-ingress.js';

it('shares a bounded window without storing client identifiers and resets only at the boundary',()=>{
 let time=0;const limiter=createInboundIngressLimiter({maxRequests:2,windowMs:1000,maxInFlight:1,now:()=>time});
 expect(limiter.allowRequest()).toBe(true);expect(limiter.allowRequest()).toBe(true);expect(limiter.allowRequest()).toBe(false);
 time=999;expect(limiter.allowRequest()).toBe(false);time=1000;expect(limiter.allowRequest()).toBe(true);
});
it('fails closed for backwards, invalid and throwing clocks without resetting the budget',()=>{
 let time=2000;const limiter=createInboundIngressLimiter({maxRequests:1,windowMs:1000,now:()=>time});
 expect(limiter.allowRequest()).toBe(true);time=1000;expect(limiter.allowRequest()).toBe(false);time=NaN;expect(limiter.allowRequest()).toBe(false);
 time=2500;expect(limiter.allowRequest()).toBe(false);time=3000;expect(limiter.allowRequest()).toBe(true);
 expect(createInboundIngressLimiter({now:()=>{throw Error('synthetic');}}).allowRequest()).toBe(false);
});
it('bounds in-flight work without queuing and uses idempotent release',()=>{
 const limiter=createInboundIngressLimiter({maxInFlight:1}),release=limiter.acquire();expect(release).not.toBeNull();expect(limiter.acquire()).toBeNull();
 release!();const second=limiter.acquire();expect(second).not.toBeNull();release!();expect(limiter.acquire()).toBeNull();second!();expect(limiter.acquire()).not.toBeNull();
});
it('rejects unsafe server settings and snapshots options',()=>{
 for(const options of [{maxRequests:0},{maxRequests:121},{windowMs:999},{windowMs:60001},{maxInFlight:0},{maxInFlight:9},{maxRequests:NaN},{maxRequests:null},{windowMs:null},{maxInFlight:null},{now:null}])expect(()=>createInboundIngressLimiter(options as never)).toThrow();
 const options={maxRequests:1};const limiter=createInboundIngressLimiter(options);options.maxRequests=100;
 expect(limiter.allowRequest()).toBe(true);expect(limiter.allowRequest()).toBe(false);
});
it('defaults to sixty requests per minute and four simultaneous workflow operations',()=>{
 const limiter=createInboundIngressLimiter({now:()=>0});for(let i=0;i<60;i++)expect(limiter.allowRequest()).toBe(true);expect(limiter.allowRequest()).toBe(false);expect(limiter.retryAfterSeconds).toBe(60);
 const releases=Array.from({length:4},()=>limiter.acquire());expect(releases.every(Boolean)).toBe(true);expect(limiter.acquire()).toBeNull();for(const release of releases)release!();expect(limiter.acquire()).not.toBeNull();
});
