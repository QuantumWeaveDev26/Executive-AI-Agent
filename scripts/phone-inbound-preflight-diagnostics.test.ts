import {it,expect} from 'vitest';
import {preflightCheck,rejectPreflight,readPreflightDiagnostic} from './phone-inbound-preflight-diagnostics.mjs';
it('preserves a successful operation without retry',async()=>{let calls=0;expect(await preflightCheck('image_metadata',()=>{calls++;return 12;})).toBe(12);expect(calls).toBe(1);});
for(const [code,kind] of [['ETIMEDOUT','command_timeout'],['ENOENT','command_unavailable'],['EACCES','permission_denied'],['EADDRINUSE','port_in_use'],['OTHER','operation_failed']]){
 it(`sanitizes ${code} without retaining raw output`,async()=>{
  let calls=0;const e=await preflightCheck('port_probe',()=>{calls++;throw Object.assign(Error('PRIVATE'),{code,stdout:'SECRET',stderr:'SECRET'});}).catch(e=>e);
  expect(calls).toBe(1);expect(readPreflightDiagnostic(e)).toEqual({check:'port_probe',kind});expect(JSON.stringify(e)).not.toContain('SECRET');expect(e.message).not.toContain('PRIVATE');
 });
}
it('distinguishes malformed JSON and failed validation',async()=>{
 const a=await preflightCheck('context_metadata',()=>JSON.parse('invalid')).catch(e=>e);
 const b=await preflightCheck('context_metadata',()=>rejectPreflight()).catch(e=>e);
 expect(readPreflightDiagnostic(a)?.kind).toBe('invalid_json');expect(readPreflightDiagnostic(b)?.kind).toBe('validation_failed');
});
it('rejects unknown checks before work and ignores arbitrary or throwing diagnostic data',async()=>{
 let touched=false;await expect(preflightCheck('PRIVATE',()=>{touched=true;})).rejects.toThrow();expect(touched).toBe(false);
 expect(readPreflightDiagnostic({preflightCheck:'PRIVATE',preflightKind:'operation_failed'})).toBeNull();
 expect(readPreflightDiagnostic(Object.defineProperty({},'preflightCheck',{get(){throw Error('PRIVATE');}}))).toBeNull();
});
