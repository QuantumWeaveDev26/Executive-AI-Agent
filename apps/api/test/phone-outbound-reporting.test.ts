import {it,expect} from 'vitest';
import {projectOutboundCallReport} from '../src/services/phone-outbound-reporting.js';
it('prepares equivalent outbound reporting without changing the ledger or inferring media/duration',()=>{
 const call={id:'synthetic-call',providerCallId:'20261103/synthetic',draft:{recipient:{maskedPhone:'•••• 0001',displayName:'Ram'}},createdAt:'2026-11-03T12:00:00Z',state:'failed',report:{text:'Provider reported failure'},simulated:false};
 const before=JSON.stringify(call),r=projectOutboundCallReport(call as never);
 expect(r.callStatus).toBe('failed');expect(r.providerVerified).toBe(false);expect(r.durationSeconds).toBeNull();expect(r.recordingReference).toBeNull();expect(JSON.stringify(call)).toBe(before);
});
it('keeps simulations labelled as simulations',()=>{
 const r=projectOutboundCallReport({id:'test',providerCallId:null,draft:{recipient:{maskedPhone:'•••• 0001',displayName:'Ram'}},createdAt:'2026-11-03T12:00:00Z',state:'completed',report:{text:'Synthetic only'},simulated:true} as never);
 expect(r.simulated).toBe(true);expect(r.providerInteractionId).toBeNull();expect(r.providerVerified).toBe(false);
});
