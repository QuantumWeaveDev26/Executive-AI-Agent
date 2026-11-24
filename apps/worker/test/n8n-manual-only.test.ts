
import { describe,it,expect,vi } from 'vitest';
import { JobProcessor } from '../src/processor.js';
import { N8N_CREATE_ACTION } from '@thaara/policy';
describe('Step76 n8n is manual-only before worker lease acquisition',()=>{
 it('uses the stored action, ignores misleading queue metadata and leaves the step untouched',async()=>{
  const query=vi.fn(async(sql:string)=>{if(sql.includes('FROM plan_steps'))return {rows:[{id:'step',plan_id:'plan',action_name:N8N_CREATE_ACTION}]};throw Error('Unexpected mutation or lease');});
  const db={query,withScopedTransaction:async(_scope:unknown,operation:any)=>operation({query})};
  const processor=new JobProcessor(db as any);
  const result=await processor.process({workspaceId:'workspace',jobRunId:'job',jobName:'plan.execute_step',payload:{planId:'plan',stepId:'step',actionName:'test.deterministic_hash_task'}});
  expect(result.result).toMatchObject({manualExecutionRequired:true});
  expect(query).toHaveBeenCalledTimes(1);
 });
});
