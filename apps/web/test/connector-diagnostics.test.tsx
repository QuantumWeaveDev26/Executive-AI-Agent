import React from 'react';
import { describe,it,expect,vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConnectorDiagnosticsView } from '../src/ConnectorDiagnostics';
import { getConnectorDiagnostics } from '../src/connector-diagnostics-api';
import { request } from '../src/api';
vi.mock('../src/api',()=>({request:vi.fn(async()=>({connectors:[]}))}));
const item={connectorName:'n8n' as const,connectionScope:'workspace' as const,connectionState:'configured_unverified' as const,storageKind:'postgres_durable' as const,storageStatus:'readable' as const,kmsStatus:'mock_only' as const,
 lastDiagnostic:{code:'local_metadata_read' as const,checkedAt:'2026-10-17T10:00:00.000Z',providerContacted:false as const}};
const render=(extra:any={})=>renderToStaticMarkup(<ConnectorDiagnosticsView role="owner" items={[item]} loading={false} error={false} onRefresh={()=>{}} {...extra}/>);
describe('Step84 read-only admin diagnostics panel',()=>{
 it.each(['member','viewer'])('hides the panel from %s',role=>{expect(render({role})).toBe('');});
 it.each(['owner','admin'])('shows local storage/KMS/diagnostic results for %s',role=>{
  const html=render({role});for(const text of ['Configured, unverified','PostgreSQL (isolated test)','Readable','Mock KMS only','Local metadata read','Last safe diagnostic'])expect(html).toContain(text);
  expect(html).not.toMatch(/<input|<form|Disconnect|Activate|Execute|apiKey|accessToken/);
 });
 it('shows user-scoped Gmail and unavailable/not-configured states truthfully',()=>{
  const html=render({items:[{...item,connectorName:'gmail',connectionScope:'user',connectionState:'not_configured',storageKind:'unavailable',storageStatus:'not_configured',kmsStatus:'not_configured',lastDiagnostic:{...item.lastDiagnostic,code:'not_configured'}}]});
  expect(html).toContain('Gmail (your account)');expect(html).toContain('Not configured');expect(html).toContain('Managed KMS not configured');
 });
 it('renders loading, safe retry error and empty states',()=>{
  expect(render({loading:true})).toContain('Loading connector diagnostics');expect(render({loading:true})).not.toContain('<article');
  expect(render({error:true})).toContain('role="alert"');expect(render({error:true})).not.toContain('<article');expect(render({items:[]})).toContain('No connector diagnostics available');
 });
 it('does not display unknown diagnostic strings or malformed timestamps',()=>{
  const html=render({items:[{...item,connectionState:'PRIVATE-TOKEN',lastDiagnostic:{...item.lastDiagnostic,code:'postgresql://SECRET',checkedAt:'PRIVATE-CONNECTION'}}]});
  expect(html).toContain('Unavailable');expect(html).not.toMatch(/PRIVATE|SECRET|postgresql:/);
 });
 it('refreshes through the authenticated GET helper without a body or execution request',async()=>{
  await getConnectorDiagnostics();expect(request).toHaveBeenCalledWith('/api/v1/admin/connectors/diagnostics');
 });
 it('hides n8n connection status panel in Settings when hideN8n is enabled while keeping Gmail diagnostics',()=>{
  const gmailItem={...item,connectorName:'gmail' as const,connectionScope:'user' as const};
  const html=render({hideN8n:true,items:[item,gmailItem]});
  expect(html).toContain('Gmail (your account)');
  expect(html).not.toContain('n8n (workspace)');
  expect(html).not.toContain('n8n shows this workspace');
 });
});
