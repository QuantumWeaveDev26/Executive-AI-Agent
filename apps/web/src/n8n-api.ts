import { request } from './api';
export interface N8nConnectionDetails {
 connectorName:'n8n';status:'not_configured'|'disconnected'|'configured_unverified';configured:boolean;
 mode:'disabled'|'mock';managementEnabled:boolean;storage:'unavailable'|'ephemeral_encrypted_mock'|'postgres_durable';revision?:number;
 selectedProfileId:string|null;profiles:{id:string;label:string}[];liveProvidersStatus:'not_configured';
}
export const getN8nConnection=()=>request<N8nConnectionDetails>('/api/v1/connectors/n8n/connection');
export const configureN8nConnection=(profileId:string,revision?:number)=>request<N8nConnectionDetails>('/api/v1/connectors/n8n/connection',{method:'PUT',headers:revision===undefined?{}:{'If-Match':JSON.stringify(String(revision))},body:JSON.stringify({profileId})});
export const disconnectN8nConnection=(revision?:number)=>request<N8nConnectionDetails>('/api/v1/connectors/n8n/connection',{method:'DELETE',headers:revision===undefined?{}:{'If-Match':JSON.stringify(String(revision))},body:'{}'});
