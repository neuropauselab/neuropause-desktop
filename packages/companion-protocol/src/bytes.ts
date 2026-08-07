/**
 * Byte helpers (M1-02) — pure, environment-free. UTF-8 is implemented here
 * rather than via TextEncoder/TextDecoder because Hermes's coverage of the
 * encoding globals has lagged; the protocol must not depend on host globals.
 */
import { base64urlnopad } from '@scure/base';
import { CompanionProtocolError } from './errors';

/** Uint8Array → base64url (no padding). */
export function toB64(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}

/** base64url (no padding) → Uint8Array; refuses malformed input. */
export function fromB64(text: string): Uint8Array {
  try {
    return base64urlnopad.decode(text);
  } catch {
    throw new CompanionProtocolError('invalid', 'Malformed base64url payload.');
  }
}

/** UTF-8 encode (full code-point range, surrogate pairs handled). */
export function utf8ToBytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const cp = text.codePointAt(i) ?? 0;
    if (cp > 0xffff) i += 1; // consumed a surrogate pair
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** UTF-8 decode; refuses truncated or malformed sequences. */
export function bytesToUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let cp: number;
    let extra: number;
    if (b0 < 0x80) {
      cp = b0;
      extra = 0;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      extra = 1;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      extra = 2;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07;
      extra = 3;
    } else {
      throw new CompanionProtocolError('invalid', 'Malformed UTF-8 payload.');
    }
    if (i + extra >= bytes.length) {
      throw new CompanionProtocolError('invalid', 'Truncated UTF-8 payload.');
    }
    for (let k = 1; k <= extra; k += 1) {
      const bk = bytes[i + k];
      if ((bk & 0xc0) !== 0x80)
        throw new CompanionProtocolError('invalid', 'Malformed UTF-8 continuation.');
      cp = (cp << 6) | (bk & 0x3f);
    }
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

/** Concatenate byte arrays. */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/** Constant-time byte equality (length leak only — lengths are public here). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
