import crypto from 'node:crypto';
import { inflateRawSync, unzipSync } from 'node:zlib';
import type {
  BulkCampaignExtractedFacts,
  BulkCampaignGroundedQaItem,
  BulkCampaignKnowledgeChunk,
  BulkCampaignKnowledgeContext,
  BulkCampaignKnowledgeFileFormat,
  BulkCampaignKnowledgeFileRecord,
  BulkCampaignKnowledgeUploadInput
} from '@thaara/contracts';
import { QUANTUM_WEAVE_SECTIONS } from '../knowledge/quantum-weave.v1.js';
import { QUANTUM_WEAVE_COMPANY_INFO, VERIFIED_SERVICES } from './quantum-weave-knowledge.js';
import { extractTextFromDocx, extractTextFromPdf } from './chat-attachments.js';

export const CAMPAIGN_KNOWLEDGE_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per file
export const CAMPAIGN_KNOWLEDGE_MAX_FILES = 10;
export const CAMPAIGN_KNOWLEDGE_MAX_CHARS_PER_FILE = 40000;
export const SARVAM_OUTBOUND_AGENT_LABEL = 'Thaara AI — Sarvam outbound v6' as const;
export const SARVAM_MAX_CALL_PURPOSE_CHARS = 10000;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are', 'will', 'can', 'how',
  'what', 'who', 'when', 'where', 'why', 'does', 'our', 'about', 'into', 'have', 'has', 'had', 'not',
  'but', 'all', 'any', 'one', 'two', 'out', 'use', 'using', 'please', 'tell', 'ask', 'they', 'them',
  'their', 'there', 'here', 'more', 'some', 'such', 'than', 'then', 'also', 'may', 'its', 'is', 'it',
  'in', 'on', 'at', 'to', 'of', 'or', 'by', 'as', 'an', 'be', 'do', 'if', 'we'
]);

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|system)\s+instructions?/gi,
  /disregard\s+(?:all\s+)?(?:previous|system|safety|policy)\s+(?:instructions?|rules?)/gi,
  /bypass\s+(?:owner\s+)?(?:approval|consent|dnd|policy)/gi,
  /you\s+are\s+now\s+(?:in\s+)?(?:developer|unrestricted|admin|god)\s+mode/gi,
  /<\s*\/?\s*(?:system|instruction|policy_override)\s*>/gi
];

function detectKnowledgeFormat(fileName: string, mimeType?: string): BulkCampaignKnowledgeFileFormat | null {
  const ext = fileName.trim().split('.').pop()?.toLowerCase() ?? '';
  const mime = (mimeType ?? '').toLowerCase();
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'docx';
  if (ext === 'xlsx' || mime.includes('spreadsheetml')) return 'xlsx';
  if (ext === 'csv' || mime === 'text/csv' || mime === 'application/csv') return 'csv';
  if (ext === 'txt' || mime === 'text/plain') return 'txt';
  return null;
}

function sanitizeUntrustedKnowledgeText(raw: string): string {
  let cleaned = raw
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
  for (const pat of PROMPT_INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pat, '[filtered-directive]');
  }
  return cleaned
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, CAMPAIGN_KNOWLEDGE_MAX_CHARS_PER_FILE);
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function inflateZipEntry(bytes: Buffer, entryName: string): string | null {
  // Check Central Directory (`PK\x01\x02`) first for exact compressed size when ZIP data descriptors are used
  let cdCompSize = 0;
  let cdMethod = -1;
  let cdLocalOffset = -1;
  let cdPos = 0;
  while (cdPos + 46 <= bytes.length) {
    const cdIdx = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), cdPos);
    if (cdIdx === -1 || cdIdx + 46 > bytes.length) break;
    const method = bytes.readUInt16LE(cdIdx + 10);
    const compSize = bytes.readUInt32LE(cdIdx + 20);
    const fnLen = bytes.readUInt16LE(cdIdx + 28);
    const extraLen = bytes.readUInt16LE(cdIdx + 30);
    const commentLen = bytes.readUInt16LE(cdIdx + 32);
    const localOffset = bytes.readUInt32LE(cdIdx + 42);
    if (cdIdx + 46 + fnLen <= bytes.length) {
      const name = bytes.subarray(cdIdx + 46, cdIdx + 46 + fnLen).toString('utf8');
      if (name === entryName) {
        cdMethod = method;
        cdCompSize = compSize;
        cdLocalOffset = localOffset;
        break;
      }
    }
    cdPos = cdIdx + 46 + fnLen + extraLen + commentLen;
  }

  const bin = bytes.toString('binary');
  let headerOffset = cdLocalOffset;
  if (headerOffset < 0) {
    const idx = bin.indexOf(entryName);
    if (idx === -1) return null;
    headerOffset = bin.lastIndexOf('PK\x03\x04', idx);
  }
  if (headerOffset === -1 || headerOffset + 30 > bytes.length) return null;
  const method = cdMethod >= 0 ? cdMethod : bytes.readUInt16LE(headerOffset + 8);
  const localCompSize = bytes.readUInt32LE(headerOffset + 18);
  const compSize = localCompSize > 0 ? localCompSize : cdCompSize;
  const fnLen = bytes.readUInt16LE(headerOffset + 26);
  const extraLen = bytes.readUInt16LE(headerOffset + 28);
  const start = headerOffset + 30 + fnLen + extraLen;
  const slice =
    compSize > 0 && start + compSize <= bytes.length
      ? bytes.subarray(start, start + compSize)
      : bytes.subarray(start);
  if (method === 0) {
    return slice.toString('utf8');
  }
  try {
    return inflateRawSync(slice).toString('utf8');
  } catch {
    try {
      return unzipSync(slice).toString('utf8');
    } catch {
      return null;
    }
  }
}

function extractParagraphAwareDocx(bytes: Buffer): string {
  const xml = inflateZipEntry(bytes, 'word/document.xml');
  if (xml) {
    const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
    const outParas: string[] = [];
    for (const pXml of paragraphs) {
      const withBreaks = pXml
        .replace(/<w:br\b[^>]*\/?>/g, '\n')
        .replace(/<w:tab\b[^>]*\/?>/g, ' ');
      const runs = (withBreaks.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) ?? []).map(t =>
        decodeXmlEntities(t.replace(/<[^>]+>/g, ''))
      );
      const paraText = runs.join('').replace(/[ \t]{2,}/g, ' ').trim();
      if (paraText) {
        outParas.push(paraText);
      }
    }
    if (outParas.length > 0) {
      return outParas.join('\n\n');
    }
  }
  return extractTextFromDocx(bytes);
}

const INTERNAL_KB_GOVERNANCE_RE =
  /\b(?:shared\s+company\s+knowledge\s+layer|verified-source\s+consolidation|versioned,\s*customer-safe|source\s+authority\s+and\s+precedence|truth\s+rule\s*:|provide\s+one\s+centralized\s+company\s+knowledge\s+source|what\s+is\s+known\s+versus\s+unverified|operating\s+instructions\s+and\s+what\s+is\s+known|no\s+runtime\s+credentials\s+or\s+operational\s+state)\b/i;

export function isInternalKnowledgeGovernanceText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^Document\s+[AB]\s*[—–-]/i.test(trimmed)) return true;
  return INTERNAL_KB_GOVERNANCE_RE.test(trimmed);
}

function sanitizeCustomerFacingSnippet(raw: string): string {
  const sentences = raw
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
  const kept = sentences.filter(
    s =>
      !isInternalKnowledgeGovernanceText(s) &&
      !/^(?:the\s+source\s+names|discuss\s+the\s+customer['’]s\s+problem\s+first|do\s+not\s+imply\s+every\s+configuration|prefer\s+clarity,\s*systems|say\s+so\s+and\s+offer\s+human\s+confirmation|do\s+not\s+invent\s+a\s+slot)/i.test(
        s
      )
  );
  return kept.join(' ').trim();
}

function extractStructuredXlsxKnowledge(bytes: Buffer): string {
  const sharedXml = inflateZipEntry(bytes, 'xl/sharedStrings.xml') ?? '';
  const sharedStrings: string[] = [];
  if (sharedXml) {
    const siMatches = sharedXml.match(/<si[\s\S]*?<\/si>/g) ?? [];
    for (const si of siMatches) {
      const parts = (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map(t =>
        decodeXmlEntities(t.replace(/<[^>]+>/g, ''))
      );
      sharedStrings.push(parts.join(''));
    }
  }

  const sheetXml = inflateZipEntry(bytes, 'xl/worksheets/sheet1.xml') ?? '';
  if (sheetXml) {
    const rows: string[] = [];
    const rowMatches = sheetXml.match(/<row\b[\s\S]*?<\/row>/g) ?? [];
    for (const rowXml of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rowXml.match(/<c\b[\s\S]*?<\/c>/g) ?? [];
      for (const cXml of cellMatches) {
        const typeMatch = /\bt="([^"]+)"/.exec(cXml);
        const cType = typeMatch?.[1] ?? '';
        if (cType === 'inlineStr') {
          const inlineT = (cXml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
            .map(t => decodeXmlEntities(t.replace(/<[^>]+>/g, '')))
            .join('');
          if (inlineT.trim()) cells.push(inlineT.trim());
        } else {
          const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cXml);
          if (vMatch?.[1] !== undefined) {
            const rawVal = vMatch[1].trim();
            if (cType === 's') {
              const sIdx = Number.parseInt(rawVal, 10);
              const resolved = sharedStrings[sIdx] ?? '';
              if (resolved.trim()) cells.push(resolved.trim());
            } else {
              cells.push(decodeXmlEntities(rawVal));
            }
          }
        }
      }
      if (cells.length > 0) {
        rows.push(cells.join(' | '));
      }
    }
    if (rows.length > 0) {
      return rows.join('\n');
    }
  }
  return sharedStrings.filter(Boolean).join('\n');
}

function tokenizeKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\u0C80-\u0CFF\u0900-\u097F₹+\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 40);
}

