/**
 * Secure Chat Attachment Storage and Document Parsing Service.
 *
 * Implements:
 * - Server-side MIME & file signature/magic-byte validation.
 * - Safe size (<= 10MB) and count (<= 5) limits.
 * - Native text extraction for PDF, DOCX, XLSX, CSV, and TXT without external dependencies.
 * - Scoped in-memory & file storage with strict workspace/user authorization.
 * - Untrusted content demarcation for model context.
 */

import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync, inflateSync, unzipSync } from 'node:zlib';
import type { AuthenticatedScope } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';

export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const CHAT_ATTACHMENT_MAX_COUNT = 5;
export const MAX_EXTRACTED_TEXT_LENGTH = 60000; // ~15k tokens cap

export type SupportedAttachmentMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf'
  | 'text/plain'
  | 'text/csv'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // docx
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; // xlsx

export interface ChatAttachmentRecord {
  id: string;
  workspaceId: string;
  userId: string;
  conversationId: string;
  filename: string;
  mimeType: SupportedAttachmentMime;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  extractedText?: string;
  thumbnailBase64?: string;
  bytes: Buffer;
}

export interface AttachmentSummary {
  id: string;
  filename: string;
  mimeType: SupportedAttachmentMime;
  sizeBytes: number;
  extractedTextLength?: number;
  hasThumbnail: boolean;
}

/**
 * Validates magic bytes against claimed MIME type.
 */
export function verifyFileSignature(bytes: Buffer, declaredMime: string): SupportedAttachmentMime {
  if (bytes.length < 4) {
    throw new AppError('File too small or empty to verify signature.', 'ATTACHMENT_INVALID', 400);
  }

  const mime = declaredMime.toLowerCase().split(';')[0]!.trim();

  // 1. JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // 3. WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  // 4. PDF: %PDF- (25 50 44 46 2D)
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'application/pdf';
  }

  // 5. ZIP-based OOXML formats: PK\x03\x04 (50 4B 03 04)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    if (mime.includes('wordprocessingml') || mime.includes('docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (mime.includes('spreadsheetml') || mime.includes('xlsx')) {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    // Ambiguous PK file without matching mime
    throw new AppError('Unsupported or unrecognized zip document type.', 'ATTACHMENT_UNSUPPORTED', 400);
  }

  // 6. Plain Text / CSV / TSV: Must be valid UTF-8 (including Windows Excel CSV MIME 'application/vnd.ms-excel')
  if (
    mime === 'text/csv' ||
    mime === 'text/plain' ||
    mime === 'text/tab-separated-values' ||
    mime === 'application/csv' ||
    mime === 'application/vnd.ms-excel'
  ) {
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      decoder.decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
      return mime === 'text/plain' ? 'text/plain' : 'text/csv';
    } catch {
      throw new AppError('Text or CSV file is not valid UTF-8.', 'ATTACHMENT_INVALID', 400);
    }
  }

  throw new AppError(`Unsupported file format '${declaredMime}'.`, 'ATTACHMENT_UNSUPPORTED', 400);
}

export const validateMagicBytes = verifyFileSignature;

function decodePdfUtf16Hex(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (!clean || clean.length % 2 !== 0) return '';
  if (clean.length >= 4 && clean.length % 4 === 0) {
    let out = '';
    for (let i = 0; i < clean.length; i += 4) {
      const cp = parseInt(clean.slice(i, i + 4), 16);
      if (!Number.isNaN(cp) && cp > 0) out += String.fromCharCode(cp);
    }
    return out;
  }
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const b = parseInt(clean.slice(i, i + 2), 16);
    if (!Number.isNaN(b)) bytes.push(b);
  }
  return Buffer.from(bytes).toString('latin1');
}

