/**
 * API request signing (zero-trust) — a CLOUD-PLATFORM primitive.
 *
 * Consolidation note (NCEA 10.2A): identity / sessions / JWT / OAuth are owned
 * authoritatively by `apps/backend/auth` (Apple/Google providers, PKCE, jose
 * JWTs, sessions, password hashing). This module keeps ONLY the piece the
 * backend does not have — HMAC request signing over a canonical
 * (method, path, timestamp, body-hash) with a replay window — as a reusable
 * primitive for signed inter-service / device calls. It duplicates nothing in
 * the backend.
 */
import type { Clock } from '../../lib/clock';
import { hmacHex, sha256Hex } from '../../lib/ids';
import { timingSafeEqual } from 'node:crypto';
import { type Result, ok, err } from '../../lib/result';

export interface SignerError {
  code: 'stale' | 'bad_signature';
  message: string;
}

function canonical(method: string, path: string, timestamp: number, body: string): string {
  return [method.toUpperCase(), path, String(timestamp), sha256Hex(body)].join('\n');
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export class RequestSigner {
  private readonly toleranceMs: number;

  constructor(
    private readonly secret: string,
    private readonly clock: Clock,
    opts: { toleranceMs?: number } = {},
  ) {
    this.toleranceMs = opts.toleranceMs ?? 5 * 60 * 1000;
  }

  sign(method: string, path: string, body: string, timestamp?: number): { signature: string; timestamp: number } {
    const ts = timestamp ?? this.clock.now();
    return { signature: hmacHex(this.secret, canonical(method, path, ts, body)), timestamp: ts };
  }

  verify(
    method: string,
    path: string,
    body: string,
    signature: string,
    timestamp: number,
  ): Result<true, SignerError> {
    if (Math.abs(this.clock.now() - timestamp) > this.toleranceMs) {
      return err({ code: 'stale', message: 'timestamp outside replay window' });
    }
    const expected = hmacHex(this.secret, canonical(method, path, timestamp, body));
    if (!safeEqualHex(signature, expected)) {
      return err({ code: 'bad_signature', message: 'signature does not verify' });
    }
    return ok(true);
  }
}