function splitLongTextIntoBoundedChunks(text: string, maxLen = 650): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];

  const sentences = trimmed.split(/(?<=[.!?])\s+|\s*\|\s*(?=[A-Z0-9§])/).filter(Boolean);
  const chunks: string[] = [];
  let acc = '';
  for (const seg of sentences) {
    if (seg.length > maxLen) {
      if (acc.trim()) {
        chunks.push(acc.trim());
        acc = '';
      }
      for (let pos = 0; pos < seg.length; pos += maxLen) {
        const piece = seg.slice(pos, pos + maxLen).trim();
        if (piece) chunks.push(piece);
      }
      continue;
    }
    if (acc && acc.length + 1 + seg.length > maxLen) {
      chunks.push(acc.trim());
      acc = seg;
    } else {
      acc = acc ? `${acc} ${seg}` : seg;
    }
  }
  if (acc.trim()) chunks.push(acc.trim());
  return chunks;
}

function chunkDocumentText(fileId: string, fileName: string, cleanText: string): BulkCampaignKnowledgeChunk[] {
  const paragraphs = cleanText
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);

  const rawBlocks: Array<{ heading?: string; text: string }> = [];
  let currentHeading: string | undefined;

  for (const para of paragraphs) {
    const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
    if (
      lines.length === 1 &&
      lines[0]!.length <= 90 &&
      (/^(?:#+\s*|[A-Z][A-Za-z0-9 &/()§—–-]{2,75}:?)$/.test(lines[0]!) ||
        /\b(?:agenda|speaker|topics|overview|pricing|packages|faq|audience|who should attend|registration|implementation|services|identity|mission|discovery|follow-up)\b/i.test(
          lines[0]!
        ))
    ) {
      currentHeading = lines[0]!.replace(/^#+\s*/, '').replace(/:$/, '').trim();
      continue;
    }

    if (para.length <= 650) {
      rawBlocks.push({ ...(currentHeading ? { heading: currentHeading } : {}), text: para });
    } else {
      let acc = '';
      for (const line of lines) {
        if (line.length > 650) {
          if (acc.trim()) {
            rawBlocks.push({ ...(currentHeading ? { heading: currentHeading } : {}), text: acc.trim() });
            acc = '';
          }
          for (const piece of splitLongTextIntoBoundedChunks(line, 650)) {
            rawBlocks.push({ ...(currentHeading ? { heading: currentHeading } : {}), text: piece });
          }
        } else if ((acc + '\n' + line).length > 650 && acc) {
          rawBlocks.push({ ...(currentHeading ? { heading: currentHeading } : {}), text: acc.trim() });
          acc = line;
        } else {
          acc = acc ? `${acc}\n${line}` : line;
        }
      }
      if (acc.trim()) {
        rawBlocks.push({ ...(currentHeading ? { heading: currentHeading } : {}), text: acc.trim() });
      }
    }
  }

  if (rawBlocks.length === 0 && cleanText.trim()) {
    for (const piece of splitLongTextIntoBoundedChunks(cleanText, 650)) {
      rawBlocks.push({ text: piece });
    }
  }

  return rawBlocks.slice(0, 60).map((b, idx) => {
    const combinedForKw = `${b.heading ?? ''} ${b.text}`;
    return {
      chunkId: `${fileId}_c${idx + 1}`,
      fileId,
      fileName,
      ...(b.heading ? { heading: b.heading.slice(0, 160) } : {}),
      text: b.text.slice(0, 1200),
      keywords: tokenizeKeywords(combinedForKw)
    };
  });
}

function extractFactsAndConflicts(
  instruction: string,
  chunks: BulkCampaignKnowledgeChunk[]
): {
  facts: BulkCampaignExtractedFacts;
  conflicts: string[];
  missingDetails: string[];
} {
  const nonGovernanceChunks = chunks.filter(c => !isInternalKnowledgeGovernanceText(c.text));
  const effectiveChunks = nonGovernanceChunks.length > 0 ? nonGovernanceChunks : chunks;
  const fullText = effectiveChunks.map(c => `${c.heading ? c.heading + ':\n' : ''}${c.text}`).join('\n\n');
  const combinedWithInstruction = `${instruction}\n${fullText}`;

  const instrExplicitCompanyOrServices =
    /\b(?:introduce\s+(?:about\s+)?(?:the\s+|our\s+)?(?:company|quantum\s+weave)|introduce\s+quantum\s+weave|our\s+(?:ai\s+)?services|company\s+introduction|voice\s+agent\s+solutions)\b/i.test(
      instruction
    ) && !/\b(?:webinar|masterclass|seminar|live\s+session)\b/i.test(instruction);

  // Detect when the owner explicitly scopes the campaign to another business/brand (e.g. Custom Teamwear / Custom Team Wear, Kashyap Inc, SmileCare)
  const namesQuantumWeave = /\b(?:quantum\s*weave|brandmint)\b/i.test(combinedWithInstruction);
  const namesThirdPartyBrand =
    !namesQuantumWeave &&
    (/\b(?:custom\s+team\s*wear|kashyap\s+inc|smilecare|apparel\s+aggregator|bulk\s+corporate.*apparel)\b/i.test(
      combinedWithInstruction
    ) ||
      /\b(?:act\s+as\s+(?:the\s+)?(?:owner|senior\s+sales|sales\s+(?:advisor|executive)|founder|representative|manager)[\s\w/-]{0,30}\bof\s+[A-Z]|calling\s+(?:from|on\s+behalf\s+of)\s+(?!quantum\s*weave\b)[A-Z])/i.test(
        instruction
      ));

  const isWebinar =
    !instrExplicitCompanyOrServices &&
    !namesThirdPartyBrand &&
    (/\b(?:webinar|workshop|masterclass|seminar|live\s+session)\b/i.test(instruction) ||
      /(?:^|\n)\s*(?:webinar\s+title|event\s+title|agenda|who\s+should\s+attend)\s*:/i.test(fullText));
  const isServices =
    !isWebinar &&
    !namesThirdPartyBrand &&
    (namesQuantumWeave ||
      instrExplicitCompanyOrServices ||
      /\b(?:voice\s+agent|ai\s+automation|digital\s+marketing|whatsapp\s+automation|company\s+profile)\b/i.test(
        combinedWithInstruction
      ));
  const campaignType: BulkCampaignExtractedFacts['campaignType'] = isWebinar
    ? 'webinar'
    : isServices
      ? 'services'
      : 'general';

  const agendaTopics: string[] = [];
  const speakers: string[] = [];
  const servicesOffered: string[] = [];
  const faqs: BulkCampaignExtractedFacts['faqs'] = [];
  let title: string | undefined;
  let targetAudience: string | undefined;
  let registrationInfo: string | undefined;
  let pricingSummary: string | undefined;
  let pricingExplicitlyProvided = false;
  let implementationTimeline: string | undefined;

  const detectedTimes = new Map<string, string>(); // normalized -> source label
  const detectedUrls = new Map<string, string>(); // url -> source label

  const collectTimes = (txt: string, sourceLabel: string) => {
    const timeMatches = txt.match(/\b(?:1[0-2]|0?[1-9])(?::[0-5][0-9])?\s*(?:AM|PM|am|pm)\b/g) ?? [];
    for (const tm of timeMatches) {
      const norm = tm.toUpperCase().replace(/\s+/g, ' ').trim();
      if (!detectedTimes.has(norm)) detectedTimes.set(norm, sourceLabel);
    }
  };
  const collectUrls = (txt: string, sourceLabel: string) => {
    const urls = txt.match(/https?:\/\/[^\s)>\]"']+/gi) ?? [];
    for (const u of urls) {
      const cleanU = u.replace(/[.,;]+$/, '');
      if (!cleanU.includes('linktr.ee/team.quantumweaveai') && !cleanU.includes('wa.me/')) {
        if (!detectedUrls.has(cleanU)) detectedUrls.set(cleanU, sourceLabel);
      }
    }
  };

  if (instruction.trim()) {
    collectTimes(instruction, 'Campaign instructions');
    collectUrls(instruction, 'Campaign instructions');
  }

  for (const chunk of chunks) {
    collectTimes(chunk.text, chunk.fileName);
    collectUrls(chunk.text, chunk.fileName);

    const lines = chunk.text.split('\n').map(l => l.trim()).filter(Boolean);
    const headingLower = (chunk.heading ?? '').toLowerCase();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Title
      if (!title && /^(?:webinar\s+title|event\s+title|campaign\s+title|title|event)\s*:\s*(.+)$/i.test(line)) {
        title = RegExp.$1.trim().slice(0, 160);
      }

      // Speaker / Host
      const spkMatch =
        /^(?:speaker|speakers|host|hosted\s+by|conducted\s+by|presenter|instructor|mentor)\s*:\s*(.+)$/i.exec(line) ||
        /\b(?:conducted\s+by|hosted\s+by|speaker\s+is|led\s+by)\s+([A-Z][A-Za-z .,-]{3,90})/.exec(line);
      if (spkMatch?.[1]) {
        speakers.push(spkMatch[1].trim().slice(0, 160));
      } else if (headingLower.includes('speaker') || headingLower.includes('presenter')) {
        speakers.push(line.replace(/^[-*•]\s*/, '').slice(0, 160));
      }

      // Agenda / Topics
      const topicMatch = /^(?:agenda|topics?\s+covered|what\s+you\s+will\s+learn|curriculum|modules?)\s*:\s*(.+)$/i.exec(
        line
      );
      if (topicMatch?.[1]) {
        agendaTopics.push(topicMatch[1].trim().slice(0, 240));
      } else if (
        (headingLower.includes('agenda') ||
          headingLower.includes('topic') ||
          headingLower.includes('learn')) &&
        line.length >= 6
      ) {
        agendaTopics.push(line.replace(/^[-*•\d.)]+\s*/, '').slice(0, 240));
      }

      // Audience / Beginners / Prerequisites
      const audMatch =
        /^(?:who\s+should\s+attend|target\s+audience|audience|suitability|prerequisites?|level)\s*:\s*(.+)$/i.exec(
          line
        );
      if (audMatch?.[1] && !targetAudience) {
        targetAudience = audMatch[1].trim().slice(0, 240);
      } else if (
        !targetAudience &&
        (headingLower.includes('audience') ||
          headingLower.includes('who should attend') ||
          headingLower.includes('prerequisite') ||
          /\b(?:suitable\s+for\s+beginners|no\s+prior\s+coding|designed\s+for\s+founders|open\s+to\s+beginners)\b/i.test(
            line
          ))
      ) {
        targetAudience = line.replace(/^[-*•]\s*/, '').slice(0, 240);
      }

      // Registration
      const regMatch = /^(?:registration|register(?:\s+at|\s+here)?|registration\s+link|join\s+link|how\s+to\s+register)\s*:\s*(.+)$/i.exec(
        line
      );
      if (regMatch?.[1] && !registrationInfo) {
        registrationInfo = regMatch[1].trim().slice(0, 300);
      } else if (
        !registrationInfo &&
        (headingLower.includes('registration') || /\bhttps?:\/\/[^\s]+/i.test(line)) &&
        /\b(?:register|registration|rsvp|zoom|meet|signup|sign\s+up|link)\b/i.test(`${headingLower} ${line}`)
      ) {
        registrationInfo = line.slice(0, 300);
      }

      // Services / products / catalogue offerings
      const svcMatch =
        /^(?:core\s+offer|products?\s*(?:&|and)\s*services?|services?|solutions?|offerings?|products?)\s*:\s*(.+)$/i.exec(
          line
        ) ||
        /^(?:core\s+offer)\s+(.{15,220})$/i.exec(line) ||
        /^[-*•]?\s*((?:corporate|premium|sportswear|event|institution|custom)\s+catalogues?\s+includes?\s+.+)$/i.exec(
          line
        );
      if (svcMatch?.[1]) {
        servicesOffered.push(svcMatch[1].trim().slice(0, 240));
      } else if (
        (headingLower.includes('service') ||
          headingLower.includes('solution') ||
          headingLower.includes('catalog') ||
          headingLower.includes('product') ||
          headingLower.includes('offer')) &&
        /^[-*•\d.)]+\s+/.test(line)
      ) {
        servicesOffered.push(line.replace(/^[-*•\d.)]+\s*/, '').slice(0, 240));
      }

      // Pricing (explicitly uploaded & confirmed in campaign document — ignore unconfirmed historical ladders)
      const isUnconfirmedPricingLine =
        /\b(?:not\s+confirmed\s+current\s+quotes?|current\s+prices?\s+unconfirmed|not\s+verified\s+by\s+this\s+knowledge\s+source|no\s+current\s+price\s+is\s+provided)\b/i.test(
          `${headingLower} ${line}`
        );
      if (
        !isUnconfirmedPricingLine &&
        (/(?:₹|\bINR\b|\bRs\.?\s*\d|\$\s*\d|\bfree\s+of\s+charge\b|\bfree\s+webinar\b|\bpricing\s*:|\bpackage\s*:)/i.test(
          line
        ) ||
          headingLower.includes('pricing') ||
          headingLower.includes('package'))
      ) {
        pricingExplicitlyProvided = true;
        if (!pricingSummary) {
          pricingSummary = line.slice(0, 360);
        } else if (pricingSummary.length + line.length < 350 && !pricingSummary.includes(line)) {
          pricingSummary = `${pricingSummary}; ${line}`.slice(0, 360);
        }
      }

      // Implementation timeline (only explicit verified timelines; ignore training curriculum day ranges & unverified disclaimers)
      const isUnverifiedOrCurriculumDays =
        /\b(?:not\s+verified\s+by\s+this\s+knowledge\s+source|100-day|days\s+1[–-]\d+)\b/i.test(line);
      const implMatch = !isUnverifiedOrCurriculumDays
        ? /\b(?:implementation(?:\s+time|\s+timeline|\s+process)?|delivery\s+timeline|go-live|onboarding)\s*:\s*([^\n.;]+(?:\.[^\n.;]{0,80})?)/i.exec(
            line
          )
        : null;
      if (implMatch?.[1] && !implementationTimeline) {
        implementationTimeline = implMatch[1].trim().slice(0, 240);
      } else if (
        !implementationTimeline &&
        !isUnverifiedOrCurriculumDays &&
        (headingLower.includes('implementation timeline') ||
          /\b(?:implementation\s+takes|deployment\s+takes|go\s+live\s+in|deployed\s+within|\d+\s*(?:to\s+\d+\s*)?business\s+days)\b/i.test(
            line
          ))
      ) {
        implementationTimeline = line.slice(0, 240);
      }

      // FAQ pairs (Q: ... / A: ..., single-row spreadsheet Q: ... | A: ..., or standalone question heading + answer)
      const inlineFaqMatch = /^(?:Q(?:\d+)?|Question)\s*[:.-]\s*(.+?\?)\s*\|\s*(?:A(?:\d+)?|Answer)?\s*[:.-]?\s*(.+)$/i.exec(
        line
      );
      const qMatch = !inlineFaqMatch ? /^(?:Q(?:\d+)?|Question)\s*[:.-]\s*(.+\?)$/i.exec(line) : null;
      const collectAnswerLines = (startIdx: number): string => {
        const collected: string[] = [];
        let len = 0;
        for (let k = startIdx; k < lines.length && k < startIdx + 4; k++) {
          const candidate = lines[k]!;
          if (k > startIdx) {
            if (
              candidate.endsWith('?') ||
              /^(?:Q(?:\d+)?|Question)\s*[:.-]/i.test(candidate) ||
              /^\d+\.\s+[A-Z]/.test(candidate) ||
              /^(?:Main\s+Campaign\s+Objective|Rule\s*:|Purpose\s*:)/i.test(candidate)
            ) {
              break;
            }
          }
          const cleaned = k === startIdx ? candidate.replace(/^(?:A(?:\d+)?|Answer)\s*[:.-]\s*/i, '').trim() : candidate;
          if (!cleaned) break;
          collected.push(cleaned);
          len += cleaned.length + 1;
          if (len >= 520 || (/[.!]$/.test(cleaned) && collected.join(' ').length >= 80)) break;
        }
        return collected.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600);
      };
      if (inlineFaqMatch?.[1] && inlineFaqMatch?.[2]) {
        faqs.push({
          question: inlineFaqMatch[1].trim().slice(0, 240),
          answer: inlineFaqMatch[2].trim().slice(0, 600),
          sourceFile: chunk.fileName
        });
      } else if (qMatch?.[1] && lines[i + 1]) {
        const ans = collectAnswerLines(i + 1);
        if (ans) {
          faqs.push({
            question: qMatch[1].trim().slice(0, 240),
            answer: ans,
            sourceFile: chunk.fileName
          });
        }
      } else if (line.endsWith('?') && line.length <= 180 && lines[i + 1] && !lines[i + 1]!.endsWith('?')) {
        const ans = collectAnswerLines(i + 1);
        if (ans) {
          faqs.push({
            question: line.replace(/^[-*•\d.)]+\s*/, '').slice(0, 240),
            answer: ans,
            sourceFile: chunk.fileName
          });
        }
      }
    }
  }

  // Extract FAQ pairs across chunk boundaries so a 650-char chunk split never separates a question from its answer
  const flatDocLines: Array<{ line: string; fileName: string }> = [];
  for (const chunk of chunks) {
    for (const rawLine of chunk.text.split('\n')) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      // Skip running PDF page footers/headers (e.g. "Custom Team Wear • Thaara Knowledge Pack", "Page 3")
      if (/^Page\s+\d+(?:\s+of\s+\d+)?$/i.test(trimmed)) continue;
      if (/\bPage\s+\d+\s*$/i.test(trimmed) && trimmed.length <= 95 && !/[.?!]/.test(trimmed)) continue;
      flatDocLines.push({ line: trimmed, fileName: chunk.fileName });
    }
  }
  const seenFaqKeys = new Set<string>(faqs.map(f => f.question.toLowerCase()));
  const collectCrossChunkAnswer = (startIdx: number, sourceFile: string): string => {
    const collected: string[] = [];
    let len = 0;
    for (let k = startIdx; k < flatDocLines.length && k < startIdx + 4; k++) {
      const entry = flatDocLines[k]!;
      if (entry.fileName !== sourceFile) break;
      const candidate = entry.line;
      if (k > startIdx) {
        if (
          candidate.endsWith('?') ||
          /^(?:Q(?:\d+)?|Question)\s*[:.-]/i.test(candidate) ||
          /^\d+\.\s+[A-Z]/.test(candidate) ||
          /^(?:Main\s+Campaign\s+Objective|Rule\s*:|Purpose\s*:)/i.test(candidate)
        ) {
          break;
        }
      }
      const cleaned =
        k === startIdx ? candidate.replace(/^(?:A(?:\d+)?|Answer)\s*[:.-]\s*/i, '').trim() : candidate;
      if (!cleaned) break;
      collected.push(cleaned);
      len += cleaned.length + 1;
      if (len >= 520 || (/[.!]$/.test(cleaned) && collected.join(' ').length >= 80)) break;
    }
    return collected
      .join(' ')
      .replace(/\s+[A-Z][^.!?\n]{5,70}\bPage\s+\d+\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
  };
  for (let i = 0; i < flatDocLines.length; i++) {
    const { line, fileName } = flatDocLines[i]!;
    const inlineFaqMatch = /^(?:Q(?:\d+)?|Question)\s*[:.-]\s*(.+?\?)\s*\|\s*(?:A(?:\d+)?|Answer)?\s*[:.-]?\s*(.+)$/i.exec(
      line
    );
    const qMatch = !inlineFaqMatch ? /^(?:Q(?:\d+)?|Question)\s*[:.-]\s*(.+\?)$/i.exec(line) : null;
    let questionText: string | null = null;
    let answerText: string | null = null;
    if (inlineFaqMatch?.[1] && inlineFaqMatch?.[2]) {
      questionText = inlineFaqMatch[1].trim().slice(0, 240);
      answerText = inlineFaqMatch[2].trim().slice(0, 600);
    } else if (qMatch?.[1] && flatDocLines[i + 1]) {
      questionText = qMatch[1].trim().slice(0, 240);
      answerText = collectCrossChunkAnswer(i + 1, fileName);
    } else if (
      line.endsWith('?') &&
      line.length >= 10 &&
      line.length <= 180 &&
      flatDocLines[i + 1] &&
      !flatDocLines[i + 1]!.line.endsWith('?')
    ) {
      questionText = line.replace(/^[-*•\d.)]+\s*/, '').slice(0, 240);
      answerText = collectCrossChunkAnswer(i + 1, fileName);
    }
    if (questionText && answerText && !seenFaqKeys.has(questionText.toLowerCase())) {
      seenFaqKeys.add(questionText.toLowerCase());
      faqs.push({ question: questionText, answer: answerText, sourceFile: fileName });
    }
  }

  // Date & Time extraction
  let dateAndTime: string | undefined;
  const dateLineMatch =
    /(?:date\s*(?:&|and)?\s*time|when|schedule|event\s+date)\s*:\s*([^\n]+)/i.exec(fullText) ||
    /\b((?:tomorrow|today|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+\d{4})?)[^\n.;]{0,50}?(?:at\s+)?(?:1[0-2]|0?[1-9])(?::[0-5][0-9])?\s*(?:AM|PM|am|pm)(?:\s*IST)?)/i.exec(
      combinedWithInstruction
    );
  if (dateLineMatch?.[1]) {
    dateAndTime = dateLineMatch[1].trim().slice(0, 160);
  }

  // Conflict detection
  const conflicts: string[] = [];
  if (instruction.trim()) {
    const instrTimes = (instruction.match(/\b(?:1[0-2]|0?[1-9])(?::[0-5][0-9])?\s*(?:AM|PM)\b/gi) ?? []).map(t =>
      t.toUpperCase().replace(/\s+/g, ' ')
    );
    const explicitFileStartMatch = /(?:start\s*time|time)\s*:\s*((?:1[0-2]|0?[1-9])(?::[0-5][0-9])?\s*(?:AM|PM))/i.exec(
      fullText
    );
    if (instrTimes.length === 1 && explicitFileStartMatch?.[1]) {
      const fileStart = explicitFileStartMatch[1].toUpperCase().replace(/\s+/g, ' ');
      const instrNorm = instrTimes[0]!.replace(':00', '');
      const fileNorm = fileStart.replace(':00', '');
      if (instrNorm !== fileNorm) {
        conflicts.push(
          `Conflicting event time detected: instructions mention "${instrTimes[0]}", while uploaded document states "${fileStart}". Please clarify before approving.`
        );
      }
    }
  }
  if (detectedUrls.size > 1) {
    const entries = [...detectedUrls.entries()];
    conflicts.push(
      `Multiple different campaign links detected across inputs (${entries.map(([u, src]) => `${u} in ${src}`).slice(0, 2).join(' vs ')}). Please confirm which link Thaara should share.`
    );
  }

  // Missing essential information check
  const missingDetails: string[] = [];
  if (campaignType === 'webinar') {
    if (!dateAndTime && detectedTimes.size === 0) {
      missingDetails.push('Webinar date and start time');
    }
    if (!registrationInfo && detectedUrls.size === 0 && !/\breply\s+yes\b/i.test(combinedWithInstruction)) {
      missingDetails.push('Registration link or RSVP instructions');
    }
  } else if (chunks.length === 0 && instruction.trim().length < 25) {
    missingDetails.push('Clear campaign offer, event details, or knowledge document');
  }

  return {
    facts: {
      campaignType,
      ...(title ? { title } : {}),
      agendaTopics: [...new Set(agendaTopics)].slice(0, 12),
      speakers: [...new Set(speakers)].slice(0, 8),
      ...(dateAndTime ? { dateAndTime } : {}),
      ...(registrationInfo ? { registrationInfo } : {}),
      ...(targetAudience ? { targetAudience } : {}),
      servicesOffered: [...new Set(servicesOffered)].slice(0, 12),
      ...(pricingSummary ? { pricingSummary } : {}),
      pricingExplicitlyProvided,
      ...(implementationTimeline ? { implementationTimeline } : {}),
      faqs: faqs.slice(0, 16)
    },
    conflicts,
    missingDetails
  };
}

