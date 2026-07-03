/**
 * Integrity primitives for the package service. SHA-256 over buffers and files,
 * plus constant-time-ish comparison helpers. Hashing files is streamed so large
 * artifacts never sit fully in memory.
 */
import { promises as fs, createReadStream } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';

export function sha256Buffer(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** True when two hex digests match (length-safe comparison). */
export function hashesEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export interface IntegrityResult {
  ok: boolean;
  actual: string;
  expected: string;
  reason: string | null;
}

export async function verifyFileHash(path: string, expected: string): Promise<IntegrityResult> {
  try {
    await fs.access(path);
  } catch {
    return { ok: false, actual: '', expected, reason: 'file_missing' };
  }
  const actual = await sha256File(path);
  const ok = hashesEqual(actual, expected);
  return { ok, actual, expected, reason: ok ? null : 'hash_mismatch' };
}