function parsePdfToUnicodeCmap(streamText: string, cmap: Map<string, string>): void {
  if (!streamText.includes('beginbfchar') && !streamText.includes('beginbfrange')) return;

  const bfcharBlocks = streamText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g);
  for (const blk of bfcharBlocks) {
    const pairs = (blk[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g);
    for (const pair of pairs) {
      const src = pair[1]!.toUpperCase();
      const dst = decodePdfUtf16Hex(pair[2]!);
      if (dst) cmap.set(src, dst);
    }
  }

  const bfrangeBlocks = streamText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g);
  for (const blk of bfrangeBlocks) {
    const body = blk[1] ?? '';
    // Array form: <start> <end> [<u1> <u2> ...]
    const arrRanges = body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g);
    for (const r of arrRanges) {
      const start = parseInt(r[1]!, 16);
      const end = parseInt(r[2]!, 16);
      const width = r[1]!.length;
      const items = [...(r[3] ?? '').matchAll(/<([0-9A-Fa-f]+)>/g)].map(m => m[1]!);
      const limit = Math.min(end - start + 1, items.length, 4096);
      for (let i = 0; i < limit; i++) {
        const key = (start + i).toString(16).toUpperCase().padStart(width, '0');
        const dst = decodePdfUtf16Hex(items[i]!);
        if (dst) cmap.set(key, dst);
      }
    }
    // Scalar form: <start> <end> <destStart>
    const scalarRanges = body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g);
    for (const r of scalarRanges) {
      const start = parseInt(r[1]!, 16);
      const end = parseInt(r[2]!, 16);
      const destStart = parseInt(r[3]!, 16);
      const srcWidth = r[1]!.length;
      const dstWidth = Math.max(4, r[3]!.length);
      const count = Math.min(end - start + 1, 4096);
      for (let i = 0; i < count; i++) {
        const key = (start + i).toString(16).toUpperCase().padStart(srcWidth, '0');
        const dstHex = (destStart + i).toString(16).toUpperCase().padStart(dstWidth, '0');
        const dst = decodePdfUtf16Hex(dstHex);
        if (dst) cmap.set(key, dst);
      }
    }
  }
}

const WINANSI_C1_MAP: Record<number, string> = {
  0x7f: ' • ',
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ'
};

function decodePdfWinAnsiCode(code: number): string {
  if (WINANSI_C1_MAP[code] !== undefined) return WINANSI_C1_MAP[code]!;
  return String.fromCharCode(code);
}

function decodePdfAscii85(bytes: Buffer): Buffer | null {
  let s = bytes.toString('latin1');
  const eod = s.indexOf('~>');
  if (eod >= 0) s = s.slice(0, eod);
  const out: number[] = [];
  const tuple: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch <= 32) continue;
    if (ch === 122 && tuple.length === 0) {
      // 'z' shorthand for four zero bytes
      out.push(0, 0, 0, 0);
      continue;
    }
    if (ch < 33 || ch > 117) {
      return null;
    }
    tuple.push(ch - 33);
    if (tuple.length === 5) {
      let val = 0;
      for (const d of tuple) val = val * 85 + d;
      out.push((val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff);
      tuple.length = 0;
    }
  }
  if (tuple.length === 1) return null;
  if (tuple.length > 1) {
    const pad = 5 - tuple.length;
    for (let i = 0; i < pad; i++) tuple.push(84);
    let val = 0;
    for (const d of tuple) val = val * 85 + d;
    const tail = [(val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff];
    for (let i = 0; i < 4 - pad; i++) out.push(tail[i]!);
  }
  return out.length > 0 ? Buffer.from(out) : null;
}

function decodePdfAsciiHex(bytes: Buffer): Buffer | null {
  let s = bytes.toString('latin1');
  const eod = s.indexOf('>');
  if (eod >= 0) s = s.slice(0, eod);
  const hex = s.replace(/\s+/g, '');
  if (!hex || !/^[0-9A-Fa-f]+$/.test(hex)) return null;
  const padded = hex.length % 2 === 1 ? `${hex}0` : hex;
  return Buffer.from(padded, 'hex');
}

function decodePdfLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch !== '\\') {
      const code = ch.charCodeAt(0);
      out += code >= 0x7f && code <= 0x9f ? decodePdfWinAnsiCode(code) : ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    i++;
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === 'b') out += '\b';
    else if (next === 'f') out += '\f';
    else if (next === '(' || next === ')' || next === '\\') out += next;
    else if (next === '\r' || next === '\n') {
      if (next === '\r' && raw[i + 1] === '\n') i++;
    } else if (/[0-7]/.test(next)) {
      let oct = next;
      if (i + 1 < raw.length && /[0-7]/.test(raw[i + 1]!)) {
        oct += raw[++i]!;
        if (i + 1 < raw.length && /[0-7]/.test(raw[i + 1]!)) oct += raw[++i]!;
      }
      const code = parseInt(oct, 8);
      if (!Number.isNaN(code) && code >= 9) out += decodePdfWinAnsiCode(code);
    } else {
      out += next;
    }
  }
  return out;
}

