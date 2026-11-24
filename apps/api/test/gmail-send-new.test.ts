import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MembershipRepository,
  Migrator,
  PGliteDatabase,
  SessionRepository,
  UserRepository,
  WorkspaceRepository,
  generateSessionToken,
  hashSessionToken
} from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { Logger } from '@thaara/observability';
import { ApprovalRequest, computeCanonicalParameterHash } from '@thaara/contracts';
import { buildApp } from '../src/app.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';
import { GMAIL_LIVE_SCOPES, GMAIL_READONLY, GmailFoundation } from '../src/services/gmail.js';
import { defaultPolicyGateway } from '@thaara/policy';
import { GmailVault } from '../src/services/gmail-vault.js';
import { LiveGmailProvider } from '../src/services/google-live.js';
import {
  detectGmailChatRequest,
  executeChatGmailRequest,
  parseComposeRequest
} from '../src/services/chat-gmail-assistant.js';
import { waitForChatPlanBackgroundExecution } from '../src/services/chat-automation-orchestrator.js';

const TECHNICAL_WORDS = /gmail\.readonly|gmail\.send|untrusted|PolicyGateway|Truthful Status|awaiting_approval|accepted_by_gmail|plan ID|Approval ID|query:/i;

describe('Step 106 — Real Gmail compose & send, live search and simple chat commands', () => {
  let db: PGliteDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  type Identity = {
    userId: string;
    workspaceId: string;
    token: string;
    scope: { workspaceId: string; userId: string; role: 'owner' | 'member' | 'viewer'; sessionTokenHash: string };
  };
  let owner: Identity;
  let member: Identity;
  let viewer: Identity;
  let otherWorkspaceOwner: Identity;

  const vaultRecords = new Map<string, string>();
  const csrf = generateCsrfToken();
  let profileEmail = 'founder.live@gmail.com';
  let sendMode: 'ok' | 'uncertain503' | 'rejected400' | 'no_id' = 'ok';
  const sent: Array<{ raw: string; threadId?: string }> = [];
  const searchQueries: string[] = [];

  const inbox = [
    {
      id: 'msg_new_arrival_01',
      threadId: 'thr_new_arrival_01',
      labelIds: ['INBOX', 'UNREAD'],
      subject: 'Just arrived: contract draft',
      from: 'Partner Desk <partner.desk@client.example>',
      to: 'founder.live@gmail.com',
      date: 'Fri, 23 Oct 2026 13:05:00 +0530',
      body: 'Please review the contract draft today.'
    },
    {
      id: 'msg_ram_02',
      threadId: 'thr_ram_02',
      labelIds: ['INBOX'],
      subject: 'Lunch tomorrow?',
      from: 'Ram Kumar <ram@partner.example>',
      to: 'founder.live@gmail.com, team.lead@partner.example',
      cc: 'Anita <anita@partner.example>, founder.live@gmail.com, ram@partner.example',
      date: 'Fri, 23 Oct 2026 10:00:00 +0530',
      body: 'Are you free for lunch tomorrow? Contact trap@body-only.example if needed.'
    },
    {
      id: 'msg_sent_03',
      threadId: 'thr_sent_03',
      labelIds: ['SENT'],
      subject: 'Proposal',
      from: 'founder.live@gmail.com',
      to: 'investor@fund.example',
      date: 'Thu, 22 Oct 2026 18:00:00 +0530',
      body: 'Sharing the proposal.'
    }
  ];

  const liveFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url === 'https://oauth2.googleapis.com/token') {
      const params = new URLSearchParams(String(init?.body ?? ''));
      const readonly = params.get('code') === 'code_readonly';
      return json({
        access_token: readonly ? 'ya29.readonly_token' : 'ya29.full_secret_access_token',
        refresh_token: '1//0g_secret_refresh',
        scope: readonly ? GMAIL_READONLY : GMAIL_LIVE_SCOPES,
        expires_in: 3600
      });
    }
    if (url === 'https://oauth2.googleapis.com/revoke') return new Response('', { status: 200 });
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') {
      return json({ emailAddress: profileEmail });
    }
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      if (sendMode === 'uncertain503') return new Response('upstream timeout', { status: 503 });
      if (sendMode === 'rejected400') return json({ error: { code: 400, message: 'Invalid To header' } }, 400);
      const body = JSON.parse(String(init?.body ?? '{}')) as { raw?: string; threadId?: string };
      sent.push({ raw: Buffer.from(body.raw ?? '', 'base64url').toString('utf8'), ...(body.threadId ? { threadId: body.threadId } : {}) });
      if (sendMode === 'no_id') return json({ labelIds: ['SENT'] });
      return json({ id: `sent_msg_${sent.length}`, threadId: body.threadId ?? `new_thread_${sent.length}`, labelIds: ['SENT'] });
    }
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
      const q = (new URL(url).searchParams.get('q') ?? '').toLowerCase();
      searchQueries.push(q);
      let matches = inbox.filter((m) => !q.includes('in:inbox') || m.labelIds.includes('INBOX'));
      if (q.includes('in:sent')) matches = inbox.filter((m) => m.labelIds.includes('SENT'));
      const fromMatch = q.match(/from:(\S+)/);
      if (fromMatch) matches = matches.filter((m) => m.from.toLowerCase().includes(fromMatch[1]!));
      const toMatch = q.match(/to:(\S+)/);
      if (toMatch) matches = matches.filter((m) => m.to.toLowerCase().includes(toMatch[1]!));
      const bare = q.match(/(?:^|\s)([^\s:]+@[^\s:]+)(?:\s|$)/);
      if (bare && !fromMatch && !toMatch) {
        matches = matches.filter((m) => `${m.from} ${m.to}`.toLowerCase().includes(bare[1]!));
      }
      return json({ messages: matches.map((m) => ({ id: m.id, threadId: m.threadId })) });
    }
    for (const m of inbox) {
      if (url.startsWith(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}`)) {
        return json({
          id: m.id,
          threadId: m.threadId,
          labelIds: m.labelIds,
          snippet: m.body,
          payload: {
            headers: [
              { name: 'Subject', value: m.subject },
              { name: 'From', value: m.from },
              { name: 'To', value: m.to },
              ...('cc' in m && m.cc ? [{ name: 'Cc', value: m.cc }] : []),
              { name: 'Message-ID', value: `<${m.id}@mail.example>` },
              { name: 'Date', value: m.date }
            ],
            parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(m.body, 'utf8').toString('base64url') } }]
          }
        });
      }
    }
    return new Response('Not found', { status: 404 });
  });

  const provider = new LiveGmailProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchFn: liveFetch as unknown as typeof fetch
  });
  const vault = new GmailVault(randomBytes(32), {
    get: (k) => vaultRecords.get(k),
    set: (k, v) => {
      vaultRecords.set(k, v);
    },
    take: (k) => {
      const v = vaultRecords.get(k);
      vaultRecords.delete(k);
      return v;
    },
    delete: (k) => {
      vaultRecords.delete(k);
    }
  });

  // A second foundation over the same encrypted vault and provider, used to call the service directly.
  const foundation = new GmailFoundation({
    provider,
    vault,
    clientId: 'client-id',
    redirectUri: 'https://app.thaara.example/api/v1/connectors/gmail/oauth/callback',
    policyGateway: defaultPolicyGateway,
    audit: async () => {}
  });

  const headers = (identity: { token: string } = owner) => ({
    cookie: `thaara_session=${identity.token}; thaara_csrf=${csrf}`,
    'x-csrf-token': csrf
  });
  const sendCalls = () =>
    liveFetch.mock.calls.filter(([u]) => String(u) === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send').length;

  async function connect(identity: Identity = owner, code = 'code_full') {
    const start = await app.inject({ method: 'POST', url: '/api/v1/connectors/gmail/oauth/start', headers: headers(identity), payload: {} });
    expect(start.statusCode).toBe(200);
    const state = new URL(start.json().authorizationUrl).searchParams.get('state')!;
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/gmail/oauth/callback?state=${encodeURIComponent(state)}&code=${code}`,
      headers: headers(identity)
    });
    expect(cb.statusCode).toBe(200);
    return cb.json();
  }

  async function prepare(payload: Record<string, unknown>, identity: Identity = owner) {
    return app.inject({ method: 'POST', url: '/api/v1/connectors/gmail/messages/send-new', headers: headers(identity), payload });
  }

  async function decide(approvalId: string, status: 'approved' | 'rejected', identity: Identity = owner) {
    return app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/decide`, headers: headers(identity), payload: { status } });
  }

  async function getPlan(planId: string, identity: Identity = owner) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/plans/${planId}`, headers: headers(identity) });
    return { statusCode: res.statusCode, body: res.json() };
  }

  async function conversation(identity: Identity, title: string) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/conversations', headers: headers(identity), payload: { title } });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  let turn = 0;
  async function chat(identity: Identity, conversationId: string, content: string) {
    const stream = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/stream`,
      headers: headers(identity),
      payload: { content, idempotency_key: `step106-turn-${++turn}` }
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain('event: done');
    const msgs = await app.inject({ method: 'GET', url: `/api/v1/conversations/${conversationId}/messages`, headers: headers(identity) });
    const list = msgs.json() as Array<{ sender_type: string; content: string; metadata: Record<string, unknown> }>;
    const last = [...list].reverse().find((m) => m.sender_type === 'assistant')!;
    return { text: last.content, metadata: last.metadata ?? {} };
  }

  beforeAll(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());
    const make = async (email: string, role: 'owner' | 'member' | 'viewer', wsId?: string): Promise<Identity> => {
      const workspaceId = wsId ?? (await new WorkspaceRepository(db).create(`ws-${email}`)).id;
      const user = await new UserRepository(db).create(email, 'hash', email);
      const token = generateSessionToken();
      const scope = { workspaceId, userId: user.id, role, sessionTokenHash: hashSessionToken(token) };
      await db.withScopedTransaction(scope, async (tx) => {
        await new MembershipRepository(tx).create(workspaceId, user.id, role);
        await new SessionRepository(tx).create(user.id, workspaceId, token);
      });
      return { userId: user.id, workspaceId, token, scope };
    };
    owner = await make('owner-106@a.test', 'owner');
    member = await make('member-106@a.test', 'member', owner.workspaceId);
    viewer = await make('viewer-106@a.test', 'viewer', owner.workspaceId);
    otherWorkspaceOwner = await make('owner-106@b.test', 'owner');
    app = await buildApp({
      db,
      logger: new Logger('error'),
      config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's'.repeat(32), CORS_ORIGIN: 'http://localhost:5173' }),
      gmail: {
        provider,
        vault,
        clientId: 'client-id',
        redirectUri: 'https://app.thaara.example/api/v1/connectors/gmail/oauth/callback'
      }
    });
    await app.ready();
  });

  beforeEach(() => {
    vaultRecords.clear();
    liveFetch.mockClear();
    sent.length = 0;
    searchQueries.length = 0;
    sendMode = 'ok';
    profileEmail = 'founder.live@gmail.com';
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.close();
  });

  it('builds a standalone RFC 2822 email without a thread, omits Subject when empty and strips header injection', async () => {
    await provider.sendNew({
      accessToken: 'ya29.test',
      connectedEmail: 'founder.live@gmail.com',
      to: 'brand.new@never-contacted.example',
      bodyText: 'Hi'
    });
    await provider.sendNew({
      accessToken: 'ya29.test',
      connectedEmail: 'founder.live@gmail.com',
      to: 'brand.new@never-contacted.example',
      subject: 'Hello\r\nBcc: attacker@evil.example',
      bodyText: 'Line one\nLine two'
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.threadId).toBeUndefined();
    expect(sent[0]!.raw).toContain('From: founder.live@gmail.com');
    expect(sent[0]!.raw).toContain('To: brand.new@never-contacted.example');
    expect(sent[0]!.raw).not.toMatch(/^Subject:/m);
    expect(sent[0]!.raw.endsWith('\r\n\r\nHi')).toBe(true);
    expect(sent[1]!.raw).toContain('Subject: Hello Bcc: attacker@evil.example');
    expect(sent[1]!.raw).not.toMatch(/^Bcc:/m);
    expect(sent[1]!.raw).toContain('Line one\r\nLine two');
  });

  it('prepares a new email to a never-contacted address with optional subject, sends once after explicit approval and records a truthful receipt', async () => {
    await connect();
    const prepared = await prepare({ to: 'Brand New <brand.new@never-contacted.example>', bodyText: 'Hello there' });
    expect(prepared.statusCode).toBe(200);
    const body = prepared.json();
    expect(body).toMatchObject({
      status: 'awaiting_approval',
      from: 'founder.live@gmail.com',
      to: 'brand.new@never-contacted.example',
      bodyText: 'Hello there'
    });
    expect(body.subject).toBeUndefined();
    // Preparing never contacts Gmail send.
    expect(sendCalls()).toBe(0);

    const approved = await decide(body.approvalId, 'approved');
    expect(approved.statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(body.planId);
    expect(sendCalls()).toBe(1);
    expect(sent[0]!.threadId).toBeUndefined();
    expect(sent[0]!.raw).toContain('To: brand.new@never-contacted.example');

    const plan = await getPlan(body.planId);
    expect(plan.body.steps[0].action_name).toBe('gmail.messages.send_new');
    expect(plan.body.steps[0].status).toBe('verified');
    expect(plan.body.receipts[0].status).toBe('verified');
    expect(plan.body.receipts[0].proof).toMatchObject({
      status: 'accepted_by_gmail',
      providerMessageId: 'sent_msg_1',
      to: 'brand.new@never-contacted.example',
      connectedEmail: 'founder.live@gmail.com'
    });
    expect(String(plan.body.receipts[0].proof.note)).toContain('not final recipient inbox delivery');
    expect(JSON.stringify(plan.body)).not.toContain('ya29.');

    // Repeating the approval never sends a second email.
    const again = await decide(body.approvalId, 'approved');
    expect(again.statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(body.planId);
    expect(sendCalls()).toBe(1);
  });

  it('includes an approved subject, rejects invalid recipients and blank messages, and cancelling sends nothing', async () => {
    await connect();
    expect((await prepare({ to: 'not-an-email', bodyText: 'Hi' })).json().error.code).toBe('GMAIL_INVALID_RECIPIENT');
    expect((await prepare({ to: 'a@b.example, c@d.example', bodyText: 'Hi' })).statusCode).toBe(400);
    expect((await prepare({ to: 'ok@person.example', bodyText: '   ' })).json().error.code).toBe('GMAIL_EMPTY_MESSAGE');

    const withSubject = (await prepare({ to: 'ok@person.example', subject: 'Quick question', bodyText: 'Hi' })).json();
    expect(withSubject.subject).toBe('Quick question');
    const cancelled = await decide(withSubject.approvalId, 'rejected');
    expect(cancelled.statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(withSubject.planId);
    expect(sendCalls()).toBe(0);
    const plan = await getPlan(withSubject.planId);
    expect(['failed', 'cancelled']).toContain(plan.body.status);
  });

  it('shows a reconnect requirement instead of preparing when gmail.send was not granted or Gmail is disconnected', async () => {
    const disconnected = await prepare({ to: 'ok@person.example', bodyText: 'Hi' });
    expect(disconnected.statusCode).toBe(409);
    expect(disconnected.json().error.code).toBe('GMAIL_DISCONNECTED');

    await connect(owner, 'code_readonly');
    const readonly = await prepare({ to: 'ok@person.example', bodyText: 'Hi' });
    expect(readonly.statusCode).toBe(409);
    expect(readonly.json().error.code).toBe('GMAIL_SEND_SCOPE_REQUIRED');
    expect(sendCalls()).toBe(0);
  });

  it('never sends without a matching explicit approval: pending, tampered, wrong-action and wrong-user approvals are refused', async () => {
    await connect();
    const prepared = (await prepare({ to: 'target@person.example', bodyText: 'Exact body' })).json();
    const gmail = foundation;
    const params = { connectedEmail: 'founder.live@gmail.com', to: 'target@person.example', bodyText: 'Exact body' };
    const base: ApprovalRequest = {
      id: prepared.approvalId,
      workspaceId: owner.workspaceId,
      actionName: 'gmail.messages.send_new',
      actionParams: params,
      requesterUserId: owner.userId,
      approverUserId: null,
      status: 'pending',
      riskLevel: 'medium',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await expect(gmail.sendNew(owner.scope, params, base, 'k1')).rejects.toThrow();
    await expect(
      gmail.sendNew(owner.scope, { ...params, to: 'attacker@evil.example' }, { ...base, status: 'approved' }, 'k2')
    ).rejects.toThrow();
    await expect(
      gmail.sendNew(owner.scope, params, { ...base, status: 'approved', actionName: 'gmail.messages.send_reply' }, 'k3')
    ).rejects.toThrow();
    await expect(
      gmail.sendNew(member.scope, params, { ...base, status: 'approved' }, 'k4')
    ).rejects.toThrow();
    expect(computeCanonicalParameterHash(params)).toHaveLength(64);
    expect(sendCalls()).toBe(0);
  });

  it('blocks other users and workspaces from approving, and refuses to send if the connected Gmail account changed', async () => {
    await connect();
    const prepared = (await prepare({ to: 'target@person.example', bodyText: 'Account bound' })).json();
    expect((await decide(prepared.approvalId, 'approved', member)).statusCode).toBe(403);
    expect((await decide(prepared.approvalId, 'approved', viewer)).statusCode).toBe(403);
    expect([403, 404]).toContain((await decide(prepared.approvalId, 'approved', otherWorkspaceOwner)).statusCode);
    expect([403, 404]).toContain((await getPlan(prepared.planId, otherWorkspaceOwner)).statusCode);
    expect(sendCalls()).toBe(0);

    // The owner reconnects a different Google account before approving: the bound sender no longer matches.
    profileEmail = 'someone.else@gmail.com';
    await connect();
    expect((await decide(prepared.approvalId, 'approved')).statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(prepared.planId);
    expect(sendCalls()).toBe(0);
    const plan = await getPlan(prepared.planId);
    expect(plan.body.steps[0].status).toBe('failed');
    expect(plan.body.receipts[0].proof.code).toBe('GMAIL_ACCOUNT_MISMATCH');
  });

  it('records an uncertain provider result as unverified and never retries automatically', async () => {
    await connect();
    const first = (await prepare({ to: 'target@person.example', bodyText: 'Maybe sent' })).json();
    sendMode = 'uncertain503';
    await decide(first.approvalId, 'approved');
    await waitForChatPlanBackgroundExecution(first.planId);
    expect(sendCalls()).toBe(1);
    const plan = await getPlan(first.planId);
    expect(plan.body.steps[0].status).toBe('unverified');
    expect(plan.body.receipts[0].status).toBe('unverified');

    sendMode = 'no_id';
    const second = (await prepare({ to: 'target@person.example', bodyText: 'No id' })).json();
    await decide(second.approvalId, 'approved');
    await waitForChatPlanBackgroundExecution(second.planId);
    expect((await getPlan(second.planId)).body.steps[0].status).toBe('unverified');

    sendMode = 'rejected400';
    const third = (await prepare({ to: 'target@person.example', bodyText: 'Rejected' })).json();
    await decide(third.approvalId, 'approved');
    await waitForChatPlanBackgroundExecution(third.planId);
    expect((await getPlan(third.planId)).body.steps[0].status).toBe('failed');
    expect(sendCalls()).toBe(3);
  });

  it('runs LIVE Gmail search through the provider: newly received mail, sender and recipient addresses, Gmail operators and All Mail', async () => {
    await connect();
    const search = async (query: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/connectors/gmail/messages/search',
        headers: headers(),
        payload: { query, limit: 10 }
      });
      expect(res.statusCode).toBe(200);
      return (res.json().messages as Array<{ id: string }>).map((m) => m.id);
    };
    expect(await search('in:inbox')).toContain('msg_new_arrival_01');
    expect(await search('partner.desk@client.example')).toEqual(['msg_new_arrival_01']);
    expect(await search('to:investor@fund.example')).toEqual(['msg_sent_03']);
    expect(await search('in:anywhere -in:spam -in:trash from:ram@partner.example')).toEqual(['msg_ram_02']);
    expect(await search('never.contacted@nowhere.example')).toEqual([]);
    expect(searchQueries).toContain('in:anywhere -in:spam -in:trash from:ram@partner.example');
  });

  it('detects simple chat send commands, thank-you emails, edits and follow-ups', () => {
    expect(detectGmailChatRequest('Thaara, send hi to [example@gmail.com](mailto:example@gmail.com).')).toMatchObject({
      kind: 'compose_new_email',
      compose: { to: 'example@gmail.com', subject: null, body: 'Hi' }
    });
    expect(
      detectGmailChatRequest('Thaara, send an email to example@gmail.com saying hi, will you come tomorrow?')
    ).toMatchObject({ kind: 'compose_new_email', compose: { to: 'example@gmail.com', body: 'Hi, will you come tomorrow?' } });
    expect(parseComposeRequest('send a thank-you email to example@gmail.com')).toMatchObject({
      to: 'example@gmail.com',
      subject: 'Thank you',
      generated: 'thank_you'
    });
    expect(parseComposeRequest('send an email to example@gmail.com with subject "Plans" saying see you soon')).toMatchObject({
      subject: 'Plans',
      body: 'See you soon'
    });
    expect(detectGmailChatRequest('Change it to hi, will you come tomorrow?')).toMatchObject({
      kind: 'edit_pending_email',
      edit: { field: 'body', value: 'Hi, will you come tomorrow?' }
    });
    expect(detectGmailChatRequest('Change the subject to Lunch')).toMatchObject({ edit: { field: 'subject', value: 'Lunch' } });
    expect(detectGmailChatRequest('Send it.')).toMatchObject({ kind: 'send_approved_reply', generic: true });
    expect(detectGmailChatRequest('Cancel it')).toMatchObject({ kind: 'cancel_pending_reply', generic: true });
    expect(detectGmailChatRequest('Thaara, reply to the latest email from Ram.')).toMatchObject({
      kind: 'prepare_reply',
      replyRequest: { senderFilter: 'Ram', forceLatest: true, generatedBody: true }
    });
    expect(detectGmailChatRequest('Thaara, check my latest 5 emails.')).toEqual({ kind: 'read_latest', query: 'in:inbox', limit: 5 });
    expect(detectGmailChatRequest('Thaara, search emails from example@gmail.com.')).toMatchObject({
      kind: 'search_emails',
      query: 'from:example@gmail.com'
    });
    expect(detectGmailChatRequest('Show emails I sent to investor@fund.example')).toMatchObject({ query: 'to:investor@fund.example' });
    // Inbound questions are never treated as send requests.
    expect(detectGmailChatRequest('Did Ram send me an email?')?.kind).not.toBe('compose_new_email');
  });

  it('falls back to normal chat for "send it" / "change it" when there is no Gmail draft, and denies viewers', async () => {
    const generic = detectGmailChatRequest('Send it.')!;
    const outcome = await executeChatGmailRequest(owner.scope, generic, { db, gmail: foundation, conversationId: 'no-draft-here' });
    expect(outcome.handled).toBe(false);
    const viewerOutcome = await executeChatGmailRequest(viewer.scope, detectGmailChatRequest('send hi to a@b.example')!, {
      db,
      gmail: foundation
    });
    expect(viewerOutcome.assistantResponseText).toBe("You don't have permission to send email from this workspace.");
  });

  it('sends a new email from chat only after explicit approval, edits the same draft across turns, and answers in simple English', async () => {
    await connect();
    const conv = await conversation(owner, 'Step 106 chat send');

    const draft = await chat(owner, conv, 'Thaara, send hi to [new.person@example.org](mailto:new.person@example.org).');
    expect(draft.text).toContain('Your email is ready. Shall I send it?');
    expect(draft.text).toContain('To: new.person@example.org');
    expect(draft.text).toContain('Subject: (none)');
    expect(draft.text).toContain('Message:\nHi');
    expect(draft.text).toContain('No email has been sent yet.');
    expect(draft.text).not.toMatch(TECHNICAL_WORDS);
    expect(draft.metadata.plan_status).toBe('awaiting_approval');
    const firstPlanId = String(draft.metadata.plan_id);
    expect(sendCalls()).toBe(0);

    const edited = await chat(owner, conv, 'Change it to hi, will you come tomorrow?');
    expect(edited.text).toContain('I updated your email. Shall I send it?');
    expect(edited.text).toContain('To: new.person@example.org');
    expect(edited.text).toContain('Hi, will you come tomorrow?');
    const planId = String(edited.metadata.plan_id);
    const approvalId = String(edited.metadata.approval_id);
    expect(planId).not.toBe(firstPlanId);
    expect((await getPlan(firstPlanId)).body.status).toBe('cancelled');

    const notYet = await chat(owner, conv, 'Send it.');
    expect(notYet.text).toContain('ready but has not been sent');
    expect(notYet.text).toContain('Confirm & Send');
    expect(sendCalls()).toBe(0);

    expect((await decide(approvalId, 'approved')).statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(planId);
    expect(sendCalls()).toBe(1);
    expect(sent[0]!.raw).toContain('To: new.person@example.org');
    expect(sent[0]!.raw).toContain('Hi, will you come tomorrow?');

    const result = await chat(owner, conv, 'Send it.');
    expect(result.text).toBe('Email sent to new.person@example.org.');
    expect(sendCalls()).toBe(1);
    const verifiedPlan = await getPlan(planId);
    expect(verifiedPlan.body.steps[0].status).toBe('verified');
    expect(verifiedPlan.body.receipts[0].status).toBe('verified');
    expect(verifiedPlan.body.receipts[0].proof).toMatchObject({
      status: 'accepted_by_gmail',
      to: 'new.person@example.org'
    });

    const thanks = await chat(owner, conv, 'Send a thank-you email to helper@example.org');
    expect(thanks.text).toContain('Subject: Thank you');
    expect(thanks.text).toContain('Thank you so much. I really appreciate it.');
    const cancelled = await chat(owner, conv, 'Cancel it');
    expect(cancelled.text).toBe('Okay, I cancelled the email. No email was sent.');
    expect(sendCalls()).toBe(1);
  });

  it('reads, searches and prepares replies in simple English, and keeps other users isolated', async () => {
    await connect();
    const conv = await conversation(owner, 'Step 106 chat read');
    const latest = await chat(owner, conv, 'Thaara, check my latest 5 emails.');
    expect(latest.text).toMatch(/^Here are your latest \d+ emails:/);
    expect(latest.text).toContain('Just arrived: contract draft');
    expect(latest.text).not.toMatch(TECHNICAL_WORDS);
    expect(latest.text).not.toContain('ya29.');

    const fromSearch = await chat(owner, conv, 'Thaara, search emails from ram@partner.example.');
    expect(fromSearch.text).toContain('I found 1 email from ram@partner.example:');
    const none = await chat(owner, conv, 'Search emails from never.contacted@nowhere.example');
    expect(none.text).toContain('No emails found from never.contacted@nowhere.example.');

    const reply = await chat(owner, conv, 'Thaara, reply to the latest email from Ram.');
    expect(reply.text).toContain('I wrote a short reply. Shall I send it?');
    expect(reply.text).toContain('To: ram@partner.example');
    expect(reply.text).toContain('Subject: Re: Lunch tomorrow?');
    expect(reply.text).not.toMatch(TECHNICAL_WORDS);
    expect(sendCalls()).toBe(0);

    const memberConv = await conversation(member, 'Member isolation');
    const memberGeneric = await executeChatGmailRequest(member.scope, detectGmailChatRequest('Send it.')!, {
      db,
      gmail: foundation,
      conversationId: memberConv
    });
    expect(memberGeneric.handled).toBe(false);
    const memberTurn = await chat(member, memberConv, 'Send the email.');
    expect(memberTurn.text).toContain('There is no email waiting to be sent');
    expect(memberTurn.text).not.toContain('ram@partner.example');
    const memberRead = await chat(member, memberConv, 'Show my latest emails.');
    expect(memberRead.text).toContain('Gmail is not connected yet.');
    expect(memberRead.text).not.toContain('founder.live@gmail.com');
  });

  it('Step 106.3: supports informal English chat commands, preserves recipient and draft across turns, and handles "okay send it" without bypassing approval', async () => {
    // Disconnected state returns clear connect prompt
    const disconv = await conversation(owner, 'Disconnected send');
    const disTurn = await chat(owner, disconv, 'send gmail to krishnakitty4634@gmail.com like hw will come tomorrow');
    expect(disTurn.text).toContain('Please connect Gmail to send emails.');
    expect(sendCalls()).toBe(0);

    await connect();
    const conv1 = await conversation(owner, 'Informal send 1');

    // 1. Informal "like" phrasing in a single turn creates a real governed plan + approval
    const turn1 = await chat(owner, conv1, 'send gmail to [krishnakitty4634@gmail.com](mailto:krishnakitty4634@gmail.com) like hw will come tomorrow');
    expect(turn1.text).toContain('Your email is ready. Shall I send it?');
    expect(turn1.text).toContain('To: krishnakitty4634@gmail.com');
    expect(turn1.text).toContain('Subject: (none)');
    expect(turn1.text).toContain('Hw will come tomorrow');
    expect(turn1.metadata.plan_status).toBe('awaiting_approval');
    expect(turn1.metadata.plan_id).toBeTruthy();
    expect(turn1.metadata.approval_id).toBeTruthy();
    expect(sendCalls()).toBe(0);

    // 2. Follow-up plain message updates the pending draft in the same conversation without re-asking for recipient
    const turn2 = await chat(owner, conv1, 'Hi, will you come tomorrow?');
    expect(turn2.text).toContain('I updated your email. Shall I send it?');
    expect(turn2.text).toContain('To: krishnakitty4634@gmail.com');
    expect(turn2.text).toContain('Hi, will you come tomorrow?');
    expect(turn2.metadata.plan_status).toBe('awaiting_approval');
    const updatedPlanId = String(turn2.metadata.plan_id);
    const updatedApprovalId = String(turn2.metadata.approval_id);
    expect(updatedPlanId).not.toBe(String(turn1.metadata.plan_id));
    expect((await getPlan(String(turn1.metadata.plan_id))).body.status).toBe('cancelled');
    expect(sendCalls()).toBe(0);

    // 3. "okay send it" and "yes" reference the pending approval card without sending or falling through to OpenAI
    const okayTurn = await chat(owner, conv1, 'okay send it');
    expect(okayTurn.text).toContain('ready but has not been sent');
    expect(okayTurn.text).toContain('Approve & Send (Confirm & Send)');
    expect(okayTurn.text).not.toMatch(/cannot send emails/i);
    expect(okayTurn.metadata.plan_id).toBe(updatedPlanId);
    expect(okayTurn.metadata.approval_id).toBe(updatedApprovalId);
    expect(sendCalls()).toBe(0);

    const yesTurn = await chat(owner, conv1, 'yes');
    expect(yesTurn.text).toContain('ready but has not been sent');
    expect(yesTurn.metadata.approval_id).toBe(updatedApprovalId);
    expect(sendCalls()).toBe(0);

    // 4. Multi-turn flow where user gives only recipient first, then supplies message in next turn
    const conv2 = await conversation(owner, 'Multi-turn recipient then body');
    const askBody = await chat(owner, conv2, 'Send an email to krishnakitty4634@gmail.com');
    expect(askBody.text).toContain('What should the email to krishnakitty4634@gmail.com say?');
    expect(sendCalls()).toBe(0);

    const supplyBody = await chat(owner, conv2, 'Hi, will you come tomorrow?');
    expect(supplyBody.text).toContain('Your email is ready. Shall I send it?');
    expect(supplyBody.text).toContain('To: krishnakitty4634@gmail.com');
    expect(supplyBody.text).toContain('Hi, will you come tomorrow?');
    expect(supplyBody.metadata.plan_status).toBe('awaiting_approval');
    const conv2PlanId = String(supplyBody.metadata.plan_id);
    const conv2ApprovalId = String(supplyBody.metadata.approval_id);
    expect(sendCalls()).toBe(0);

    // 5. Conversational prefix + full command ("yes Send an email to ... saying ...") replaces prior draft cleanly
    const prefixedFull = await chat(
      owner,
      conv2,
      'yes Send an email to krishnakitty4634@gmail.com saying Hi, will you come tomorrow?'
    );
    expect(prefixedFull.text).toContain('Your email is ready. Shall I send it?');
    expect(prefixedFull.text).toContain('To: krishnakitty4634@gmail.com');
    expect(prefixedFull.text).toContain('Hi, will you come tomorrow?');
    const finalPlanId = String(prefixedFull.metadata.plan_id);
    const finalApprovalId = String(prefixedFull.metadata.approval_id);
    expect(finalPlanId).not.toBe(conv2PlanId);
    expect((await getPlan(conv2PlanId)).body.status).toBe('cancelled');
    expect(sendCalls()).toBe(0);

    // 6. Explicit approval sends once and produces truthful receipt + "Email sent to krishnakitty4634@gmail.com."
    expect((await decide(finalApprovalId, 'approved')).statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(finalPlanId);
    expect(sendCalls()).toBe(1);
    expect(sent[0]!.raw).toContain('To: krishnakitty4634@gmail.com');
    expect(sent[0]!.raw).toContain('Hi, will you come tomorrow?');

    const afterSend = await chat(owner, conv2, 'okay send it');
    expect(afterSend.text).toBe('Email sent to krishnakitty4634@gmail.com.');
    expect(sendCalls()).toBe(1);
  });

  it('Step 106.3: prepares and sends governed Inbox Reply, Reply All (with Cc and header-only recipients), and Forward with cross-user protection and double-send prevention', async () => {
    await connect();

    // 1. Single Reply via POST /api/v1/connectors/gmail/messages/send-reply
    const singleReplyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/gmail/messages/send-reply',
      headers: headers(owner),
      payload: {
        sourceMessageId: 'msg_ram_02',
        bodyText: 'Yes, 1 PM works for me!'
      }
    });
    expect(singleReplyRes.statusCode).toBe(200);
    const singleReply = singleReplyRes.json();
    expect(singleReply).toMatchObject({
      status: 'awaiting_approval',
      from: 'founder.live@gmail.com',
      to: 'ram@partner.example',
      subject: 'Re: Lunch tomorrow?',
      bodyText: 'Yes, 1 PM works for me!',
      threadId: 'thr_ram_02',
      sourceMessageId: 'msg_ram_02'
    });
    expect(singleReply.cc).toBeUndefined();
    expect(sendCalls()).toBe(0);

    // Cross-user and cross-workspace approval attempts are rejected
    expect((await decide(singleReply.approvalId, 'approved', member)).statusCode).toBe(403);
    expect([403, 404]).toContain((await decide(singleReply.approvalId, 'approved', otherWorkspaceOwner)).statusCode);
    expect(sendCalls()).toBe(0);

    // Cancel single reply -> never sends
    expect((await decide(singleReply.approvalId, 'rejected', owner)).statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(singleReply.planId);
    expect(sendCalls()).toBe(0);

    // 2. Reply All via POST /api/v1/connectors/gmail/messages/send-reply (replyAll: true)
    // Derives recipients strictly from From/To/Cc headers (excludes connectedEmail founder.live@gmail.com, deduplicates ram@partner.example, and never includes body email trap@body-only.example)
    const replyAllRes = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/gmail/messages/send-reply',
      headers: headers(owner),
      payload: {
        sourceMessageId: 'msg_ram_02',
        replyAll: true,
        bodyText: 'Adding everyone — see you tomorrow at 1 PM.'
      }
    });
    expect(replyAllRes.statusCode).toBe(200);
    const replyAll = replyAllRes.json();
    expect(replyAll).toMatchObject({
      status: 'awaiting_approval',
      from: 'founder.live@gmail.com',
      to: 'ram@partner.example',
      cc: 'team.lead@partner.example, anita@partner.example',
      subject: 'Re: Lunch tomorrow?',
      bodyText: 'Adding everyone — see you tomorrow at 1 PM.',
      threadId: 'thr_ram_02',
      sourceMessageId: 'msg_ram_02'
    });
    expect(JSON.stringify(replyAll)).not.toContain('trap@body-only.example');
    expect(sendCalls()).toBe(0);

    // Approve Reply All -> sends once with threadId, In-Reply-To, References, and Cc headers
    expect((await decide(replyAll.approvalId, 'approved', owner)).statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(replyAll.planId);
    expect(sendCalls()).toBe(1);
    expect(sent[0]!.threadId).toBe('thr_ram_02');
    expect(sent[0]!.raw).toContain('To: ram@partner.example');
    expect(sent[0]!.raw).toContain('Cc: team.lead@partner.example, anita@partner.example');
    expect(sent[0]!.raw).toContain('Subject: Re: Lunch tomorrow?');
    expect(sent[0]!.raw).toContain('In-Reply-To: <msg_ram_02@mail.example>');
    expect(sent[0]!.raw).toContain('References: <msg_ram_02@mail.example>');
    expect(sent[0]!.raw).not.toContain('trap@body-only.example');

    // Duplicate approval attempt is a no-op
    expect((await decide(replyAll.approvalId, 'approved', owner)).statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(replyAll.planId);
    expect(sendCalls()).toBe(1);

    const replyAllPlan = await getPlan(replyAll.planId);
    expect(replyAllPlan.body.steps[0].action_name).toBe('gmail.messages.send_reply');
    expect(replyAllPlan.body.steps[0].status).toBe('verified');
    expect(replyAllPlan.body.receipts[0].proof).toMatchObject({
      status: 'accepted_by_gmail',
      to: 'ram@partner.example',
      cc: 'team.lead@partner.example, anita@partner.example',
      providerThreadId: 'thr_ram_02',
      sourceMessageId: 'msg_ram_02'
    });

    // 3. Forward via governed send-new endpoint requires validated manual recipient and explicit approval
    const forwardRes = await prepare({
      to: 'colleague@company.example',
      subject: 'Fwd: Lunch tomorrow?',
      bodyText: 'FYI — see forwarded message below.\n\n---------- Forwarded message ---------\nFrom: Ram Kumar <ram@partner.example>\nSubject: Lunch tomorrow?\n\nAre you free for lunch tomorrow?'
    });
    expect(forwardRes.statusCode).toBe(200);
    const forwardPrepared = forwardRes.json();
    expect(forwardPrepared.status).toBe('awaiting_approval');
    expect(sendCalls()).toBe(1);

    expect((await decide(forwardPrepared.approvalId, 'approved', owner)).statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(forwardPrepared.planId);
    expect(sendCalls()).toBe(2);
    expect(sent[1]!.raw).toContain('To: colleague@company.example');
    expect(sent[1]!.raw).toContain('Subject: Fwd: Lunch tomorrow?');
    expect(sent[1]!.raw).toContain('---------- Forwarded message ---------');
  });
});
