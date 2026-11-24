import { createHash } from 'node:crypto';
import { GoogleCalendarEventOrigin, GoogleCalendarReminders } from '@thaara/contracts';
import {
  GMAIL_READONLY,
  GmailOptions,
  GmailProvider,
  GmailTokens
} from './gmail.js';
import { GmailVault } from './gmail-vault.js';
import {
  GOOGLE_CALENDAR_READONLY,
  GoogleCalendarOptions,
  GoogleCalendarPrimaryMetadata,
  GoogleCalendarProvider,
  GoogleCalendarTokens,
  GoogleCalendarVault,
  parseIsoDateToZonedMidnightIso
} from './google-calendar.js';

export interface LiveGoogleProviderConfig {
  clientId: string;
  clientSecret: string;
  fetchFn?: typeof fetch;
}

interface GoogleTokenEndpointResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  expires_in?: unknown;
}

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailMimePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMimePart[];
  headers?: GmailHeader[];
}

interface GmailApiMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailMimePart;
}

function decodeBase64UrlUtf8(data?: string): string {
  if (!data || typeof data !== 'string') return '';
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function stripHtmlTagsToPlainText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractGmailBodyText(part?: GmailMimePart): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64UrlUtf8(part.body.data);
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      if (child.mimeType === 'text/plain' && child.body?.data) {
        const text = decodeBase64UrlUtf8(child.body.data);
        if (text) return text;
      }
    }
    for (const child of part.parts) {
      const nested = extractGmailBodyText(child);
      if (nested) return nested;
    }
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return stripHtmlTagsToPlainText(decodeBase64UrlUtf8(part.body.data));
  }
  if (part.body?.data) {
    return decodeBase64UrlUtf8(part.body.data);
  }
  return '';
}

function findHeader(headers: GmailHeader[] | undefined, targetName: string): string | undefined {
  if (!Array.isArray(headers)) return undefined;
  const lower = targetName.toLowerCase();
  const match = headers.find((h) => typeof h?.name === 'string' && h.name.toLowerCase() === lower);
  const val = typeof match?.value === 'string' ? match.value.trim() : '';
  return val ? val : undefined;
}

async function exchangeGoogleAuthorizationCode(
  fetchFn: typeof fetch,
  input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }
): Promise<{ accessToken: string; refreshToken?: string; scope: string; expiresIn: number }> {
  const response = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: input.codeVerifier
    }).toString()
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token exchange failed with status ${response.status}`);
  }

  const data = (await response.json()) as GoogleTokenEndpointResponse;
  if (
    typeof data.access_token !== 'string' ||
    !data.access_token ||
    typeof data.scope !== 'string' ||
    typeof data.expires_in !== 'number'
  ) {
    throw new Error('Google OAuth token response missing required fields');
  }

  return {
    accessToken: data.access_token,
    ...(typeof data.refresh_token === 'string' && data.refresh_token
      ? { refreshToken: data.refresh_token }
      : {}),
    scope: data.scope,
    expiresIn: data.expires_in
  };
}

async function refreshGoogleAccessToken(
  fetchFn: typeof fetch,
  input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    defaultScope: string;
  }
): Promise<{ accessToken: string; refreshToken?: string; scope: string; expiresIn: number }> {
  const response = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body: new URLSearchParams({
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: 'refresh_token'
    }).toString()
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token refresh failed with status ${response.status}`);
  }

  const data = (await response.json()) as GoogleTokenEndpointResponse;
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.expires_in !== 'number') {
    throw new Error('Google OAuth refresh response missing required fields');
  }

  return {
    accessToken: data.access_token,
    ...(typeof data.refresh_token === 'string' && data.refresh_token
      ? { refreshToken: data.refresh_token }
      : {}),
    scope: typeof data.scope === 'string' && data.scope ? data.scope : input.defaultScope,
    expiresIn: data.expires_in
  };
}

async function revokeGoogleToken(fetchFn: typeof fetch, token: string): Promise<void> {
  const response = await fetchFn('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ token }).toString()
  });
  if (!response.ok && response.status !== 400) {
    throw new Error(`Google OAuth token revocation failed with status ${response.status}`);
  }
}

