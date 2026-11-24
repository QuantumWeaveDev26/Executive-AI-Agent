import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { canUserDecideApproval } from '../src/api';
import { GmailScreenView } from '../src/GmailScreen';
import { initialGmailState, createGmailModel } from '../src/gmail-model';
import {
  CalendarScreenView,
  buildRfc3339FromDateAndTime,
  extractDateAndTimeInZone,
} from '../src/CalendarScreen';
import { CalendarMutationChatCard } from '../src/CalendarMutationCard';
import { initialCalendarState, createCalendarModel } from '../src/calendar-model';

describe('Step 101 — Live Google Connection UI & Mock/Live Separation', () => {
  it('enables Connect Gmail button when live OAuth is configured and disconnected, and displays Connected (LIVE) when connected', async () => {
    const liveDisconnectedState = {
      ...initialGmailState('member'),
      status: {
        connectorName: 'gmail' as const,
        status: 'disconnected' as const,
        configured: true,
        connected: false,
        mode: 'live' as const,
        scopes: [],
        lastVerifiedAt: null
      }
    };

    const onConnect = vi.fn();
    const disconnectedHtml = renderToStaticMarkup(
      <GmailScreenView
        state={liveDisconnectedState}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        onConnect={onConnect}
      />
    );
    expect(disconnectedHtml).toContain('Disconnected');
    expect(disconnectedHtml).toContain('LIVE (Google OAuth 2.0)');
    expect(disconnectedHtml).not.toMatch(/<button[^>]*disabled=""[^>]*>Connect Gmail<\/button>/);

    const liveConnectedState = {
      ...liveDisconnectedState,
      status: {
        ...liveDisconnectedState.status,
        status: 'connected' as const,
        connected: true,
        scopes: ['https://www.googleapis.com/auth/gmail.readonly']
      },
      searched: true,
      rows: [
        {
          id: 'msg_live_1',
          from: 'Board Secretary <secretary@board.example>',
          subject: 'Live Agenda Packet',
          snippet: 'Attached is the live packet.',
          date: '2026-10-22T09:00:00Z',
          isUnread: true
        }
      ]
    };

    const connectedHtml = renderToStaticMarkup(
      <GmailScreenView
        state={liveConnectedState}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        onConnect={onConnect}
      />
    );
    expect(connectedHtml).toContain('Connected (LIVE)');
    expect(connectedHtml).toContain('secretary@board.example');
    expect(connectedHtml).toContain('Live Agenda Packet');
  });

  it('enables Connect Google Calendar button in live disconnected state and shows Connected (LIVE) when connected', () => {
    const liveDisconnectedCal = {
      ...initialCalendarState('member', { timeZone: 'Asia/Kolkata' }),
      status: {
        connectorName: 'google_calendar' as const,
        status: 'disconnected' as const,
        configured: true,
        connected: false,
        mode: 'live' as const,
        scopes: [],
        lastVerifiedAt: null
      }
    };

    const disconnectedHtml = renderToStaticMarkup(
      <CalendarScreenView
        state={liveDisconnectedCal}
        timeZoneDraft="Asia/Kolkata"
        onTimeZoneDraft={() => {}}
        onApplyTimeZone={() => {}}
        onToday={() => {}}
        onPrevRange={() => {}}
        onNextRange={() => {}}
        onToggleCancelled={() => {}}
        onSelectEvent={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        onConnect={() => {}}
      />
    );
    expect(disconnectedHtml).toContain('Disconnected');
    expect(disconnectedHtml).toContain('LIVE (Google OAuth 2.0)');
    expect(disconnectedHtml).not.toMatch(
      /<button[^>]*disabled=""[^>]*>Connect Google Calendar<\/button>/
    );

    const liveConnectedCal = {
      ...liveDisconnectedCal,
      status: {
        ...liveDisconnectedCal.status,
        status: 'connected' as const,
        connected: true,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly']
      }
    };

    const connectedHtml = renderToStaticMarkup(
      <CalendarScreenView
        state={liveConnectedCal}
        timeZoneDraft="Asia/Kolkata"
        onTimeZoneDraft={() => {}}
        onApplyTimeZone={() => {}}
        onToday={() => {}}
        onPrevRange={() => {}}
        onNextRange={() => {}}
        onToggleCancelled={() => {}}
        onSelectEvent={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        onConnect={() => {}}
      />
    );
    expect(connectedHtml).toContain('Connected (LIVE)');
  });

  it('initiates OAuth start via createGmailModel.connect and createCalendarModel.connect only in live mode', async () => {
    const states: any[] = [];
    const gmailModel = createGmailModel(
      'member',
      (s) => states.push(s),
      {
        status: async () => ({
          connectorName: 'gmail',
          status: 'disconnected',
          configured: true,
          connected: false,
          mode: 'live',
          scopes: [],
          lastVerifiedAt: null
        }),
        startOAuth: async () => ({
          authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=live_state',
          expiresAt: '2026-10-22T10:00:00Z',
          mode: 'live'
        }),
        search: async () => ({ messages: [], untrusted: true, mode: 'live' }),
        read: async (id) => ({ id, untrusted: true, mode: 'live' }),
        disconnect: async () => ({
          connectorName: 'gmail',
          status: 'disconnected',
          configured: true,
          connected: false,
          mode: 'live',
          scopes: [],
          lastVerifiedAt: null
        })
      }
    );

    await gmailModel.loadStatus();
    const url = await gmailModel.connect();
    expect(url).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=live_state');

    const calModel = createCalendarModel('member', () => {}, {
      status: async () => ({
        connectorName: 'google_calendar',
        status: 'reconnect_required',
        configured: true,
        connected: false,
        mode: 'live',
        scopes: [],
        lastVerifiedAt: null
      }),
      startOAuth: async () => ({
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=cal_live_state',
        expiresAt: '2026-10-22T10:00:00Z',
        mode: 'live'
      }),
      agenda: async (q) => ({
        windowStart: q.windowStart,
        windowEnd: q.windowEnd,
        timeZone: q.timeZone,
        totalEvents: 0,
        conflictEventIds: [],
        days: [],
        n8nContext: {
          connector: 'google_calendar',
          operation: 'read_agenda_snapshot',
          readOnly: true,
          timeZone: q.timeZone,
          windowStart: q.windowStart,
          windowEnd: q.windowEnd,
          eventIds: []
        },
        untrusted: true,
        mode: 'live'
      }),
      readEvent: async () => {
        throw new Error('none');
      },
      disconnect: async () => ({
        connectorName: 'google_calendar',
        status: 'disconnected',
        configured: true,
        connected: false,
        mode: 'live',
        scopes: [],
        lastVerifiedAt: null
      })
    });

    await calModel.loadStatus();
    const calUrl = await calModel.connect();
    expect(calUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=cal_live_state');
  });

  it('Step 104.1: displays "Connected as: email@example.com" from authorized Gmail profile, never assumes Thaara login email, and clears identity on disconnect', async () => {
    let connected = true;
    const model = createGmailModel('owner', () => {}, {
      status: async () => ({
        connectorName: 'gmail',
        status: connected ? 'connected' : 'disconnected',
        configured: true,
        connected,
        mode: 'live',
        scopes: connected ? ['https://www.googleapis.com/auth/gmail.readonly'] : [],
        lastVerifiedAt: '2026-10-23T05:00:00Z',
        ...(connected ? { connectedEmail: 'real.gmail.account@gmail.com' } : {})
      }),
      search: async () => ({ messages: [], untrusted: true, mode: 'live' }),
      read: async (id) => ({ id, untrusted: true, mode: 'live' }),
      disconnect: async () => {
        connected = false;
        return {
          connectorName: 'gmail',
          status: 'disconnected',
          configured: true,
          connected: false,
          mode: 'live',
          scopes: [],
          lastVerifiedAt: null
        };
      }
    });

    await model.loadStatus();
    const connectedHtml = renderToStaticMarkup(
      <GmailScreenView
        state={model.getState()}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        userEmail="thaara-login-user@workspace.test"
      />
    );

    expect(connectedHtml).toContain('Connected as: real.gmail.account@gmail.com');
    expect(connectedHtml).not.toContain('Connected as: thaara-login-user@workspace.test');

    // Disconnect clears connected account identity immediately
    await model.disconnect();
    const disconnectedHtml = renderToStaticMarkup(
      <GmailScreenView
        state={model.getState()}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        userEmail="thaara-login-user@workspace.test"
      />
    );
    expect(disconnectedHtml).not.toContain('Connected as:');
    expect(disconnectedHtml).not.toContain('real.gmail.account@gmail.com');
  });

  it('Step 104.2: executes provider-backed Gmail search (including Gmail operators, body matches, newly received messages beyond initial 10, refresh, and next/prev pagination)', async () => {
    let newestArrived = false;
    const searchCalls: Array<{ query: string; pageToken?: string }> = [];

    const model = createGmailModel('owner', () => {}, {
      status: async () => ({
        connectorName: 'gmail',
        status: 'connected',
        configured: true,
        connected: true,
        mode: 'live',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        lastVerifiedAt: '2026-10-23T05:00:00Z',
        connectedEmail: 'exec.live@gmail.com'
      }),
      search: async (query, pageToken) => {
        searchCalls.push({ query, pageToken });
        if (query === 'from:new-sender@partner.example newer_than:1d') {
          return {
            messages: newestArrived ? [{ id: 'msg_new_11' }] : [],
            untrusted: true,
            mode: 'live'
          };
        }
        if (pageToken === 'page_2_token') {
          return {
            messages: [{ id: 'msg_page_2' }],
            untrusted: true,
            mode: 'live'
          };
        }
        return {
          messages: [{ id: 'msg_page_1' }],
          nextPageToken: 'page_2_token',
          untrusted: true,
          mode: 'live'
        };
      },
      read: async (id) => {
        if (id === 'msg_new_11') {
          return {
            id: 'msg_new_11',
            from: 'New Partner <new-sender@partner.example>',
            to: 'exec.live@gmail.com',
            subject: 'Just Arrived Contract',
            snippet: 'Short snippet without search keyword',
            bodyText: 'Full body containing confidential-keyword-99',
            date: '2026-10-23T05:15:00Z',
            isUnread: true,
            untrusted: true,
            mode: 'live'
          };
        }
        return {
          id,
          from: 'colleague@company.example',
          to: 'exec.live@gmail.com',
          subject: id === 'msg_page_2' ? 'Older Page 2 Email' : 'Initial Page 1 Email',
          snippet: 'Page snippet',
          date: '2026-10-22T09:00:00Z',
          isUnread: false,
          untrusted: true,
          mode: 'live'
        };
      },
      disconnect: async () => ({
        connectorName: 'gmail',
        status: 'disconnected',
        configured: true,
        connected: false,
        mode: 'live',
        scopes: [],
        lastVerifiedAt: null
      })
    });

    await model.loadStatus();
    expect(model.getState().rows.map((r) => r.id)).toEqual(['msg_page_1']);
    expect(model.getState().pageNumber).toBe(1);
    expect(model.getState().canPrevPage).toBe(false);

    // Typing an unsubmitted query into draft must NOT hide the currently loaded inbox rows before Search is clicked
    const unsubmittedDraftHtml = renderToStaticMarkup(
      <GmailScreenView
        state={model.getState()}
        draft="from:new-sender@partner.example newer_than:1d"
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
      />
    );
    expect(unsubmittedDraftHtml).toContain('Initial Page 1 Email');

    // Infinite scroll: loading more appends Page 2 without clearing Page 1 or losing selection
    await model.select('msg_page_1');
    expect(model.getState().preview?.id).toBe('msg_page_1');

    await model.loadMore();
    expect(model.getState().rows.map((r) => r.id)).toEqual(['msg_page_1', 'msg_page_2']);
    expect(model.getState().pageNumber).toBe(2);
    expect(model.getState().selectedId).toBe('msg_page_1');
    expect(model.getState().preview?.id).toBe('msg_page_1');
    expect(model.getState().nextPageToken).toBeUndefined();

    const appendedHtml = renderToStaticMarkup(
      <GmailScreenView
        state={model.getState()}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
      />
    );
    expect(appendedHtml).toContain('Initial Page 1 Email');
    expect(appendedHtml).toContain('Older Page 2 Email');
    expect(appendedHtml).not.toContain('Previous page');
    expect(appendedHtml).not.toContain('Next page');

    // Search for a newly received email using Gmail operators; initially not yet arrived -> honest empty state
    await model.search('from:new-sender@partner.example newer_than:1d');
    expect(model.getState().rows).toEqual([]);

    // Now the new email arrives in Gmail; refreshing re-runs the active search query and finds it!
    newestArrived = true;
    await model.loadStatus();
    expect(model.getState().query).toBe('from:new-sender@partner.example newer_than:1d');
    expect(model.getState().rows.map((r) => r.id)).toEqual(['msg_new_11']);

    // Even when draft still holds the Gmail operator query, GmailScreenView renders the provider-matched message!
    const foundHtml = renderToStaticMarkup(
      <GmailScreenView
        state={model.getState()}
        draft="from:new-sender@partner.example newer_than:1d"
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
      />
    );
    expect(foundHtml).toContain('Just Arrived Contract');
    expect(foundHtml).toContain('new-sender@partner.example');
    expect(foundHtml).toContain('Query: from:new-sender@partner.example newer_than:1d');
    expect(foundHtml).toContain('Back to Inbox');
    expect(foundHtml).toContain('Clear Search');

    // Back to Inbox resets active search query and reloads inbox
    await model.backToInbox();
    expect(model.getState().query).toBe('in:inbox');
    expect(model.getState().rows.map((r) => r.id)).toEqual(['msg_page_1']);
  });

  it('Step 104.3 & Step 106: composes and sends an approval-gated email to an unknown recipient (with optional subject), prompts to reconnect when gmail.send is missing, and clears state on disconnect', async () => {
    let scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send'
    ];
    let approvedCount = 0;
    let cancelledCount = 0;

    const model = createGmailModel(
      'owner',
      () => {},
      {
        status: async () => ({
          connectorName: 'gmail',
          status: 'connected',
          configured: true,
          connected: true,
          mode: 'live',
          scopes,
          lastVerifiedAt: '2026-10-23T05:00:00Z',
          connectedEmail: 'founder@thaara.example'
        }),
        search: async () => ({ messages: [], untrusted: true, mode: 'live' }),
        read: async (id) => ({ id, untrusted: true, mode: 'live' }),
        disconnect: async () => ({
          connectorName: 'gmail',
          status: 'disconnected',
          configured: true,
          connected: false,
          mode: 'live',
          scopes: [],
          lastVerifiedAt: null
        }),
        prepareSend: async (input) => ({
          status: 'awaiting_approval',
          planId: 'plan-send-106',
          stepId: 'step-send-106',
          approvalId: 'approval-send-106',
          from: 'founder@thaara.example',
          to: input.to,
          ...(input.subject ? { subject: input.subject } : {}),
          bodyText: input.bodyText
        }),
        approveSend: async () => {
          approvedCount += 1;
        },
        sendOutcome: async (prepared) => ({
          kind: 'sent',
          to: prepared.to,
          providerMessageId: 'gmail_msg_106'
        }),
        cancelSend: async () => {
          cancelledCount += 1;
        }
      },
      { outcomePollMs: 5 }
    );

    await model.loadStatus();
    expect(model.getState().rows).toEqual([]);

    // Searching an unknown email address shows "No existing emails found.", "Compose email to <address>", and "Back to Inbox"
    await model.search('first.contact@external-org.example');
    const emptySearchHtml = renderToStaticMarkup(
      <GmailScreenView
        state={model.getState()}
        draft="first.contact@external-org.example"
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        onOpenCompose={(init) => model.openCompose(init)}
      />
    );
    expect(emptySearchHtml).toContain('No existing emails found.');
    expect(emptySearchHtml).toContain('Compose email to first.contact@external-org.example');
    expect(emptySearchHtml).toContain('Back to Inbox');
    expect(emptySearchHtml).toContain('Clear Search');

    model.openCompose({ to: 'first.contact@external-org.example' });
    expect(model.getState().composeOpen).toBe(true);
    expect(model.getState().composeDraft?.to).toBe('first.contact@external-org.example');

    // Rejects invalid recipient email address
    model.updateCompose({
      to: 'not-an-email',
      subject: '',
      bodyText: 'Hello there'
    });
    expect(await model.prepareSend()).toBeNull();
    expect(model.getState().composeError).toContain('Enter a valid email address');

    // Accepts a manually typed valid email address for a brand-new recipient with optional subject
    model.updateCompose({
      to: 'Brand New Contact <first.contact@external-org.example>',
      subject: '',
      bodyText: 'We would love to schedule an executive briefing next Tuesday.'
    });
    const prepared = await model.prepareSend();
    expect(prepared).toMatchObject({
      status: 'awaiting_approval',
      from: 'founder@thaara.example',
      to: 'first.contact@external-org.example',
      bodyText: 'We would love to schedule an executive briefing next Tuesday.'
    });
    expect(prepared?.subject).toBeUndefined();
    expect(approvedCount).toBe(0);

    const reviewHtml = renderToStaticMarkup(
      <GmailScreenView
        state={model.getState()}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        onConfirmSend={() => {}}
        onCancelSend={() => {}}
        onEditAgain={() => {}}
      />
    );
    expect(reviewHtml).toContain('Check your email');
    expect(reviewHtml).toContain('Approve &amp; Send (Confirm &amp; Send)');
    expect(reviewHtml).toContain('founder@thaara.example');
    expect(reviewHtml).toContain('first.contact@external-org.example');
    expect(reviewHtml).toContain('Subject:</strong> (none)');
    expect(reviewHtml).toContain('We would love to schedule an executive briefing next Tuesday.');

    const result = await model.confirmSend();
    expect(approvedCount).toBe(1);
    expect(result).toMatchObject({
      kind: 'sent',
      to: 'first.contact@external-org.example',
      message: 'Email sent to first.contact@external-org.example.'
    });

    // When gmail.send scope is missing, shows clear reconnect prompt
    scopes = ['https://www.googleapis.com/auth/gmail.readonly'];
    await model.loadStatus();
    const readonlyHtml = renderToStaticMarkup(
      <GmailScreenView
        state={model.getState()}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        onReconnect={() => {}}
      />
    );
    expect(readonlyHtml).toContain('Thaara can read your Gmail. To send emails, reconnect Gmail and allow sending.');
    expect(readonlyHtml).toContain('Reconnect Gmail');

    // Disconnecting clears the compose form and pending state immediately
    await model.disconnect();
    expect(model.getState().composeOpen).toBe(false);
    expect(model.getState().pendingSend).toBeNull();
    expect(model.getState().composeDraft).toEqual({ to: '', cc: '', subject: '', bodyText: '' });
    expect(cancelledCount).toBe(0);
  });

  it('Step 104.4: isolates connected Gmail account identity, search results, and compose drafts across user/workspace switches', async () => {
    // User A model with connected Gmail and prepared draft
    const modelUserA = createGmailModel('owner', () => {}, {
      status: async () => ({
        connectorName: 'gmail',
        status: 'connected',
        configured: true,
        connected: true,
        mode: 'live',
        scopes: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.send'
        ],
        lastVerifiedAt: '2026-10-23T05:00:00Z',
        connectedEmail: 'user.alpha.gmail@company.example'
      }),
      search: async () => ({
        messages: [{ id: 'msg_alpha_secret' }],
        untrusted: true,
        mode: 'live'
      }),
      read: async (id) => ({
        id,
        from: 'board@company.example',
        to: 'user.alpha.gmail@company.example',
        subject: 'User Alpha Confidential Merger',
        snippet: 'Alpha secret snippet',
        untrusted: true,
        mode: 'live'
      }),
      disconnect: async () => ({
        connectorName: 'gmail',
        status: 'disconnected',
        configured: true,
        connected: false,
        mode: 'live',
        scopes: [],
        lastVerifiedAt: null
      }),
      prepareSend: async (input) => ({
        status: 'awaiting_approval',
        planId: 'plan-alpha',
        stepId: 'step-alpha',
        approvalId: 'approval-alpha',
        from: 'user.alpha.gmail@company.example',
        to: input.to,
        subject: input.subject,
        bodyText: input.bodyText
      })
    });

    await modelUserA.loadStatus();
    modelUserA.updateCompose({
      to: 'new.recipient@external.example',
      subject: 'Alpha Private Draft',
      bodyText: 'Confidential draft body for Alpha'
    });
    await modelUserA.prepareSend();

    expect(modelUserA.getState().status?.connectedEmail).toBe('user.alpha.gmail@company.example');
    expect(modelUserA.getState().pendingSend?.subject).toBe('Alpha Private Draft');

    // Switch to User B: dispose User A model and initialize User B model (disconnected)
    modelUserA.dispose();
    const modelUserB = createGmailModel('member', () => {}, {
      status: async () => ({
        connectorName: 'gmail',
        status: 'disconnected',
        configured: true,
        connected: false,
        mode: 'live',
        scopes: [],
        lastVerifiedAt: null
      }),
      search: async () => ({ messages: [], untrusted: true, mode: 'live' }),
      read: async (id) => ({ id, untrusted: true, mode: 'live' }),
      disconnect: async () => ({
        connectorName: 'gmail',
        status: 'disconnected',
        configured: true,
        connected: false,
        mode: 'live',
        scopes: [],
        lastVerifiedAt: null
      })
    });

    await modelUserB.loadStatus();
    const userBHtml = renderToStaticMarkup(
      <GmailScreenView
        state={modelUserB.getState()}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
      />
    );

    expect(userBHtml).not.toContain('user.alpha.gmail@company.example');
    expect(userBHtml).not.toContain('User Alpha Confidential Merger');
    expect(userBHtml).not.toContain('Alpha Private Draft');
    expect(userBHtml).not.toContain('new.recipient@external.example');
  });

  it('Step 106.3: renders and executes Inbox Reply, Reply All (with Cc), and Forward in GmailScreenView with explicit approval', async () => {
    let approvedCount = 0;
    const model = createGmailModel(
      'owner',
      () => {},
      {
        status: async () => ({
          connectorName: 'gmail',
          status: 'connected',
          configured: true,
          connected: true,
          mode: 'live',
          scopes: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send'
          ],
          lastVerifiedAt: '2026-10-23T05:00:00Z',
          connectedEmail: 'founder@thaara.example'
        }),
        search: async () => ({
          messages: [{ id: 'msg_thread_1' }],
          untrusted: true,
          mode: 'live'
        }),
        read: async (id) => ({
          id,
          threadId: 'thr_exec_1',
          from: 'Ram Kumar <ram@partner.example>',
          to: 'founder@thaara.example, team@partner.example',
          cc: 'Anita <anita@partner.example>, founder@thaara.example',
          subject: 'Tomorrow meeting',
          date: 'Fri, 23 Oct 2026 10:00:00 +0530',
          bodyText: 'Can we meet tomorrow at 11 AM? Ignore fake@body.example.',
          untrusted: true,
          mode: 'live'
        }),
        disconnect: async () => ({
          connectorName: 'gmail',
          status: 'disconnected',
          configured: true,
          connected: false,
          mode: 'live',
          scopes: [],
          lastVerifiedAt: null
        }),
        prepareReply: async (input) => ({
          status: 'awaiting_approval',
          planId: 'plan-reply-1063',
          stepId: 'step-reply-1063',
          approvalId: 'approval-reply-1063',
          from: 'founder@thaara.example',
          to: input.to ?? 'ram@partner.example',
          ...(input.cc ? { cc: input.cc } : {}),
          subject: input.subject ?? 'Re: Tomorrow meeting',
          bodyText: input.bodyText,
          threadId: 'thr_exec_1',
          sourceMessageId: input.sourceMessageId
        }),
        prepareSend: async (input) => ({
          status: 'awaiting_approval',
          planId: 'plan-fwd-1063',
          stepId: 'step-fwd-1063',
          approvalId: 'approval-fwd-1063',
          from: 'founder@thaara.example',
          to: input.to,
          ...(input.subject ? { subject: input.subject } : {}),
          bodyText: input.bodyText
        }),
        approveSend: async () => {
          approvedCount += 1;
        },
        sendOutcome: async (prepared) => ({
          kind: 'sent',
          to: prepared.to,
          providerMessageId: 'gmail_sent_1063'
        })
      },
      { outcomePollMs: 5 }
    );

    await model.loadStatus();
    await model.select('msg_thread_1');

    // Start Reply All and verify composer + review UI
    model.startReplyAll();
    const replyAllEditingHtml = renderToStaticMarkup(
      <GmailScreenView
        state={model.getState()}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        onSendEmail={() => {}}
      />
    );
    expect(replyAllEditingHtml).toContain('Reply All');
    expect(replyAllEditingHtml).toContain('data-testid="gmail-compose-cc"');
    expect(replyAllEditingHtml).toContain('team@partner.example, anita@partner.example');
    expect(JSON.stringify(model.getState().composeDraft)).not.toContain('fake@body.example');

    model.updateCompose({ bodyText: 'Yes, 11 AM works for everyone.' });
    await model.prepareSend();
    expect(approvedCount).toBe(0);

    const replyAllReviewHtml = renderToStaticMarkup(
      <GmailScreenView
        state={model.getState()}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        onConfirmSend={() => {}}
        onCancelSend={() => {}}
        onEditAgain={() => {}}
      />
    );
    expect(replyAllReviewHtml).toContain('Recipient (To):</strong> ram@partner.example');
    expect(replyAllReviewHtml).toContain('Cc:</strong> team@partner.example, anita@partner.example');
    expect(replyAllReviewHtml).toContain('Subject:</strong> Re: Tomorrow meeting');
    expect(replyAllReviewHtml).toContain('Approve &amp; Send (Confirm &amp; Send)');

    const sentOutcome = await model.confirmSend();
    expect(approvedCount).toBe(1);
    expect(sentOutcome).toMatchObject({
      kind: 'sent',
      to: 'ram@partner.example',
      message: 'Email sent to ram@partner.example.'
    });
  });

  it('Step 107: renders Connected Calendar identity, queries exact Today / Next 7 Days / Previous 7 Days ranges in Asia/Kolkata, preserves active filter on Refresh, and collapses lengthy event descriptions behind Details', async () => {
    const fixedNowMs = Date.parse('2026-10-24T06:00:00Z'); // 11:30 AM IST on 2026-10-24
    let isConnected = true;
    const agendaCalls: Array<{
      windowStart: string;
      windowEnd: string;
      timeZone: string;
      includeCancelled?: boolean;
    }> = [];

    const longDescription =
      'Quarterly executive roadmap review covering Q4 enterprise rollouts, security compliance audits, customer onboarding milestones, and multi-region SLA readiness across all workspaces.';

    const model = createCalendarModel(
      'owner',
      () => {},
      {
        status: async () => ({
          connectorName: 'google_calendar',
          status: isConnected ? 'connected' : 'disconnected',
          configured: true,
          connected: isConnected,
          mode: 'live',
          scopes: isConnected ? ['https://www.googleapis.com/auth/calendar.readonly'] : [],
          lastVerifiedAt: '2026-10-24T06:00:00Z',
          ...(isConnected
            ? {
                connectedEmail: 'calendar.account@gmail.com',
                connectedCalendarSummary: 'Primary Executive Calendar'
              }
            : {})
        }),
        agenda: async (input) => {
          agendaCalls.push(input);
          return {
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
            timeZone: input.timeZone,
            totalEvents: 1,
            conflictEventIds: [],
            days: [
              {
                localDate: '2026-10-24',
                events: [
                  {
                    id: 'evt_today_ist',
                    calendarId: 'primary',
                    summary: 'IST Strategy Sync',
                    description: longDescription,
                    location: 'Google Meet',
                    startAt: '2026-10-24T08:30:00Z',
                    endAt: '2026-10-24T09:30:00Z',
                    timeZone: 'Asia/Kolkata',
                    allDay: false,
                    status: 'confirmed',
                    attendees: [],
                    untrusted: true,
                    mode: 'live'
                  }
                ]
              }
            ],
            n8nContext: {
              connector: 'google_calendar',
              operation: 'read_agenda_snapshot',
              readOnly: true,
              timeZone: input.timeZone,
              windowStart: input.windowStart,
              windowEnd: input.windowEnd,
              eventIds: ['evt_today_ist']
            },
            untrusted: true,
            mode: 'live'
          };
        },
        readEvent: async (id) => ({
          id,
          calendarId: 'primary',
          summary: 'IST Strategy Sync',
          description: longDescription,
          location: 'Google Meet',
          startAt: '2026-10-24T08:30:00Z',
          endAt: '2026-10-24T09:30:00Z',
          timeZone: 'Asia/Kolkata',
          allDay: false,
          status: 'confirmed',
          attendees: [],
          untrusted: true,
          mode: 'live'
        }),
        disconnect: async () => {
          isConnected = false;
          return {
            connectorName: 'google_calendar',
            status: 'disconnected',
            configured: true,
            connected: false,
            mode: 'live',
            scopes: [],
            lastVerifiedAt: null
          };
        }
      },
      { nowMs: fixedNowMs, timeZone: 'Asia/Kolkata', rangePreset: 'today' }
    );

    // 1. Initial load with rangePreset: 'today' queries exact 1-day Today window in Asia/Kolkata
    await model.loadStatus();
    expect(agendaCalls).toHaveLength(1);
    expect(agendaCalls[0]).toEqual({
      windowStart: '2026-10-23T18:30:00Z',
      windowEnd: '2026-10-24T18:30:00Z',
      timeZone: 'Asia/Kolkata',
      includeCancelled: false
    });

    await model.selectEvent('evt_today_ist');
    const connectedHtml = renderToStaticMarkup(
      <CalendarScreenView
        state={model.getState()}
        timeZoneDraft="Asia/Kolkata"
        onTimeZoneDraft={() => {}}
        onApplyTimeZone={() => {}}
        onToday={() => {}}
        onPrevRange={() => {}}
        onNextRange={() => {}}
        onToggleCancelled={() => {}}
        onSelectEvent={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
      />
    );
    expect(connectedHtml).toContain('data-testid="calendar-connected-account"');
    expect(connectedHtml).toContain(
      'Connected Calendar: calendar.account@gmail.com (Primary Executive Calendar)'
    );
    // Lengthy description (> 160 chars) is rendered inside collapsible Details drawer without `open` attribute
    expect(connectedHtml).toContain('data-testid="calendar-event-details-drawer"');
    expect(connectedHtml).toContain('Details (Meeting notes &amp; description)');
    expect(connectedHtml).not.toMatch(
      /<details[^>]*open=""[^>]*data-testid="calendar-event-details-drawer"/
    );

    // 2. Switch to Next 7 Days -> queries [2026-10-23T18:30:00Z, 2026-10-30T18:30:00Z)
    await model.selectRangePreset('next_7_days', fixedNowMs);
    expect(agendaCalls[1]).toEqual({
      windowStart: '2026-10-23T18:30:00Z',
      windowEnd: '2026-10-30T18:30:00Z',
      timeZone: 'Asia/Kolkata',
      includeCancelled: false
    });

    // 3. Switch to Previous 7 Days -> queries [2026-10-16T18:30:00Z, 2026-10-23T18:30:00Z)
    await model.selectRangePreset('prev_7_days', fixedNowMs);
    expect(agendaCalls[2]).toEqual({
      windowStart: '2026-10-16T18:30:00Z',
      windowEnd: '2026-10-23T18:30:00Z',
      timeZone: 'Asia/Kolkata',
      includeCancelled: false
    });

    // 4. Refresh (loadStatus) preserves the active Previous 7 Days filter
    await model.loadStatus();
    expect(agendaCalls[3]).toEqual({
      windowStart: '2026-10-16T18:30:00Z',
      windowEnd: '2026-10-23T18:30:00Z',
      timeZone: 'Asia/Kolkata',
      includeCancelled: false
    });
    expect(model.getState().rangePreset).toBe('prev_7_days');

    // 5. Disconnect immediately clears Connected Calendar identity
    await model.disconnect();
    const disconnectedHtml = renderToStaticMarkup(
      <CalendarScreenView
        state={model.getState()}
        timeZoneDraft="Asia/Kolkata"
        onTimeZoneDraft={() => {}}
        onApplyTimeZone={() => {}}
        onToday={() => {}}
        onPrevRange={() => {}}
        onNextRange={() => {}}
        onToggleCancelled={() => {}}
        onSelectEvent={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
      />
    );
    expect(disconnectedHtml).not.toContain('calendar.account@gmail.com');
    expect(disconnectedHtml).not.toContain('data-testid="calendar-connected-account"');
  });

  it('Step 107.5: converts local date/time in Asia/Kolkata, enforces requester-only approval decisions, and renders Calendar scheduling controls and Chat approval cards', () => {
    // 1. Date/time conversion in Asia/Kolkata (+05:30)
    const rangeIst = buildRfc3339FromDateAndTime('2026-10-25', '15:00', 30, 'Asia/Kolkata');
    expect(rangeIst).toEqual({
      startAt: '2026-10-25T09:30:00Z',
      endAt: '2026-10-25T10:00:00Z',
    });
    expect(extractDateAndTimeInZone('2026-10-25T09:30:00Z', 'Asia/Kolkata')).toEqual({
      date: '2026-10-25',
      time: '15:00',
    });

    // 2. Requester-only approval decisions for calendar.events.*
    const calApproval = {
      id: 'app-cal-1',
      workspaceId: 'ws-1',
      actionName: 'calendar.events.create',
      actionParams: {
        summary: 'Product Roadmap',
        startAt: '2026-10-25T09:30:00Z',
        endAt: '2026-10-25T10:00:00Z',
        timeZone: 'Asia/Kolkata',
        connectedEmail: 'calendar.owner@gmail.com',
        attendees: ['alex@partner.example'],
      },
      requesterUserId: 'user-requester',
      status: 'pending' as const,
      riskLevel: 'medium' as const,
      expiresAt: '2099-01-01T00:00:00Z',
      createdAt: '2026-10-24T00:00:00Z',
      updatedAt: '2026-10-24T00:00:00Z',
    };

    expect(canUserDecideApproval('member', 'user-requester', calApproval)).toEqual({
      canDecide: true,
    });
    expect(canUserDecideApproval('owner', 'other-user', calApproval)).toEqual({
      canDecide: false,
      reason: 'Only the person who prepared this calendar change can approve or cancel it.',
    });
    expect(canUserDecideApproval('viewer', 'user-requester', calApproval)).toEqual({
      canDecide: false,
      reason: 'Viewers cannot modify Google Calendar.',
    });

    // 3. CalendarMutationChatCard renders waiting approval and completed receipt states
    const waitingCardHtml = renderToStaticMarkup(
      <CalendarMutationChatCard
        approval={calApproval}
        canDecide={true}
        deciding={false}
        refreshing={false}
        onConfirm={() => {}}
        onCancel={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(waitingCardHtml).toContain('Schedule Meeting: Product Roadmap');
    expect(waitingCardHtml).toContain('Waiting for approval');
    expect(waitingCardHtml).toContain('Approve &amp; Schedule');
    expect(waitingCardHtml).toContain('alex@partner.example');

    const completedCardHtml = renderToStaticMarkup(
      <CalendarMutationChatCard
        approval={{ ...calApproval, status: 'approved' }}
        plan={{
          id: 'plan-cal-1',
          workspace_id: 'ws-1',
          created_by_user_id: 'user-requester',
          title: 'Schedule meeting: Product Roadmap',
          status: 'completed',
          version: 1,
          metadata: {},
          created_at: '2026-10-24T00:00:00Z',
          updated_at: '2026-10-24T00:00:00Z',
          steps: [
            {
              id: 'step-cal-1',
              plan_id: 'plan-cal-1',
              step_index: 0,
              action_name: 'calendar.events.create',
              action_class: 'write',
              parameters: calApproval.actionParams,
              parameter_hash: 'h',
              risk_level: 'medium',
              approval_mode: 'explicit',
              approval_request_id: 'app-cal-1',
              status: 'verified',
              retry_count: 0,
              max_retries: 0,
              created_at: '2026-10-24T00:00:00Z',
              updated_at: '2026-10-24T00:00:00Z',
            },
          ],
          receipts: [
            {
              id: 'rec-cal-1',
              plan_step_id: 'step-cal-1',
              status: 'verified',
              verification_method: 'connector_callback',
              proof: {
                status: 'event_created',
                operation: 'create',
                providerEventId: 'google_evt_99',
                summary: 'Product Roadmap',
                startAt: '2026-10-25T09:30:00Z',
                endAt: '2026-10-25T10:00:00Z',
                timeZone: 'Asia/Kolkata',
              },
              verified_at: '2026-10-24T00:00:00Z',
              created_at: '2026-10-24T00:00:00Z',
            },
          ],
        }}
        canDecide={false}
        deciding={false}
        refreshing={false}
        onConfirm={() => {}}
        onCancel={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(completedCardHtml).toContain('Scheduled');
    expect(completedCardHtml).toContain('Meeting scheduled for');
    expect(completedCardHtml).toContain('google_evt_99');

    // 4. CalendarScreenView renders + Schedule Meeting, Reschedule, Cancel Meeting, and write-scope banner when readonly
    const stateWithSelectedEvent = {
      ...initialCalendarState('owner', { timeZone: 'Asia/Kolkata', rangePreset: 'today' }),
      loaded: true,
      status: {
        connectorName: 'google_calendar' as const,
        status: 'connected' as const,
        configured: true,
        connected: true,
        mode: 'live' as const,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        lastVerifiedAt: '2026-10-24T06:00:00Z',
        connectedEmail: 'calendar.owner@gmail.com',
      },
      selectedId: 'evt_1',
      selectedEvent: {
        id: 'evt_1',
        calendarId: 'primary',
        summary: 'Executive Check-in',
        startAt: '2026-10-24T09:30:00Z',
        endAt: '2026-10-24T10:00:00Z',
        timeZone: 'Asia/Kolkata',
        allDay: false,
        status: 'confirmed' as const,
        attendees: [],
        untrusted: true as const,
        mode: 'live' as const,
      },
    };
    const screenHtml = renderToStaticMarkup(
      <CalendarScreenView
        state={stateWithSelectedEvent}
        timeZoneDraft="Asia/Kolkata"
        onTimeZoneDraft={() => {}}
        onApplyTimeZone={() => {}}
        onToday={() => {}}
        onPrevRange={() => {}}
        onNextRange={() => {}}
        onToggleCancelled={() => {}}
        onSelectEvent={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
      />,
    );
    expect(screenHtml).toContain('data-testid="calendar-schedule-open-btn"');
    expect(screenHtml).toContain('data-testid="calendar-detail-reschedule-btn"');
    expect(screenHtml).toContain('data-testid="calendar-detail-cancel-btn"');
    expect(screenHtml).toContain('data-testid="calendar-write-scope-banner"');
    expect(screenHtml).toContain('data-testid="calendar-ownership-filter"');
    expect(screenHtml).toContain('data-testid="calendar-detail-reminder"');
    expect(screenHtml).toContain('15 minutes before (popup)');
  });
});
