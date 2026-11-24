import { GoogleDriveFile, GoogleDriveOperationResult } from '@thaara/contracts';
import { AuthenticatedScope, ConversationMessageRepository, TransactionalDbClient } from '@thaara/db';
import { GoogleDriveService, extractVerifiedFileText } from './google-drive.js';

export type GoogleDriveChatIntentKind =
  | 'search_files'
  | 'list_folder'
  | 'read_document'
  | 'summarize_document'
  | 'create_folder'
  | 'create_doc'
  | 'upload_file'
  | 'rename_move'
  | 'share_file'
  | 'delete_file';

export interface GoogleDriveChatIntent {
  kind: GoogleDriveChatIntentKind;
  query?: string;
  name?: string;
  folderName?: string;
  folderId?: string;
  fileId?: string;
  email?: string;
  role?: 'reader' | 'commenter' | 'writer';
  content?: string;
  targetFolderName?: string;
  approvalToken?: string;
  confirmed?: boolean;
  limit?: number;
  autoRead?: boolean;
  autoSummarize?: boolean;
  includeLink?: boolean;
}

export interface GoogleDriveChatExecutionOutcome {
  handled: boolean;
  intentKind: GoogleDriveChatIntentKind;
  assistantResponseText: string;
  result?: GoogleDriveOperationResult;
}

export interface GoogleDriveChatContext {
  activeFile?: GoogleDriveFile;
  recentFiles?: GoogleDriveFile[];
}

/**
 * Extracts previously referenced Google Drive files from recent assistant messages in a conversation.
 */
export function extractDriveContextFromMessages(
  messages: Array<{ content?: string; sender_type?: string }>
): GoogleDriveChatContext {
  const context: GoogleDriveChatContext = {};
  const recentFiles: GoogleDriveFile[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.sender_type !== 'assistant' || !msg.content) continue;

    // Pattern 1: [Open "NAME" in Google Drive](LINK)
    const openWithTitleRegex =
      /\[Open\s+"([^"]+)"\s+in\s+Google\s+Drive\]\((https:\/\/(?:drive|docs)\.google\.com\/(?:file|document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)(?:\/[^\)]*)?)\)/g;
    let match: RegExpExecArray | null;
    while ((match = openWithTitleRegex.exec(msg.content)) !== null) {
      const file: GoogleDriveFile = {
        name: match[1]!,
        webViewLink: match[2]!,
        id: match[3]!,
        mimeType: 'application/octet-stream'
      };
      if (!context.activeFile) context.activeFile = file;
      if (!recentFiles.some((f) => f.id === file.id)) recentFiles.push(file);
    }

    // Pattern 2: 1. **NAME** - [Open in Drive](LINK)
    const listPattern =
      /\d+\.\s+\*\*([^*]+)\*\*(?:\s*-\s*\[Open\s+in\s+Drive\]\((https:\/\/(?:drive|docs)\.google\.com\/(?:file|document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)(?:\/[^\)]*)?)\))?/g;
    while ((match = listPattern.exec(msg.content)) !== null) {
      const file: GoogleDriveFile = {
        name: match[1]!.trim(),
        webViewLink: match[2],
        id: match[3] || '',
        mimeType: 'application/octet-stream'
      };
      if (!context.activeFile) context.activeFile = file;
      if (!recentFiles.some((f) => f.id === file.id && f.name === file.name)) recentFiles.push(file);
    }

    // Pattern 3: **Executive Summary of "NAME"**:
    const execSummaryMatch = msg.content.match(/\*\*Executive Summary of "([^"]+)"\*\*/);
    if (execSummaryMatch && execSummaryMatch[1]) {
      const fileName = execSummaryMatch[1];
      const linkMatch = msg.content.match(
        /\((https:\/\/(?:drive|docs)\.google\.com\/(?:file|document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)(?:\/[^\)]*)?)\)/
      );
      const file: GoogleDriveFile = {
        name: fileName,
        webViewLink: linkMatch?.[1],
        id: linkMatch?.[2] || '',
        mimeType: 'application/octet-stream'
      };
      if (!context.activeFile) context.activeFile = file;
      if (!recentFiles.some((f) => f.name === file.name)) recentFiles.push(file);
    }

    // Pattern 4: Document: **NAME**
    const docMatch = msg.content.match(/Document:\s+\*\*([^*]+)\*\*/);
    if (docMatch && docMatch[1]) {
      const fileName = docMatch[1].trim();
      const linkMatch = msg.content.match(
        /\((https:\/\/(?:drive|docs)\.google\.com\/(?:file|document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)(?:\/[^\)]*)?)\)/
      );
      const file: GoogleDriveFile = {
        name: fileName,
        webViewLink: linkMatch?.[1],
        id: linkMatch?.[2] || '',
        mimeType: 'application/octet-stream'
      };
      if (!context.activeFile) context.activeFile = file;
      if (!recentFiles.some((f) => f.name === file.name)) recentFiles.push(file);
    }

    if (context.activeFile) {
      break;
    }
  }

  context.recentFiles = recentFiles;
  return context;
}

/**
 * Resolves a Google Drive chat intent using both single-turn detection and multi-turn conversation context.
 * Queries the most recent messages in descending sequence order so long conversations preserve active Drive context.
 */
