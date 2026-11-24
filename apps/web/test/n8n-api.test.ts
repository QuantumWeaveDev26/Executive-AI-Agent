import { describe,it,expect,vi,afterEach } from 'vitest';
import { request } from '../src/api';
import { configureN8nConnection,disconnectN8nConnection } from '../src/n8n-api';
vi.mock('../src/api',()=>({request:vi.fn(async()=>({}))}));
afterEach(()=>vi.clearAllMocks());
describe('durable n8n browser revision preconditions',()=>{
 it('sends the observed revision when configuring a server profile',async()=>{
  await configureN8nConnection('synthetic',4);
  expect(request).toHaveBeenCalledWith('/api/v1/connectors/n8n/connection',{method:'PUT',headers:{'If-Match':'"4"'},body:'{"profileId":"synthetic"}'});
 });
 it('sends a revision and valid empty JSON when disconnecting',async()=>{
  await disconnectN8nConnection(5);
  expect(request).toHaveBeenCalledWith('/api/v1/connectors/n8n/connection',{method:'DELETE',headers:{'If-Match':'"5"'},body:'{}'});
 });
 it('preserves legacy ephemeral requests without a revision precondition',async()=>{
  await configureN8nConnection('synthetic');expect(request).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({headers:{}}));
  await disconnectN8nConnection();expect(request).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({headers:{}}));
 });
});
