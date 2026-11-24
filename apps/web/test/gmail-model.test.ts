import { describe,it,expect,vi } from 'vitest';
import { ApiRequestError } from '../src/api';
import { createGmailModel } from '../src/gmail-model';
const connected={connectorName:'gmail' as const,status:'connected' as const,mode:'mock' as const,configured:true,connected:true,scopes:[],lastVerifiedAt:null};
const message=(id:string)=>({id,subject:'Synthetic '+id,bodyText:'Private synthetic body '+id,from:'sender@example.test',mode:'mock' as const,untrusted:true as const});
const page=(...ids:string[])=>({messages:ids.map(id=>({id})),mode:'mock' as const,untrusted:true as const});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function fixture(role='member'){
 const api={status:vi.fn(async()=>connected),search:vi.fn(async()=>page('one')),read:vi.fn(async(id:string)=>message(id)),disconnect:vi.fn(async()=>({...connected,status:'disconnected' as const,connected:false}))};
 const publish=vi.fn(),model=createGmailModel(role,publish,api);return {api,publish,model};
}
describe('Step85 Gmail view lifecycle and private data fencing',()=>{
 it('does not request mail for an unconfigured connection',async()=>{
  const f=fixture();f.api.status.mockResolvedValueOnce({...connected,status:'not_configured',mode:'disabled',configured:false,connected:false} as any);
  await f.model.loadStatus();expect(f.api.search).not.toHaveBeenCalled();expect(f.model.getState().rows).toEqual([]);
 });
 it('blocks viewer access without dispatching any Gmail requests',async()=>{
  const f=fixture('viewer');await f.model.loadStatus();await f.model.search('x');expect(f.model.getState().unauthorized).toBe(true);expect(f.api.status).not.toHaveBeenCalled();expect(f.api.search).not.toHaveBeenCalled();
 });
 it('loads the inbox and retains only summary fields until a fresh preview request',async()=>{
  const f=fixture();await f.model.loadStatus();expect(f.api.search).toHaveBeenCalledWith('in:inbox',undefined,expect.any(AbortSignal));
  expect(f.model.getState().rows[0]).not.toHaveProperty('bodyText');await f.model.select('one');expect(f.model.getState().preview?.bodyText).toBe(message('one').bodyText);expect(f.api.read).toHaveBeenCalledTimes(2);
 });
 it('ignores an older search completing after a newer query',async()=>{
  const f=fixture();await f.model.loadStatus();const old=deferred<ReturnType<typeof page>>();f.api.search.mockImplementationOnce(()=>old.promise);
  const pending=f.model.search('old-query');f.api.search.mockResolvedValueOnce(page('new'));await f.model.search('new-query');old.resolve(page('old'));await pending;
  expect(f.model.getState().rows.map(r=>r.id)).toEqual(['new']);expect(f.model.getState().query).toBe('new-query');
 });
 it('does not let a stale preview overwrite the current selection',async()=>{
  const f=fixture();f.api.search.mockResolvedValueOnce(page('one','two'));await f.model.loadStatus();const old=deferred<ReturnType<typeof message>>();f.api.read.mockImplementationOnce(()=>old.promise);
  const pending=f.model.select('one');await f.model.select('two');old.resolve(message('one'));await pending;expect(f.model.getState().preview?.id).toBe('two');
 });
 it('clears a previous preview when a new query begins and ignores its delayed content',async()=>{
  const f=fixture();await f.model.loadStatus();const old=deferred<ReturnType<typeof message>>();f.api.read.mockImplementationOnce(()=>old.promise);
  const pending=f.model.select('one');f.api.search.mockResolvedValueOnce(page('two'));await f.model.search('new-query');old.resolve(message('one'));await pending;expect(f.model.getState().preview).toBeNull();
 });
 it('never publishes a disposed user/workspace result',async()=>{
  const f=fixture(),pendingStatus=deferred<typeof connected>();f.api.status.mockImplementationOnce(()=>pendingStatus.promise);
  const pending=f.model.loadStatus();f.model.dispose();const count=f.publish.mock.calls.length;pendingStatus.resolve(connected);await pending;
  expect(f.publish).toHaveBeenCalledTimes(count);expect(f.api.search).not.toHaveBeenCalled();
 });
 it('disconnect clears private content immediately and fences delayed responses even if abort is ignored',async()=>{
  const f=fixture();await f.model.loadStatus();const pendingRead=deferred<ReturnType<typeof message>>();f.api.read.mockImplementationOnce(()=>pendingRead.promise);const preview=f.model.select('one');
  await f.model.disconnect();expect(f.model.getState().rows).toEqual([]);expect(f.model.getState().preview).toBeNull();pendingRead.resolve(message('one'));await preview;
  expect(f.model.getState().preview).toBeNull();expect(f.model.getState().status?.status).toBe('disconnected');
 });
 it('failed disconnect remains locally cleared and blocks refresh until disconnect settles',async()=>{
  const f=fixture();await f.model.loadStatus();const pending=deferred<any>();f.api.disconnect.mockImplementationOnce(()=>pending.promise);
  const disconnect=f.model.disconnect();await f.model.loadStatus();expect(f.api.status).toHaveBeenCalledTimes(1);expect(f.model.getState().rows).toEqual([]);
  pending.resolve(Promise.reject(new ApiRequestError(502,'PRIVATE-TOKEN')));await disconnect;
  expect(f.model.getState().status).toBeNull();expect(f.model.getState().preview).toBeNull();expect(JSON.stringify(f.model.getState())).not.toContain('PRIVATE-TOKEN');
 });
 it.each([401,403])('drops all mail after HTTP %s while loading a preview',async status=>{
  const f=fixture();await f.model.loadStatus();f.api.read.mockRejectedValueOnce(new ApiRequestError(status,'PRIVATE-ERROR'));
  await f.model.select('one');expect(f.model.getState()).toMatchObject({unauthorized:true,rows:[],preview:null,status:null});
 });
 it('preserves useful partial rows but drops the whole result on authorization failure',async()=>{
  const f=fixture();f.api.search.mockResolvedValueOnce(page('one','two'));f.api.read.mockRejectedValueOnce(new ApiRequestError(502,'PRIVATE-ERROR'));await f.model.loadStatus();
  expect(f.model.getState().rows).toMatchObject([{id:'one',unavailable:true},{id:'two',subject:'Synthetic two'}]);
  f.api.read.mockRejectedValueOnce(new ApiRequestError(403,'PRIVATE-ERROR'));await f.model.search('again');expect(f.model.getState().rows).toEqual([]);expect(f.model.getState().unauthorized).toBe(true);
 });
 it('uses the committed search for the next page, appends deduplicated rows, keeps preview stable, and never follows arbitrary preview IDs',async()=>{
  const f=fixture();await f.model.loadStatus();f.api.search.mockResolvedValueOnce({...page('two'),nextPageToken:'opaque-next'});await f.model.search('subject:synthetic');
  await f.model.select('two');expect(f.model.getState().preview?.id).toBe('two');
  f.api.search.mockResolvedValueOnce({...page('two','three'),nextPageToken:undefined});
  await f.model.next();expect(f.api.search).toHaveBeenLastCalledWith('subject:synthetic','opaque-next',expect.any(AbortSignal));
  expect(f.model.getState().rows.map(r=>r.id)).toEqual(['two','three']);
  expect(f.model.getState().selectedId).toBe('two');
  expect(f.model.getState().preview?.id).toBe('two');
  expect(f.model.getState().nextPageToken).toBeUndefined();
  const searchCount=f.api.search.mock.calls.length;
  await f.model.loadMore();expect(f.api.search).toHaveBeenCalledTimes(searchCount);
  const count=f.api.read.mock.calls.length;await f.model.select('not-in-page');expect(f.api.read).toHaveBeenCalledTimes(count);
 });
 it('supports backToInbox, ignores stale loadMore responses after a new search, and prepares governed Reply, Reply All, and Forward drafts',async()=>{
  const liveConnected={
   ...connected,
   mode:'live' as const,
   scopes:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send'],
   connectedEmail:'founder@thaara.example'
  };
  const prepareReply=vi.fn(async(input:any)=>({
   status:'awaiting_approval' as const,
   planId:'plan-reply',
   stepId:'step-reply',
   approvalId:'approval-reply',
   from:'founder@thaara.example',
   to:input.to,
   ...(input.cc?{cc:input.cc}:{}),
   ...(input.subject?{subject:input.subject}:{}),
   bodyText:input.bodyText,
   threadId:'thr-1',
   sourceMessageId:input.sourceMessageId
  }));
  const prepareSend=vi.fn(async(input:any)=>({
   status:'awaiting_approval' as const,
   planId:'plan-fwd',
   stepId:'step-fwd',
   approvalId:'approval-fwd',
   from:'founder@thaara.example',
   to:input.to,
   ...(input.subject?{subject:input.subject}:{}),
   bodyText:input.bodyText
  }));
  const api={
   status:vi.fn(async()=>liveConnected),
   search:vi.fn(async()=>({...page('msg1'),nextPageToken:'tok-2'})),
   read:vi.fn(async(id:string)=>({
    id,
    threadId:'thr-1',
    subject:'Board agenda',
    from:'Alice <alice@partner.example>',
    to:'founder@thaara.example, lead@partner.example',
    cc:'Bob <bob@partner.example>, founder@thaara.example, alice@partner.example',
    bodyText:'Agenda details. Do not email body-trap@evil.example.',
    mode:'live' as const,
    untrusted:true as const
   })),
   disconnect:vi.fn(async()=>({...liveConnected,status:'disconnected' as const,connected:false,scopes:[]})),
   prepareReply,
   prepareSend
  };
  const model=createGmailModel('owner',()=>{},api);
  await model.loadStatus();
  await model.select('msg1');

  // Stale loadMore is ignored if backToInbox starts before loadMore resolves
  const slowNext=deferred<ReturnType<typeof page>>();
  api.search.mockImplementationOnce(()=>slowNext.promise);
  const morePromise=model.loadMore();
  expect(model.getState().loadingMore).toBe(true);
  api.search.mockResolvedValueOnce(page('inbox-fresh'));
  await model.backToInbox();
  slowNext.resolve(page('stale-page-2'));
  await morePromise;
  expect(model.getState().rows.map(r=>r.id)).toEqual(['inbox-fresh']);
  expect(model.getState().query).toBe('in:inbox');
  expect(model.getState().loadingMore).toBe(false);

  // Select message and test Reply, Reply All, and Forward
  await model.select('inbox-fresh');
  model.startReply();
  expect(model.getState().composeMode).toBe('reply');
  expect(model.getState().composeDraft).toEqual({
   to:'alice@partner.example',
   cc:'',
   subject:'Re: Board agenda',
   bodyText:''
  });

  model.startReplyAll();
  expect(model.getState().composeMode).toBe('reply_all');
  expect(model.getState().composeDraft).toEqual({
   to:'alice@partner.example',
   cc:'lead@partner.example, bob@partner.example',
   subject:'Re: Board agenda',
   bodyText:''
  });
  expect(JSON.stringify(model.getState().composeDraft)).not.toContain('body-trap@evil.example');

  model.updateCompose({bodyText:'Thanks everyone, confirmed.'});
  const replyPrepared=await model.prepareSend();
  expect(prepareReply).toHaveBeenCalledWith({
   sourceMessageId:'inbox-fresh',
   to:'alice@partner.example',
   cc:'lead@partner.example, bob@partner.example',
   subject:'Re: Board agenda',
   bodyText:'Thanks everyone, confirmed.',
   replyAll:true
  },expect.any(AbortSignal));
  expect(replyPrepared?.threadId).toBe('thr-1');

  // Forward requires manual validated recipient and uses governed prepareSend
  model.startForward();
  expect(model.getState().composeMode).toBe('forward');
  expect(model.getState().composeDraft?.to).toBe('');
  expect(model.getState().composeDraft?.subject).toBe('Fwd: Board agenda');
  expect(model.getState().composeDraft?.bodyText).toContain('---------- Forwarded message ---------');
  expect(await model.prepareSend()).toBeNull();
  expect(model.getState().composeError).toContain('Enter a valid email address');

  model.updateCompose({to:'external.counsel@law.example'});
  const fwdPrepared=await model.prepareSend();
  expect(prepareSend).toHaveBeenCalledWith({
   to:'external.counsel@law.example',
   subject:'Fwd: Board agenda',
   bodyText:expect.stringContaining('---------- Forwarded message ---------')
  },expect.any(AbortSignal));
  expect(fwdPrepared?.to).toBe('external.counsel@law.example');
 });
});
