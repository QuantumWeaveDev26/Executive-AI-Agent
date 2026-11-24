import React,{useEffect,useState} from 'react';
import { N8nConnectionDetails,getN8nConnection,configureN8nConnection,disconnectN8nConnection } from './n8n-api';
interface Props {
 role:string;details:N8nConnectionDetails|null;loading:boolean;error:string|null;selected:string;
 onSelect:(id:string)=>void;onRefresh:()=>void;onConfigure:()=>void;onDisconnect:()=>void;
}
export function N8nConnectionView(p:Props) {
 const allowed=['owner','admin'].includes(p.role);
 if(!allowed)return <section className="card" aria-label="n8n connection"><h2>n8n connection</h2><p>Workspace admin access required.</p></section>;
 return <section className="card" aria-label="n8n connection">
  <h2>n8n connection</h2>
  <p>Manage this workspace’s local connection. Live providers are not configured.</p>
  {p.loading&&<p role="status">Loading n8n connection…</p>}
  {p.error&&<p role="alert">{p.error}</p>}
  {p.details&&!p.loading&&<div>
   <p><strong>Status:</strong> <span className="badge badge-warning">{p.details.status}</span> · {p.details.mode}</p>
   {!p.details.managementEnabled&&<p>Secure server storage is not configured. An administrator must provision approved server profiles.</p>}
   {p.details.storage==='postgres_durable'&&<p>Encrypted isolated PostgreSQL test storage · revision {p.details.revision}. Mock KMS only. Live providers are not configured.</p>}
   {p.details.mode==='mock'&&p.details.storage!=='postgres_durable'&&<p>Encrypted temporary mock storage. No live connection has been verified.</p>}
   <label htmlFor="n8n-profile">Approved server profile</label>
   <select id="n8n-profile" value={p.selected} onChange={e=>p.onSelect(e.target.value)} disabled={!p.details.managementEnabled||p.loading}>
    <option value="">Select a profile</option>
    {p.details.profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.label}</option>)}
   </select>
   {p.details.profiles.length===0&&<p>No approved server profiles are available.</p>}
   <div className="action-row">
    <button type="button" className="btn btn-primary" onClick={p.onConfigure} disabled={p.loading||!p.details.managementEnabled||!p.details.profiles.some(v=>v.id===p.selected)}>Use server profile</button>
    <button type="button" className="btn btn-secondary" onClick={p.onDisconnect} disabled={p.loading||!p.details.managementEnabled||!p.details.configured}>Local disconnect</button>
   </div>
  </div>}
  <button type="button" className="btn btn-secondary" onClick={p.onRefresh} disabled={p.loading}>Refresh connection</button>
 </section>;
}
export function N8nConnection({role,workspaceId}:{role:string;workspaceId:string}) {
 const [details,setDetails]=useState<N8nConnectionDetails|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null),[selected,setSelected]=useState('');
 const generation=React.useRef(0);
 async function run(operation:()=>Promise<N8nConnectionDetails>) {
  const version=++generation.current;setLoading(true);setError(null);
  try {const value=await operation();if(version===generation.current){setDetails(value);setSelected(value.selectedProfileId??'');}}
  catch {if(version===generation.current){setDetails(null);setSelected('');setError('Unable to load or update n8n connection. Refresh to retry.');}}
  finally{if(version===generation.current)setLoading(false);}
 }
 useEffect(()=>{
  generation.current++;setDetails(null);setSelected('');setError(null);setLoading(false);
  if(['owner','admin'].includes(role))void run(getN8nConnection);
  return ()=>{generation.current++;};
 },[workspaceId,role]);
 return <N8nConnectionView role={role} details={details} loading={loading} error={error} selected={selected} onSelect={setSelected}
  onRefresh={()=>void run(getN8nConnection)} onConfigure={()=>void run(()=>configureN8nConnection(selected,details?.revision))} onDisconnect={()=>void run(()=>disconnectN8nConnection(details?.revision))}/>;
}