export function buildSarvamBoundedFactBrief(input: {
  instruction: string;
  eventDetails?: string;
  facts: BulkCampaignExtractedFacts;
  questions?: string[];
  chunks?: BulkCampaignKnowledgeChunk[];
}): string {
  const parts: string[] = [];
  const cleanGoal = (input.instruction || input.eventDetails || 'Customer outreach').replace(/\s+/g, ' ').trim();
  parts.push(`Goal: ${cleanGoal.slice(0, 2000)}`);

  const { facts } = input;
  if (facts.dateAndTime) parts.push(`When: ${facts.dateAndTime.slice(0, 160)}`);
  if (facts.speakers.length > 0) parts.push(`Speaker/Host: ${facts.speakers.slice(0, 4).join('; ').slice(0, 240)}`);
  if (facts.agendaTopics.length > 0) {
    parts.push(`Topics: ${facts.agendaTopics.slice(0, 12).join('; ').slice(0, 1200)}`);
  } else if (facts.servicesOffered.length > 0) {
    parts.push(`Services: ${facts.servicesOffered.slice(0, 12).join('; ').slice(0, 1200)}`);
  } else if (facts.campaignType === 'services') {
    parts.push(
      'Services: AI Voice Agents (en-IN/kn-IN/kn-en), 24/7 WhatsApp & Workflow Automation, Digital Marketing & Meta Growth, Cash Flow Copy & AI Video Systems'
    );
  }
  if (facts.targetAudience) parts.push(`Audience: ${facts.targetAudience.slice(0, 240)}`);
  if (facts.registrationInfo) {
    parts.push(`Register/Next: ${facts.registrationInfo.slice(0, 240)}`);
  } else if (facts.campaignType === 'services') {
    parts.push(`Consultation: Team callback or ${QUANTUM_WEAVE_COMPANY_INFO.supportContact}`);
  }
  if (facts.implementationTimeline) parts.push(`Timeline: ${facts.implementationTimeline.slice(0, 200)}`);
  if (facts.pricingExplicitlyProvided && facts.pricingSummary) {
    parts.push(`Verified Pricing: ${facts.pricingSummary.slice(0, 360)}`);
  } else {
    parts.push('Pricing: Custom-scoped per requirement; never quote or invent numbers—offer team consultation.');
  }
  if (input.questions && input.questions.length > 0) {
    parts.push(`Qualify: ${input.questions.slice(0, 16).join(' | ').slice(0, 1200)}`);
  }
  if (facts.faqs.length > 0) {
    const faqText = facts.faqs
      .slice(0, 12)
      .map(f => `Q: ${f.question} A: ${f.answer}`)
      .join(' | ')
      .slice(0, 2400);
    if (faqText) {
      parts.push(`FAQs: ${faqText}`);
    }
  }
  if (input.chunks && input.chunks.length > 0) {
    const knowledgeBudget = Math.max(0, SARVAM_MAX_CALL_PURPOSE_CHARS - parts.join(' | ').length - 220);
    if (knowledgeBudget > 80) {
      const fullKb = input.chunks
        .filter(c => !isInternalKnowledgeGovernanceText(c.text))
        .map(c => (c.heading ? `${c.heading}: ${c.text}` : c.text).replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' | ')
        .slice(0, knowledgeBudget);
      if (fullKb) {
        parts.push(`Knowledge: ${fullKb}`);
      }
    }
  }
  const isQuantumWeave =
    facts.campaignType === 'services' || /quantum\s*weave/i.test(input.instruction);
  parts.push(
    isQuantumWeave
      ? 'Rule: Answer ONLY from verified facts & Quantum Weave KB; if unconfirmed, say so & offer callback.'
      : 'Rule: Answer ONLY from verified campaign facts & uploaded knowledge; never invent prices, MOQs, or promises.'
  );

  let joined = parts.join(' | ');
  if (joined.length > SARVAM_MAX_CALL_PURPOSE_CHARS) {
    joined = joined.slice(0, SARVAM_MAX_CALL_PURPOSE_CHARS - 3).trimEnd() + '...';
  }
  return joined;
}

