// Explicit release-evidence check: imports the isolated local candidate, not a live service.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {PhoneHistoryPage} from '../../../node_modules/.cache/phone-web-current-baseline-20261107/apps/web/src/PhonePages';
const owner={role:'owner',userId:'owner',workspaceId:'workspace'};
// Root Vitest uses classic JSX for imported cache fixtures; production Vite uses automatic JSX.
beforeEach(()=>vi.stubGlobal('React',React));
afterEach(()=>vi.unstubAllGlobals());
const call:any={id:'11111111-1111-4111-8111-111111111111',approvalId:'22222222-2222-4222-8222-222222222222',
 draft:{recipient:{displayName:'Ram',maskedPhone:'+91 ******0002'},purpose:'Website status',language:'en-IN',mode:'live',maxDurationSeconds:300},
 createdAt:'2026-11-01T09:00:00Z',state:'completed',simulated:false,providerCallId:'synthetic-provider-attempt',
 report:{text:'Provider result unverified.',spokenText:'Provider result unverified.',quotedResponses:[],evidenceIds:[],verified:false,simulated:false}};
const render=(record:any,identity:any=owner)=>renderToStaticMarkup(<PhoneHistoryPage ownerIdentity={identity} initialState={{calls:[record],openId:record.id}}/>);
it('renders existing Calendar review for the owner without claiming an appointment exists',()=>{
 const html=render(call);
 expect(html).toContain('aria-label="Appointment review"');expect(html).toContain('Appointment not confirmed.');
 expect(html).not.toContain('Appointment confirmed.');expect(html).toContain('Prepare Calendar review');
});
it('does not offer review for members, missing identity, simulations or unfinished calls',()=>{
 for(const html of [render(call,{...owner,role:'member'}),render(call,null),render({...call,simulated:true}),render({...call,state:'prepared'}),render({...call,providerCallId:null})])
  expect(html).not.toContain('aria-label="Appointment review"');
});
