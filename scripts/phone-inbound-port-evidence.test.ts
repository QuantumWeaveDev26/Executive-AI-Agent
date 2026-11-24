import {expect,it} from 'vitest';
import {summarizePhoneFixturePorts} from './phone-inbound-port-evidence.mjs';
const requested={'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'15436'}]};
it('never confirms an empty actual mapping, despite the requested loopback binding',()=>{
 const r=summarizePhoneFixturePorts(requested,{'5432/tcp':[]});expect(r.status).toBe('unconfirmed');expect(r.requested.exactMatch).toBe(true);expect(r.actual).toEqual({shape:'postgres_empty',entries:'zero',exactMatch:false});
});
it('distinguishes absent/null/empty metadata without inventing publication or connectivity',()=>{
 expect(summarizePhoneFixturePorts(requested,null).actual.shape).toBe('null');expect(summarizePhoneFixturePorts(requested,{}).actual.shape).toBe('empty_object');expect(summarizePhoneFixturePorts(requested,{'5432/tcp':null}).actual.shape).toBe('postgres_null');
 for(const value of [null,{},undefined,{'5432/tcp':[]}])expect(summarizePhoneFixturePorts(requested,value).status).toBe('unconfirmed');
});
it('recognizes exact metadata without authorizing a connection or a fallback',()=>{
 const r=summarizePhoneFixturePorts(requested,requested);expect(r.status).toBe('matching_metadata');expect(r).not.toHaveProperty('authorized');expect(r).not.toHaveProperty('fallback');
});
it('rejects extra/wrong bindings without printing arbitrary addresses or metadata keys',()=>{
 for(const actual of [{'5432/tcp':[{HostIp:'PRIVATE-HOST',HostPort:'15436'}]},{'PRIVATE-KEY':[]},{'5432/tcp':[...requested['5432/tcp'],...requested['5432/tcp']]},[]]){
  const r=summarizePhoneFixturePorts(requested,actual);expect(r.status).toBe('unconfirmed');expect(JSON.stringify(r)).not.toContain('PRIVATE');
 }
});
it('supports the separately identified legacy port and refuses coercion or hostile getters',()=>{
 const old={'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'15435'}]};expect(summarizePhoneFixturePorts(old,old,15435).status).toBe('matching_metadata');expect(summarizePhoneFixturePorts(old,old).status).toBe('unconfirmed');
 const getter=Object.defineProperty({},'5432/tcp',{enumerable:true,get(){throw Error('PRIVATE');}});expect(summarizePhoneFixturePorts(requested,getter).actual.shape).toBe('unreadable');
 expect(()=>summarizePhoneFixturePorts(requested,requested,'15436' as never)).toThrow();
});
