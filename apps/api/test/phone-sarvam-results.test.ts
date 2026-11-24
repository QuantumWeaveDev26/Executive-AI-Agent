import {describe,it,expect,vi} from 'vitest';
import {createSarvamResultReader} from '../src/services/phone-sarvam-results.js';

const ids={orgId:'org',workspaceId:'ws',appId:'app',appVersion:2};
const binding={attemptId:'attempt_1',createdAt:'2026-10-30T00:00:00.000Z'};
const item={attempt_id:'attempt_1',interaction_id:'20261030/abc-123',app_version:2,connectivity_status:'connected',end_datetime:'2026-10-30T00:01:00',channel_direction:'outbound'};
const key='synthetic-results-key';
function fixture(over:Record<string,unknown>={}){
 const fetch=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('/attempts?')?{items:[{...item,...over}]}:{interaction_id:item.interaction_id,messages:[{role:'assistant',content:'I agree.'},{role:'user',content:'ನಾಳೆ ಬರುತ್ತೇನೆ',language_name:'Kannada'}]})));
 return {fetch,read:createSarvamResultReader({...ids,enabled:true,credentials:{resolve:async()=>({apiKey:key})},fetch:fetch as unknown as typeof globalThis.fetch})};
}
describe('authenticated Sarvam evidence reader (fake network only)',()=>{
 it('binds the exact attempt/version before fetching encoded original-language transcript',async()=>{
  const f=fixture();expect(await f.read(binding)).toMatchObject({status:'available',outcome:'completed',responses:['ನಾಳೆ ಬರುತ್ತೇನೆ']});
  expect(f.fetch).toHaveBeenCalledTimes(2);
  expect((await f.read(binding)).conversation?.turns.map(t=>t.speaker)).toEqual(['thaara','customer']);
  const [url,init]=f.fetch.mock.calls[0] as unknown as [string,RequestInit];
  expect(new URL(url).searchParams.get('filter_conditions')).toContain('attempt_1');
  expect(init).toMatchObject({method:'GET',redirect:'error',headers:{'X-API-Key':key}});
  expect(f.fetch.mock.calls[1]![0]).toContain('/transcripts/20261030%2Fabc-123');
 });
 it('never requests transcript for mismatched attempt, version, unfinished or malformed ids',async()=>{
  for(const over of [{attempt_id:'foreign'},{app_version:3},{end_datetime:null},{interaction_id:'20261030/../private'}]){
   const f=fixture(over);expect((await f.read(binding)).status).not.toBe('available');expect(f.fetch).toHaveBeenCalledTimes(1);
  }
 });
 it('does not connect when disabled or input is invalid, and never retries errors',async()=>{
  const fetch=vi.fn();const read=createSarvamResultReader({...ids,enabled:false,credentials:{resolve:async()=>{throw Error('secret');}},fetch});
  expect((await read(binding)).status).toBe('unavailable');expect(fetch).not.toHaveBeenCalled();
  const f=fixture();expect((await f.read({...binding,attemptId:'../x'})).status).toBe('unavailable');expect(f.fetch).not.toHaveBeenCalled();
  const fail=vi.fn(async()=>new Response('private failure',{status:429}));
  const r=createSarvamResultReader({...ids,enabled:true,credentials:{resolve:async()=>({apiKey:key})},fetch:fail as unknown as typeof globalThis.fetch});
  expect(await r(binding)).toEqual({status:'unavailable',responses:[]});expect(fail).toHaveBeenCalledTimes(1);
 });
 it('never invents a result from empty or mismatched transcripts',async()=>{
  const f=fixture();f.fetch.mockImplementation(async(url:string)=>new Response(JSON.stringify(url.includes('/attempts?')?{items:[item]}:{interaction_id:'foreign',messages:[]})));
  expect((await f.read(binding)).status).toBe('unavailable');
 });
});
