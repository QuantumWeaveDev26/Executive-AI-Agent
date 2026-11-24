
import { describe,it,expect,vi } from 'vitest';
import { buildN8nDevWorkflow } from '@thaara/policy';
import { N8nHttpTransport } from '../src/services/n8n-http.js';
const workspaceId='11111111-1111-4111-8111-111111111111';
const workflow=buildN8nDevWorkflow({workspaceId,planId:'plan',stepId:'step',idempotencyKey:'key',parameters:{}},{workflowHash:'a'.repeat(64)});
function setup() {
 const request=vi.fn(),key=vi.fn(async()=> 'PRIVATE-API-KEY');
 const transport=new N8nHttpTransport({workspaceId,baseUrl:'https://thaara-test.app.n8n.cloud',resolveApiKey:key,fetch:request as typeof fetch});
 return {transport,request,key};
}
describe('Step76 server-only n8n authenticated HTTP transport',()=>{
 it.each(['http://unsafe.example','https://user:private@safe.example','https://safe.example/path','https://safe.example?secret=x','https://127.0.0.1','https://localhost','https://169.254.169.254'])('rejects unexpected server origin %s',baseUrl=>{
  expect(()=>new N8nHttpTransport({workspaceId,baseUrl,resolveApiKey:async()=> 'private'})).toThrow();
 });
 it('uses server credentials only in headers, refuses redirects, and paginates read-only',async()=>{
  const f=setup();
  f.request.mockResolvedValueOnce(new Response(JSON.stringify({data:[{id:'unrelated',name:'Other'}],nextCursor:'cursor&private'})))
   .mockResolvedValueOnce(new Response(JSON.stringify({data:[{id:'owned',name:workflow.name}]})));
  expect(await f.transport.listByName(workflow.name)).toEqual([{id:'owned',name:workflow.name}]);
  const [url,options]=f.request.mock.calls[1]!;
  expect(new URL(url).searchParams.get('cursor')).toBe('cursor&private');
  expect(options.headers['X-N8N-API-KEY']).toBe('PRIVATE-API-KEY');expect(options.redirect).toBe('error');
  expect(url).not.toContain('PRIVATE-API-KEY');expect(options.method).toBe('GET');
 });
 it('creates via the new-workflow endpoint only, with no ID or activation input',async()=>{
  const f=setup();f.request.mockResolvedValueOnce(new Response(JSON.stringify({id:'new-id',active:false})));
  expect(await f.transport.createInactive(workflow)).toEqual({id:'new-id'});
  const [url,options]=f.request.mock.calls[0]!;
  expect(url).toBe('https://thaara-test.app.n8n.cloud/api/v1/workflows');expect(options.method).toBe('POST');
  const body=JSON.parse(options.body);
  expect(body).not.toHaveProperty('id');expect(body).not.toHaveProperty('active');
  expect(body.name).toMatch(/^THAARA_V2_DEV_/);
  expect(JSON.stringify(body)).not.toContain('PRIVATE-API-KEY');
 });
 it('rejects a credential-bearing, active or altered graph before any HTTP call',async()=>{
  const f=setup();
  for(const mutation of ['credentials','active','node','expression']) {
   const altered:any=structuredClone(workflow);
   if(mutation==='credentials')altered.nodes[1].credentials={id:'existing'};
   if(mutation==='active')altered.active=true;
   if(mutation==='node')altered.nodes[1].type='n8n-nodes-base.gmail';
   if(mutation==='expression')altered.nodes[1].parameters.assignments.assignments[0].value='={{ $env.SECRET }}';
   await expect(f.transport.createInactive(altered)).rejects.toThrow();
  }
  expect(f.request).not.toHaveBeenCalled();
 });
 it.each(['../existing','https://evil.example','id/activate',''])('rejects unsafe workflow ID %s before networking',async id=>{
  const f=setup();await expect(f.transport.read(id)).rejects.toThrow();expect(f.request).not.toHaveBeenCalled();
 });
 it('sanitizes authentication errors and never returns n8n error bodies',async()=>{
  const f=setup();f.request.mockResolvedValueOnce(new Response('PRIVATE-API-KEY server details',{status:403}));
  await expect(f.transport.read('id')).rejects.toThrow('n8n request failed.');
 });
 it('fails closed on missing server credentials',async()=>{
  const f=setup();f.key.mockResolvedValueOnce('');
  await expect(f.transport.read('id')).rejects.toThrow();expect(f.request).not.toHaveBeenCalled();
 });
 it('does not retry timeouts or transport errors',async()=>{
  const f=setup();f.request.mockRejectedValueOnce(Error('PRIVATE-API-KEY timeout'));
  await expect(f.transport.createInactive(workflow)).rejects.toThrow('n8n request failed.');
  expect(f.request).toHaveBeenCalledTimes(1);
 });
 it('fails closed rather than trusting incomplete or oversized inventory',async()=>{
  const f=setup();f.request.mockImplementation(async()=>new Response(JSON.stringify({data:[],nextCursor:'more'})));
  await expect(f.transport.listByName(workflow.name)).rejects.toThrow();
  expect(f.request).toHaveBeenCalledTimes(5);
 });
 it('bounds response data and does not disclose malformed provider responses',async()=>{
  const f=setup();f.request.mockResolvedValueOnce(new Response('x'.repeat(1024*1024+1)));
  await expect(f.transport.read('id')).rejects.toThrow('n8n request failed.');
 });
});