export class LiveGmailProvider implements GmailProvider {
  readonly mode = 'live' as const;
  private readonly fetchFn: typeof fetch;
  private readonly clientSecret: string;

  constructor(config: LiveGoogleProviderConfig) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error('LiveGmailProvider requires clientId and clientSecret.');
    }
    this.clientSecret = config.clientSecret;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async exchange(input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
  }): Promise<GmailTokens> {
    return exchangeGoogleAuthorizationCode(this.fetchFn, {
      ...input,
      clientSecret: this.clientSecret
    });
  }

  async refresh(input: { refreshToken: string; clientId: string }): Promise<GmailTokens> {
    return refreshGoogleAccessToken(this.fetchFn, {
      refreshToken: input.refreshToken,
      clientId: input.clientId,
      clientSecret: this.clientSecret,
      defaultScope: GMAIL_READONLY
    });
  }

  async revoke(input: { token: string }): Promise<void> {
    await revokeGoogleToken(this.fetchFn, input.token);
  }

  async getProfile(input: { accessToken: string }): Promise<{ emailAddress?: string }> {
    const response = await this.fetchFn(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          accept: 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Gmail API profile request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { emailAddress?: unknown };
    const email =
      typeof payload.emailAddress === 'string' && payload.emailAddress.trim()
        ? payload.emailAddress.trim().slice(0, 320)
        : undefined;
    return email ? { emailAddress: email } : {};
  }

  async search(input: {
    accessToken: string;
    query: string;
    limit: number;
    pageToken?: string;
  }): Promise<unknown> {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', input.query);
    url.searchParams.set('maxResults', String(input.limit));
    if (input.pageToken) {
      url.searchParams.set('pageToken', input.pageToken);
    }

    const response = await this.fetchFn(url.href, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Gmail API search failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      messages?: Array<{ id?: string; threadId?: string }>;
      nextPageToken?: string;
    };

    return {
      messages: Array.isArray(payload.messages)
        ? payload.messages.map((m) => ({
            id: m.id,
            ...(m.threadId ? { threadId: m.threadId } : {})
          }))
        : [],
      ...(typeof payload.nextPageToken === 'string' && payload.nextPageToken
        ? { nextPageToken: payload.nextPageToken }
        : {})
    };
  }

  async read(input: { accessToken: string; messageId: string }): Promise<unknown> {
    const url = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(input.messageId)}`
    );
    url.searchParams.set('format', 'full');

    const response = await this.fetchFn(url.href, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Gmail API message read failed with status ${response.status}`);
    }

    const msg = (await response.json()) as GmailApiMessage;
    const headers = msg.payload?.headers;
    const subject = findHeader(headers, 'Subject');
    const from = findHeader(headers, 'From');
    const to = findHeader(headers, 'To');
    const cc = findHeader(headers, 'Cc');
    const replyTo = findHeader(headers, 'Reply-To');
    const messageIdHeader = findHeader(headers, 'Message-ID') ?? findHeader(headers, 'Message-Id');
    const referencesHeader = findHeader(headers, 'References');
    const date = findHeader(headers, 'Date');
    const bodyText = extractGmailBodyText(msg.payload) || msg.snippet || '';
    const isUnread = Array.isArray(msg.labelIds) ? msg.labelIds.includes('UNREAD') : false;

    return {
      id: msg.id,
      ...(msg.threadId ? { threadId: msg.threadId } : {}),
      ...(subject ? { subject: subject.slice(0, 4096) } : {}),
      ...(from ? { from: from.slice(0, 4096) } : {}),
      ...(to ? { to: to.slice(0, 4096) } : {}),
      ...(cc ? { cc: cc.slice(0, 4096) } : {}),
      ...(replyTo ? { replyTo: replyTo.slice(0, 4096) } : {}),
      ...(messageIdHeader ? { messageIdHeader: messageIdHeader.slice(0, 4096) } : {}),
      ...(referencesHeader ? { referencesHeader: referencesHeader.slice(0, 8192) } : {}),
      ...(date ? { date: date.slice(0, 256) } : {}),
      ...(typeof msg.snippet === 'string' && msg.snippet
        ? { snippet: msg.snippet.slice(0, 4096) }
        : {}),
      bodyText: bodyText.slice(0, 100000),
      isUnread
    };
  }

  async sendReply(input: {
    accessToken: string;
    connectedEmail: string;
    to: string;
    cc?: string;
    subject: string;
    threadId: string;
    inReplyTo?: string;
    references?: string;
    bodyText: string;
  }): Promise<{ id?: string; threadId?: string }> {
    const raw = buildPlainTextMimeMessage({
      from: input.connectedEmail,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      inReplyTo: input.inReplyTo,
      references: input.references,
      bodyText: input.bodyText
    });
    return this.postMessagesSend(input.accessToken, { raw, threadId: input.threadId });
  }

  /**
   * Sends a brand-new standalone email (Step 106). No threadId is supplied, so Gmail creates a new
   * conversation. The Subject header is omitted entirely when no subject was approved.
   */
  async sendNew(input: {
    accessToken: string;
    connectedEmail: string;
    to: string;
    subject?: string;
    bodyText: string;
  }): Promise<{ id?: string; threadId?: string }> {
    const raw = buildPlainTextMimeMessage({
      from: input.connectedEmail,
      to: input.to,
      subject: input.subject,
      bodyText: input.bodyText
    });
    return this.postMessagesSend(input.accessToken, { raw });
  }

  private async postMessagesSend(
    accessToken: string,
    body: { raw: string; threadId?: string }
  ): Promise<{ id?: string; threadId?: string }> {
    let response: Response;
    try {
      response = await this.fetchFn(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            accept: 'application/json'
          },
          body: JSON.stringify(body)
        }
      );
    } catch (networkErr) {
      const err = new Error(
        networkErr instanceof Error ? networkErr.message : 'Network error calling Gmail messages.send'
      ) as Error & { uncertain?: boolean };
      err.uncertain = true;
      throw err;
    }

    if (!response.ok) {
      const err = new Error(`Gmail API messages.send failed with status ${response.status}`) as Error & {
        statusCode?: number;
        uncertain?: boolean;
      };
      err.statusCode = response.status;
      if (response.status >= 500 || response.status === 408) {
        err.uncertain = true;
      }
      throw err;
    }

    let payload: { id?: unknown; threadId?: unknown };
    try {
      payload = (await response.json()) as { id?: unknown; threadId?: unknown };
    } catch {
      const err = new Error('Gmail API messages.send returned unreadable JSON') as Error & {
        uncertain?: boolean;
      };
      err.uncertain = true;
      throw err;
    }

    return {
      ...(typeof payload.id === 'string' && payload.id.trim() ? { id: payload.id.trim() } : {}),
      ...(typeof payload.threadId === 'string' && payload.threadId.trim()
        ? { threadId: payload.threadId.trim() }
        : {})
    };
  }
}

