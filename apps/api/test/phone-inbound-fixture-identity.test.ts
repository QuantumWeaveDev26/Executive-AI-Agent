import {it,expect,vi} from 'vitest';
import {captureInboundFixtureAdmin} from './helpers/phone-inbound-fixture-identity.js';
function fixture(options:{superuser?:boolean;restoreFails?:boolean;metadataFails?:boolean;name?:string}={}){
 const initial=options.name??'synthetic_admin',events:any[]=[],commands:string[]=[];
 let runtime=false;
 const query=vi.fn(async()=>{
  if(options.metadataFails)throw Object.assign(Error('PRIVATE metadata'),{code:'42501'});
  return {rows:[{current_identity:runtime?'synthetic_runtime':initial,session_identity:runtime?'synthetic_runtime':initial,is_superuser:options.superuser??!runtime,can_read_audit:!runtime}]};
 });
 const exec=vi.fn(async(sql:string)=>{commands.push(sql);if(sql==='RESET ROLE')return;
  if(options.restoreFails)throw Object.assign(Error('PRIVATE credential detail'),{code:'42501'});runtime=false;
 });
 return {db:{query,exec},events,commands,setRuntime:()=>{runtime=true;},query};
}
it('captures the fixture administrator and explicitly restores then verifies it before privileged work',async()=>{
 const f=fixture(),admin=await captureInboundFixtureAdmin(f.db as never,d=>f.events.push(d));f.setRuntime();await admin.restore();
 expect(f.commands).toEqual(['SET SESSION AUTHORIZATION "synthetic_admin"','RESET ROLE']);expect(f.events.map(d=>d.verified)).toEqual([true,true]);expect(JSON.stringify(f.events)).not.toContain('synthetic_admin');
});
it('rejects a non-administrator at capture instead of granting it extra privileges',async()=>{
 const f=fixture({superuser:false});await expect(captureInboundFixtureAdmin(f.db as never,d=>f.events.push(d))).rejects.toThrow('PHONE113_FIXTURE_ADMIN_UNVERIFIED');expect(f.commands).toHaveLength(0);
});
it('fails closed when restoration errors and retains only a sanitized finite diagnostic',async()=>{
 const f=fixture({restoreFails:true}),admin=await captureInboundFixtureAdmin(f.db as never,d=>f.events.push(d));f.setRuntime();await expect(admin.restore()).rejects.toThrow('PHONE113_FIXTURE_ADMIN_UNVERIFIED');
 expect(f.events.at(-1)?.sqlState).toBe('42501');expect(JSON.stringify(f.events)).not.toContain('PRIVATE');
});
it('does not accept a stale runtime identity even if reset commands report success',async()=>{
 const f=fixture(),admin=await captureInboundFixtureAdmin({...f.db,exec:async()=>{}} as never,d=>f.events.push(d));f.setRuntime();
 await expect(admin.restore()).rejects.toThrow('PHONE113_FIXTURE_ADMIN_UNVERIFIED');expect(f.events.at(-1)?.verified).toBe(false);
});
it('quotes the captured identifier correctly and never accepts names from a caller',async()=>{
 const f=fixture({name:'fixture"administrator'}),admin=await captureInboundFixtureAdmin(f.db as never);await admin.restore();expect(f.commands[0]).toBe('SET SESSION AUTHORIZATION "fixture""administrator"');
});
it('contains observer failures without changing the restoration result',async()=>{
 const f=fixture(),admin=await captureInboundFixtureAdmin(f.db as never,()=>{throw Error('PRIVATE observer');});await expect(admin.restore()).resolves.toBeUndefined();
});