export async function resolveGoogleDriveChatRequest(
  scope: AuthenticatedScope,
  userMessage: string,
  options: {
    db?: TransactionalDbClient;
    conversationId?: string;
    hasAttachments?: boolean;
  } = {}
): Promise<GoogleDriveChatIntent | null> {
  let context: GoogleDriveChatContext | undefined;

  if (options.db && options.conversationId) {
    try {
      if (typeof options.db.withScopedTransaction === 'function') {
        const rows = await options.db.withScopedTransaction(scope, async (client) => {
          const res = await client.query<{ sender_type: string; content: string }>(
            `SELECT sender_type, content
             FROM public.conversation_messages
             WHERE workspace_id = $1
               AND conversation_id = $2
               AND user_id = $3
               AND created_at > COALESCE(
                 (SELECT MAX(cutoff_at) FROM public.user_purge_cutoffs WHERE workspace_id = $1 AND user_id = $3),
                 '-infinity'::timestamptz
               )
             ORDER BY sequence_number DESC
             LIMIT 10;`,
            [scope.workspaceId, options.conversationId, scope.userId]
          );
          return res.rows;
        });
        context = extractDriveContextFromMessages([...rows].reverse());
      } else {
        const messageRepo = new ConversationMessageRepository(options.db);
        const allRecent = await messageRepo.listByConversation(scope, options.conversationId, { limit: 200 });
        context = extractDriveContextFromMessages(allRecent.slice(-10));
      }
    } catch {
      // Gracefully ignore history retrieval failure
    }
  }

  return detectGoogleDriveChatRequest(userMessage, context, {
    hasAttachments: options.hasAttachments
  });
}

/**
 * Natural language intent parser for Google Drive commands in Thaara Chat.
 */