/**
 * Builds a base64url RFC 2822 plain-text message. Header values are stripped of CR/LF so approved
 * content can never inject extra headers or recipients. Non-ASCII subjects use RFC 2047 encoding.
 */
function buildPlainTextMimeMessage(input: {
  from: string;
  to: string;
  cc?: string;
  subject?: string;
  inReplyTo?: string;
  references?: string;
  bodyText: string;
}): string {
  const stripHeaderLineBreaks = (val: string) => val.replace(/[\r\n]+/g, ' ').trim();
  const safeFrom = stripHeaderLineBreaks(input.from);
  const safeTo = stripHeaderLineBreaks(input.to);
  const safeCc = input.cc ? stripHeaderLineBreaks(input.cc) : '';
  const rawSubject = input.subject ? stripHeaderLineBreaks(input.subject) : '';
  const encodedSubject = /[^\x20-\x7E]/.test(rawSubject)
    ? `=?UTF-8?B?${Buffer.from(rawSubject, 'utf8').toString('base64')}?=`
    : rawSubject;
  const safeInReplyTo = input.inReplyTo ? stripHeaderLineBreaks(input.inReplyTo) : undefined;
  const safeReferences = input.references ? stripHeaderLineBreaks(input.references) : undefined;
  const normalizedBody = input.bodyText.replace(/\r?\n/g, '\r\n');

  const mimeLines = [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    ...(safeCc ? [`Cc: ${safeCc}`] : []),
    ...(encodedSubject ? [`Subject: ${encodedSubject}`] : []),
    ...(safeInReplyTo ? [`In-Reply-To: ${safeInReplyTo}`] : []),
    ...(safeReferences ? [`References: ${safeReferences}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizedBody
  ];
  return Buffer.from(mimeLines.join('\r\n'), 'utf8').toString('base64url');
}

interface GoogleCalendarApiEventItem {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  organizer?: { email?: string; displayName?: string };
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
    organizer?: boolean;
    self?: boolean;
  }>;
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{
      method?: string;
      minutes?: number;
    }>;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

function normalizeGoogleCalendarReminders(raw: unknown): GoogleCalendarReminders | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { useDefault?: unknown; overrides?: unknown };
  if (typeof r.useDefault !== 'boolean') return undefined;
  if (!Array.isArray(r.overrides)) {
    return { useDefault: r.useDefault };
  }
  const overrides = r.overrides
    .filter(
      (item): item is { method: 'popup' | 'email'; minutes: number } =>
        Boolean(item) &&
        typeof item === 'object' &&
        ((item as { method?: unknown }).method === 'popup' ||
          (item as { method?: unknown }).method === 'email') &&
        typeof (item as { minutes?: unknown }).minutes === 'number' &&
        Number.isInteger((item as { minutes: number }).minutes) &&
        (item as { minutes: number }).minutes >= 0 &&
        (item as { minutes: number }).minutes <= 40320
    )
    .slice(0, 5)
    .map((item) => ({
      method: item.method,
      minutes: item.minutes
    }));
  return {
    useDefault: r.useDefault,
    overrides
  };
}

function normalizeGoogleCalendarOrigin(raw: unknown): GoogleCalendarEventOrigin | undefined {
  if (
    raw === 'thaara_chat' ||
    raw === 'thaara_ui' ||
    raw === 'thaara_gmail_explicit' ||
    raw === 'external_calendar'
  ) {
    return raw;
  }
  return undefined;
}

function normalizeGoogleCalendarEvent(
  item: GoogleCalendarApiEventItem,
  fallbackTimeZone: string
): Record<string, unknown> {
  const isAllDay = Boolean(!item.start?.dateTime && item.start?.date);
  const eventTimeZone = item.start?.timeZone || item.end?.timeZone || fallbackTimeZone || 'UTC';
  const startAt = item.start?.dateTime
    ? item.start.dateTime
    : item.start?.date
      ? parseIsoDateToZonedMidnightIso(item.start.date, eventTimeZone)
      : '';
  const endAt = item.end?.dateTime
    ? item.end.dateTime
    : item.end?.date
      ? parseIsoDateToZonedMidnightIso(item.end.date, eventTimeZone)
      : '';
  const status =
    item.status === 'cancelled' || item.status === 'tentative' ? item.status : 'confirmed';
  const summary =
    typeof item.summary === 'string' && item.summary.trim()
      ? item.summary.trim().slice(0, 1024)
      : 'Busy';
  const normalizedReminders = normalizeGoogleCalendarReminders(item.reminders);
  const normalizedOrigin = normalizeGoogleCalendarOrigin(
    item.extendedProperties?.private?.thaaraOrigin
  );

  return {
    id: typeof item.id === 'string' ? item.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256) : '',
    calendarId: 'primary',
    summary,
    ...(typeof item.description === 'string' && item.description.trim()
      ? { description: stripHtmlTagsToPlainText(item.description).slice(0, 8192) }
      : {}),
    ...(typeof item.location === 'string' && item.location.trim()
      ? { location: item.location.trim().slice(0, 1024) }
      : {}),
    startAt,
    endAt,
    timeZone: eventTimeZone,
    allDay: isAllDay,
    status,
    ...(typeof item.organizer?.email === 'string' && item.organizer.email.length >= 3
      ? { organizerEmail: item.organizer.email.slice(0, 320) }
      : {}),
    attendees: Array.isArray(item.attendees)
      ? item.attendees.slice(0, 50).map((att) => ({
          ...(typeof att.email === 'string' && att.email.length >= 3
            ? { email: att.email.slice(0, 320) }
            : {}),
          ...(typeof att.displayName === 'string' && att.displayName.trim()
            ? { displayName: att.displayName.trim().slice(0, 256) }
            : {}),
          ...(att.responseStatus &&
          ['needsAction', 'declined', 'tentative', 'accepted'].includes(att.responseStatus)
            ? { responseStatus: att.responseStatus }
            : {}),
          ...(typeof att.organizer === 'boolean' ? { organizer: att.organizer } : {}),
          ...(typeof att.self === 'boolean' ? { self: att.self } : {})
        }))
      : [],
    ...(normalizedReminders ? { reminders: normalizedReminders } : {}),
    ...(normalizedOrigin ? { thaaraOrigin: normalizedOrigin } : {})
  };
}

export class LiveGoogleCalendarProvider implements GoogleCalendarProvider {
  readonly mode = 'live' as const;
  private readonly fetchFn: typeof fetch;
  private readonly clientSecret: string;

  constructor(config: LiveGoogleProviderConfig) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error('LiveGoogleCalendarProvider requires clientId and clientSecret.');
    }
    this.clientSecret = config.clientSecret;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async exchange(input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
  }): Promise<GoogleCalendarTokens> {
    return exchangeGoogleAuthorizationCode(this.fetchFn, {
      ...input,
      clientSecret: this.clientSecret
    });
  }

  async refresh(input: {
    refreshToken: string;
    clientId: string;
  }): Promise<GoogleCalendarTokens> {
    return refreshGoogleAccessToken(this.fetchFn, {
      refreshToken: input.refreshToken,
      clientId: input.clientId,
      clientSecret: this.clientSecret,
      defaultScope: GOOGLE_CALENDAR_READONLY
    });
  }

  async revoke(input: { token: string }): Promise<void> {
    await revokeGoogleToken(this.fetchFn, input.token);
  }

  async getPrimaryCalendar(input: {
    accessToken: string;
  }): Promise<GoogleCalendarPrimaryMetadata> {
    const response = await this.fetchFn(
      'https://www.googleapis.com/calendar/v3/calendars/primary',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          accept: 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Google Calendar API getPrimaryCalendar failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      id?: unknown;
      summary?: unknown;
      timeZone?: unknown;
    };

    const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim().slice(0, 320) : undefined;
    const summary =
      typeof payload.summary === 'string' && payload.summary.trim()
        ? payload.summary.trim().slice(0, 256)
        : undefined;
    const timeZone =
      typeof payload.timeZone === 'string' && payload.timeZone.trim()
        ? payload.timeZone.trim().slice(0, 64)
        : undefined;

    return {
      ...(id ? { id } : {}),
      ...(summary ? { summary } : {}),
      ...(timeZone ? { timeZone } : {})
    };
  }

  async listEvents(input: {
    accessToken: string;
    windowStart: string;
    windowEnd: string;
    timeZone: string;
    query?: string;
    includeCancelled: boolean;
    limit: number;
    pageToken?: string;
  }): Promise<unknown> {
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', input.windowStart);
    url.searchParams.set('timeMax', input.windowEnd);
    url.searchParams.set('timeZone', input.timeZone);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', String(input.limit));
    url.searchParams.set('showDeleted', input.includeCancelled ? 'true' : 'false');
    if (input.query) {
      url.searchParams.set('q', input.query);
    }
    if (input.pageToken) {
      url.searchParams.set('pageToken', input.pageToken);
    }

    const response = await this.fetchFn(url.href, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Google Calendar API listEvents failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      items?: GoogleCalendarApiEventItem[];
      nextPageToken?: string;
    };

    const events = Array.isArray(payload.items)
      ? payload.items.map((item) => normalizeGoogleCalendarEvent(item, input.timeZone))
      : [];

    return {
      events,
      ...(typeof payload.nextPageToken === 'string' && payload.nextPageToken
        ? { nextPageToken: payload.nextPageToken }
        : {})
    };
  }

  async readEvent(input: { accessToken: string; eventId: string }): Promise<unknown> {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`
    );

    const response = await this.fetchFn(url.href, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Google Calendar API readEvent failed with status ${response.status}`);
    }

    const item = (await response.json()) as GoogleCalendarApiEventItem;
    return normalizeGoogleCalendarEvent(item, 'UTC');
  }

  async createEvent(input: {
    accessToken: string;
    summary: string;
    description?: string;
    location?: string;
    startAt: string;
    endAt: string;
    timeZone: string;
    attendees?: string[];
    sendUpdates: 'all' | 'none';
    reminders?: GoogleCalendarReminders;
    origin?: GoogleCalendarEventOrigin;
  }): Promise<{ id?: string; status?: string; reminders?: GoogleCalendarReminders }> {
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('sendUpdates', input.sendUpdates);

    const body: Record<string, unknown> = {
      summary: input.summary,
      ...(input.description ? { description: input.description } : {}),
      ...(input.location ? { location: input.location } : {}),
      start: {
        dateTime: input.startAt,
        timeZone: input.timeZone
      },
      end: {
        dateTime: input.endAt,
        timeZone: input.timeZone
      },
      ...(input.attendees && input.attendees.length > 0
        ? { attendees: input.attendees.map((email) => ({ email })) }
        : {}),
      ...(input.reminders
        ? {
            reminders: {
              useDefault: input.reminders.useDefault,
              ...(!input.reminders.useDefault && input.reminders.overrides
                ? { overrides: input.reminders.overrides }
                : {})
            }
          }
        : {}),
      ...(input.origin
        ? {
            extendedProperties: {
              private: {
                thaaraOrigin: input.origin
              }
            }
          }
        : {})
    };

    return this.executeEventMutation(url.href, 'POST', input.accessToken, body, 'events.insert');
  }

  async updateEvent(input: {
    accessToken: string;
    eventId: string;
    summary: string;
    newStartAt: string;
    newEndAt: string;
    timeZone: string;
    sendUpdates: 'all' | 'none';
    reminders?: GoogleCalendarReminders;
  }): Promise<{ id?: string; status?: string; reminders?: GoogleCalendarReminders }> {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`
    );
    url.searchParams.set('sendUpdates', input.sendUpdates);

    const body: Record<string, unknown> = {
      summary: input.summary,
      start: {
        dateTime: input.newStartAt,
        timeZone: input.timeZone
      },
      end: {
        dateTime: input.newEndAt,
        timeZone: input.timeZone
      },
      ...(input.reminders
        ? {
            reminders: {
              useDefault: input.reminders.useDefault,
              ...(!input.reminders.useDefault && input.reminders.overrides
                ? { overrides: input.reminders.overrides }
                : {})
            }
          }
        : {})
    };

    return this.executeEventMutation(url.href, 'PATCH', input.accessToken, body, 'events.patch');
  }

  async cancelEvent(input: {
    accessToken: string;
    eventId: string;
    sendUpdates: 'all' | 'none';
  }): Promise<{ id?: string; status?: string }> {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`
    );
    url.searchParams.set('sendUpdates', input.sendUpdates);

    let response: Response;
    try {
      response = await this.fetchFn(url.href, {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          accept: 'application/json'
        }
      });
    } catch (networkErr) {
      const err = new Error(
        networkErr instanceof Error
          ? networkErr.message
          : 'Network error calling Google Calendar events.delete'
      ) as Error & { uncertain?: boolean };
      err.uncertain = true;
      throw err;
    }

    if (!response.ok) {
      const err = new Error(
        `Google Calendar API events.delete failed with status ${response.status}`
      ) as Error & { statusCode?: number; uncertain?: boolean };
      err.statusCode = response.status;
      if (response.status >= 500 || response.status === 408) {
        err.uncertain = true;
      }
      throw err;
    }

    if (response.status === 204) {
      return { id: input.eventId, status: 'cancelled' };
    }

    try {
      const text = await response.text();
      if (!text.trim()) {
        return { id: input.eventId, status: 'cancelled' };
      }
      const payload = JSON.parse(text) as { id?: unknown; status?: unknown };
      return {
        id:
          typeof payload.id === 'string' && payload.id.trim()
            ? payload.id.trim()
            : input.eventId,
        status: 'cancelled'
      };
    } catch {
      return { id: input.eventId, status: 'cancelled' };
    }
  }

  private async executeEventMutation(
    url: string,
    method: 'POST' | 'PATCH',
    accessToken: string,
    body: Record<string, unknown>,
    operationLabel: string
  ): Promise<{ id?: string; status?: string; reminders?: GoogleCalendarReminders }> {
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify(body)
      });
    } catch (networkErr) {
      const err = new Error(
        networkErr instanceof Error
          ? networkErr.message
          : `Network error calling Google Calendar ${operationLabel}`
      ) as Error & { uncertain?: boolean };
      err.uncertain = true;
      throw err;
    }

    if (!response.ok) {
      const err = new Error(
        `Google Calendar API ${operationLabel} failed with status ${response.status}`
      ) as Error & { statusCode?: number; uncertain?: boolean };
      err.statusCode = response.status;
      if (response.status >= 500 || response.status === 408) {
        err.uncertain = true;
      }
      throw err;
    }

    let payload: { id?: unknown; status?: unknown; reminders?: unknown };
    try {
      payload = (await response.json()) as { id?: unknown; status?: unknown; reminders?: unknown };
    } catch {
      const err = new Error(
        `Google Calendar API ${operationLabel} returned unreadable JSON`
      ) as Error & { uncertain?: boolean };
      err.uncertain = true;
      throw err;
    }

    const normalizedReminders = normalizeGoogleCalendarReminders(payload.reminders);
    return {
      ...(typeof payload.id === 'string' && payload.id.trim() ? { id: payload.id.trim() } : {}),
      ...(typeof payload.status === 'string' && payload.status.trim()
        ? { status: payload.status.trim() }
        : {}),
      ...(normalizedReminders ? { reminders: normalizedReminders } : {})
    };
  }
}

export function createLiveGoogleIntegrationFromEnv(
  env: Record<string, string | undefined>,
  store?: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    take(key: string): string | undefined;
    delete(key: string): void;
  },
  fetchFn?: typeof fetch
): {
  gmail?: GmailOptions;
  googleCalendar?: GoogleCalendarOptions;
} {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return {};
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth configuration requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }
  const secretSeed = env.GOOGLE_VAULT_KEY;
  // A dedicated 32-byte hex key is required; never derive live token keys from sessions.
  if (
    !secretSeed ||
    !/^[0-9a-f]{64}$/i.test(secretSeed) ||
    /^([0-9a-f]{2})\1{31}$/i.test(secretSeed) ||
    secretSeed.toLowerCase() === env.SESSION_SECRET?.toLowerCase()
  ) {
    throw new Error('GOOGLE_VAULT_KEY must be a dedicated 32-byte hex key, separate from SESSION_SECRET.');
  }

  const backingMap = new Map<string, string>();
  const defaultStore = store ?? {
    get: (k: string) => backingMap.get(k),
    set: (k: string, v: string) => {
      backingMap.set(k, v);
    },
    take: (k: string) => {
      const v = backingMap.get(k);
      backingMap.delete(k);
      return v;
    },
    delete: (k: string) => {
      backingMap.delete(k);
    }
  };

  const gmailKey = createHash('sha256').update(`gmail:${secretSeed}`).digest();
  const calendarKey = createHash('sha256').update(`google_calendar:${secretSeed}`).digest();
  const allowLocalhostRedirect = env.NODE_ENV !== 'production';
  const defaultLocalBase = (env.CORS_ORIGIN?.trim() || 'http://localhost:5173').replace(/\/+$/, '');
  const gmailRedirectUri =
    env.GOOGLE_GMAIL_REDIRECT_URI?.trim() ||
    (allowLocalhostRedirect
      ? `${defaultLocalBase}/api/v1/connectors/gmail/oauth/callback`
      : 'https://localhost:3000/api/v1/connectors/gmail/oauth/callback');
  const calendarRedirectUri =
    env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() ||
    (allowLocalhostRedirect
      ? `${defaultLocalBase}/api/v1/connectors/google-calendar/oauth/callback`
      : 'https://localhost:3000/api/v1/connectors/google-calendar/oauth/callback');

  return {
    gmail: {
      provider: new LiveGmailProvider({ clientId, clientSecret, fetchFn }),
      vault: new GmailVault(gmailKey, defaultStore),
      clientId,
      redirectUri: gmailRedirectUri,
      allowLocalhostRedirect
    },
    googleCalendar: {
      provider: new LiveGoogleCalendarProvider({ clientId, clientSecret, fetchFn }),
      vault: new GoogleCalendarVault(calendarKey, defaultStore),
      clientId,
      redirectUri: calendarRedirectUri,
      allowLocalhostRedirect
    }
  };
}

export const REAL_INTEGRATION_REQUIREMENTS_CHECKLIST = {
  runtimeAudit: {
    currentDevRuntime: 'PGlite in-memory database + in-memory ciphertext vault store',
    productionRequirement:
      'Managed PostgreSQL 16+ with RLS enabled, persistent encrypted connector_tokens table, KMS/Vault-backed 256-bit master key, and Redis-backed BullMQ workers.'
  },
  googleOAuthReadOnly: {
    requiredEnvVars: [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_GMAIL_REDIRECT_URI',
      'GOOGLE_CALENDAR_REDIRECT_URI',
      'GOOGLE_VAULT_KEY'
    ],
    scopes: [GMAIL_READONLY, GOOGLE_CALENDAR_READONLY],
    localRedirectUris: [
      'http://localhost:5173/api/v1/connectors/gmail/oauth/callback',
      'http://localhost:5173/api/v1/connectors/google-calendar/oauth/callback'
    ],
    redirectUris: [
      'https://<domain>/api/v1/connectors/gmail/oauth/callback',
      'https://<domain>/api/v1/connectors/google-calendar/oauth/callback'
    ]
  },
  futureRealIntegrations: {
    gmailSending: {
      scope: 'https://www.googleapis.com/auth/gmail.send',
      controls: ['Approval-gated PolicyGateway', 'Recipient allowlist/confirmation', 'RFC 2822 MIME builder', 'Verified messageId/threadId receipt']
    },
    calendarEventCreation: {
      scope: 'https://www.googleapis.com/auth/calendar.events',
      controls: ['Approval-gated PolicyGateway', 'Conflict check before insert', 'Explicit sendUpdates policy', 'Verified htmlLink/id receipt']
    },
    whatsappBusinessCloud: {
      requirements: ['Meta Business Manager account', 'Verified WhatsApp Business Phone Number ID', 'System User Permanent Access Token', 'Approved template messages for business-initiated >24h window', 'X-Hub-Signature-256 webhook verification']
    },
    smsProvider: {
      indiaRegulations: ['TRAI DLT entity registration', 'Approved 6-char Sender ID (Header)', 'Approved DLT Content Template IDs'],
      providers: ['Exotel SMS', 'MSG91', 'Twilio']
    },
    exotelPhoneAndVoiceAi: {
      requirements: ['Exotel KYC + ExoPhone virtual number', 'HTTPS Passthru/Voicebot applet', 'WSS bidirectional 8kHz/16kHz PCM audio stream', 'Real-time STT + LLM + TTS (<800ms latency)', 'Explicit call recording consent & DND compliance']
    },
    bilingualVoiceInterface: {
      languages: ['en-IN', 'kn-IN'],
      requirements: ['Browser MediaDevices microphone capture', 'Streaming STT (Sarvam/Google Chirp/Deepgram)', 'Kannada + English neural TTS playback', 'Push-to-talk and barge-in interruption']
    }
  }
} as const;