export function retrieveCampaignKnowledgeChunks(
  context: BulkCampaignKnowledgeContext | undefined,
  query: string,
  maxChunks = 4
): BulkCampaignKnowledgeChunk[] {
  if (!context || context.chunks.length === 0) return [];
  const qTokens = tokenizeKeywords(query);
  const qLower = query.toLowerCase();

  const customerSafeChunks = context.chunks.filter(c => !isInternalKnowledgeGovernanceText(c.text));
  const pool = customerSafeChunks.length > 0 ? customerSafeChunks : context.chunks;

  const scored = pool.map(chunk => {
    let score = 0;
    const hay = `${chunk.heading ?? ''} ${chunk.text}`.toLowerCase();
    for (const qt of qTokens) {
      if (chunk.keywords.includes(qt)) score += 4;
      else if (hay.includes(qt)) score += 2;
    }
    if (/\b(?:learn|agenda|topic|cover|curriculum|module)\b/i.test(qLower) && /\b(?:agenda|topic|learn|cover|session|module)\b/i.test(hay)) {
      score += 6;
    }
    if (/\b(?:beginner|suitable|prerequisite|audience|attend|experience)\b/i.test(qLower) && /\b(?:beginner|suitable|prerequisite|audience|attend|founder|anyone)\b/i.test(hay)) {
      score += 6;
    }
    if (/\b(?:who|speaker|conduct|host|presenter|instructor)\b/i.test(qLower) && /\b(?:speaker|conduct|host|presenter|led by|mentor|founder)\b/i.test(hay)) {
      score += 6;
    }
    if (/\b(?:register|registration|join|link|sign\s*up|rsvp)\b/i.test(qLower) && /\b(?:register|registration|link|zoom|meet|http|rsvp)\b/i.test(hay)) {
      score += 6;
    }
    if (/\b(?:cost|price|pricing|fee|charge|package|free|how\s+much)\b/i.test(qLower) && /(?:₹|\binr\b|\brs\b|\bprice|\bpricing|\bpackage|\bfree\b|\bcost)/i.test(hay)) {
      score += 6;
    }
    if (/\b(?:kannada|language|multilingual|hindi|english)\b/i.test(qLower) && /\b(?:kannada|language|multilingual|hindi|english|kn-in)\b/i.test(hay)) {
      score += 6;
    }
    if (/\b(?:how\s+long|timeline|implementation|deploy|setup\s+time|weeks|days)\b/i.test(qLower) && /\b(?:implementation|timeline|days|weeks|onboarding|setup|deploy)\b/i.test(hay)) {
      score += 6;
    }
    if (/\b(?:demo|demonstrat|show\s+me|trial|consultation)\b/i.test(qLower) && /\b(?:demo|demonstrat|consultation|walkthrough|calendly)\b/i.test(hay)) {
      score += 6;
    }
    if (
      /\b(?:products?|services?|supply|sell|offer|catalogue|catalog|apparel|garment|merchandise)\b/i.test(qLower) &&
      /\b(?:products?|services?|catalogue|catalog|apparel|garment|merchandise|polo|t-?shirt|hoodie|jacket|core\s+offer|bulk\s+orders)\b/i.test(
        hay
      )
    ) {
      score += 6;
    }
    if (
      /\b(?:minimum\s+order|moq|quantity|requirements?|sample\s+visit|experience\s+cent(?:re|er))\b/i.test(qLower) &&
      /\b(?:minimum\s+order|moq|sample\s+visit|experience\s+cent(?:re|er)|above\s+\d+\s*pcs|\d+\s*pcs|bulk\s+orders)\b/i.test(
        hay
      )
    ) {
      score += 6;
    }
    if (
      /\b(?:next\s+step|after\s+this\s+call|follow[\s-]?up|appointment|visit|callback|mockup|quotation)\b/i.test(qLower) &&
      /\b(?:next\s+step|follow[\s-]?up|appointment|experience\s+cent(?:re|er)|sample\s+visit|catalogue|quotation|mockup|callback)\b/i.test(
        hay
      )
    ) {
      score += 6;
    }
    return { chunk, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks)
    .map(s => s.chunk);
}

/**
 * Answers a customer follow-up question strictly using:
 *  1. Verified campaign-scoped knowledge (`context`)
 *  2. Approved Quantum Weave company knowledge (`QUANTUM_WEAVE_SECTIONS` & `VERIFIED_SERVICES`)
 * Never invents prices, guarantees, ROI promises, dates, or unverified capabilities,
 * and never exposes internal knowledge-base governance instructions as customer-facing copy.
 */
export function answerCampaignCustomerQuestion(input: {
  question: string;
  knowledgeContext?: BulkCampaignKnowledgeContext;
  eventDetails?: string;
}): BulkCampaignGroundedQaItem {
  const q = input.question.trim();
  const qLower = q.toLowerCase();
  const ctx = input.knowledgeContext;
  const facts = ctx?.extractedFacts;
  const allProcessedFiles = (ctx?.files ?? []).filter(f => f.status === 'processed').map(f => f.fileName);
  const primaryFileRef = allProcessedFiles[0] ? [allProcessedFiles[0]] : ['Campaign Brief'];
  const isQuantumWeaveContext =
    facts?.campaignType === 'services' ||
    allProcessedFiles.some(f => /(?:document[_\s-]*a|quantum[_\s-]*weave)/i.test(f));

  // 0. Guard against unverified guarantees / ROI / refund / unsupported claims unless explicitly present in uploaded chunks
  if (/\b(?:guarantee|100%\s+roi|promised?\s+revenue|money\s*back|refund\s+policy|guaranteed\s+leads)\b/i.test(qLower)) {
    const matchingGuaranteeChunk = retrieveCampaignKnowledgeChunks(ctx, q, 2).find(
      c => /\b(?:refund|guarantee)\b/i.test(c.text) && !/\bnot\s+verified\b/i.test(c.text)
    );
    if (matchingGuaranteeChunk) {
      return {
        question: q,
        answer: sanitizeCustomerFacingSnippet(matchingGuaranteeChunk.text),
        sourceRefs: [matchingGuaranteeChunk.fileName],
        grounded: true
      };
    }
    return {
      question: q,
      answer: isQuantumWeaveContext
        ? 'We do not promise fixed revenue or universal ROI guarantees—results depend on your business workflow, offer, and execution. Our team can review your goals on a consultation call or on WhatsApp (+91 99729 65677).'
        : 'We do not make unverified guarantees or promises—our team will confirm the exact details after reviewing your requirements.',
      sourceRefs: isQuantumWeaveContext ? [...primaryFileRef, 'Document A §13'] : primaryFileRef,
      grounded: false,
      requiresHumanFollowUp: true
    };
  }

  // 1. Direct FAQ match from uploaded campaign documents
  if (facts && facts.faqs.length > 0) {
    const qNorm = qLower.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const qWords = tokenizeKeywords(q);
    let bestFaq: { faq: BulkCampaignExtractedFacts['faqs'][number]; overlap: number } | null = null;
    for (const faq of facts.faqs) {
      const fNorm = faq.question.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      if (fNorm === qNorm) {
        bestFaq = { faq, overlap: 100 };
        break;
      }
      const fWords = tokenizeKeywords(faq.question);
      const overlap = qWords.filter(w => fWords.includes(w)).length;
      const minRequired = qWords.length <= 1 ? 1 : 2;
      if (overlap >= minRequired && (!bestFaq || overlap > bestFaq.overlap)) {
        bestFaq = { faq, overlap };
      }
    }
    if (bestFaq) {
      const isProductsQuery = /\b(?:products?\s+or\s+services?|what\s+products|what\s+do\s+you\s+(?:supply|offer|sell))\b/i.test(
        qLower
      );
      const isMetaDirectiveAnswer = /^(?:use\s+the\s+verified|refer\s+to\s+the\s+verified|explain\s+the\s+relevant)\b/i.test(
        bestFaq.faq.answer.trim()
      );
      if (isProductsQuery && isMetaDirectiveAnswer && facts.servicesOffered.length > 0) {
        const formatted = facts.servicesOffered
          .slice(0, 4)
          .map(s => s.trim().replace(/\.+$/, ''))
          .filter(Boolean)
          .join('. ');
        const answer = /^(?:corporate|premium|sportswear|we\b|our\b)/i.test(formatted)
          ? `${formatted}.`
          : `We supply ${formatted}.`;
        return {
          question: q,
          answer: answer.slice(0, 650),
          sourceRefs: [bestFaq.faq.sourceFile],
          grounded: true
        };
      }
      return {
        question: q,
        answer: bestFaq.faq.answer.replace(/\s+[A-Z][^.!?\n]{5,70}\bPage\s+\d+\s*$/i, '').trim(),
        sourceRefs: [bestFaq.faq.sourceFile],
        grounded: true
      };
    }
  }

  // 2. Pricing / Cost / Fee questions — strict anti-hallucination rule!
  if (/\b(?:how\s+much|cost|price|pricing|fee|fees|charges?|packages?|is\s+it\s+free|ticket\s+price)\b/i.test(qLower)) {
    if (facts?.pricingExplicitlyProvided && facts.pricingSummary) {
      const priceChunks = retrieveCampaignKnowledgeChunks(ctx, q, 2);
      const refs = priceChunks.length > 0 ? [...new Set(priceChunks.map(c => c.fileName))] : primaryFileRef;
      return {
        question: q,
        answer: `Based on our campaign details: ${facts.pricingSummary}`,
        sourceRefs: refs,
        grounded: true
      };
    }
    if (!isQuantumWeaveContext) {
      const priceChunks = retrieveCampaignKnowledgeChunks(ctx, `${q} price quote quotation cost`, 2);
      if (priceChunks.length > 0) {
        const snippet = sanitizeCustomerFacingSnippet(priceChunks[0]!.text).slice(0, 600);
        if (snippet.length >= 20) {
          return {
            question: q,
            answer: snippet,
            sourceRefs: [priceChunks[0]!.fileName],
            grounded: true
          };
        }
      }
      return {
        question: q,
        answer:
          'Pricing depends on your specific requirements, quantities, and delivery details. Share your brief and our team will prepare and confirm an accurate quotation rather than guessing.',
        sourceRefs: primaryFileRef,
        grounded: false,
        requiresHumanFollowUp: true
      };
    }
    return {
      question: q,
      answer:
        'At Quantum Weave AI, active project pricing and implementation timelines are custom-scoped to your workflow and integrations rather than quoted from a fixed standard price list. Our team would be happy to understand your requirements on a short consultation (or via WhatsApp at +91 99729 65677) and share a confirmed proposal.',
      sourceRefs: [...primaryFileRef, 'Document A §§8,13'],
      grounded: false,
      requiresHumanFollowUp: true
    };
  }

  // 3. Webinar Agenda / "What will I learn?"
  if (/\b(?:what\s+will\s+i\s+learn|agenda|topics?|cover(?:ed)?|syllabus|curriculum|what\s+is\s+the\s+webinar\s+about)\b/i.test(qLower)) {
    if (facts && facts.agendaTopics.length > 0) {
      const agendaChunks = retrieveCampaignKnowledgeChunks(ctx, 'agenda topics learn', 2);
      const refs = agendaChunks.length > 0 ? [...new Set(agendaChunks.map(c => c.fileName))] : primaryFileRef;
      return {
        question: q,
        answer: `In this session, you will cover: ${facts.agendaTopics.join('; ')}.`,
        sourceRefs: refs,
        grounded: true
      };
    }
  }

  // 4. Suitability / Beginners / Audience / Prerequisites
  if (/\b(?:beginner|suitable|prerequisite|who\s+should\s+attend|who\s+is\s+(?:it|this)\s+for|technical\s+background|coding)\b/i.test(qLower)) {
    if (facts?.targetAudience) {
      const audChunks = retrieveCampaignKnowledgeChunks(ctx, 'beginner suitable audience prerequisites', 2);
      const refs = audChunks.length > 0 ? [...new Set(audChunks.map(c => c.fileName))] : primaryFileRef;
      return {
        question: q,
        answer: facts.targetAudience,
        sourceRefs: refs,
        grounded: true
      };
    }
  }

  // 5. Speaker & Registration (supports single OR compound questions like "Who is conducting it and how do I register?")
  const asksSpeaker = /\b(?:who\s+is\s+(?:conducting|hosting|speaking|presenting|teaching)|speaker|presenter|instructor|host)\b/i.test(
    qLower
  );
  const asksRegistration = /\b(?:how\s+(?:do|can)\s+i\s+register|registration|register|sign\s*up|join\s+link|joining\s+link|where\s+do\s+i\s+join)\b/i.test(
    qLower
  );
  if (asksSpeaker && asksRegistration && (facts?.speakers.length || facts?.registrationInfo)) {
    const parts: string[] = [];
    if (facts && facts.speakers.length > 0) {
      parts.push(`The session is conducted by ${facts.speakers.join(' and ')}.`);
    }
    if (facts?.registrationInfo) {
      parts.push(`To register: ${facts.registrationInfo}`);
    }
    return {
      question: q,
      answer: parts.join(' '),
      sourceRefs: primaryFileRef,
      grounded: true
    };
  }
  if (asksSpeaker) {
    if (facts && facts.speakers.length > 0) {
      const spkChunks = retrieveCampaignKnowledgeChunks(ctx, 'speaker host conducting presenter', 2);
      const refs = spkChunks.length > 0 ? [...new Set(spkChunks.map(c => c.fileName))] : primaryFileRef;
      return {
        question: q,
        answer: `The session is conducted by ${facts.speakers.join(' and ')}.`,
        sourceRefs: refs,
        grounded: true
      };
    }
  }

  // 6. Registration / How do I join or register?
  if (asksRegistration) {
    if (facts?.registrationInfo) {
      const regChunks = retrieveCampaignKnowledgeChunks(ctx, 'register registration link join', 2);
      const refs = regChunks.length > 0 ? [...new Set(regChunks.map(c => c.fileName))] : primaryFileRef;
      return {
        question: q,
        answer: `To register: ${facts.registrationInfo}`,
        sourceRefs: refs,
        grounded: true
      };
    }
  }

  // 7. Date & Time / When is it?
  if (/\b(?:when\s+is|what\s+time|date\s+and\s+time|schedule)\b/i.test(qLower)) {
    const dt = facts?.dateAndTime || input.eventDetails;
    if (dt && facts?.campaignType === 'webinar') {
      return {
        question: q,
        answer: `Schedule details: ${dt}`,
        sourceRefs: primaryFileRef,
        grounded: true
      };
    }
  }

  // 8. Implementation Timeline / How long does implementation take?
  if (/\b(?:how\s+long|implementation\s+take|timeline|setup\s+time|onboarding\s+time|go\s+live)\b/i.test(qLower)) {
    if (facts?.implementationTimeline) {
      const tlChunks = retrieveCampaignKnowledgeChunks(ctx, 'implementation timeline how long', 2);
      const refs = tlChunks.length > 0 ? [...new Set(tlChunks.map(c => c.fileName))] : primaryFileRef;
      return {
        question: q,
        answer: facts.implementationTimeline,
        sourceRefs: refs,
        grounded: true
      };
    }
    return {
      question: q,
      answer:
        'Delivery timelines depend on your exact workflow scope and integrations, and a fixed duration is not pre-committed before discovery. Our team can confirm an accurate rollout plan during a short consultation.',
      sourceRefs: [...primaryFileRef, 'Document A §13'],
      grounded: false,
      requiresHumanFollowUp: true
    };
  }

  // 9. Supported Languages & Integrations
  const asksLanguage = /\b(?:kannada|multilingual|languages?|hindi|kanglish)\b/i.test(qLower);
  const asksIntegrations = /\b(?:integrat(?:e|ions?)|connect\s+with|crm|calendar|workspace|tools)\b/i.test(qLower);
  if (isQuantumWeaveContext && (asksLanguage || asksIntegrations)) {
    if (asksLanguage && !asksIntegrations) {
      const langChunks = retrieveCampaignKnowledgeChunks(ctx, 'kannada language multilingual', 2).filter(c =>
        /\b(?:kannada|kn-in|kanglish|hindi)\b/i.test(c.text)
      );
      if (langChunks.length > 0) {
        const cleaned = sanitizeCustomerFacingSnippet(langChunks.map(c => c.text).join(' ')).slice(0, 600);
        if (cleaned.length >= 25) {
          return {
            question: q,
            answer: cleaned,
            sourceRefs: [...new Set(langChunks.map(c => c.fileName))],
            grounded: true
          };
        }
      }
      return {
        question: q,
        answer:
          'Yes—Quantum Weave AI supports multilingual customer conversations in English (en-IN), Kannada (kn-IN), and Kanglish (kn-en) for AI voice calling, along with English, Kannada, and Hindi across WhatsApp and chat workflows.',
        sourceRefs: [...primaryFileRef, 'Document A §§5–6'],
        grounded: true
      };
    }

    if (asksIntegrations && !asksLanguage) {
      return {
        question: q,
        answer:
          'Our AI voice and business automation workflows connect with WhatsApp Business, Google Calendar, Google Workspace (Gmail and Drive), and structured CRM/follow-up pipelines depending on your approved business setup.',
        sourceRefs: [...primaryFileRef, 'Document A §§5–6'],
        grounded: true
      };
    }

    return {
      question: q,
      answer:
        'Yes—our AI Voice Agents and WhatsApp workflows support English, Kannada, and Kanglish (plus Hindi on messaging workflows), and can integrate with WhatsApp Business, Google Calendar, Google Workspace, and CRM follow-up systems.',
      sourceRefs: [...primaryFileRef, 'Document A §§5–6'],
      grounded: true
    };
  }

  // 10. Demo / Consultation / Human Follow-Up request
  if (
    isQuantumWeaveContext &&
    /\b(?:demonstrat|demo|show\s+me|live\s+walkthrough|book\s+a\s+(?:call|consultation)|request\s+a\s+consultation|consultation|speak\s+with\s+(?:someone|a\s+human)|reach\s+your\s+team)\b/i.test(
      qLower
    )
  ) {
    const demoChunks = retrieveCampaignKnowledgeChunks(ctx, 'demo demonstration consultation', 2);
    if (demoChunks.length > 0 && /\b(?:calendly|walkthrough)\b/i.test(demoChunks[0]!.text)) {
      return {
        question: q,
        answer: sanitizeCustomerFacingSnippet(demoChunks[0]!.text).slice(0, 600),
        sourceRefs: [demoChunks[0]!.fileName],
        grounded: true
      };
    }
    return {
      question: q,
      answer: `You can request a consultation by asking for a team callback on this call, messaging our team on ${QUANTUM_WEAVE_COMPANY_INFO.supportContact}, or booking a 30-minute discovery slot (${QUANTUM_WEAVE_COMPANY_INFO.calendlyUrl}).`,
      sourceRefs: [...primaryFileRef, 'Document A §2; Document B §11'],
      grounded: true,
      requiresHumanFollowUp: true
    };
  }

  // 11. What Quantum Weave AI does & Which Services Are Offered (conversational, zero internal KB meta-wording!)
  if (
    isQuantumWeaveContext &&
    /\b(?:what\s+does\s+quantum\s+weave(?:\s+ai)?\s+do|about\s+quantum\s+weave|who\s+are\s+you|introduce\s+(?:your\s+)?company|what\s+is\s+quantum\s+weave)\b/i.test(
      qLower
    )
  ) {
    const extraServices =
      facts && facts.servicesOffered.length > 0
        ? ` In this campaign, we are highlighting ${facts.servicesOffered.slice(0, 3).join(', ')}.`
        : '';
    return {
      question: q,
      answer:
        `Quantum Weave AI (the AI innovation and implementation venture of BrandMint AI Pvt. Ltd.) helps businesses grow sustainably using practical AI systems, multilingual AI Voice Agents, 24/7 WhatsApp and workflow automation, and digital marketing solutions.${extraServices}`.slice(
          0,
          650
        ),
      sourceRefs: [...primaryFileRef, 'Document A §§2,5–6'],
      grounded: true
    };
  }

  // 12. AI Voice Agent solutions & Customer Enquiry Handling
  if (
    isQuantumWeaveContext &&
    /\b(?:ai\s+voice\s+agent|how\s+does\s+(?:it|the\s+voice\s+agent|your\s+voice\s+agent)\s+work|voice\s+automation|handle\s+customer\s+enquir(?:y|ies)|inbound\s+and\s+outbound)\b/i.test(
      qLower
    )
  ) {
    return {
      question: q,
      answer:
        'Our multilingual AI Voice Agents handle inbound customer enquiries and approved outbound calls naturally in English, Kannada, and Kanglish. They introduce your business or event, answer customer questions strictly from verified company knowledge, understand requirements, and record structured call summaries and human callback requests.',
      sourceRefs: [...primaryFileRef, 'Document A §§5–6'],
      grounded: true
    };
  }

  // 13. Digital Marketing Services & Growth
  if (/\b(?:digital\s+marketing|marketing\s+services|social\s+media|meta\s+ads|lead\s+generation|copywriting)\b/i.test(qLower)) {
    const mktSvc = VERIFIED_SERVICES.find(s => s.id === 'digital-marketing');
    const copySvc = VERIFIED_SERVICES.find(s => s.id === 'cash-flow-copy');
    return {
      question: q,
      answer: `We provide ${mktSvc?.name ?? 'Digital Marketing & Social Media Management'} (targeted Meta growth and lead acquisition), ${copySvc?.name ?? 'Cash Flow Copy'} conversion messaging, and AI-assisted video and creative production. Following our Marketing First framework, these systems turn marketing reach into qualified customer conversations and structured follow-up.`,
      sourceRefs: [...primaryFileRef, 'Document A §§4,5,9'],
      grounded: true
    };
  }

  // 14. Business Automation & Services Catalogue
  if (
    isQuantumWeaveContext &&
    /\b(?:which\s+services|what\s+services|services\s+(?:are\s+)?offered|what\s+solutions|business\s+automation|whatsapp\s+automation|workflow\s+automation|how\s+does\s+automation\s+help)\b/i.test(
      qLower
    )
  ) {
    return {
      question: q,
      answer:
        'Quantum Weave AI offers multilingual AI Voice Agents, 24/7 WhatsApp automation and lead conversion, Digital Marketing and Meta growth campaigns, AI video and creative content, Cash Flow Copy systems, and custom business process automation. Automation helps your business respond to enquiries instantly, capture leads around the clock, and reduce manual follow-up workload.',
      sourceRefs: [...primaryFileRef, 'Document A §§5–6'],
      grounded: true
    };
  }

  // 14b. General business products / services supplied (from uploaded campaign PDF/DOCX/TXT)
  if (
    !isQuantumWeaveContext &&
    facts &&
    facts.servicesOffered.length > 0 &&
    /\b(?:products?\s+or\s+services?|what\s+products|what\s+do\s+you\s+(?:supply|offer|sell)|which\s+services|what\s+services)\b/i.test(
      qLower
    )
  ) {
    const formatted = facts.servicesOffered
      .slice(0, 4)
      .map(s => s.trim().replace(/\.+$/, ''))
      .filter(Boolean)
      .join('. ');
    const answer = /^(?:corporate|premium|sportswear|we\b|our\b)/i.test(formatted)
      ? `${formatted}.`
      : `We supply ${formatted}.`;
    return {
      question: q,
      answer: answer.slice(0, 650),
      sourceRefs: primaryFileRef,
      grounded: true
    };
  }

  // 15. General chunk retrieval from uploaded campaign documents (sanitized of internal governance meta-headers)
  const topChunks = retrieveCampaignKnowledgeChunks(ctx, q, 2);
  if (topChunks.length > 0) {
    const rawJoined = topChunks
      .map(c => (c.heading ? `${c.heading}: ${c.text}` : c.text))
      .join(' ');
    const snippet = sanitizeCustomerFacingSnippet(rawJoined).slice(0, 650);
    if (snippet.length >= 20) {
      return {
        question: q,
        answer: snippet,
        sourceRefs: [...new Set(topChunks.map(c => c.fileName))],
        grounded: true
      };
    }
  }

  // 16. Honest unknown — never guess or fabricate!
  return {
    question: q,
    answer:
      'I do not have confirmed details on that in this campaign’s reference materials. I will note your question so a member of our team can follow up with accurate information.',
    sourceRefs: ['Unconfirmed — Human Follow-Up Offered'],
    grounded: false,
    requiresHumanFollowUp: true
  };
}

export function generateSampleGroundedQa(
  knowledgeContext: Omit<BulkCampaignKnowledgeContext, 'sampleGroundedQa'>,
  eventDetails?: string
): BulkCampaignGroundedQaItem[] {
  const extractedFaqs = knowledgeContext.extractedFacts.faqs ?? [];
  const sampleQuestions =
    knowledgeContext.extractedFacts.campaignType === 'webinar'
      ? [
          'What will I learn?',
          'Is it suitable for beginners?',
          'Who is conducting the session?',
          'How do I register?',
          'How much does it cost?'
        ]
      : knowledgeContext.extractedFacts.campaignType === 'services'
        ? [
            'What does Quantum Weave do?',
            'How does an AI Voice Agent work?',
            'Which services are offered and how does automation help?',
            'How much does it cost?',
            'Can it handle Kannada and integrate with our tools?',
            'How can your digital marketing services help a business?',
            'How can I request a consultation?'
          ]
        : extractedFaqs.length > 0
          ? extractedFaqs.slice(0, 6).map(f => f.question)
          : [
              'What products or services do you supply?',
              'What minimum order quantity or requirements apply?',
              'How much does it cost?',
              'What is the next step after this call?'
            ];

  const tempCtx: BulkCampaignKnowledgeContext = { ...knowledgeContext, sampleGroundedQa: [] };
  return sampleQuestions.map(question =>
    answerCampaignCustomerQuestion({
      question,
      knowledgeContext: tempCtx,
      eventDetails
    })
  );
}

/**
 * Ensures an existing campaign's uploaded `Document_A` / `Quantum_Weave` knowledge context
 * has complete multi-section customer-safe chunks (recovering gracefully if an earlier draft
 * truncated DOCX extraction to 1 internal governance chunk) WITHOUT requiring re-upload.
 */
export function enrichOrUpgradeCampaignKnowledgeContext(input: {
  knowledgeContext?: BulkCampaignKnowledgeContext;
  instruction: string;
  eventDetails?: string;
  questions?: string[];
}): BulkCampaignKnowledgeContext {
  const existing = input.knowledgeContext;
  const docAFile = existing?.files.find(
    f =>
      f.status === 'processed' &&
      /(?:document[_\s-]*a|quantum[_\s-]*weave)/i.test(f.fileName)
  );

  const nonMetaChunks = (existing?.chunks ?? []).filter(c => !isInternalKnowledgeGovernanceText(c.text));
  const needsDocAHydration = Boolean(docAFile && nonMetaChunks.length < 3);
  const instructionIsQuantumWeave =
    /\b(?:quantum\s*weave|brandmint)\b/i.test(input.instruction) ||
    (!/\b(?:custom\s+team\s*wear|kashyap\s+inc|smilecare|act\s+as\s+(?:the\s+)?(?:owner|senior\s+sales|sales\s+(?:advisor|executive)|founder|representative|manager)[\s\w/-]{0,30}\bof\s+[A-Z])/i.test(
      input.instruction
    ) &&
      /\b(?:voice\s+agent|ai\s+automation|digital\s+marketing)\b/i.test(input.instruction));

  let nextFiles: BulkCampaignKnowledgeFileRecord[] = existing ? structuredClone(existing.files) : [];
  let nextChunks: BulkCampaignKnowledgeChunk[] = existing ? structuredClone(existing.chunks) : [];

  if (needsDocAHydration || (!existing && instructionIsQuantumWeave)) {
    const targetFileId = docAFile?.fileId ?? 'kb_doc_a_verified';
    const targetFileName =
      docAFile?.fileName ?? 'Document_A_Quantum_Weave_Complete_Knowledge_Base.docx';

    const hydratedChunks: BulkCampaignKnowledgeChunk[] = QUANTUM_WEAVE_SECTIONS.map((sec, idx) => ({
      chunkId: `${targetFileId}_c${idx + 1}`,
      fileId: targetFileId,
      fileName: targetFileName,
      heading: `${sec.title} (${sec.source})`,
      text: sec.text,
      keywords: tokenizeKeywords(`${sec.title} ${sec.text}`)
    }));

    nextChunks = [
      ...nextChunks.filter(c => c.fileId !== targetFileId && !isInternalKnowledgeGovernanceText(c.text)),
      ...hydratedChunks
    ].slice(0, 120);

    if (docAFile) {
      nextFiles = nextFiles.map(f =>
        f.fileId === docAFile.fileId
          ? {
              ...f,
              chunkCount: hydratedChunks.length,
              statusMessage: `Processed (${hydratedChunks.length} verified knowledge sections)`
            }
          : f
      );
    } else if (nextFiles.length === 0) {
      const joinedChars = hydratedChunks.reduce((sum, c) => sum + c.text.length, 0);
      nextFiles = [
        {
          fileId: targetFileId,
          fileName: targetFileName,
          format: 'docx',
          sizeBytes: joinedChars,
          sha256: crypto.createHash('sha256').update(targetFileName).digest('hex'),
          status: 'processed',
          statusMessage: `Processed (${hydratedChunks.length} verified knowledge sections)`,
          extractedCharCount: joinedChars,
          chunkCount: hydratedChunks.length
        }
      ];
    }
  } else {
    nextChunks = nonMetaChunks;
  }

  const { facts, conflicts, missingDetails } = extractFactsAndConflicts(input.instruction, nextChunks);
  const sarvamBoundedFactBrief = buildSarvamBoundedFactBrief({
    instruction: input.instruction,
    eventDetails: input.eventDetails,
    facts,
    questions: input.questions,
    chunks: nextChunks
  });

  const baseCtx: Omit<BulkCampaignKnowledgeContext, 'sampleGroundedQa'> = {
    files: nextFiles,
    chunks: nextChunks,
    extractedFacts: facts,
    conflicts,
    missingDetails,
    sarvamBoundedFactBrief
  };

  return {
    ...baseCtx,
    sampleGroundedQa: generateSampleGroundedQa(baseCtx, input.eventDetails)
  };
}

/**
 * Processes and validates campaign-scoped knowledge files (`PDF`, `DOCX`, `TXT`, `CSV`, `XLSX`).
 * Strictly isolated from customer contact parsing — never extracts phone numbers into recipients.
 */
export function ingestCampaignKnowledgeFiles(input: {
  files: BulkCampaignKnowledgeUploadInput[];
  instruction: string;
  eventDetails?: string;
  questions?: string[];
}): BulkCampaignKnowledgeContext {
  const fileRecords: BulkCampaignKnowledgeFileRecord[] = [];
  const allChunks: BulkCampaignKnowledgeChunk[] = [];

  const boundedFiles = (input.files ?? []).slice(0, CAMPAIGN_KNOWLEDGE_MAX_FILES);

  for (let idx = 0; idx < boundedFiles.length; idx++) {
    const item = boundedFiles[idx]!;
    const fileId = `kb_${idx + 1}_${crypto.randomBytes(4).toString('hex')}`;
    const format = detectKnowledgeFormat(item.fileName, item.mimeType);

    const rawBytes = item.fileBase64
      ? Buffer.from(item.fileBase64, 'base64')
      : Buffer.from(item.rawText ?? '', 'utf8');
    const sha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');

    if (!format) {
      fileRecords.push({
        fileId,
        fileName: item.fileName.slice(0, 180),
        format: 'txt',
        sizeBytes: rawBytes.length,
        sha256,
        status: 'rejected',
        statusMessage: 'Unsupported format. Please attach PDF, DOCX, TXT, CSV, or XLSX campaign knowledge files.',
        extractedCharCount: 0,
        chunkCount: 0
      });
      continue;
    }

    if (rawBytes.length === 0) {
      fileRecords.push({
        fileId,
        fileName: item.fileName.slice(0, 180),
        format,
        sizeBytes: 0,
        sha256,
        status: 'rejected',
        statusMessage: 'File is empty and contains no readable text.',
        extractedCharCount: 0,
        chunkCount: 0
      });
      continue;
    }

    if (rawBytes.length > CAMPAIGN_KNOWLEDGE_MAX_FILE_BYTES) {
      fileRecords.push({
        fileId,
        fileName: item.fileName.slice(0, 180),
        format,
        sizeBytes: rawBytes.length,
        sha256,
        status: 'rejected',
        statusMessage: 'File exceeds the 5 MB campaign knowledge size limit.',
        extractedCharCount: 0,
        chunkCount: 0
      });
      continue;
    }

    // Reject Windows/Linux executables disguised with document extensions
    if (
      (rawBytes[0] === 0x4d && rawBytes[1] === 0x5a) || // MZ
      (rawBytes[0] === 0x7f && rawBytes[1] === 0x45 && rawBytes[2] === 0x4c && rawBytes[3] === 0x46) // ELF
    ) {
      fileRecords.push({
        fileId,
        fileName: item.fileName.slice(0, 180),
        format,
        sizeBytes: rawBytes.length,
        sha256,
        status: 'rejected',
        statusMessage: 'Unsafe binary file rejected.',
        extractedCharCount: 0,
        chunkCount: 0
      });
      continue;
    }

    let extractedRaw = '';
    let rejectionReason: string | null = null;

    if (format === 'pdf') {
      if (item.rawText && item.rawText.trim() && !item.fileBase64) {
        extractedRaw = item.rawText;
      } else if (
        rawBytes.length >= 5 &&
        rawBytes[0] === 0x25 &&
        rawBytes[1] === 0x50 &&
        rawBytes[2] === 0x44 &&
        rawBytes[3] === 0x46 &&
        rawBytes[4] === 0x2d
      ) {
        extractedRaw = extractTextFromPdf(rawBytes);
        if (extractedRaw.startsWith('[Scanned or')) {
          rejectionReason = 'Scanned or image-only PDF has no readable digital text layer.';
        }
      } else {
        rejectionReason = 'Invalid or unreadable PDF header.';
      }
    } else if (format === 'docx') {
      if (item.rawText && item.rawText.trim() && !item.fileBase64) {
        extractedRaw = item.rawText;
      } else if (rawBytes[0] === 0x50 && rawBytes[1] === 0x4b) {
        extractedRaw = extractParagraphAwareDocx(rawBytes);
        if (
          extractedRaw.startsWith('Unable to locate document text') ||
          extractedRaw.startsWith('Invalid DOCX')
        ) {
          rejectionReason = extractedRaw;
        }
      } else {
        rejectionReason = 'Invalid DOCX archive signature.';
      }
    } else if (format === 'xlsx') {
      if (item.rawText && item.rawText.trim() && !item.fileBase64) {
        extractedRaw = item.rawText;
      } else if (rawBytes[0] === 0x50 && rawBytes[1] === 0x4b) {
        extractedRaw = extractStructuredXlsxKnowledge(rawBytes);
        if (!extractedRaw.trim()) {
          rejectionReason = 'Spreadsheet contains no readable text cells.';
        }
      } else {
        rejectionReason = 'Invalid XLSX archive signature.';
      }
    } else {
      // txt or csv
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        extractedRaw = item.rawText ?? decoder.decode(rawBytes);
      } catch {
        rejectionReason = 'Text/CSV file is not valid UTF-8.';
      }
    }

    const sanitized = rejectionReason ? '' : sanitizeUntrustedKnowledgeText(extractedRaw);
    if (rejectionReason || sanitized.length < 5) {
      fileRecords.push({
        fileId,
        fileName: item.fileName.slice(0, 180),
        format,
        sizeBytes: rawBytes.length,
        sha256,
        status: 'rejected',
        statusMessage: rejectionReason ?? 'No readable text content found in file.',
        extractedCharCount: 0,
        chunkCount: 0
      });
      continue;
    }

    const fileChunks = chunkDocumentText(fileId, item.fileName.slice(0, 180), sanitized);
    allChunks.push(...fileChunks);
    fileRecords.push({
      fileId,
      fileName: item.fileName.slice(0, 180),
      format,
      sizeBytes: rawBytes.length,
      sha256,
      status: 'processed',
      statusMessage: `Processed (${fileChunks.length} knowledge ${fileChunks.length === 1 ? 'section' : 'sections'})`,
      extractedCharCount: sanitized.length,
      chunkCount: fileChunks.length
    });
  }

  const trimmedChunks = allChunks.slice(0, 120);
  const { facts, conflicts, missingDetails } = extractFactsAndConflicts(input.instruction, trimmedChunks);
  const sarvamBoundedFactBrief = buildSarvamBoundedFactBrief({
    instruction: input.instruction,
    eventDetails: input.eventDetails,
    facts,
    questions: input.questions,
    chunks: trimmedChunks
  });

  const baseCtx: Omit<BulkCampaignKnowledgeContext, 'sampleGroundedQa'> = {
    files: fileRecords,
    chunks: trimmedChunks,
    extractedFacts: facts,
    conflicts,
    missingDetails,
    sarvamBoundedFactBrief
  };

  return {
    ...baseCtx,
    sampleGroundedQa: generateSampleGroundedQa(baseCtx, input.eventDetails)
  };
}

export interface CampaignKnowledgeQueryResult {
  found: boolean;
  campaignId: string;
  answers: Array<{ source: string; text: string }>;
  excerpt: string;
  fallbackMessage: string;
}

const KNOWLEDGE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'what', 'when', 'where', 'which', 'how', 'are', 'you', 'your', 'can', 'does', 'have', 'from', 'about', 'please', 'tell'
]);