export function detectGoogleDriveChatRequest(
  text: string,
  context?: GoogleDriveChatContext,
  options?: { hasAttachments?: boolean }
): GoogleDriveChatIntent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const explicitDrive =
    /\b(?:google\s+drive|g-?drive|(?:my\s+|latest\s+|recent\s+)drive|in\s+drive|to\s+drive|from\s+drive|on\s+drive|into\s+drive|search\s+drive|drive\s+for|drive\s+files?|drive\s+folders?|drive\s+docs?|drive\s+documents?|(?:check|open|show|search|list|view|browse)\s+(?:my\s+)?(?:latest\s+|recent\s+)?drive|google\s+docs?|google\s+sheets?|google\s+slides?)\b/i.test(
      trimmed
    );

  // If user uploaded chat attachments in this turn and did not mention Drive, let the chat attachment analyzer handle it
  if (options?.hasAttachments && !explicitDrive) {
    return null;
  }

  // Exclude other channels when Drive is not explicitly mentioned
  if (!explicitDrive) {
    if (/\b(?:email|emails|gmail|mail|inbox|send\s+email|compose\s+email)\b/i.test(trimmed)) return null;
    if (/\b(?:calendar|meeting|meetings|event|events|schedule|appointment|appointments|outbound\s+call|phone\s+call|callback)\b/i.test(trimmed)) return null;
    if (/\b(?:whatsapp|bulk\s+campaign|campaign\s+status|campaign\s+batch|campaigns)\b/i.test(trimmed)) return null;
  }

  // Pure follow-up: read or summarize active document in conversation
  const followUpTargetPattern =
    '(?:this|that|it|the\\s+(?:file|document|doc|report|proposal)\\s+we\\s+just\\s+found|(?:the|this|that)\\s+(?:file|document|doc|report|proposal|pdf))';

  const isPureFollowUpSummarize =
    new RegExp(
      `^(?:thaara[,\\s]+)?(?:please\\s+)?(?:(?:read\\s+and\\s+)?(?:summarize|summarise)|give\\s+me\\s+(?:a\\s+)?(?:short\\s+)?summary\\s+of|summary\\s+of)\\s+${followUpTargetPattern}(?:\\s+and\\s+(?:summarize|summarise)\\s+it)?\\s*[.?!]?$`,
      'i'
    ).test(trimmed) ||
    /^(?:thaara[,\s]+)?(?:please\s+)?(?:read|open)\s+(?:this|that|the)\s+(?:document|file|doc|report|proposal)\s+and\s+(?:summarize|summarise|give\s+me\s+(?:a\s+)?(?:short\s+)?summary(?:\s+of\s+it)?)\s*[.?!]?$/i.test(
      trimmed
    );

  const isPureFollowUpRead =
    new RegExp(
      `^(?:thaara[,\\s]+)?(?:please\\s+)?(?:read|open|view|fetch|get)\\s+${followUpTargetPattern}\\s*[.?!]?$`,
      'i'
    ).test(trimmed);

  const mentionsExplicitDocNounInFollowUp =
    /\b(?:file|document|doc|report|proposal|pdf)\b/i.test(trimmed);

  if (context?.activeFile) {
    if (isPureFollowUpSummarize) {
      return {
        kind: 'summarize_document',
        fileId: context.activeFile.id,
        name: context.activeFile.name,
        query: context.activeFile.name
      };
    }
    if (isPureFollowUpRead) {
      return {
        kind: 'read_document',
        fileId: context.activeFile.id,
        name: context.activeFile.name,
        query: context.activeFile.name
      };
    }
  } else if (mentionsExplicitDocNounInFollowUp) {
    // Only fall back to latest Drive file when an explicit document/file noun is used (never hijack bare "Summarize it.")
    if (isPureFollowUpSummarize) {
      return {
        kind: 'search_files',
        query: '',
        limit: 1,
        autoSummarize: true,
        includeLink: true
      };
    }
    if (isPureFollowUpRead) {
      return {
        kind: 'search_files',
        query: '',
        limit: 1,
        autoRead: true,
        includeLink: true
      };
    }
  }

  // Check if Drive or specific Drive/document retrieval actions are referenced
  const mentionsDrive = explicitDrive;
  const mentionsDocOrPdf =
    /\b(?:google\s+docs?|in\s+my\s+drive|pdf\s+in\s+(?:my\s+)?drive)\b/i.test(trimmed);
  const mentionsFileListing =
    /\b(?:show|list|get|find|fetch|check|display|view|see)\s+(?:me\s+)?(?:all\s+)?(?:my\s+)?(?:latest|recent|last|newest|top)?\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:files|docs|documents|items|pdfs|reports|proposals|spreadsheets|presentations)\b/i.test(
      trimmed
    );
  const mentionsDocumentSearch =
    /\b(?:find|search\s+for|look\s+for|show\s+me|list|fetch|get)\s+(?:my\s+)?(?:documents|docs|files)\b/i.test(
      trimmed
    );
  const mentionsNamedDocAction =
    /\b(?:find|search(?:\s+for)?|look\s+for|locate|open|read|view|fetch|get|show(?:\s+me)?|pull\s+up|summarize|summarise)\s+(?:my\s+|the\s+|our\s+)?(?:latest\s+|recent\s+|newest\s+|last\s+)?(?:[a-z0-9&'_-]+\s+){0,6}(?:report|reports|proposal|proposals|document|documents|doc|docs|file|files|pdf|pdfs|deck|decks|presentation|presentations|spreadsheet|spreadsheets|sheet|sheets|contract|contracts)\b/i.test(
      trimmed
    );
  const mentionsCreateFolderOrDoc =
    /\bcreate\s+(?:a\s+)?(?:new\s+)?(?:(?:drive\s+)?folder|google\s+doc)\b/i.test(trimmed);

  if (
    !mentionsDrive &&
    !mentionsDocOrPdf &&
    !mentionsFileListing &&
    !mentionsDocumentSearch &&
    !mentionsNamedDocAction &&
    !mentionsCreateFolderOrDoc &&
    !/\b(?:drive\s+folder|drive\s+file)\b/i.test(trimmed)
  ) {
    return null;
  }

  // 1. Summarize document / PDF (standalone summarize command)
  const isSearchPrefix = /^(?:thaara[,\s]+)?(?:please\s+)?(?:find|search|look\s+for|where\s+is|check\s+for)\b/i.test(trimmed);
  const summarizeMatch = trimmed.match(
    /\b(?:summarize|summarise|give\s+me\s+a\s+summary\s+of|summary\s+of)\s+(?:(?:the|my|our)\s+)?(?:(?:latest|recent|newest|last)\s+)?([^\r\n.?!]+?)(?:\s+(?:in|from)\s+(?:my\s+)?(?:google\s+)?drive)?[.?!]*$/i
  );
  if (
    summarizeMatch &&
    summarizeMatch[1] &&
    !isSearchPrefix &&
    !/^(?:it|this|that|them|all|file|document)$/i.test(summarizeMatch[1].trim()) &&
    /\b(?:summarize|summarise|summary)\b/i.test(trimmed)
  ) {
    const raw = summarizeMatch[1].trim();
    return {
      kind: 'summarize_document',
      name: raw,
      query: raw
    };
  }

  // 2. Confirmed Delete with token
  const confirmedDeleteMatch = trimmed.match(
    /\b(?:confirm\s+delete|confirm\s+removal\s+of)\s+(?:the\s+)?(?:file\s+|document\s+)?["']?([^\r\n"']+)["']?(?:\s*(?:\[|\()?([A-Za-z0-9_-]+)(?:\]|\))?)?/i
  );
  if (confirmedDeleteMatch && confirmedDeleteMatch[1]) {
    const rawTarget = confirmedDeleteMatch[1].replace(/\s+(?:from|in)\s+(?:google\s+)?drive\b/i, '').trim();
    const token = confirmedDeleteMatch[2]?.trim() || (trimmed.match(/\b((?:DRV-CONF|CONFIRM-DEL)-[A-F0-9-]+)\b/i)?.[1]);
    return {
      kind: 'delete_file',
      name: rawTarget,
      approvalToken: token
    };
  }

  // 3. Delete file (initial request)
  const deleteMatch = trimmed.match(
    /\b(?:delete|remove|trash)\s+(?:the\s+)?(?:file\s+|document\s+)?["']?([^\r\n"']+)["']?\s+(?:from\s+(?:google\s+)?drive|to\s+trash)\b/i
  );
  if (deleteMatch && deleteMatch[1]) {
    return {
      kind: 'delete_file',
      name: deleteMatch[1].trim()
    };
  }

  // 4. Confirmed Share
  const confirmedShareMatch = trimmed.match(
    /\bconfirm\s+share\s+(?:the\s+|this\s+)?([^\r\n]+?)\s+with\s+([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?:\s+as\s+(\w+))?(?:\s*(?:\[|\()?([A-Za-z0-9_-]+)(?:\]|\))?)?/i
  );
  if (confirmedShareMatch && confirmedShareMatch[1] && confirmedShareMatch[2]) {
    const rawRole = (confirmedShareMatch[3]?.toLowerCase() === 'editor' || confirmedShareMatch[3]?.toLowerCase() === 'writer') ? 'writer' : 'reader';
    const token = confirmedShareMatch[4]?.trim() || (trimmed.match(/\b((?:DRV-CONF|CONFIRM-SHARE)-[A-F0-9-]+)\b/i)?.[1]);
    return {
      kind: 'share_file',
      name: confirmedShareMatch[1].replace(/^(?:the|this|file|document|proposal)\s+/i, '').trim(),
      email: confirmedShareMatch[2].trim(),
      role: rawRole,
      confirmed: true,
      approvalToken: token
    };
  }

  // 4b. Confirmed Move
  const confirmedMoveMatch = trimmed.match(
    /\bconfirm\s+move\s+(?:the\s+|this\s+)?(?:file\s+|document\s+)?["']?([^\r\n"']+?)["']?\s+to\s+(?:folder\s+)?["']?([^\r\n\["']+?)["']?(?:\s*(?:\[|\()?([A-Za-z0-9_-]+)(?:\]|\))?)?\s*$/i
  );
  if (confirmedMoveMatch && confirmedMoveMatch[1] && confirmedMoveMatch[2]) {
    const token = confirmedMoveMatch[3]?.trim() || (trimmed.match(/\b(DRV-CONF-[A-F0-9-]+)\b/i)?.[1]);
    return {
      kind: 'rename_move',
      name: confirmedMoveMatch[1].trim(),
      targetFolderName: confirmedMoveMatch[2].trim(),
      confirmed: true,
      approvalToken: token
    };
  }

  // Raw token reply for delete confirmation: "DRV-CONF-XXXX-XXXX" or "CONFIRM-DEL-..."
  const rawDelTokenMatch = trimmed.match(/^(?:confirm\s+)?((?:DRV-CONF|CONFIRM-DEL)-[A-F0-9-]+)\s*[.?!]?$/i);
  if (rawDelTokenMatch && rawDelTokenMatch[1]) {
    return {
      kind: 'delete_file',
      approvalToken: rawDelTokenMatch[1].toUpperCase()
    };
  }

  // 5. Share file (initial request)
  const shareMatch = trimmed.match(
    /\bshare\s+(?:the\s+|this\s+)?([^\r\n]+?)\s+with\s+([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i
  );
  if (shareMatch && shareMatch[1] && shareMatch[2]) {
    return {
      kind: 'share_file',
      name: shareMatch[1].replace(/^(?:the|this|file|document|proposal)\s+/i, '').trim(),
      email: shareMatch[2].trim(),
      role: 'reader'
    };
  }

  // 4. Create folder
  const createFolderMatch = trimmed.match(
    /\bcreate\s+(?:a\s+)?(?:new\s+)?folder\s+(?:named|called|titled)?\s*["']?([^\r\n"']+)["']?/i
  );
  if (createFolderMatch && createFolderMatch[1] && (mentionsDrive || /\bfolder\b/i.test(trimmed))) {
    const rawName = createFolderMatch[1]
      .replace(/\s+(?:in|on)\s+(?:my\s+)?(?:google\s+)?drive\b/i, '')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .trim();
    return {
      kind: 'create_folder',
      folderName: rawName,
      name: rawName
    };
  }

  // 5. Create Google Doc
  const createDocMatch = trimmed.match(
    /\bcreate\s+(?:a\s+)?(?:new\s+)?google\s+doc\s+(?:named|called|titled)?\s*["']?([^\r\n"']+)["']?/i
  );
  if (createDocMatch && createDocMatch[1]) {
    const rawTitle = createDocMatch[1]
      .replace(/\s+(?:in|on)\s+(?:my\s+)?(?:google\s+)?drive\b/i, '')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .trim();
    return {
      kind: 'create_doc',
      name: rawTitle
    };
  }

  // 6. Upload file
  const uploadMatch = trimmed.match(
    /\bupload\s+(?:this\s+)?(?:file\s+|document\s+)?["']?([^\r\n"']+)["']?\s+to\s+(?:google\s+)?drive\b/i
  );
  if (uploadMatch && uploadMatch[1]) {
    return {
      kind: 'upload_file',
      name: uploadMatch[1].trim()
    };
  }

  // 7. Rename or Move
  const moveMatch = trimmed.match(
    /\bmove\s+(?:file\s+)?["']?([^\r\n"']+)["']?\s+to\s+(?:folder\s+)?["']?([^\r\n"']+)["']?/i
  );
  if (moveMatch && moveMatch[1] && moveMatch[2] && mentionsDrive) {
    return {
      kind: 'rename_move',
      name: moveMatch[1].trim(),
      targetFolderName: moveMatch[2].trim()
    };
  }

  const renameMatch = trimmed.match(
    /\brename\s+(?:file\s+)?["']?([^\r\n"']+)["']?\s+to\s+["']?([^\r\n"']+)["']?/i
  );
  if (renameMatch && renameMatch[1] && renameMatch[2] && mentionsDrive) {
    return {
      kind: 'rename_move',
      name: renameMatch[1].trim(),
      query: renameMatch[2].trim() // newName
    };
  }

  // 8. List folder contents
  const listFolderMatch = trimmed.match(
    /\b(?:list|show|view|fetch)\s+(?:the\s+)?(?:files|contents|documents)\s+(?:in|inside|under)\s+(?:folder\s+)?["']?([^\r\n"']+)["']?/i
  );
  if (listFolderMatch && listFolderMatch[1] && mentionsDrive) {
    return {
      kind: 'list_folder',
      folderName: listFolderMatch[1].replace(/\s+(?:in|on)\s+(?:my\s+)?(?:google\s+)?drive\b/i, '').trim()
    };
  }

  // 9. Read document
  const readMatch = trimmed.match(
    /\b(?:read|open|view|fetch|get)\s+(?:the\s+)?(?:document|file|doc|pdf)\s+["']?([^\r\n"']+)["']?(?:\s+(?:from|in)\s+(?:google\s+)?drive)?/i
  );
  if (readMatch && readMatch[1] && (mentionsDrive || mentionsDocOrPdf || mentionsNamedDocAction)) {
    const cleanedTarget = readMatch[1]
      .replace(/\s+(?:from|in|on)\s+(?:my\s+)?(?:google\s+)?drive\b/i, '')
      .replace(/^[.\s?!]+|[.\s?!]+$/g, '')
      .trim();
    if (cleanedTarget && !/^(?:it|this|that)$/i.test(cleanedTarget)) {
      return {
        kind: 'read_document',
        name: cleanedTarget,
        query: cleanedTarget
      };
    }
  }

  // 10. Natural search and multi-action compound requests
  const hasRead = /\b(?:read(?:\s+it)?|open(?:\s+it)?)\b/i.test(trimmed);
  const hasSummarize = /\b(?:summarize(?:\s+it)?|summarise(?:\s+it)?|give\s+me\s+(?:a\s+)?(?:short\s+)?summary|summary)\b/i.test(trimmed);
  const hasLink = /\b(?:with\s+(?:the\s+)?(?:document\s+)?links?|provide\s+(?:the\s+)?(?:document\s+)?links?|document\s+link|links?)\b/i.test(trimmed);

  const { query: parsedQ, limit: parsedLimit } = parseNaturalSearchQuery(trimmed);
  return {
    kind: 'search_files',
    query: parsedQ,
    name: parsedQ,
    limit: parsedLimit,
    autoRead: hasRead || hasSummarize,
    autoSummarize: hasSummarize,
    includeLink: hasLink || hasSummarize || hasRead
  };
}

/**
 * Natural query cleanser for Google Drive search requests.
 */
function parseNaturalSearchQuery(text: string): { query: string; limit: number; isOpenLatest: boolean } {
  const trimmed = text.trim();
  let limit = 10;

  const WORD_TO_NUM: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };

  const limitMatch =
    trimmed.match(/\b(?:latest|top|recent|last|first)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i) ||
    trimmed.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:latest|recent|files|items|docs|documents)\b/i);

  if (limitMatch && limitMatch[1]) {
    const rawNum = limitMatch[1].toLowerCase();
    limit = WORD_TO_NUM[rawNum] ?? parseInt(rawNum, 10);
    if (isNaN(limit) || limit <= 0) limit = 10;
  }

  const isOpenLatest =
    /\b(?:show\s+me|list|search|find|get|check|display|view)?\s*(?:my\s+)?(?:latest|recent|last|newest)\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:files|docs|documents|items|drive)?(?:\s+with\s+(?:their\s+)?links?)?\b/i.test(trimmed) &&
    !/\b(?:proposal|pitch\s*deck|report|invoice|contract|budget|notes|presentation|sheet|slides|deck)\b/i.test(trimmed);

  let cleaned = trimmed
    .replace(/^thaara[,\s]+/i, '')
    // Strip trailing multi-action instructions such as:
    // ", read it, and give me a short summary with the document link"
    // "and read it"
    // "and summarize it"
    // "and give me a short summary with the link"
    .replace(/\s*,?\s*(?:and\s+)?(?:then\s+)?(?:please\s+)?(?:read(?:\s+it)?|summarize(?:\s+it)?|summarise(?:\s+it)?|give\s+me\s+(?:a\s+)?(?:short\s+)?summary|provide\s+(?:the\s+)?(?:document\s+)?links?|with\s+(?:the\s+)?(?:document\s+)?links?).*$/gi, '')
    .replace(/\b(?:please\s+)?(?:search|find|look\s+for|where\s+is|check\s+for|check|get|show\s+me|show|list|display|view|open|read)\b/gi, '')
    .replace(/\b(?:in|on|from|inside|into)\s+(?:my\s+)?(?:google\s+)?drive\b/gi, '')
    .replace(/\b(?:my\s+)?(?:google\s+)?drive\b/gi, '')
    .replace(/\b(?:my\s+)?(?:latest|recent|newest|top|last)\b/gi, '')
    .replace(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:files|items|docs|documents)?\b/gi, '')
    .replace(/\b(?:with\s+)?(?:their\s+)?(?:links?|urls?)\b/gi, '')
    .replace(/\b(?:and\s+show\s+me|and\s+list)\b/gi, '')
    .trim()
    .replace(/^(?:for|about)\s+/i, '')
    .replace(/^[,\s.?!]+|[,\s.?!]+$/g, '')
    .trim();

  if (/^(?:(?:my|the|all)\s+)?(?:files|documents|docs|items|drive)?$/i.test(cleaned) || isOpenLatest) {
    cleaned = '';
  }

  return { query: cleaned, limit, isOpenLatest };
}

