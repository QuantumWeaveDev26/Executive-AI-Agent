import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutomationActivity, AutomationActivityView } from '../src/AutomationActivity';
import { loadAutomationActivity } from '../src/automation-api';

const event = {
  id:'receipt:a',timestamp:'2026-10-16T10:07:00.000Z',event_type:'step.completed',status:'verified',source:'receipt',
  step_id:'step-a',approval_id:null,receipt_id:'receipt-a',step_index:0,attempt_number:null,
  details:'Outcome from an immutable execution receipt. Raw proof is excluded.'
};
function render(overrides:Record<string,unknown>={}) {
  return renderToStaticMarkup(<AutomationActivityView {...({
    open:true,loading:false,error:null,items:[],nextOffset:null,offset:0,historyNotice:'Only retained records are shown.',
    onToggle:()=>{},onRefresh:()=>{},onPage:()=>{},...overrides
  } as any)}/>);
}
describe('Step 72 activity presentation',()=>{
  it('offers View Activity without loading or exposing records until opened',()=>{
    const html=renderToStaticMarkup(<AutomationActivity planId="plan-a"/>);
    expect(html).toContain('View Activity');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('No recorded activity');
  });
  it('shows loading instead of stale records or an empty state',()=>{
    const html=render({loading:true,items:[event]});
    expect(html).toContain('Loading activity');
    expect(html).not.toContain('receipt-a');
    expect(html).not.toContain('No recorded activity');
  });
  it('distinguishes an empty page from access or load errors',()=>{
    expect(render()).toContain('No recorded activity');
    const html=render({error:'Your session has expired. Sign in again.',items:[event]});
    expect(html).toContain('role="alert"');
    expect(html).toContain('Sign in again');
    expect(html).not.toContain('receipt-a');
    expect(html).not.toContain('No recorded activity');
  });
  it('shows timestamp, event type, status, evidence source and safe details',()=>{
    const html=render({items:[event]});
    expect(html).toContain('Step completed');
    expect(html).toMatch(/datetime="2026-10-16T10:07:00\.000Z"/i);
    expect(html).toContain('verified');
    expect(html).toContain('Receipt');
    expect(html).toContain('receipt-a');
    expect(html).toContain('Raw proof is excluded');
  });
  it('labels current-record observations without inventing historical events',()=>{
    const html=render({items:[{...event,event_type:'step.status_observed',status:'running',source:'step_record',details:'Latest recorded step state; this is not a historical transition.'}]});
    expect(html).toContain('Step state observed');
    expect(html).toContain('Step record');
    expect(html).toContain('not a historical transition');
  });
  it('renders rejected, failed, unverified and cancelled outcomes truthfully',()=>{
    const html=render({items:[
      {...event,id:'1',event_type:'approval.rejected',status:'rejected'},
      {...event,id:'2',event_type:'step.failed',status:'failed'},
      {...event,id:'3',event_type:'step.unverified',status:'unverified'},
      {...event,id:'4',event_type:'plan.cancelled',status:'cancelled'}
    ]});
    for(const label of ['Approval rejected','Step failed','Step unverified','Plan cancelled'])expect(html).toContain(label);
  });
  it('shows a scheduled retry and its attempt without claiming another execution',()=>{
    const html=render({items:[{...event,event_type:'step.retry_scheduled',status:'queued',attempt_number:2,source:'audit'}]});
    expect(html).toContain('Execution retry scheduled');
    expect(html).toContain('Attempt 2');
    expect(html).toContain('queued');
  });
  it('provides chronological pagination and disables unavailable pages',()=>{
    const html=render({items:[event],offset:20,nextOffset:40});
    expect(html).toContain('Previous activity');
    expect(html).toContain('Next activity');
    expect(html).toContain('Page 2');
    expect(render({loading:true})).toContain('disabled=""');
  });
  it('escapes displayed text and offers no execution or mutation controls',()=>{
    const html=render({items:[{...event,details:'<script>untrusted</script>'}]});
    expect(html).toContain('&lt;script&gt;untrusted&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('Approve</button>');
    expect(html).not.toContain('Deploy</button>');
  });
});
describe('Step 72 activity reads',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it('uses only the scoped read endpoint, server pagination and cancellable uncached GET',async()=>{
    const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({items:[event],nextOffset:null,historyNotice:'Retained records only.'})});
    vi.stubGlobal('fetch',fetch);
    const controller=new AbortController();
    const result=await loadAutomationActivity('plan/a',20,controller.signal);
    expect(result.items[0].status).toBe('verified');
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/automations/plan%2Fa/activity?limit=20&offset=20');
    expect(fetch.mock.calls[0][1]).toMatchObject({method:'GET',cache:'no-store',credentials:'include',signal:controller.signal});
  });
});
