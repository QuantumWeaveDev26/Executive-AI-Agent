import {it,expect} from 'vitest';
import {makeInboundDiagnostic} from '../src/services/phone-inbound-diagnostics.js';
it('retains only allowlisted SQLSTATE and category, never raw error details',()=>{
 const error={code:'42501',message:'PRIVATE secret',detail:'PRIVATE customer',query:'PRIVATE SQL',where:'PRIVATE function',token:'PRIVATE credential'};
 const d=makeInboundDiagnostic('grant_initial',error);expect(d).toEqual({phase:'grant_initial',category:'permission',sqlState:'42501',check:null});expect(JSON.stringify(d)).not.toContain('PRIVATE');expect(Object.isFrozen(d)).toBe(true);
});
it('classifies known schema, constraint, timeout, connection and transaction states',()=>{
 for(const [code,category] of [['42809','schema'],['42883','schema'],['23514','constraint'],['22P02','invalid_data'],['57014','timeout'],['55P03','timeout'],['08006','connection'],['25P02','transaction']]){
  expect(makeInboundDiagnostic('policy_and_work',{code}).category).toBe(category);
 }
});
it('drops unknown codes, unknown phases and untrusted check strings',()=>{
 expect(makeInboundDiagnostic('PRIVATE' as never,{code:'SECRET'},'PRIVATE' as never)).toEqual({phase:'unknown',category:'unknown',sqlState:null,check:null});
 expect(makeInboundDiagnostic('begin',{code:'__proto__'}).sqlState).toBeNull();
 expect(makeInboundDiagnostic('begin',null).category).toBe('unknown');
});
it('identifies a finite local validation check without including actual values',()=>{
 expect(makeInboundDiagnostic('role_validation',Error('PRIVATE actual role'),'session_identity')).toEqual({phase:'role_validation',category:'local_validation',sqlState:null,check:'session_identity'});
});
it('does not execute arbitrary error property accessors',()=>{
 const error=Object.defineProperty({},'code',{get(){throw Error('PRIVATE getter');}});expect(makeInboundDiagnostic('connect',error).sqlState).toBeNull();
});