function decodePdfHexString(hexRaw: string, cmap: Map<string, string>): string {
  const hex = hexRaw.replace(/\s+/g, '').toUpperCase();
  if (!hex || hex.length % 2 !== 0) return '';

  // UTF-16BE BOM
  if (hex.startsWith('FEFF') && hex.length >= 8 && hex.length % 4 === 0) {
    return decodePdfUtf16Hex(hex.slice(4));
  }

  // Try 4-hex-digit (2-byte CID) CMap lookup first if CMap has 4-digit keys
  if (cmap.size > 0 && hex.length % 4 === 0) {
    let mapped4 = '';
    let hits4 = 0;
    const total4 = hex.length / 4;
    for (let i = 0; i < hex.length; i += 4) {
      const code = hex.slice(i, i + 4);
      const ch = cmap.get(code);
      if (ch !== undefined) {
        mapped4 += ch;
        hits4++;
      }
    }
    if (hits4 > 0 && hits4 >= total4 * 0.5) {
      return mapped4;
    }
  }

  // Try 2-hex-digit (1-byte) CMap lookup
  if (cmap.size > 0) {
    let mapped2 = '';
    let hits2 = 0;
    const total2 = hex.length / 2;
    for (let i = 0; i < hex.length; i += 2) {
      const code = hex.slice(i, i + 2);
      const ch = cmap.get(code);
      if (ch !== undefined) {
        mapped2 += ch;
        hits2++;
      } else {
        const b = parseInt(code, 16);
        if (b >= 32 && b <= 126) mapped2 += String.fromCharCode(b);
      }
    }
    if (hits2 > 0 && hits2 >= total2 * 0.3) {
      return mapped2;
    }
  }

  // Fallback: direct UTF-16BE (00XX pairs) or printable ASCII/Latin-1 bytes
  if (hex.length >= 4 && hex.length % 4 === 0) {
    let zeroHigh = 0;
    for (let i = 0; i < hex.length; i += 4) {
      if (hex.slice(i, i + 2) === '00') zeroHigh++;
    }
    if (zeroHigh >= (hex.length / 4) * 0.6) {
      return decodePdfUtf16Hex(hex);
    }
  }

  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    const b = parseInt(hex.slice(i, i + 2), 16);
    if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) {
      out += String.fromCharCode(b);
    }
  }
  return out;
}

function mergeWrappedPdfBlockLines(blockLines: string[]): string[] {
  if (blockLines.length <= 1) return blockLines;
  const merged: string[] = [];
  for (const rawLine of blockLines) {
    const line = rawLine.trim();
    if (!line) continue;
    const prev = merged[merged.length - 1];
    const startsNewLogicalLine =
      /^(?:[-*•–—]|\d{1,2}[.)]\s|[A-Za-z][A-Za-z0-9 /&()-]{1,36}:\s|Q(?:\d+)?\s*[:.-]|A(?:\d+)?\s*[:.-]|Question\s*[:.-]|Answer\s*[:.-])/i.test(
        line
      );
    const prevEndedCleanly = prev ? /[.!?:]$/.test(prev) : true;
    if (prev && !prevEndedCleanly && !startsNewLogicalLine && prev.length < 480) {
      merged[merged.length - 1] = `${prev} ${line}`.replace(/\s+/g, ' ').trim();
    } else {
      merged.push(line);
    }
  }
  return merged;
}

