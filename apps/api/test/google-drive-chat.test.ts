import { describe, it, expect, vi } from 'vitest';
import {
  detectGoogleDriveChatRequest,
  executeChatGoogleDriveRequest,
  extractDriveContextFromMessages,
  resolveGoogleDriveChatRequest
} from '../src/services/chat-google-drive-assistant.js';
import { GoogleDriveService } from '../src/services/google-drive.js';
import { AuthenticatedScope } from '@thaara/db';
import { ForbiddenError } from '@thaara/observability';
import { ModelGatewayAdapter } from '../src/services/model-gateway.js';

describe('Google Drive Chat Assistant', () => {
  const ownerScope: AuthenticatedScope = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    role: 'owner'
  };

  const customerScope: AuthenticatedScope = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    userId: '33333333-3333-3333-3333-333333333333',
    role: 'viewer'
  };

  describe('Intent Detection', () => {
    it('detects search requests', () => {
      const intent1 = detectGoogleDriveChatRequest('find my latest marketing proposal in Google Drive');
      expect(intent1).not.toBeNull();
      expect(intent1?.kind).toBe('search_files');
      expect(intent1?.query).toContain('marketing proposal');

      const intent2 = detectGoogleDriveChatRequest('search Drive for Q3 financial report');
      expect(intent2).not.toBeNull();
      expect(intent2?.kind).toBe('search_files');
      expect(intent2?.query).toBe('Q3 financial report');

      const intent3 = detectGoogleDriveChatRequest('Thaara, search my Google Drive and show me my latest 5 files with their links.');
      expect(intent3).not.toBeNull();
      expect(intent3?.kind).toBe('search_files');
      expect(intent3?.limit).toBe(5);
      expect(intent3?.query).toBe(''); // Open latest search

      const intent4 = detectGoogleDriveChatRequest('Find my latest proposal in Google Drive.');
      expect(intent4).not.toBeNull();
      expect(intent4?.kind).toBe('search_files');
      expect(intent4?.query).toBe('proposal');
    });

    it('detects list folder requests', () => {
      const intent = detectGoogleDriveChatRequest('list files in folder Client Proposals in Google Drive');
      expect(intent).not.toBeNull();
      expect(intent?.kind).toBe('list_folder');
      expect(intent?.folderName).toBe('Client Proposals');
    });

    it('detects read document requests', () => {
      const intent = detectGoogleDriveChatRequest('read the document Project Plan from my Drive');
      expect(intent).not.toBeNull();
      expect(intent?.kind).toBe('read_document');
      expect(intent?.name).toContain('Project Plan');
    });

    it('detects summarize document requests', () => {
      const intent = detectGoogleDriveChatRequest('summarize the proposal in my Drive');
      expect(intent).not.toBeNull();
      expect(intent?.kind).toBe('summarize_document');
      expect(intent?.name).toContain('proposal');
    });

    it('detects create folder requests', () => {
      const intent = detectGoogleDriveChatRequest('create a folder named Invoices 2026 in Google Drive');
      expect(intent).not.toBeNull();
      expect(intent?.kind).toBe('create_folder');
      expect(intent?.folderName).toBe('Invoices 2026');
    });

    it('detects create Google Doc requests', () => {
      const intent = detectGoogleDriveChatRequest('create a Google Doc titled Project Roadmap');
      expect(intent).not.toBeNull();
      expect(intent?.kind).toBe('create_doc');
      expect(intent?.name).toBe('Project Roadmap');
    });

    it('detects upload requests', () => {
      const intent = detectGoogleDriveChatRequest('upload this document to Google Drive');
      expect(intent).not.toBeNull();
      expect(intent?.kind).toBe('upload_file');
    });

    it('detects share requests with email', () => {
      const intent = detectGoogleDriveChatRequest('share the proposal with client@brandmint.ai in Drive');
      expect(intent).not.toBeNull();
      expect(intent?.kind).toBe('share_file');
      expect(intent?.email).toBe('client@brandmint.ai');
    });

    it('detects delete requests', () => {
      const intent = detectGoogleDriveChatRequest('delete file old_draft.docx from Google Drive');
      expect(intent).not.toBeNull();
      expect(intent?.kind).toBe('delete_file');
      expect(intent?.name).toBe('old_draft.docx');
    });

    it('detects multi-action compound requests (find + read + summarize + link)', () => {
      // 1. Exact user command
      const intent1 = detectGoogleDriveChatRequest(
        'Thaara, find my latest Custom Teamwear report in Google Drive, read it, and give me a short summary with the document link.'
      );
      expect(intent1).not.toBeNull();
      expect(intent1?.kind).toBe('search_files');
      expect(intent1?.query).toBe('Custom Teamwear report');
      expect(intent1?.autoRead).toBe(true);
      expect(intent1?.autoSummarize).toBe(true);
      expect(intent1?.includeLink).toBe(true);

      // 2. Compound "find X and read it"
      const intent2 = detectGoogleDriveChatRequest('find my latest Custom Teamwear report in Google Drive and read it');
      expect(intent2).not.toBeNull();
      expect(intent2?.kind).toBe('search_files');
      expect(intent2?.query).toBe('Custom Teamwear report');
      expect(intent2?.autoRead).toBe(true);
      expect(intent2?.autoSummarize).toBe(false);

      // 3. Compound "find X, read it, and summarize it"
      const intent3 = detectGoogleDriveChatRequest('find Strategic Roadmap, read it, and summarize it in Google Drive');
      expect(intent3).not.toBeNull();
      expect(intent3?.kind).toBe('search_files');
      expect(intent3?.query).toBe('Strategic Roadmap');
      expect(intent3?.autoRead).toBe(true);
      expect(intent3?.autoSummarize).toBe(true);

      // 4. Compound "find X and give me a short summary with the link"
      const intent4 = detectGoogleDriveChatRequest('find Financial Forecast in Drive and give me a short summary with the link');
      expect(intent4).not.toBeNull();
      expect(intent4?.kind).toBe('search_files');
      expect(intent4?.query).toBe('Financial Forecast');
      expect(intent4?.autoSummarize).toBe(true);
      expect(intent4?.includeLink).toBe(true);
    });

    it('ignores general or unrelated queries', () => {
      expect(detectGoogleDriveChatRequest('Hi Thaara')).toBeNull();
      expect(detectGoogleDriveChatRequest('What are your AI services?')).toBeNull();
      expect(detectGoogleDriveChatRequest('Schedule a meeting with Rahul on Friday')).toBeNull();
    });
  });

  describe('Role-Based Security Boundary', () => {
    it('prevents non-owner/customer from performing Google Drive operations', async () => {
      const service = new GoogleDriveService();
      await expect(service.searchFiles(customerScope, { query: 'test' })).rejects.toThrow(ForbiddenError);
      await expect(service.listFolder(customerScope)).rejects.toThrow(ForbiddenError);
      await expect(service.createFolder(customerScope, { name: 'secret' })).rejects.toThrow(ForbiddenError);
      await expect(service.createDoc(customerScope, { title: 'doc' })).rejects.toThrow(ForbiddenError);
    });

    it('rejects non-owner execution in executeChatGoogleDriveRequest', async () => {
      const service = new GoogleDriveService();
      const outcome = await executeChatGoogleDriveRequest(
        customerScope,
        { kind: 'search_files', query: 'roadmap' },
        service
      );
      expect(outcome.handled).toBe(true);
      expect(outcome.assistantResponseText).toContain('Access denied');
    });
  });

  describe('GoogleDriveService with Mock Fetch', () => {
    it('handles search successfully and returns formatted files', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          operation: 'drive_search',
          files: [
            {
              id: 'file-123',
              name: 'Q3 Marketing Proposal.docx',
              mimeType: 'application/vnd.google-apps.document',
              webViewLink: 'https://docs.google.com/document/d/file-123/view',
              modifiedTime: '2026-11-10T10:00:00Z'
            }
          ]
        })
      });

      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });
      const res = await service.searchFiles(ownerScope, { query: 'marketing proposal' });

      expect(res.success).toBe(true);
      expect(res.files).toHaveLength(1);
      expect(res.files?.[0].name).toBe('Q3 Marketing Proposal.docx');

      const outcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'search_files', query: 'marketing proposal' },
        service
      );
      expect(outcome.assistantResponseText).toContain('Q3 Marketing Proposal.docx');
      expect(outcome.assistantResponseText).toContain('https://docs.google.com/document/d/file-123/view');
    });

    it('handles create folder successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          operation: 'drive_create_folder',
          folder: {
            id: 'folder-456',
            name: 'Client Invoices',
            mimeType: 'application/vnd.google-apps.folder',
            webViewLink: 'https://drive.google.com/drive/folders/folder-456'
          }
        })
      });

      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });
      const outcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'create_folder', folderName: 'Client Invoices' },
        service
      );

      expect(outcome.assistantResponseText).toContain('Successfully created folder');
      expect(outcome.assistantResponseText).toContain('Client Invoices');
      expect(outcome.assistantResponseText).toContain('https://drive.google.com/drive/folders/folder-456');
    });

    it('requires explicit confirmation before deleting files bound to immutable fileId, workspace and owner', async () => {
      const mockFetch = vi.fn();
      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });

      // Mock search/resolution for old_contract.pdf
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          operation: 'drive_search',
          files: [
            {
              id: 'file-contract-999',
              name: 'old_contract.pdf',
              mimeType: 'application/pdf',
              webViewLink: 'https://docs.google.com/file/d/file-contract-999'
            }
          ]
        })
      });

      // 1. First call without confirmation token prompts for single-use token bound to file ID
      const outcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'delete_file', name: 'old_contract.pdf' },
        service
      );

      expect(outcome.assistantResponseText).toContain('Action Requires Confirmation');
      expect(outcome.assistantResponseText).toContain('file-contract-999');
      expect(outcome.assistantResponseText).toMatch(/DRV-CONF-[A-F0-9]{6}-[A-F0-9]{6}/);

      const tokenMatch = outcome.assistantResponseText.match(/DRV-CONF-[A-F0-9]{6}-[A-F0-9]{6}/);
      expect(tokenMatch).not.toBeNull();
      const singleUseToken = tokenMatch![0];

      // 2. Generic confirmation without valid token is REJECTED
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          operation: 'drive_search',
          files: [{ id: 'file-contract-999', name: 'old_contract.pdf' }]
        })
      });

      const genericOutcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'delete_file', name: 'old_contract.pdf', approvalToken: 'generic-confirm' },
        service
      );
      expect(genericOutcome.assistantResponseText).toContain('Deletion rejected: Invalid or unknown confirmation token');

      // 3. Applying token to a different file is REJECTED
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          operation: 'drive_search',
          files: [{ id: 'file-different-111', name: 'different.pdf' }]
        })
      });

      const crossFileOutcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'delete_file', name: 'different.pdf', approvalToken: singleUseToken },
        service
      );
      expect(crossFileOutcome.assistantResponseText).toContain('Confirmation token is bound to file');

      // 4. Exact bound token is ACCEPTED
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_search',
            files: [{ id: 'file-contract-999', name: 'old_contract.pdf' }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_delete',
            message: 'File "old_contract.pdf" was permanently deleted from Google Drive.'
          })
        });

      const approvedOutcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'delete_file', name: 'old_contract.pdf', approvalToken: singleUseToken },
        service
      );

      expect(approvedOutcome.assistantResponseText).toContain('permanently deleted');

      // 5. Replay attack: Reusing the same token a second time is REJECTED
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          operation: 'drive_search',
          files: [{ id: 'file-contract-999', name: 'old_contract.pdf' }]
        })
      });

      const replayOutcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'delete_file', name: 'old_contract.pdf', approvalToken: singleUseToken },
        service
      );
      expect(replayOutcome.assistantResponseText).toContain('Invalid or unknown confirmation token');
    });

    it('requires explicit recipient and permission confirmation before sharing files bound to immutable fileId', async () => {
      const mockFetch = vi.fn();
      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          operation: 'drive_search',
          files: [
            {
              id: 'proposal-doc-777',
              name: 'Strategic Proposal.docx',
              mimeType: 'application/vnd.google-apps.document'
            }
          ]
        })
      });

      // 1. Initial share command prompts for confirmation with single-use token bound to file ID
      const initialOutcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'share_file', name: 'Strategic Proposal.docx', email: 'client@brandmint.ai', role: 'reader' },
        service
      );

      expect(initialOutcome.assistantResponseText).toContain('File Sharing Confirmation Required');
      expect(initialOutcome.assistantResponseText).toContain('proposal-doc-777');
      expect(initialOutcome.assistantResponseText).toContain('client@brandmint.ai');
      expect(initialOutcome.assistantResponseText).toMatch(/DRV-CONF-[A-F0-9]{6}-[A-F0-9]{6}/);

      const tokenMatch = initialOutcome.assistantResponseText.match(/DRV-CONF-[A-F0-9]{6}-[A-F0-9]{6}/);
      const shareToken = tokenMatch![0];

      // 2. Confirmed share executes with valid token
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_search',
            files: [{ id: 'proposal-doc-777', name: 'Strategic Proposal.docx' }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_share',
            message: 'Shared "Strategic Proposal.docx" with client@brandmint.ai as reader.'
          })
        });

      const confirmedOutcome = await executeChatGoogleDriveRequest(
        ownerScope,
        {
          kind: 'share_file',
          name: 'Strategic Proposal.docx',
          email: 'client@brandmint.ai',
          role: 'reader',
          confirmed: true,
          approvalToken: shareToken
        },
        service
      );

      expect(confirmedOutcome.assistantResponseText).toContain('Shared **Strategic Proposal.docx** with **client@brandmint.ai**');
    });

    it('handles Google Doc reading and PDF extraction with working links', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          operation: 'drive_read',
          file: {
            id: 'doc-pdf-1',
            name: 'Client Analysis.pdf',
            webViewLink: 'https://docs.google.com/file/d/doc-pdf-1',
            summary: 'Extracted PDF text: Client requested automated AI workflows.'
          }
        })
      });

      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });
      const outcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'read_document', name: 'Client Analysis.pdf' },
        service
      );

      expect(outcome.assistantResponseText).toContain('Client Analysis.pdf');
      expect(outcome.assistantResponseText).toContain('https://docs.google.com/file/d/doc-pdf-1');
      expect(outcome.assistantResponseText).toContain('Extracted PDF text');
    });

    it('handles file upload and rename/move operations', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_upload',
            file: {
              id: 'uploaded-1',
              name: 'notes.txt',
              webViewLink: 'https://drive.google.com/file/d/uploaded-1'
            }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_search',
            files: [{ id: 'uploaded-1', name: 'notes.txt' }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_rename_move',
            message: 'File renamed to final_notes.txt successfully.'
          })
        });

      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });

      // Upload
      const uploadOutcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'upload_file', name: 'notes.txt', content: 'Executive brief' },
        service
      );
      expect(uploadOutcome.assistantResponseText).toContain('Successfully uploaded **notes.txt**');
      expect(uploadOutcome.assistantResponseText).toContain('https://drive.google.com/file/d/uploaded-1');

      // Rename/Move
      const moveOutcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'rename_move', fileId: 'uploaded-1', query: 'final_notes.txt' },
        service
      );
      expect(moveOutcome.assistantResponseText).toContain('final_notes.txt');
    });

    it('executes multi-action sequence: search -> resolve latest file -> summarize -> return clickable link', async () => {
      const mockFetch = vi.fn()
        // 1. searchFiles returns matching files
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_search',
            files: [
              {
                id: '1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU',
                name: 'Custom Teamwear Reports',
                webViewLink: 'https://drive.google.com/file/d/1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU/view',
                modifiedTime: '2026-11-12T15:30:00Z'
              }
            ]
          })
        })
        // 2. readFile for summarization
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_read',
            file: {
              id: '1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU',
              name: 'Custom Teamwear Reports',
              webViewLink: 'https://drive.google.com/file/d/1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU/view',
              summary: 'Q3 Teamwear production report: 15,000 units delivered across 12 athletic franchises with 99.4% on-time fulfillment.'
            }
          })
        });

      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });
      const intent = detectGoogleDriveChatRequest(
        'Thaara, find my latest Custom Teamwear report in Google Drive, read it, and give me a short summary with the document link.'
      );
      expect(intent).not.toBeNull();
      expect(intent?.query).toBe('Custom Teamwear report');

      const outcome = await executeChatGoogleDriveRequest(ownerScope, intent!, service);
      expect(outcome.handled).toBe(true);
      expect(outcome.assistantResponseText).toContain('Executive Summary of "Custom Teamwear Reports"');
      expect(outcome.assistantResponseText).toContain('https://drive.google.com/file/d/1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU/view');
      expect(outcome.assistantResponseText).toContain('15,000 units delivered');
    });

    it('handles empty responses from n8n automation workflow gracefully without throwing errors', async () => {
      // Simulate n8n returning HTTP 200 with an empty body (e.g. 0 items matched search)
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => ''
      });

      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });
      const res = await service.searchFiles(ownerScope, { query: 'non_existent_file_xyz' });
      expect(res.success).toBe(true);
      expect(res.files).toEqual([]);

      const outcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'search_files', query: 'non_existent_file_xyz' },
        service
      );
      expect(outcome.handled).toBe(true);
      expect(outcome.assistantResponseText).toBe('No matching files found in your Google Drive.');
    });

    it('summarizes documents using model gateway when available', async () => {
      const mockModelGateway: Partial<ModelGatewayAdapter> = {
        streamResponse: vi.fn().mockImplementation(async function* () {
          yield { delta: 'Revenue up 40% with 12 enterprise pilots.' };
        })
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          operation: 'drive_read',
          file: {
            id: 'doc-789',
            name: 'Q3 Report.pdf',
            webViewLink: 'https://docs.google.com/file/d/doc-789',
            summary: 'Full raw document text of Q3 report'
          }
        })
      });

      const service = new GoogleDriveService({
        fetchFn: mockFetch as unknown as typeof fetch,
        modelGateway: mockModelGateway as unknown as ModelGatewayAdapter
      });

      const outcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'summarize_document', name: 'Q3 Report.pdf' },
        service
      );

      expect(outcome.assistantResponseText).toContain('Executive Summary');
      expect(outcome.assistantResponseText).toContain('Revenue up 40%');
    });

    it('reports truthful error state when n8n/Google Drive fails', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection timed out'));
      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });

      const outcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'search_files', query: 'missing' },
        service
      );

      expect(outcome.handled).toBe(true);
      expect(outcome.assistantResponseText).toContain('encountered an issue: Unable to connect to Google Drive service: Connection timed out');
    });

    it('enforces token expiration and rejects expired tokens', async () => {
      const mockFetch = vi.fn();
      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });

      const record = service.confirmationStore.createToken({
        workspaceId: ownerScope.workspaceId,
        userId: ownerScope.userId,
        fileId: 'file-exp-123',
        fileName: 'expired.pdf',
        operation: 'delete'
      });

      // Manually set expiration to the past
      record.expiresAt = Date.now() - 1000;

      const verification = service.confirmationStore.verifyAndConsume(
        record.token,
        ownerScope,
        'file-exp-123',
        'delete'
      );

      expect(verification.valid).toBe(false);
      expect(verification.reason).toContain('Confirmation token has expired');
    });

    it('prevents cross-user and cross-workspace token theft', async () => {
      const service = new GoogleDriveService();
      const record = service.confirmationStore.createToken({
        workspaceId: ownerScope.workspaceId,
        userId: ownerScope.userId,
        fileId: 'file-secret-456',
        fileName: 'financials.xlsx',
        operation: 'delete'
      });

      // Different user in same workspace tries to use token
      const attackerUserScope: AuthenticatedScope = {
        workspaceId: ownerScope.workspaceId,
        userId: '99999999-9999-9999-9999-999999999999',
        role: 'owner'
      };

      const userTheft = service.confirmationStore.verifyAndConsume(
        record.token,
        attackerUserScope,
        'file-secret-456',
        'delete'
      );
      expect(userTheft.valid).toBe(false);
      expect(userTheft.reason).toContain('does not belong to this user');

      // Different workspace tries to use token
      const attackerWorkspaceScope: AuthenticatedScope = {
        workspaceId: '88888888-8888-8888-8888-888888888888',
        userId: ownerScope.userId,
        role: 'owner'
      };

      const wsTheft = service.confirmationStore.verifyAndConsume(
        record.token,
        attackerWorkspaceScope,
        'file-secret-456',
        'delete'
      );
      expect(wsTheft.valid).toBe(false);
      expect(wsTheft.reason).toContain('does not belong to this workspace');
    });

    it('requires disambiguation when multiple files match a deletion target', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          operation: 'drive_search',
          files: [
            { id: 'f-1', name: 'Proposal.pdf' },
            { id: 'f-2', name: 'Proposal.pdf' }
          ]
        })
      });

      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });
      const outcome = await executeChatGoogleDriveRequest(
        ownerScope,
        { kind: 'delete_file', name: 'Proposal.pdf' },
        service
      );

      expect(outcome.assistantResponseText).toContain('Multiple files named "Proposal.pdf" exist in your Google Drive');
      expect(outcome.assistantResponseText).toContain('f-1');
      expect(outcome.assistantResponseText).toContain('f-2');
    });
  });

  describe('Natural Variations & Context Binding (Production Reliability)', () => {
    it('reliably detects natural variations without requiring explicit "google drive" keyword', () => {
      // 1. "check my latest drive"
      const i1 = detectGoogleDriveChatRequest('check my latest drive');
      expect(i1).not.toBeNull();
      expect(i1?.kind).toBe('search_files');
      expect(i1?.query).toBe('');

      // 2. "Check my latest Drive."
      const i2 = detectGoogleDriveChatRequest('Check my latest Drive.');
      expect(i2).not.toBeNull();
      expect(i2?.kind).toBe('search_files');

      // 3. "Show me my latest 5 files."
      const i3 = detectGoogleDriveChatRequest('Show me my latest 5 files.');
      expect(i3).not.toBeNull();
      expect(i3?.kind).toBe('search_files');
      expect(i3?.limit).toBe(5);
      expect(i3?.query).toBe('');

      // 4. "Show me my latest five files."
      const i4 = detectGoogleDriveChatRequest('Show me my latest five files.');
      expect(i4).not.toBeNull();
      expect(i4?.kind).toBe('search_files');
      expect(i4?.limit).toBe(5);
      expect(i4?.query).toBe('');

      // 5. "Find my documents."
      const i5 = detectGoogleDriveChatRequest('Find my documents.');
      expect(i5).not.toBeNull();
      expect(i5?.kind).toBe('search_files');
      expect(i5?.query).toBe('');

      // 6. "Open my latest report."
      const i6 = detectGoogleDriveChatRequest('Open my latest report.');
      expect(i6).not.toBeNull();
      expect(i6?.kind).toBe('search_files');
      expect(i6?.query).toBe('report');
      expect(i6?.autoRead).toBe(true);

      // 7. Exact post-deployment command 4a: "Find my latest Custom Teamwear report." (without "in Google Drive")
      const i7 = detectGoogleDriveChatRequest('Find my latest Custom Teamwear report.');
      expect(i7).not.toBeNull();
      expect(i7?.kind).toBe('search_files');
      expect(i7?.query).toBe('Custom Teamwear report');
      expect(i7?.autoRead).toBe(false);

      // 8. Conversational / channel non-interference
      expect(detectGoogleDriveChatRequest('Summarize it.')).toBeNull();
      expect(detectGoogleDriveChatRequest('Write a report on Q3 AI adoption')).toBeNull();
      expect(detectGoogleDriveChatRequest('Send an email with the report to Rahul')).toBeNull();
      expect(detectGoogleDriveChatRequest('Read this document.', undefined, { hasAttachments: true })).toBeNull();
    });

    it('extracts active Drive file and recent files from assistant conversation history', () => {
      const messages = [
        {
          sender_type: 'user',
          content: 'Find my latest Custom Teamwear report in Google Drive'
        },
        {
          sender_type: 'assistant',
          content:
            'Here are the matching files from your Google Drive (sorted by most recently modified):\n\n' +
            '1. **Custom Teamwear Reports** - [Open in Drive](https://drive.google.com/file/d/1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU/view) *(Modified: 11/12/2026)*\n' +
            '2. **Custom Teamwear Leads** - [Open in Drive](https://drive.google.com/file/d/1uL_15i1v3Ooxy2RP9ixdoBDKSWY_DhRBnXB4A6o7H9A/view)'
        }
      ];

      const context = extractDriveContextFromMessages(messages);
      expect(context.activeFile).toBeDefined();
      expect(context.activeFile?.id).toBe('1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU');
      expect(context.activeFile?.name).toBe('Custom Teamwear Reports');
      expect(context.activeFile?.webViewLink).toBe('https://drive.google.com/file/d/1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU/view');
      expect(context.recentFiles).toHaveLength(2);
    });

    it('binds follow-up commands ("Read this document", "Summarize it") to the active conversation file', () => {
      const context = {
        activeFile: {
          id: '1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU',
          name: 'Custom Teamwear Reports',
          webViewLink: 'https://drive.google.com/file/d/1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU/view',
          mimeType: 'application/vnd.google-apps.document'
        }
      };

      // Follow-up 1: "Read this document."
      const readIntent = detectGoogleDriveChatRequest('Read this document.', context);
      expect(readIntent).not.toBeNull();
      expect(readIntent?.kind).toBe('read_document');
      expect(readIntent?.fileId).toBe('1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU');
      expect(readIntent?.name).toBe('Custom Teamwear Reports');

      // Follow-up 2: "Summarize the file we just found."
      const sumIntent1 = detectGoogleDriveChatRequest('Summarize the file we just found.', context);
      expect(sumIntent1).not.toBeNull();
      expect(sumIntent1?.kind).toBe('summarize_document');
      expect(sumIntent1?.fileId).toBe('1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU');
      expect(sumIntent1?.name).toBe('Custom Teamwear Reports');

      // Follow-up 3: "Summarize it."
      const sumIntent2 = detectGoogleDriveChatRequest('Summarize it.', context);
      expect(sumIntent2).not.toBeNull();
      expect(sumIntent2?.kind).toBe('summarize_document');
      expect(sumIntent2?.fileId).toBe('1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU');
      expect(sumIntent2?.name).toBe('Custom Teamwear Reports');
    });

    it('prevents file identity substitution: NEVER substitutes Quantum Films when Custom Teamwear was requested', async () => {
      // Mock n8n returning an array where item 0 is unrelated Quantum Films, but item 1 is requested Custom Teamwear
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) || '{}');
        return {
          ok: true,
          json: async () => ({
            success: true,
            operation: body.operation,
            files: [
              {
                id: '1DjQUHrHLZbEDG_WVmD-gF-SlF1lEUG5T',
                name: 'Quantum Films_Storytelling Platform — Product and Implementation Cookbook.docx',
                webViewLink: 'https://drive.google.com/file/d/1DjQUHrHLZbEDG_WVmD-gF-SlF1lEUG5T/view'
              },
              {
                id: '1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU',
                name: 'Custom Teamwear Reports',
                webViewLink: 'https://drive.google.com/file/d/1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU/view'
              }
            ],
            // n8n sub 05 might have carelessly placed files[0] into file
            file: {
              id: '1DjQUHrHLZbEDG_WVmD-gF-SlF1lEUG5T',
              name: 'Quantum Films_Storytelling Platform — Product and Implementation Cookbook.docx',
              webViewLink: 'https://drive.google.com/file/d/1DjQUHrHLZbEDG_WVmD-gF-SlF1lEUG5T/view'
            },
            message: 'Successfully executed drive_read: found 2 items.'
          })
        };
      });

      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });

      // Execute summarizeDocument specifically for Custom Teamwear
      const result = await service.summarizeDocument(
        ownerScope,
        '1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU',
        'Custom Teamwear Reports'
      );

      // Invariant: result MUST strictly be Custom Teamwear, never Quantum Films!
      expect(result.file?.id).toBe('1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU');
      expect(result.file?.name).toBe('Custom Teamwear Reports');
      expect(result.message).not.toContain('Quantum Films');
    });

    it('truthfully reports when document content cannot be extracted directly, preserving the valid document link', async () => {
      // Mock n8n returning the document with no readable text extraction
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) || '{}');
        if (body.operation === 'drive_search') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              operation: 'drive_search',
              files: [
                {
                  id: '1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU',
                  name: 'Custom Teamwear Reports',
                  webViewLink: 'https://drive.google.com/file/d/1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU/view'
                }
              ]
            })
          };
        }
        return {
          ok: true,
          json: async () => ({
            success: true,
            operation: 'drive_read',
            file: {
              id: '1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU',
              name: 'Custom Teamwear Reports',
              webViewLink: 'https://drive.google.com/file/d/1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU/view',
              summary: '' // No text extracted
            },
            message: 'Successfully executed drive_read: found 1 items.'
          })
        };
      });

      const service = new GoogleDriveService({ fetchFn: mockFetch as unknown as typeof fetch });
      const intent = detectGoogleDriveChatRequest(
        'Thaara, find my latest Custom Teamwear report in Google Drive, read it, and give me a short summary with the document link.'
      );
      expect(intent).not.toBeNull();

      const outcome = await executeChatGoogleDriveRequest(ownerScope, intent!, service);
      expect(outcome.handled).toBe(true);
      expect(outcome.assistantResponseText).toContain('Executive Summary of "Custom Teamwear Reports"');
      expect(outcome.assistantResponseText).toContain(
        'The document "Custom Teamwear Reports" has been retrieved from your Google Drive. Its full text content could not be extracted directly for automated summarization, but it is accessible in Google Drive:'
      );
      expect(outcome.assistantResponseText).toContain(
        'https://drive.google.com/file/d/1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU/view'
      );
      expect(outcome.assistantResponseText).not.toContain('Quantum Films');
      expect(outcome.assistantResponseText).not.toContain('found 10 items');
    });
  });
});
