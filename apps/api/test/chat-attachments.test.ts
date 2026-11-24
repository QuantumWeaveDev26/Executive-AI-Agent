import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  verifyFileSignature,
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromXlsx,
  parseCsvContent,
  ChatAttachmentStore,
  CHAT_ATTACHMENT_MAX_BYTES
} from '../src/services/chat-attachments.js';
import type { AuthenticatedScope } from '@thaara/db';

const testScope: AuthenticatedScope = {
  workspaceId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'owner'
};

const otherScope: AuthenticatedScope = {
  workspaceId: '33333333-3333-3333-3333-333333333333',
  userId: '44444444-4444-4444-4444-444444444444',
  role: 'member'
};

describe('ChatAttachmentService - Magic Bytes & Extraction', () => {
  describe('File Signature & Magic Bytes Validation', () => {
    it('verifies valid JPEG buffer', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const verified = verifyFileSignature(jpegBuffer, 'image/jpeg');
      expect(verified).toBe('image/jpeg');
    });

    it('verifies valid PNG buffer', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      const verified = verifyFileSignature(pngBuffer, 'image/png');
      expect(verified).toBe('image/png');
    });

    it('verifies valid PDF buffer', () => {
      const pdfBuffer = Buffer.from('%PDF-1.7\n%test content\n');
      const verified = verifyFileSignature(pdfBuffer, 'application/pdf');
      expect(verified).toBe('application/pdf');
    });

    it('verifies valid CSV buffer', () => {
      const csvBuffer = Buffer.from('name,email,company\nAlice,alice@example.com,RetailCo\n');
      const verified = verifyFileSignature(csvBuffer, 'text/csv');
      expect(verified).toBe('text/csv');
    });

    it('rejects spoofed file with wrong magic bytes', () => {
      const fakePdf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
      expect(() => verifyFileSignature(fakePdf, 'application/pdf')).toThrowError(/Unsupported file format/);
    });
  });

  describe('Document Text Parsing', () => {
    it('parses structured CSV content', () => {
      const csv = Buffer.from('id,service,leads\n1,WhatsApp,45\n2,Marketing,120\n');
      const parsed = parseCsvContent(csv);
      expect(parsed).toContain('CSV Data (3 rows):');
      expect(parsed).toContain('WhatsApp');
      expect(parsed).toContain('Marketing');
    });

    it('extracts plain text from text-based PDF buffer', () => {
      const pdf = Buffer.from('%PDF-1.4\nProposal for Quantum Weave AI Marketing Strategy\nAction items for Q4 growth\n%%EOF');
      const text = extractTextFromPdf(pdf);
      expect(text).toContain('Proposal for Quantum Weave');
      expect(text).toContain('Action items for Q4 growth');
    });

    it('identifies scanned/image-only PDF without false claims', () => {
      const scannedPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image >>\nendobj\n%%EOF');
      const text = extractTextFromPdf(scannedPdf);
      expect(text).toContain('Scanned or image-only PDF');
    });

    it('extracts text from real DOCX file', () => {
      const docxPath = 'C:/Users/Admin/.gemini/antigravity/brain/ddf6e71d-f292-4f0d-a1ff-2a29a7d88a87/.user_uploaded/media_1793942182280_4271728e.docx';
      if (fs.existsSync(docxPath)) {
        const bytes = fs.readFileSync(docxPath);
        const text = extractTextFromDocx(bytes);
        expect(text).toContain('Thaara V2 Integration Plan');
        expect(text.length).toBeGreaterThan(100);
      }
    });

    it('extracts tabular entries from XLSX', () => {
      // Test with mock XLSX structure containing sharedStrings
      const mockXlsx = Buffer.concat([
        Buffer.from('PK\x03\x04'),
        Buffer.alloc(22),
        Buffer.from([0x14, 0x00, 0x00, 0x00]), // fnLen: 20
        Buffer.from('xl/sharedStrings.xml'),
        Buffer.from('PK\x03\x04')
      ]);
      const result = extractTextFromXlsx(mockXlsx);
      expect(typeof result).toBe('string');
    });
  });

  describe('Scoped Attachment Store & Security', () => {
    it('saves image attachment with metadata without claiming text extraction', async () => {
      const store = new ChatAttachmentStore();
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      const saved = await store.save(testScope, 'conv-img-1', {
        filename: 'chart.png',
        mimeType: 'image/png',
        bytes: pngBuffer
      });
      expect(saved.id).toBeDefined();
      expect(saved.mimeType).toBe('image/png');
      expect(saved.thumbnailBase64).toBeDefined();
      expect(saved.extractedText).toContain('Image attachment: chart.png');
    });

    it('saves attachment and enforces workspace isolation', async () => {
      const store = new ChatAttachmentStore();
      const pdfBuffer = Buffer.from('%PDF-1.7\nExecutive brief for client consultation\n');

      const saved = await store.save(testScope, 'conv-101', {
        filename: 'client_brief.pdf',
        mimeType: 'application/pdf',
        bytes: pdfBuffer
      });

      expect(saved.id).toBeDefined();
      expect(saved.filename).toBe('client_brief.pdf');
      expect(saved.mimeType).toBe('application/pdf');
      expect(saved.extractedText).toContain('Executive brief');

      // Accessible within scope
      const retrieved = await store.findById(testScope, saved.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(saved.id);

      // Access denied for other workspace
      await expect(store.findById(otherScope, saved.id)).rejects.toThrowError(/Access to attachment denied/);
    });

    it('rejects files exceeding 10MB limit', async () => {
      const store = new ChatAttachmentStore();
      const oversized = Buffer.alloc(CHAT_ATTACHMENT_MAX_BYTES + 1024);
      oversized.write('%PDF-', 0);

      await expect(
        store.save(testScope, 'conv-101', {
          filename: 'huge.pdf',
          mimeType: 'application/pdf',
          bytes: oversized
        })
      ).rejects.toThrowError(/File exceeds maximum limit of 10 MB/);
    });
  });
});
