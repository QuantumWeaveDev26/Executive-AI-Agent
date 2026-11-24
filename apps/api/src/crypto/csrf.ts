import crypto from 'node:crypto';

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function verifyCsrfToken(headerToken: string | undefined, cookieToken: string | undefined): boolean {
  if (!headerToken || !cookieToken) return false;
  if (headerToken.length !== cookieToken.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(headerToken, 'utf-8'),
      Buffer.from(cookieToken, 'utf-8')
    );
  } catch {
    return false;
  }
}
