import {useEffect,useRef,useState} from 'react';
import { ConnectorDiagnostic,getConnectorDiagnostics } from './connector-diagnostics-api';
import { UI_VISIBILITY } from './navigation';
const states={not_configured:'Not configured',disconnected:'Disconnected',connected_mock:'Connected (mock)',configured_unverified:'Configured, unverified',reconnect_required:'Reconnect required',unavailable:'Unavailable'};
const stores={unavailable:'Unavailable',ephemeral_encrypted_mock:'Encrypted temporary mock storage',postgres_durable:'PostgreSQL (isolated test)'};
const availability={not_configured:'Not configured',not_checked:'Not checked',readable:'Readable',unavailable:'Unavailable'};
const results={not_configured:'Not configured',local_metadata_read:'Local metadata read',local_metadata_unavailable:'Local metadata unavailable'};
function checkedAt(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'Unavailable':date.toLocaleString();}
interface Props {role:string;items:ConnectorDiagnostic[];loading:boolean;error:boolean;onRefresh:()=>void;hideN8n?:boolean;}
export function ConnectorDiagnosticsView(p:Props){
 if(!['owner','admin'].includes(p.role))return null;
 const visibleItems=p.hideN8n?p.items.filter(item=>item.connectorName!=='n8n'):p.items;
 return <section className="card" aria-labelledby="connector-diagnostics-title" aria-busy={p.loading}>
  <div className="automation-toolbar"><h2 id="connector-diagnostics-title">Connector diagnostics</h2>
   <button type="button" className="btn btn-secondary" onClick={p.onRefresh} disabled={p.loading}>Refresh diagnostics</button></div>
  <p>{p.hideN8n?'Local status only. Provider health is not checked. Gmail shows your account.':'Local status only. Provider health is not checked. Gmail shows your account; n8n shows this workspace.'}</p>
  {p.loading&&<p role="status">Loading connector diagnostics…</p>}
  {p.error&&<p role="alert">Unable to load diagnostics. Refresh to retry.</p>}
  {!p.loading&&!p.error&&visibleItems.length===0&&<p>No connector diagnostics available.</p>}
  {!p.loading&&!p.error&&visibleItems.map(item=><article key={item.connectorName} aria-label={item.connectorName+' diagnostics'}>
   <h3>{item.connectorName==='gmail'?'Gmail (your account)':'n8n (workspace)'}</h3>
   <dl><dt>Connection</dt><dd><span className={'badge badge-'+(item.connectionState==='unavailable'?'danger':'warning')}>{states[item.connectionState]??'Unavailable'}</span></dd>
    <dt>Storage</dt><dd>{stores[item.storageKind]??'Unavailable'} · {availability[item.storageStatus]??'Unavailable'}</dd>
    <dt>KMS configuration</dt><dd>{item.kmsStatus==='mock_only'?'Mock KMS only; managed KMS not configured':'Managed KMS not configured'}</dd>
    <dt>Last safe diagnostic</dt><dd>{results[item.lastDiagnostic.code]??'Unavailable'} · {checkedAt(item.lastDiagnostic.checkedAt)}</dd>
   </dl>
  </article>)}
 </section>;
}
export function ConnectorDiagnostics({role,workspaceId}:{role:string;workspaceId:string}){
 const [items,setItems]=useState<ConnectorDiagnostic[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(false);
 const generation=useRef(0);
 async function refresh(){
  const version=++generation.current;setLoading(true);setError(false);setItems([]);
  try{const value=await getConnectorDiagnostics();if(version===generation.current)setItems(value.connectors);}
  catch{if(version===generation.current)setError(true);}
  finally{if(version===generation.current)setLoading(false);}
 }
 useEffect(()=>{
  generation.current++;setItems([]);setError(false);setLoading(false);
  if(['owner','admin'].includes(role))void refresh();
  return ()=>{generation.current++;};
 },[workspaceId,role]);
 return <ConnectorDiagnosticsView role={role} items={items} loading={loading} error={error} hideN8n={!UI_VISIBILITY.n8nSettingsConnection} onRefresh={()=>void refresh()}/>;
}
