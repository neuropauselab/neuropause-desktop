/**
 * Password credentials (Wave 1). Real scrypt hashing via node:crypto — passwords
 * are never stored or logged in plaintext. Used by the identity service; not a new
 * service, just the credential primitive NEMS needs on top of Phase-14 identity.
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const computed = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}
