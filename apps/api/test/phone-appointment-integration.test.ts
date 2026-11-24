import {afterEach,it,expect,vi} from 'vitest';
import {createPhoneAppointmentIntegration} from '../src/services/phone-appointment-integration.js';
const profile={routeId:'route',workspaceId:'workspace',ownerUserId:'owner',principalId:'principal',revision:1,appId:'agent',appVersion:14,deploymentId:'inbound',agentPhoneNumber:'+918000000001',maxCallLengthSeconds:300 as const};
afterEach(()=>vi.unstubAllEnvs());
it('refuses production before using any ports',()=>{
 vi.stubEnv('NODE_ENV','production');expect(()=>createPhoneAppointmentIntegration({} as any)).toThrow('test-only');
});
it('requires a durable call ledger',()=>{
 expect(()=>createPhoneAppointmentIntegration({calls:{durable:false}} as any)).toThrow('durable');
});
it('assembles the existing services without querying storage, borrowing an owner login or calling Calendar',()=>{
 const query=vi.fn(),withAuthenticatedScope=vi.fn(),withScopedTransaction=vi.fn(),withGrant=vi.fn();
 const calendar={writeReadiness:vi.fn(),findConflicts:vi.fn(),listEvents:vi.fn(),readEvent:vi.fn()};
 const options=createPhoneAppointmentIntegration({db:{query,withAuthenticatedScope,withScopedTransaction},calendar:calendar as any,calls:{durable:true,load:vi.fn()},inbound:{profile,interactionId:'20261106/appointment',transactions:{withGrant}}});
 expect(options.phoneAppointments).toHaveProperty('inbound.request');expect(options.phoneAppointments).toHaveProperty('inboundOwner.status');expect(options.phoneAppointments).toHaveProperty('outbound.status');expect(options.phoneInboundJournal).toHaveProperty('detail');
 for(const mock of [query,withAuthenticatedScope,withScopedTransaction,withGrant,...Object.values(calendar)])expect(mock).not.toHaveBeenCalled();
});