function extractLinesFromPdfContentStream(decompressed: string, cmap: Map<string, string>): string[] {
  const lines: string[] = [];
  const blocks = [...decompressed.matchAll(/BT\b([\s\S]*?)\bET/g)];
  const sources = blocks.length > 0 ? blocks.map(b => b[1] ?? '') : [decompressed];

  for (const src of sources) {
    const blockLines: string[] = [];
    let cur = '';
    // Scan literal strings (...), hex strings <...>, TJ arrays [...], and text operators
    let i = 0;
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === '(') {
        // Read balanced/escaped literal string
        let depth = 1;
        let j = i + 1;
        let raw = '';
        while (j < src.length && depth > 0) {
          const c = src[j]!;
          if (c === '\\' && j + 1 < src.length) {
            raw += c + src[j + 1]!;
            j += 2;
            continue;
          }
          if (c === '(') depth++;
          else if (c === ')') {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
          raw += c;
          j++;
        }
        const after = src.slice(j, j + 16);
        if (/^\s*(?:Tj|'|"|\r?\n)/.test(after)) {
          cur += decodePdfLiteralString(raw);
        }
        i = j;
        continue;
      }
      if (ch === '<' && src[i + 1] !== '<') {
        const end = src.indexOf('>', i + 1);
        if (end > i) {
          const hex = src.slice(i + 1, end);
          const after = src.slice(end + 1, end + 16);
          if (/^[0-9A-Fa-f\s]+$/.test(hex) && /^\s*(?:Tj|'|")/.test(after)) {
            cur += decodePdfHexString(hex, cmap);
          }
          i = end + 1;
          continue;
        }
      }
      if (ch === '[') {
        // Parse TJ array: [...] TJ
        let j = i + 1;
        let arrOut = '';
        let inParen = false;
        let depth = 0;
        while (j < src.length) {
          const c = src[j]!;
          if (inParen) {
            if (c === '\\' && j + 1 < src.length) {
              j += 2;
              continue;
            }
            if (c === '(') depth++;
            else if (c === ')') {
              depth--;
              if (depth === 0) inParen = false;
            }
            j++;
            continue;
          }
          if (c === ']') {
            j++;
            break;
          }
          if (c === '(') {
            let d = 1;
            let k = j + 1;
            let raw = '';
            while (k < src.length && d > 0) {
              const cc = src[k]!;
              if (cc === '\\' && k + 1 < src.length) {
                raw += cc + src[k + 1]!;
                k += 2;
                continue;
              }
              if (cc === '(') d++;
              else if (cc === ')') {
                d--;
                if (d === 0) {
                  k++;
                  break;
                }
              }
              raw += cc;
              k++;
            }
            arrOut += decodePdfLiteralString(raw);
            j = k;
            continue;
          }
          if (c === '<' && src[j + 1] !== '<') {
            const end = src.indexOf('>', j + 1);
            if (end > j) {
              const hex = src.slice(j + 1, end);
              if (/^[0-9A-Fa-f\s]+$/.test(hex)) {
                arrOut += decodePdfHexString(hex, cmap);
              }
              j = end + 1;
              continue;
            }
          }
          // Kerning number: negative shift < -120 typically indicates a word space
          const numMatch = src.slice(j).match(/^(-?\d+(?:\.\d+)?)/);
          if (numMatch) {
            const val = Number(numMatch[1]);
            if (val < -120 && arrOut && !arrOut.endsWith(' ')) {
              arrOut += ' ';
            }
            j += numMatch[1]!.length;
            continue;
          }
          j++;
        }
        const after = src.slice(j, j + 10);
        if (/^\s*TJ\b/.test(after) && arrOut) {
          cur += arrOut;
        }
        i = j;
        continue;
      }
      // Line break operators (Td, TD, T*, Tm)
      if (
        ch === 'T' &&
        (src[i + 1] === 'd' || src[i + 1] === 'D' || src[i + 1] === '*' || src[i + 1] === 'm') &&
        (i === 0 || /\s/.test(src[i - 1]!))
      ) {
        if (cur.trim()) {
          blockLines.push(cur.replace(/\s+/g, ' ').trim());
          cur = '';
        }
        i += 2;
        continue;
      }
      i++;
    }
    if (cur.trim()) {
      blockLines.push(cur.replace(/\s+/g, ' ').trim());
    }
    if (blockLines.length > 0) {
      lines.push(...mergeWrappedPdfBlockLines(blockLines));
    }
  }
  return lines;
}

function tryInflatePdfBuffer(buf: Buffer): Buffer | null {
  try {
    return inflateSync(buf);
  } catch {
    try {
      return unzipSync(buf);
    } catch {
      try {
        return inflateRawSync(buf);
      } catch {
        return null;
      }
    }
  }
}

/**
 * Extracts plain text from simple, Flate, ASCII85+Flate (e.g. ReportLab), ASCIIHex, or CIDFont/ToUnicode CMap PDF buffers.
 */
export function extractTextFromPdf(bytes: Buffer): string {
  const content = bytes.toString('binary');
  const decompressedStreams: string[] = [];

  // Match stream ... endstream (supports LF, CRLF, or CR terminators)
  const streamRegex = /stream(?:\r\n|\n|\r)([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(content)) !== null) {
    const dictWindowStart = Math.max(0, match.index - 400);
    const precedingDict = content.slice(dictWindowStart, match.index);

    // Skip embedded non-text binary payloads (e.g., C2PA manifests, raster images, font binaries)
    if (
      /\/Type\s*\/EmbeddedFile\b/.test(precedingDict) ||
      /\/Subtype\s*\/(?:Image|Type1C|CIDFontType0C|OpenType)\b/.test(precedingDict)
    ) {
      continue;
    }

    let rawBin = match[1]!;
    if (rawBin.endsWith('\r\n')) rawBin = rawBin.slice(0, -2);
    else if (rawBin.endsWith('\n') || rawBin.endsWith('\r')) rawBin = rawBin.slice(0, -1);
    let workingBuf: Buffer = Buffer.from(rawBin, 'binary');

    const hasAscii85 = /\/ASCII85Decode\b/.test(precedingDict) || (rawBin.includes('~>') && !/[\x00-\x08\x0E-\x1F\x80-\xFF]/.test(rawBin.slice(0, 64)));
    const hasAsciiHex = /\/ASCIIHexDecode\b/.test(precedingDict);

    if (hasAscii85) {
      const decoded85 = decodePdfAscii85(workingBuf);
      if (decoded85 && decoded85.length > 0) {
        workingBuf = decoded85;
      }
    } else if (hasAsciiHex) {
      const decodedHex = decodePdfAsciiHex(workingBuf);
      if (decodedHex && decodedHex.length > 0) {
        workingBuf = decodedHex;
      }
    }

    const inflated = tryInflatePdfBuffer(workingBuf);
    const decompressed = inflated ? inflated.toString('latin1') : workingBuf.toString('latin1');

    if (decompressed) {
      decompressedStreams.push(decompressed);
    }
  }

  // Pass 1: collect all ToUnicode CMap tables from decompressed streams (including CID fonts)
  const cmap = new Map<string, string>();
  for (const s of decompressedStreams) {
    parsePdfToUnicodeCmap(s, cmap);
  }
  parsePdfToUnicodeCmap(content, cmap);

  // Pass 2: extract readable text lines from every content stream
  const textLines: string[] = [];
  for (const s of decompressedStreams) {
    if (s.includes('beginbfchar') || s.includes('beginbfrange')) continue;
    const extracted = extractLinesFromPdfContentStream(s, cmap);
    if (extracted.length > 0) {
      textLines.push(...extracted);
    }
  }

  // Also scan raw top-level content (excluding PDF % comment lines) if PDF stores text uncompressed outside streams
  if (textLines.length === 0) {
    const contentWithoutComments = content.replace(/^%[^\r\n]*/gm, '');
    textLines.push(...extractLinesFromPdfContentStream(contentWithoutComments, cmap));
  }

  const cleanedLines = textLines
    .map(l => l.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 0 && /[A-Za-z0-9\u0900-\u0DFF]/.test(l));

  if (cleanedLines.length === 0) {
    const isRasterImagePdf = content.includes('/Image') || content.includes('/XObject');
    if (isRasterImagePdf) {
      return '[Scanned or image-only PDF: No embedded digital text layer found. OCR processing required for visual extraction.]';
    }
    const ascii = bytes.toString('utf-8').replace(/[^\x20-\x7E\r\n\t]/g, ' ');
    const readable = ascii
      .split(/\s{2,}/)
      .filter((s) => s.trim().length > 3 && !s.includes('<<') && !s.includes('>>'));
    if (readable.length > 0) {
      return readable.slice(0, 30).join('\n').slice(0, MAX_EXTRACTED_TEXT_LENGTH);
    }
    return '[Scanned or empty PDF: No readable text layers detected.]';
  }

  return cleanedLines.join('\n').slice(0, MAX_EXTRACTED_TEXT_LENGTH);
}

/**
 * Extracts text from DOCX (PK ZIP containing word/document.xml).
 */
export function extractTextFromDocx(bytes: Buffer): string {
  const bufferString = bytes.toString('binary');
  // Simple ZIP directory search for word/document.xml
  const fileHeaderIndex = bufferString.indexOf('word/document.xml');
  if (fileHeaderIndex === -1) {
    return 'Unable to locate document text in DOCX file.';
  }

  // Find stream offset
  const localHeaderOffset = bufferString.lastIndexOf('PK\x03\x04', fileHeaderIndex);
  if (localHeaderOffset === -1) {
    return 'Invalid DOCX structure.';
  }

  try {
    const compressedSize = bytes.readUInt32LE(localHeaderOffset + 18);
    const fnLen = bytes.readUInt16LE(localHeaderOffset + 26);
    const extraLen = bytes.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + fnLen + extraLen;
    const compressedData =
      compressedSize > 0
        ? bytes.subarray(dataStart, dataStart + compressedSize)
        : bytes.subarray(dataStart);
    let xml = '';
    try {
      xml = inflateRawSync(compressedData).toString('utf-8');
    } catch {
      xml = inflateRawSync(bytes.subarray(dataStart)).toString('utf-8');
    }

    // Extract all text inside <w:t> tags
    const textPieces = xml.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
    return textPieces
      .map((p) => p.replace(/<[^>]+>/g, ''))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .slice(0, MAX_EXTRACTED_TEXT_LENGTH);
  } catch {
    return 'DOCX content parsed (complex formatting omitted).';
  }
}

/**
 * Extracts text from XLSX (PK ZIP containing xl/sharedStrings.xml or xl/worksheets/sheet1.xml).
 */
export function extractTextFromXlsx(bytes: Buffer): string {
  const bufferString = bytes.toString('binary');
  const sharedStringsIdx = bufferString.indexOf('xl/sharedStrings.xml');
  const pieces: string[] = [];

  if (sharedStringsIdx !== -1) {
    const localHeaderOffset = bufferString.lastIndexOf('PK\x03\x04', sharedStringsIdx);
    if (localHeaderOffset !== -1) {
      try {
        const compressedSize = bytes.readUInt32LE(localHeaderOffset + 18);
        const fnLen = bytes.readUInt16LE(localHeaderOffset + 26);
        const extraLen = bytes.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + fnLen + extraLen;
        const compressedData =
          compressedSize > 0
            ? bytes.subarray(dataStart, dataStart + compressedSize)
            : bytes.subarray(dataStart);
        let xml = '';
        try {
          xml = inflateRawSync(compressedData).toString('utf-8');
        } catch {
          xml = inflateRawSync(bytes.subarray(dataStart)).toString('utf-8');
        }
        const strings = xml.match(/<t[^>]*>(.*?)<\/t>/g) || [];
        for (const s of strings) {
          const clean = s.replace(/<[^>]+>/g, '').trim();
          if (clean) pieces.push(clean);
        }
      } catch {
        // Fallback
      }
    }
  }

  // Also check sheet1.xml for cell values (<v>123</v>) if sharedStrings was empty or sparse
  const sheetIdx = bufferString.indexOf('xl/worksheets/sheet1.xml');
  if (sheetIdx !== -1 && pieces.length < 5) {
    const localHeaderOffset = bufferString.lastIndexOf('PK\x03\x04', sheetIdx);
    if (localHeaderOffset !== -1) {
      try {
        const compressedSize = bytes.readUInt32LE(localHeaderOffset + 18);
        const fnLen = bytes.readUInt16LE(localHeaderOffset + 26);
        const extraLen = bytes.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + fnLen + extraLen;
        const compressedData =
          compressedSize > 0
            ? bytes.subarray(dataStart, dataStart + compressedSize)
            : bytes.subarray(dataStart);
        let xml = '';
        try {
          xml = inflateRawSync(compressedData).toString('utf-8');
        } catch {
          xml = inflateRawSync(bytes.subarray(dataStart)).toString('utf-8');
        }
        const cellVals = xml.match(/<v>(.*?)<\/v>/g) || [];
        for (const v of cellVals.slice(0, 100)) {
          const clean = v.replace(/<[^>]+>/g, '').trim();
          if (clean) pieces.push(clean);
        }
      } catch {
        // Fallback
      }
    }
  }

  if (pieces.length === 0) {
    return 'Spreadsheet data loaded (tabular structure parsed).';
  }

  return `Spreadsheet Data (${pieces.length} entries):\n${pieces.slice(0, 200).join(' | ')}`.slice(
    0,
    MAX_EXTRACTED_TEXT_LENGTH
  );
}

/**
 * Extracts structured text from CSV.
 */
export function parseCsvContent(bytes: Buffer): string {
  const text = bytes.toString('utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const preview = lines.slice(0, 100).join('\n');
  return `CSV Data (${lines.length} rows):\n${preview}`.slice(0, MAX_EXTRACTED_TEXT_LENGTH);
}

/**
 * Scoped in-memory attachment repository.
 */
export class ChatAttachmentStore {
  private readonly items = new Map<string, ChatAttachmentRecord>();

  async save(
    scope: AuthenticatedScope,
    conversationId: string,
    file: { filename: string; mimeType: string; bytes: Buffer }
  ): Promise<ChatAttachmentRecord> {
    if (file.bytes.length > CHAT_ATTACHMENT_MAX_BYTES) {
      throw new AppError(
        `File exceeds maximum limit of 10 MB (received ${(file.bytes.length / (1024 * 1024)).toFixed(2)} MB).`,
        'ATTACHMENT_TOO_LARGE',
        400
      );
    }

    const verifiedMime = verifyFileSignature(file.bytes, file.mimeType);
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');
    const id = randomUUID();

    let extractedText: string | undefined;
    let thumbnailBase64: string | undefined;

    if (verifiedMime === 'application/pdf') {
      extractedText = extractTextFromPdf(file.bytes);
    } else if (
      verifiedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      extractedText = extractTextFromDocx(file.bytes);
    } else if (
      verifiedMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      extractedText = extractTextFromXlsx(file.bytes);
    } else if (verifiedMime === 'text/csv') {
      extractedText = parseCsvContent(file.bytes);
    } else if (verifiedMime === 'text/plain') {
      extractedText = file.bytes.toString('utf-8').slice(0, MAX_EXTRACTED_TEXT_LENGTH);
    } else if (verifiedMime.startsWith('image/')) {
      thumbnailBase64 = `data:${verifiedMime};base64,${file.bytes.subarray(0, 204800).toString('base64')}`;
      extractedText = `Image attachment: ${file.filename} (${verifiedMime}, ${file.bytes.length} bytes)`;
    }

    const record: ChatAttachmentRecord = {
      id,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      conversationId,
      filename: file.filename.replace(/[^a-zA-Z0-9._-]/g, '_'),
      mimeType: verifiedMime,
      sizeBytes: file.bytes.length,
      sha256,
      createdAt: new Date().toISOString(),
      extractedText,
      thumbnailBase64,
      bytes: file.bytes
    };

    this.items.set(id, record);
    return record;
  }

  async findById(scope: AuthenticatedScope, id: string): Promise<ChatAttachmentRecord | null> {
    const record = this.items.get(id);
    if (!record) return null;
    if (record.workspaceId !== scope.workspaceId) {
      throw new ForbiddenError('Access to attachment denied.');
    }
    return record;
  }

  async listByConversation(
    scope: AuthenticatedScope,
    conversationId: string
  ): Promise<AttachmentSummary[]> {
    const matches: AttachmentSummary[] = [];
    for (const record of this.items.values()) {
      if (record.workspaceId === scope.workspaceId && record.conversationId === conversationId) {
        matches.push({
          id: record.id,
          filename: record.filename,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          extractedTextLength: record.extractedText?.length,
          hasThumbnail: Boolean(record.thumbnailBase64)
        });
      }
    }
    return matches;
  }
}

export const globalChatAttachmentStore = new ChatAttachmentStore();