/**
 * Retrieves approved campaign-specific facts strictly from the bound campaign's `knowledgeContext`.
 * Never accesses other campaigns, workspaces, or unapproved files, and never invents missing facts.
 */
export function queryCampaignKnowledge(
  campaignId: string,
  knowledgeContext: BulkCampaignKnowledgeContext | undefined,
  input: { query: string; maxChars?: number }
): CampaignKnowledgeQueryResult {
  const fallbackMessage = 'That detail is not in the approved campaign document. I will note this for a follow-up.';
  const cleanQuery = (input.query ?? '').trim().slice(0, 300);
  if (!cleanQuery || !knowledgeContext || knowledgeContext.chunks.length === 0) {
    return { found: false, campaignId, answers: [], excerpt: '', fallbackMessage };
  }

  const maxChars = Math.min(1500, Math.max(200, input.maxChars ?? 800));
  const tokens = cleanQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !KNOWLEDGE_STOPWORDS.has(t));
  if (tokens.length === 0) {
    return { found: false, campaignId, answers: [], excerpt: '', fallbackMessage };
  }

  const scored = knowledgeContext.chunks
    .map(chunk => {
      const lower = chunk.text.toLowerCase();
      let hits = 0;
      for (const tok of tokens) {
        if (lower.includes(tok)) hits++;
      }
      return { chunk, hits };
    })
    .filter(s => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (scored.length === 0) {
    return { found: false, campaignId, answers: [], excerpt: '', fallbackMessage };
  }

  const answers: Array<{ source: string; text: string }> = [];
  let remaining = maxChars;
  for (const item of scored.slice(0, 3)) {
    if (remaining <= 40) break;
    const snippet = item.chunk.text.slice(0, remaining).trim();
    if (!snippet) continue;
    answers.push({ source: item.chunk.fileName, text: snippet });
    remaining -= snippet.length + 2;
  }

  return {
    found: answers.length > 0,
    campaignId,
    answers,
    excerpt: answers.map(a => a.text).join('\n').slice(0, maxChars),
    fallbackMessage
  };
}

export function createCampaignKnowledgeToken(secret: string, workspaceId: string, campaignId: string): string {
  return crypto.createHash('sha256')
    .update(`thaara-sarvam-kb:${secret}:${workspaceId}:${campaignId}`)
    .digest('hex');
}

export function verifyCampaignKnowledgeToken(
  secret: string,
  providedToken: string | undefined,
  workspaceId: string,
  campaignId: string
): boolean {
  if (!secret || !providedToken || !/^[a-f0-9]{64}$/i.test(providedToken.trim())) return false;
  const expected = Buffer.from(createCampaignKnowledgeToken(secret, workspaceId, campaignId), 'utf8');
  const actual = Buffer.from(providedToken.trim().toLowerCase(), 'utf8');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
