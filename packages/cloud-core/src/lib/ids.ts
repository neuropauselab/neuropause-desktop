/**
 * Identifier + hashing primitives.
 *   - contentId: DETERMINISTIC content-addressed id (same inputs -> same id).
 *     Used by audit provenance so ids are verifiable, not random.
 *   - randomId: non-deterministic id for enrollment/session handles.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';

/** Delimiter for joining content parts before hashing (kept ASCII-visible). */
const PART_SEPARATOR = '|';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacHex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

/** Deterministic, content-addressed id. */
export function contentId(prefix: string, ...parts: Array<string | number>): string {
  return `${prefix}_${sha256Hex(parts.map(String).join(PART_SEPARATOR)).slice(0, 24)}`;
}

/** Random id for handles that must be unforgeable and unique (not verifiable). */
export function randomId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}
