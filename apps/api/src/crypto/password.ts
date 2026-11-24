import crypto from 'node:crypto';

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export async function verifyPassword(password: string, combined: string): Promise<boolean> {
  const [salt, hash] = combined.split(':');
  if (!salt || !hash) return false;
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      const hashBuffer = Buffer.from(hash, 'hex');
      try {
        resolve(crypto.timingSafeEqual(hashBuffer, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}
