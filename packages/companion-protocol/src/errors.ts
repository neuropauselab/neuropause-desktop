/**
 * Companion protocol errors (M1-02). One typed error, a closed code set —
 * both ends of the wire (desktop gateway, mobile client) refuse with these
 * codes and nothing else, so the phone can render every failure honestly.
 */

export const COMPANION_ERROR_CODES = [
  'unauthorized',
  'revoked',
  'not-signed-in',
  'replay',
  'bad-envelope',
  'sender-mismatch',
  'rate-limited',
  'not-found',
  'invalid',
  'internal',
  'version-mismatch',
] as const;

export type CompanionErrorCode = (typeof COMPANION_ERROR_CODES)[number];

export class CompanionProtocolError extends Error {
  readonly code: CompanionErrorCode;

  constructor(code: CompanionErrorCode, message: string) {
    super(message);
    this.name = 'CompanionProtocolError';
    this.code = code;
  }
}

/** Narrow an unknown thrown value to a protocol error code (else `internal`). */
export function companionErrorCode(err: unknown): CompanionErrorCode {
  return err instanceof CompanionProtocolError ? err.code : 'internal';
}
