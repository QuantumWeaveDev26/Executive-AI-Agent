
import { N8nCreateOnlyTransport,N8nDevelopmentWorkflow,isSafeN8nDevWorkflow } from '@thaara/policy';

export interface N8nHttpOptions {
 workspaceId:string;baseUrl:string;resolveApiKey:()=>Promise<string>;fetch?:typeof fetch;
}
// No update/delete/execute/publish/credential-management methods exist on this transport.
export class N8nHttpTransport implements N8nCreateOnlyTransport {
 readonly mode='live' as const;
 readonly workspaceId:string;
 private readonly origin:string;
 private readonly requestFetch:typeof fetch;
 constructor(private options:N8nHttpOptions) {
  const url=new URL(options.baseUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
   !['','/'].includes(url.pathname)||(url.port&&url.port!=='443')||
   !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)||url.hostname.endsWith('.localhost')||!options.workspaceId)
   throw new Error('Invalid n8n server origin.');
  this.origin=url.origin;this.workspaceId=options.workspaceId;this.requestFetch=options.fetch??fetch;
 }
 private async request(method:'GET'|'POST',path:string,body?:unknown):Promise<Record<string,unknown>> {
  try {
   const secret=await this.options.resolveApiKey();
   if(!secret||/[\r\n]/.test(secret))throw Error();
   const response=await this.requestFetch(this.origin+'/api/v1'+path,{
    method,redirect:'error',signal:AbortSignal.timeout(3000),
    headers:{'X-N8N-API-KEY':secret,'Content-Type':'application/json','Accept':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
   });
   if(!response.ok||!response.body)throw Error();
   const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   try {
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;
     if(size>1024*1024){await reader.cancel();throw Error();}chunks.push(part.value);}
   }finally{reader.releaseLock();}
   const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed;
  }catch{throw new Error('n8n request failed.');}
 }
 private id(value:string) {if(!/^[a-zA-Z0-9_-]{1,128}$/.test(value))throw Error('Invalid n8n workflow ID.');return value;}
 async listByName(name:string):Promise<Array<{id:string;name:string}>> {
  if(!/^THAARA_V2_DEV_[A-Z0-9_]+$/i.test(name)||name.length>120)throw Error('Invalid development workflow name.');
  const matches:Array<{id:string;name:string}>=[];let cursor:string|undefined;
  for(let page=0;page<5;page++) {
   const query=new URLSearchParams({limit:'200',name});if(cursor)query.set('cursor',cursor);
   const response=await this.request('GET','/workflows?'+query);
   if(!Array.isArray(response.data)||response.data.length>200)throw Error('n8n request failed.');
   for(const row of response.data) {
    if(!row||typeof row.id!=='string'||typeof row.name!=='string')throw Error('n8n request failed.');
    if(row.name===name)matches.push({id:this.id(row.id),name:row.name});
   }
   if(!response.nextCursor)return matches;
   if(typeof response.nextCursor!=='string'||response.nextCursor.length>4096)throw Error('n8n request failed.');
   cursor=response.nextCursor;
  }
  throw Error('n8n inventory is incomplete; creation refused.');
 }
 async createInactive(workflow:N8nDevelopmentWorkflow):Promise<{id:string}> {
  if(!isSafeN8nDevWorkflow(workflow))throw Error('Unsafe n8n development workflow.');
  // The create endpoint always starts unpublished (n8n documented default).
  // active is a read-only API field; no activation endpoint is exposed.
  const body={name:workflow.name,nodes:workflow.nodes.map(({id,name,type,typeVersion,position,parameters})=>({
   id,name,type,typeVersion,position,parameters})),connections:workflow.connections,settings:{executionOrder:'v1'}};
  const response=await this.request('POST','/workflows',body);
  return {id:this.id(typeof response.id==='string'?response.id:'')};
 }
 async read(id:string):Promise<unknown> {return this.request('GET','/workflows/'+this.id(id));}
}
