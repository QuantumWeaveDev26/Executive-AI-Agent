import React from 'react';
import { describe,it,expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { N8nConnectionView } from '../src/N8nConnection';
const details={connectorName:'n8n' as const,status:'not_configured' as const,configured:false,mode:'disabled' as const,managementEnabled:false,storage:'unavailable' as const,profiles:[],selectedProfileId:null,liveProvidersStatus:'not_configured' as const};
function render(extra:any={}){return renderToStaticMarkup(<N8nConnectionView role="owner" details={details} loading={false} error={null} selected="" onSelect={()=>{}} onRefresh={()=>{}} onConfigure={()=>{}} onDisconnect={()=>{}} {...extra}/>);}
describe('Step77 n8n admin connection screen',()=>{
 it.each(['member','viewer'])('hides configuration controls from %s',role=>{expect(render({role})).not.toContain('<select');expect(render({role})).toContain('Workspace admin access required');});
 it('shows truthful setup blocker and no credential input',()=>{
  const html=render();expect(html).toContain('not_configured');expect(html).toContain('Secure server storage is not configured');
  expect(html).not.toMatch(/type="password"|type="text"|apiKey|accessToken/);
 });
 it('labels persistent test storage and its revision without claiming a live connection',()=>{
  const html=render({details:{...details,mode:'mock',managementEnabled:true,storage:'postgres_durable',revision:7}});
  expect(html).toContain('PostgreSQL test storage');expect(html).toContain('revision 7');expect(html).toContain('Mock KMS only');
  expect(html).not.toContain('temporary mock storage');
 });
 it('renders loading, retryable error and empty profile states',()=>{
  expect(render({loading:true})).toContain('Loading n8n connection');
  expect(render({error:'Unable to load connection.'})).toContain('role="alert"');
  expect(render()).toContain('No approved server profiles');
 });
 it('labels mock configuration as unverified and supports local disconnect',()=>{
  const html=render({details:{...details,status:'configured_unverified',configured:true,mode:'mock',managementEnabled:true,storage:'ephemeral_encrypted_mock',profiles:[{id:'synthetic',label:'Synthetic profile'}],selectedProfileId:'synthetic'},selected:'synthetic'});
  expect(html).toContain('configured_unverified');expect(html).toContain('Local disconnect');expect(html).toContain('Synthetic profile');expect(html).toContain('mock');
 });
});