/**
 * Formats a list of Google Drive files into clear executive markdown.
 */
function formatFileList(files: GoogleDriveFile[], limit?: number): string {
  if (!files || files.length === 0) {
    return 'No matching files found in your Google Drive.';
  }

  const sorted = [...files].sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime());
  const displayFiles = typeof limit === 'number' && limit > 0 ? sorted.slice(0, limit) : sorted;

  const lines = displayFiles.map((f, i) => {
    const link = f.webViewLink ? ` - [Open in Drive](${f.webViewLink})` : '';
    const modified = f.modifiedTime ? ` *(Modified: ${new Date(f.modifiedTime).toLocaleDateString()})*` : '';
    return `${i + 1}. **${f.name}**${link}${modified}`;
  });

  return `Here are the matching files from your Google Drive (sorted by most recently modified):\n\n${lines.join('\n')}`;
}

/**
 * Executes a governed Google Drive chat request.
 */
export async function executeChatGoogleDriveRequest(
  scope: AuthenticatedScope,
  intent: GoogleDriveChatIntent,
  driveService: GoogleDriveService
): Promise<GoogleDriveChatExecutionOutcome> {
  // Security enforcement: only executive owner or admin can access Google Drive
  if (scope.role !== 'owner' && scope.role !== 'admin') {
    return {
      handled: true,
      intentKind: intent.kind,
      assistantResponseText: 'Access denied: Google Drive operations are restricted to workspace executive owners.'
    };
  }

  switch (intent.kind) {
    case 'search_files': {
      const res = await driveService.searchFiles(scope, {
        query: intent.query,
        nameFilter: intent.name,
        limit: intent.limit
      });
      if (!res.success) {
        const targetDesc = intent.query ? `for "${intent.query}"` : 'for your latest files';
        let msg = res.message || 'Operation failed.';
        if (msg.includes('reconnected') || msg.includes('revoked') || msg.includes('expired')) {
          msg = 'The Google Drive OAuth credential (BNt9B8jgVmexVQ1O) has expired or was revoked. Please reconnect the Google Drive account in n8n credentials.';
        }
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `I searched Google Drive ${targetDesc}, but encountered an issue: ${msg}`,
          result: res
        };
      }
      if (intent.autoSummarize || intent.autoRead) {
        if (!res.files || res.files.length === 0) {
          const targetDesc = intent.query ? `for "${intent.query}"` : 'in your Google Drive';
          return {
            handled: true,
            intentKind: intent.kind,
            assistantResponseText: `I searched Google Drive ${targetDesc}, but found no matching documents to read or summarize.`,
            result: res
          };
        }

        // Select the latest matching file
        const sortedFiles = [...res.files].sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime());
        const targetFile = sortedFiles[0];

        if (!targetFile) {
          return {
            handled: true,
            intentKind: intent.kind,
            assistantResponseText: `I searched Google Drive for "${intent.query || ''}", but found no matching documents to read or summarize.`,
            result: res
          };
        }

        const link = targetFile.webViewLink
          ? `\n\n[Open "${targetFile.name}" in Google Drive](${targetFile.webViewLink})`
          : '';

        if (intent.autoSummarize) {
          const summaryRes = await driveService.summarizeDocument(scope, targetFile.id, targetFile.name);
          if (!summaryRes.success) {
            return {
              handled: true,
              intentKind: intent.kind,
              assistantResponseText: `I located **${targetFile.name}** in your Google Drive, but encountered an issue while reading it for summarization: ${summaryRes.message}${link}`,
              result: summaryRes
            };
          }

          const verifiedSummary =
            (typeof summaryRes.file?.summary === 'string' && summaryRes.file.summary.trim()) ||
            extractVerifiedFileText(summaryRes.file) ||
            extractVerifiedFileText(targetFile);
          const summaryContent =
            verifiedSummary ||
            summaryRes.message ||
            `The document "${targetFile.name}" has been retrieved from your Google Drive. Its full text content could not be extracted directly for automated summarization, but it is accessible in Google Drive:`;

          return {
            handled: true,
            intentKind: intent.kind,
            assistantResponseText: `**Executive Summary of "${targetFile.name}"**:\n\n${summaryContent}${link}`,
            result: {
              ...summaryRes,
              file: targetFile
            }
          };
        }

        // Plain autoRead
        const readRes = await driveService.readFile(scope, targetFile.id, targetFile.name);
        const verifiedText = extractVerifiedFileText(readRes.file) || extractVerifiedFileText(targetFile);
        const textContent =
          verifiedText ||
          `The document "${targetFile.name}" was located in your Google Drive, but its full text content is not directly extractable through the current Drive metadata workflow. You can open and read the full document directly in Google Drive:`;

        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Document: **${targetFile.name}**\n\n${textContent}${link}`,
          result: readRes
        };
      }

      return {
        handled: true,
        intentKind: intent.kind,
        assistantResponseText: formatFileList(res.files || [], intent.limit),
        result: res
      };
    }

    case 'list_folder': {
      const res = await driveService.listFolder(scope, intent.folderId, intent.folderName);
      if (!res.success) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Unable to list files in folder "${intent.folderName || 'Root'}": ${res.message}`,
          result: res
        };
      }
      return {
        handled: true,
        intentKind: intent.kind,
        assistantResponseText: `Files in folder **${intent.folderName || 'Root'}**:\n\n${formatFileList(res.files || [])}`,
        result: res
      };
    }

    case 'read_document': {
      let targetFileId = intent.fileId;
      let targetFileName = intent.name;
      let fallbackLink = '';

      if (!targetFileId && targetFileName) {
        const searchRes = await driveService.searchFiles(scope, { query: targetFileName, limit: 5 });
        if (searchRes.success && searchRes.files && searchRes.files.length > 0) {
          const sorted = [...searchRes.files].sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime());
          const first = sorted[0];
          if (first) {
            targetFileId = first.id;
            targetFileName = first.name;
            fallbackLink = first.webViewLink ? `\n\n[Open "${first.name}" in Google Drive](${first.webViewLink})` : '';
          }
        }
      }

      const res = await driveService.readFile(scope, targetFileId || '', targetFileName);
      const docName = targetFileName || res.file?.name || intent.name || 'Document';
      if (!res.success || (!res.file && !fallbackLink)) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Unable to read "${docName}" from your Google Drive: ${res.message || 'No matching verified document was found.'}`,
          result: res
        };
      }

      if (targetFileId && res.file?.id && res.file.id !== targetFileId) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Unable to read "${docName}": file identity verification failed (received mismatched file ID).`,
          result: res
        };
      }

      const link = (res.file?.webViewLink ? `\n\n[Open "${docName}" in Google Drive](${res.file.webViewLink})` : '') || fallbackLink;
      const verifiedContent = extractVerifiedFileText(res.file);
      const content =
        verifiedContent ||
        `The document "${docName}" was located in your Google Drive, but its full text content is not directly extractable through the current Drive metadata workflow. You can open and read the full document directly in Google Drive:`;

      return {
        handled: true,
        intentKind: intent.kind,
        assistantResponseText: `Document: **${docName}**\n\n${content}${link}`,
        result: res
      };
    }

    case 'summarize_document': {
      let targetFileId = intent.fileId;
      let targetFileName = intent.name;
      let fallbackLink = '';

      if (!targetFileId && targetFileName) {
        const searchRes = await driveService.searchFiles(scope, { query: targetFileName, limit: 5 });
        if (searchRes.success && searchRes.files && searchRes.files.length > 0) {
          const sorted = [...searchRes.files].sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime());
          const first = sorted[0];
          if (first) {
            targetFileId = first.id;
            targetFileName = first.name;
            fallbackLink = first.webViewLink ? `\n\n[Open "${first.name}" in Google Drive](${first.webViewLink})` : '';
          }
        }
      }

      const res = await driveService.summarizeDocument(scope, targetFileId || '', targetFileName);
      const docName = targetFileName || res.file?.name || intent.name || 'Document';
      if (!res.success) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Unable to summarize "${docName}": ${res.message || 'The requested document could not be verified in Google Drive.'}${fallbackLink}`,
          result: res
        };
      }

      const verifiedSummary =
        (typeof res.file?.summary === 'string' && res.file.summary.trim()) ||
        extractVerifiedFileText(res.file);
      const summaryContent =
        verifiedSummary ||
        res.message ||
        `The document "${docName}" has been retrieved from your Google Drive. Its full text content could not be extracted directly for automated summarization, but it is accessible in Google Drive:`;

      const link = (res.file?.webViewLink ? `\n\n[Open "${docName}" in Google Drive](${res.file.webViewLink})` : '') || fallbackLink;
      return {
        handled: true,
        intentKind: intent.kind,
        assistantResponseText: `**Executive Summary of "${docName}"**:\n\n${summaryContent}${link}`,
        result: res
      };
    }

    case 'create_folder': {
      const res = await driveService.createFolder(scope, {
        name: intent.folderName || intent.name || 'New Folder',
        parentFolderId: intent.folderId
      });
      if (!res.success || !res.folder) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Failed to create folder "${intent.folderName || intent.name}": ${res.message}`,
          result: res
        };
      }
      const link = res.folder.webViewLink ? ` [View Folder](${res.folder.webViewLink})` : '';
      return {
        handled: true,
        intentKind: intent.kind,
        assistantResponseText: `Successfully created folder **${res.folder.name}** in Google Drive.${link}`,
        result: res
      };
    }

    case 'create_doc': {
      const res = await driveService.createDoc(scope, {
        title: intent.name || 'Untitled Document',
        content: intent.content || '',
        parentFolderId: intent.folderId
      });
      if (!res.success || !res.file) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Failed to create Google Doc "${intent.name}": ${res.message}`,
          result: res
        };
      }
      const link = res.file.webViewLink ? ` [Open Document](${res.file.webViewLink})` : '';
      return {
        handled: true,
        intentKind: intent.kind,
        assistantResponseText: `Successfully created Google Doc **${res.file.name}**.${link}`,
        result: res
      };
    }

    case 'upload_file': {
      const res = await driveService.uploadFile(scope, intent.name || 'document.txt', intent.content || 'Uploaded from Thaara Chat');
      if (!res.success || !res.file) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Failed to upload "${intent.name}" to Google Drive: ${res.message}`,
          result: res
        };
      }
      const link = res.file.webViewLink ? ` [Open File](${res.file.webViewLink})` : '';
      return {
        handled: true,
        intentKind: intent.kind,
        assistantResponseText: `Successfully uploaded **${res.file.name}** to Google Drive.${link}`,
        result: res
      };
    }

    case 'rename_move': {
      const target = intent.name || intent.fileId || '';
      const resolved = await driveService.resolveFile(scope, target);
      if (!resolved.resolved || !resolved.file) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: resolved.message || `File "${target}" was not found in Google Drive.`
        };
      }
      const file = resolved.file;
      let destinationFolderId = intent.folderId;
      let destinationLabel = intent.targetFolderName || intent.folderId || '';

      if (!destinationFolderId && intent.targetFolderName) {
        const folderSearch = await driveService.searchFiles(scope, {
          query: intent.targetFolderName,
          mimeTypeFilter: 'application/vnd.google-apps.folder',
          limit: 5
        });
        const matchedFolder = folderSearch.files?.find(
          (f) => f.name.toLowerCase() === intent.targetFolderName!.toLowerCase()
        ) || folderSearch.files?.[0];
        if (matchedFolder) {
          destinationFolderId = matchedFolder.id;
          destinationLabel = matchedFolder.name;
        } else {
          destinationFolderId = intent.targetFolderName;
        }
      }

      const res = await driveService.renameOrMove(scope, {
        fileId: file.id,
        fileName: file.name,
        newName: intent.query,
        targetFolderId: destinationFolderId,
        removeParents: Array.isArray(file.parents) && file.parents.length > 0 ? file.parents.join(',') : undefined,
        confirmed: intent.confirmed,
        confirmationToken: intent.approvalToken
      });
      if (res.requiresConfirmation) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `⚠️ **File Move Confirmation Required**:\n- **File**: **${file.name}** (ID: \`${file.id}\`)\n- **Destination Folder**: **${destinationLabel || destinationFolderId}** (\`${destinationFolderId}\`)\n\nTo confirm moving this file, reply with:\n\`Confirm move ${file.name} to ${destinationLabel || destinationFolderId} [${res.approvalId}]\`\n*(This single-use confirmation token expires in 10 minutes).*`,
          result: res
        };
      }
      if (!res.success) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Unable to update file: ${res.message}`,
          result: res
        };
      }
      return {
        handled: true,
        intentKind: intent.kind,
        assistantResponseText: res.message || `File **${file.name}** updated successfully in Google Drive.`,
        result: res
      };
    }

    case 'share_file': {
      if (!intent.email) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Please specify the email address of the person you want to share "${intent.name || 'this file'}" with.`
        };
      }
      const target = intent.name || intent.fileId || 'document';
      const resolved = await driveService.resolveFile(scope, target);
      if (!resolved.resolved || !resolved.file) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: resolved.message || `File "${target}" was not found in Google Drive.`
        };
      }
      const file = resolved.file;
      const res = await driveService.shareFile(scope, {
        fileId: file.id,
        fileName: file.name,
        email: intent.email,
        role: intent.role || 'reader',
        confirmed: intent.confirmed,
        confirmationToken: intent.approvalToken
      });
      if (res.requiresConfirmation) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `⚠️ **File Sharing Confirmation Required**:\n- **File**: **${file.name}** (ID: \`${file.id}\`)\n- **Recipient**: **${intent.email}**\n- **Permission**: **${intent.role === 'writer' ? 'Editor' : 'Viewer'}**\n\nTo confirm and grant access, reply with:\n\`Confirm share ${file.name} with ${intent.email} [${res.approvalId}]\`\n*(This single-use confirmation token expires in 10 minutes).*`,
          result: res
        };
      }
      if (!res.success) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Failed to share "${file.name}" with ${intent.email}: ${res.message}`,
          result: res
        };
      }
      return {
        handled: true,
        intentKind: intent.kind,
        assistantResponseText: `Shared **${file.name}** with **${intent.email}** as ${intent.role === 'writer' ? 'Editor' : 'Viewer'}.`,
        result: res
      };
    }

    case 'delete_file': {
      const target = intent.name || intent.fileId || 'file';
      const resolved = await driveService.resolveFile(scope, target);
      if (!resolved.resolved || !resolved.file) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: resolved.message || `File "${target}" was not found in Google Drive.`
        };
      }
      const file = resolved.file;
      const res = await driveService.deleteFile(scope, {
        fileId: file.id,
        fileName: file.name,
        approvalToken: intent.approvalToken
      });
      if (res.requiresApproval) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `⚠️ **Action Requires Confirmation**: Permanent deletion of **"${file.name}"** (ID: \`${file.id}\`) cannot be undone.\nThis action is strictly bound to your workspace (\`${scope.workspaceId.slice(0, 8)}\`) and executive user account.\n\nTo confirm deletion, reply with the exact confirmation code:\n\`Confirm delete ${file.name} [${res.approvalId}]\`\n*(This single-use confirmation token expires in 10 minutes).*`,
          result: res
        };
      }
      if (!res.success) {
        return {
          handled: true,
          intentKind: intent.kind,
          assistantResponseText: `Failed to delete "${file.name}": ${res.message}`,
          result: res
        };
      }
      return {
        handled: true,
        intentKind: intent.kind,
        assistantResponseText: res.message,
        result: res
      };
    }
  }
}
