import React, { useEffect, useId, useState } from 'react';
import { AutomationActivityEvent, AutomationActivityResponse, loadAutomationActivity, dashboardError } from './automation-api';

const PAGE_SIZE=20;
const eventLabels:Record<string,string> = {
  'plan.created':'Plan created','plan.submitted':'Plan submitted','plan.completed':'Plan completed',
  'plan.cancelled':'Plan cancelled','plan.failed':'Plan failed','step.created':'Step created',
  'step.queued':'Step queued','step.started':'Step started','step.completed':'Step completed',
  'step.retry_scheduled':'Execution retry scheduled','step.failed':'Step failed','step.unverified':'Step unverified','step.not_configured':'Step not configured',
  'step.status_observed':'Step state observed','approval.requested':'Approval requested',
  'approval.approved':'Approval approved','approval.rejected':'Approval rejected','approval.expired':'Approval expired',
  'approval.status_observed':'Approval state observed'
};
const sourceLabels:Record<string,string> = {
  audit:'Audit entry',plan_record:'Plan record',step_record:'Step record',
  approval_record:'Approval record',execution_record:'Execution record',receipt:'Receipt'
};
interface ActivityViewProps extends AutomationActivityResponse {
  regionId:string; open:boolean; loading:boolean; error:string|null; offset:number;
  onToggle():void; onRefresh():void; onPage(offset:number):void;
}
export function AutomationActivityView(props:ActivityViewProps):React.ReactElement {
  return <section className="automation-activity" aria-label="Automation activity">
    <button type="button" className="btn btn-secondary" aria-expanded={props.open} aria-controls={props.regionId}
      onClick={props.onToggle}>{props.open?'Hide Activity':'View Activity'}</button>
    {props.open && <div id={props.regionId} aria-live="polite" aria-busy={props.loading}>
      <div className="automation-toolbar">
        <h4>Activity timeline</h4>
        <button type="button" className="btn btn-secondary" disabled={props.loading} onClick={props.onRefresh}>Refresh activity</button>
      </div>
      <p className="automation-muted">Chronological activity, oldest first. {props.historyNotice}</p>
      {props.loading ? <p role="status">Loading activity…</p>
        : props.error ? <div className="error-banner" role="alert">{props.error}</div>
        : props.items.length===0 ? <p role="status">No recorded activity on this page.</p>
        : <ol className="automation-activity-list">{props.items.map((event:AutomationActivityEvent)=>{
          const variant=['verified','completed','approved'].includes(event.status)?'success':
            ['failed','unverified','rejected','execution_failed'].includes(event.status)?'danger':'warning';
          const date=new Date(event.timestamp);
          return <li key={event.id} className="automation-evidence">
            <div className="automation-toolbar"><strong>{eventLabels[event.event_type]??'Recorded activity'}</strong>
              <span className={`badge badge-${variant}`}>{event.status.replaceAll('_',' ')}</span></div>
            <time dateTime={event.timestamp}>{Number.isNaN(date.getTime())?'Timestamp unavailable':date.toLocaleString()}</time>
            <p className="automation-muted">{sourceLabels[event.source]??'Record'} · {event.event_type}</p>
            <p>{event.details}</p>
            {event.step_index!==null && <p>Step {event.step_index+1}{event.attempt_number!==null?` · Attempt ${event.attempt_number}`:''}</p>}
            {event.step_id && <p className="automation-id">Step: {event.step_id}</p>}
            {event.approval_id && <p className="automation-id">Approval: {event.approval_id}</p>}
            {event.receipt_id && <p className="automation-id">Receipt: {event.receipt_id}</p>}
          </li>;
        })}</ol>}
      <div className="automation-toolbar automation-pagination" aria-label="Activity pages">
        <button type="button" className="btn btn-secondary" disabled={props.loading||Boolean(props.error)||props.offset===0}
          onClick={()=>props.onPage(Math.max(0,props.offset-PAGE_SIZE))}>Previous activity</button>
        <span>Page {Math.floor(props.offset/PAGE_SIZE)+1}</span>
        <button type="button" className="btn btn-secondary" disabled={props.loading||Boolean(props.error)||props.nextOffset===null}
          onClick={()=>props.nextOffset!==null&&props.onPage(props.nextOffset)}>Next activity</button>
      </div>
    </div>}
  </section>;
}

export function AutomationActivity({planId}:{planId:string}) {
  const regionId=useId();
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState({offset:0,revision:0});
  const [data,setData]=useState<AutomationActivityResponse>({items:[],nextOffset:null,historyNotice:''});
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    setData({items:[],nextOffset:null,historyNotice:''});setError(null);setLoading(open);
    if(open) loadAutomationActivity(planId,query.offset,controller.signal).then(result=>{
      if(!controller.signal.aborted)setData(result);
    }).catch((err:unknown)=>{
      if(!controller.signal.aborted)setError(dashboardError(err));
    }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[planId,open,query]);
  return <AutomationActivityView {...data} regionId={regionId} open={open} loading={loading} error={error} offset={query.offset}
    onToggle={()=>{setData({items:[],nextOffset:null,historyNotice:''});setError(null);setLoading(!open);setOpen(!open);setQuery(q=>({...q,offset:0}));}}
    onRefresh={()=>{setData({items:[],nextOffset:null,historyNotice:''});setError(null);setLoading(true);setQuery(q=>({offset:0,revision:q.revision+1}));}}
    onPage={offset=>{setData({items:[],nextOffset:null,historyNotice:''});setError(null);setLoading(true);setQuery(q=>({...q,offset}));}}/>;
}
