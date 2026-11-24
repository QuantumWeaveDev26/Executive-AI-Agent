import React from 'react';

function isSafeHttpsUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Safely renders inline chat text with clickable HTTPS markdown links `[label](https://...)`,
 * bold `**text**`, and inline `` `code` `` using pure React elements (zero HTML injection).
 */
export function ChatRichText({ text }: { text: string }): React.ReactElement {
  const tokenPattern = /\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)|\*\*([^*\n]{1,300})\*\*|`([^`\n]{1,200})`/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    const [fullMatch, linkLabel, linkUrl, boldText, codeText] = match;
    keyCounter += 1;

    if (linkLabel !== undefined && linkUrl !== undefined) {
      const safeHref = isSafeHttpsUrl(linkUrl);
      if (safeHref) {
        elements.push(
          <a
            key={`link-${keyCounter}`}
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--brand-blue, #2563eb)',
              fontWeight: 600,
              textDecoration: 'underline',
              wordBreak: 'break-word',
            }}
          >
            {linkLabel}
          </a>
        );
      } else {
        elements.push(fullMatch);
      }
    } else if (boldText !== undefined) {
      elements.push(<strong key={`bold-${keyCounter}`}>{boldText}</strong>);
    } else if (codeText !== undefined) {
      elements.push(
        <code
          key={`code-${keyCounter}`}
          style={{
            padding: '0.1rem 0.35rem',
            borderRadius: '4px',
            background: 'rgba(15, 23, 42, 0.06)',
            fontSize: '0.88em',
          }}
        >
          {codeText}
        </code>
      );
    } else {
      elements.push(fullMatch);
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return <>{elements.length > 0 ? elements : text}</>;
}
