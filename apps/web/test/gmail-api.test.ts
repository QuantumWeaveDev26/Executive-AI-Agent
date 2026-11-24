import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { getGmailStatus,searchGmail,readGmailMessage,disconnectGmail,gmailError } from '../src/gmail-api';
import { ApiRequestError } from '../src/api';
const status={connectorName:'gmail',status:'connected',connected:true,configured:true,mode:'mock',scopes:[],lastVerifiedAt:null};
const fetcher=vi.fn();
beforeEach(()=>{fetcher.mockReset();vi.stubGlobal('document',{cookie:'thaara_csrf=synthetic-csrf'});vi.stubGlobal('fetch',fetcher);});
afterEach(()=>vi.unstubAllGlobals());
const respond=(value:any)=>fetcher.mockResolvedValueOnce({ok:true,json:async()=>value});
describe('Step85 Gmail browser API safety',()=>{
 it('uses cookie authentication and CSRF for bounded POST search and JSON disconnect',async()=>{
  respond({messages:[{id:'one'}],mode:'mock',untrusted:true,nextPageToken:'opaque'});await searchGmail(' in:inbox ');
  const [url,options]=fetcher.mock.calls[0];expect(url).toBe('/api/v1/connectors/gmail/messages/search');expect(options.credentials).toBe('include');expect(options.method).toBe('POST');
  expect(new Headers(options.headers).get('x-csrf-token')).toBe('synthetic-csrf');expect(JSON.parse(options.body)).toEqual({query:'in:inbox',limit:10});
  respond({...status,status:'disconnected',connected:false});await disconnectGmail();const deletion=fetcher.mock.calls[1][1];expect(deletion.method).toBe('DELETE');expect(deletion.body).toBe('{}');expect(new Headers(deletion.headers).get('x-csrf-token')).toBe('synthetic-csrf');
 });
 it('keeps queries/page tokens out of URLs and sends no client-selected workspace/user',async()=>{
  respond({messages:[],mode:'mock',untrusted:true});await searchGmail('from:synthetic@example.test','private-page');
  const [url,options]=fetcher.mock.calls[0];expect(url).not.toMatch(/synthetic|private-page/);expect(JSON.parse(options.body)).toEqual({query:'from:synthetic@example.test',limit:10,pageToken:'private-page'});
 });
 it.each(['../secret','https://evil.example','mail%2Fsecret',''])('rejects unsafe message ID %s before any fetch',async id=>{
  await expect(readGmailMessage(id)).rejects.toMatchObject({status:400});expect(fetcher).not.toHaveBeenCalled();
 });
 it('rejects unexpected IDs/modes/untrusted markers and strips unknown HTML/credential fields',async()=>{
  respond({id:'other',mode:'mock',untrusted:true});await expect(readGmailMessage('one')).rejects.toMatchObject({status:502});
  respond({id:'one',mode:'live',untrusted:true});await expect(readGmailMessage('one')).rejects.toMatchObject({status:502});
  respond({id:'one',mode:'mock',untrusted:false});await expect(readGmailMessage('one')).rejects.toMatchObject({status:502});
  respond({id:'one',mode:'mock',untrusted:true,bodyText:'Synthetic text',bodyHtml:'<script>bad()</script>',accessToken:'PRIVATE'});
  expect(await readGmailMessage('one')).toEqual({id:'one',mode:'mock',untrusted:true,bodyText:'Synthetic text'});
 });
 it('rejects live-mode status and strips secret status extras',async()=>{
  respond({...status,mode:'live'});await expect(getGmailStatus()).rejects.toMatchObject({status:502});respond({...status,accessToken:'PRIVATE'});expect(await getGmailStatus()).not.toHaveProperty('accessToken');
 });
 it('fails closed on excessive/untrusted search results and overlong query input',async()=>{
  respond({messages:Array.from({length:11},(_,i)=>({id:'mail'+i})),mode:'mock',untrusted:true});await expect(searchGmail('x')).rejects.toMatchObject({status:502});
  respond({messages:[],mode:'mock',untrusted:false});await expect(searchGmail('x')).rejects.toMatchObject({status:502});
  const calls=fetcher.mock.calls.length;await expect(searchGmail('x'.repeat(1001))).rejects.toMatchObject({status:400});expect(fetcher).toHaveBeenCalledTimes(calls);
 });
 it('never exposes provider or server error strings as UI errors',()=>{
  expect(gmailError(new ApiRequestError(403,'postgresql://PRIVATE'))).toBe('unauthorized');expect(gmailError(Error('PRIVATE'))).toBe('unavailable');
 });
});
