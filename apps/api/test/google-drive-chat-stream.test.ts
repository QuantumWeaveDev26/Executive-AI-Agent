import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import {
  PGliteDatabase,
  Migrator,
  WorkspaceRepository,
  UserRepository,
  MembershipRepository,
  SessionRepository,
  generateSessionToken,
  hashSessionToken
} from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME } from '../src/plugins/auth.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';
import { GoogleDriveService } from '../src/services/google-drive.js';

describe('Google Drive Chat Streaming API E2E (/api/v1/conversations/:id/stream)', () => {
  let app: FastifyInstance;
  let db: PGliteDatabase;
  let workspaceId: string;
  let userId: string;
  let sessionToken: string;
  let csrfToken: string;
  let mockFetch: ReturnType<typeof vi.fn>;

  const CTW_FILE_ID = '1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU';
  const CTW_NAME = 'Custom Teamwear Reports';
  const CTW_LINK = `https://drive.google.com/file/d/${CTW_FILE_ID}/view`;

  beforeEach(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);

    const ws = await wsRepo.create('Executive Workspace');
    workspaceId = ws.id;
    const user = await userRepo.create('executive@brandmint.ai', 'hashed_pass', 'Executive Owner');
    userId = user.id;

    sessionToken = generateSessionToken();
    const scope = {
      workspaceId: ws.id,
      userId: user.id,
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken(sessionToken)
    };

    await db.withScopedTransaction(scope, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(ws.id, user.id, 'owner');
      await sRepo.create(user.id, ws.id, sessionToken);
    });

    csrfToken = generateCsrfToken();

    // Mock n8n Sub 05 webhook
    mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) || '{}');
      const op = body.operation || 'drive_search';

      if (op === 'drive_search') {
        const query = body.query || '';
        if (query.includes('Custom Teamwear')) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              operation: 'drive_search',
              files: [
                {
                  id: CTW_FILE_ID,
                  name: CTW_NAME,
                  webViewLink: CTW_LINK,
                  modifiedTime: '2026-11-12T15:30:00Z'
                },
                {
                  id: '1uL_15i1v3Ooxy2RP9ixdoBDKSWY_DhRBnXB4A6o7H9A',
                  name: 'Custom Teamwear Leads',
                  webViewLink: 'https://drive.google.com/file/d/1uL_15i1v3Ooxy2RP9ixdoBDKSWY_DhRBnXB4A6o7H9A/view',
                  modifiedTime: '2026-11-11T12:00:00Z'
                }
              ],
              file: {
                id: CTW_FILE_ID,
                name: CTW_NAME,
                webViewLink: CTW_LINK
              },
              message: 'Successfully executed drive_search: found 2 items.'
            })
          };
        }

        // Generic open search
        return {
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_search',
            files: [
              { id: 'f-1', name: 'File 1.docx', webViewLink: 'https://drive.google.com/file/d/f-1/view', modifiedTime: '2026-11-13T10:00:00Z' },
              { id: 'f-2', name: 'File 2.pdf', webViewLink: 'https://drive.google.com/file/d/f-2/view', modifiedTime: '2026-11-13T09:00:00Z' },
              { id: 'f-3', name: 'File 3.xlsx', webViewLink: 'https://drive.google.com/file/d/f-3/view', modifiedTime: '2026-11-13T08:00:00Z' },
              { id: 'f-4', name: 'File 4.pptx', webViewLink: 'https://drive.google.com/file/d/f-4/view', modifiedTime: '2026-11-13T07:00:00Z' },
              { id: 'f-5', name: 'File 5.txt', webViewLink: 'https://drive.google.com/file/d/f-5/view', modifiedTime: '2026-11-13T06:00:00Z' },
              { id: 'f-6', name: 'File 6.pdf', webViewLink: 'https://drive.google.com/file/d/f-6/view', modifiedTime: '2026-11-13T05:00:00Z' }
            ],
            message: 'Successfully executed drive_search: found 6 items.'
          })
        };
      }

      if (op === 'drive_read') {
        const fileId = body.fileId;
        const fileName = body.fileName || '';
        return {
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_read',
            file: {
              id: fileId || CTW_FILE_ID,
              name: fileName || CTW_NAME,
              webViewLink: CTW_LINK,
              summary: 'Q3 Teamwear production report: 15,000 units delivered across 12 athletic franchises.'
            },
            message: 'Successfully executed drive_read: found 1 items.'
          })
        };
      }

      return {
        ok: true,
        json: async () => ({ success: true, operation: op })
      };
    });

    const googleDrive = new GoogleDriveService({
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const config = loadConfig();
    app = await buildApp({
      config,
      db,
      googleDrive
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  async function createConversation(title = 'Executive Drive Session'): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`,
        'x-csrf-token': csrfToken
      },
      payload: { title }
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).id;
  }

  it('reproduces and resolves Failure 1: Compound query searches specifically for Custom Teamwear, never substitutes Quantum Films, and returns link', async () => {
    const convId = await createConversation();

    const streamRes = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/stream`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`,
        'x-csrf-token': csrfToken
      },
      payload: {
        content: 'Thaara, find my latest Custom Teamwear report in Google Drive, read it, and give me a short summary with the document link.',
        idempotency_key: 'stream-ctw-001'
      }
    });

    expect(streamRes.statusCode).toBe(200);
    const body = streamRes.body;
    expect(body).toContain('event: done');

    // Verify message was stored in conversation history
    const msgsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`
      }
    });
    const messages = JSON.parse(msgsRes.body);
    const assistantMsg = messages.find((m: { sender_type: string }) => m.sender_type === 'assistant');
    expect(assistantMsg).toBeDefined();

    // Verify response content
    expect(assistantMsg.content).toContain('Custom Teamwear Reports');
    expect(assistantMsg.content).toContain(CTW_LINK);
    expect(assistantMsg.content).not.toContain('Quantum Films');
    expect(assistantMsg.content).not.toContain('found 10 items');
  });

  it('reproduces and resolves Failure 2: "check my latest drive" returns files instead of falling back or denying access', async () => {
    const convId = await createConversation();

    const streamRes = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/stream`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`,
        'x-csrf-token': csrfToken
      },
      payload: {
        content: 'check my latest drive',
        idempotency_key: 'stream-check-drive-001'
      }
    });

    expect(streamRes.statusCode).toBe(200);
    const body = streamRes.body;
    expect(body).toContain('event: done');

    const msgsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`
      }
    });
    const messages = JSON.parse(msgsRes.body);
    const assistantMsg = messages.find((m: { sender_type: string }) => m.sender_type === 'assistant');
    expect(assistantMsg).toBeDefined();

    expect(assistantMsg.content).toContain('Here are the matching files from your Google Drive');
    expect(assistantMsg.content).not.toContain('cannot access');
    expect(assistantMsg.content).not.toContain('not configured');
  });

  it('reproduces and resolves Failure 3: "Show me my latest 5 files." returns exactly 5 files with links', async () => {
    const convId = await createConversation();

    const streamRes = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/stream`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`,
        'x-csrf-token': csrfToken
      },
      payload: {
        content: 'Show me my latest 5 files.',
        idempotency_key: 'stream-latest-5-001'
      }
    });

    expect(streamRes.statusCode).toBe(200);
    const body = streamRes.body;
    expect(body).toContain('event: done');

    const msgsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`
      }
    });
    const messages = JSON.parse(msgsRes.body);
    const assistantMsg = messages.find((m: { sender_type: string }) => m.sender_type === 'assistant');
    expect(assistantMsg).toBeDefined();

    expect(assistantMsg.content).toContain('Here are the matching files from your Google Drive');
    expect(assistantMsg.content).toContain('1. **File 1.docx**');
    expect(assistantMsg.content).toContain('5. **File 5.txt**');
    expect(assistantMsg.content).not.toContain('6. **File 6.pdf**'); // Sliced to 5
  });

  it('supports multi-turn follow-up commands in long conversations: Turn 1 "Find my latest Custom Teamwear report." -> Turn 2 "Read this document."', async () => {
    const convId = await createConversation();

    // Seed 11 prior user messages (unconfigured model gateway records user message without assistant message -> 11 rows > 10)
    for (let i = 1; i <= 11; i++) {
      const priorRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conversations/${convId}/stream`,
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`,
          'x-csrf-token': csrfToken
        },
        payload: {
          content: `General executive note #${i}`,
          idempotency_key: `prior-note-${i}`
        }
      });
      expect(priorRes.statusCode).toBe(200);
    }

    // Turn 1: Exact owner command without "in Google Drive"
    const turn1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/stream`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`,
        'x-csrf-token': csrfToken
      },
      payload: {
        content: 'Find my latest Custom Teamwear report.',
        idempotency_key: 'multi-turn-001'
      }
    });
    expect(turn1Res.statusCode).toBe(200);

    // Turn 2: Exact owner follow-up command "Read this document."
    const turn2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/stream`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`,
        'x-csrf-token': csrfToken
      },
      payload: {
        content: 'Read this document.',
        idempotency_key: 'multi-turn-002'
      }
    });
    expect(turn2Res.statusCode).toBe(200);

    const msgsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`
      }
    });
    const messages = JSON.parse(msgsRes.body);
    // 11 prior user messages + 4 Drive turn messages = 15 messages (exceeds LIMIT 10 window)
    expect(messages.length).toBe(15);
    const assistantMsg1 = messages[12];
    expect(assistantMsg1.sender_type).toBe('assistant');
    expect(assistantMsg1.content).toContain('Custom Teamwear Reports');
    expect(assistantMsg1.content).toContain(CTW_LINK);

    const assistantMsg2 = messages[14];
    expect(assistantMsg2.sender_type).toBe('assistant');
    expect(assistantMsg2.content).toContain('Document: **Custom Teamwear Reports**');
    expect(assistantMsg2.content).toContain(CTW_LINK);
    expect(assistantMsg2.content).toContain('15,000 units delivered');
    expect(assistantMsg2.content).not.toContain('Quantum Films');
  });
});
