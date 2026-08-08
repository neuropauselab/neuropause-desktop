/**
 * M1-02 — wire framing. Locks the request/response/event shapes both ends
 * parse, the closed error-code set, and version assertion.
 */
import { describe, expect, it } from 'vitest';
import {
  CompanionEventFrameSchema,
  CompanionRequestSchema,
  CompanionResponseSchema,
  errResponse,
  okResponse,
} from './wire';
import { assertProtocolVersion, COMPANION_PROTOCOL_VERSION } from './version';
import { CompanionProtocolError } from './errors';

describe('framing schemas', () => {
  it('accepts well-formed frames', () => {
    expect(CompanionRequestSchema.safeParse({ id: 'r1', op: 'companion.snapshot' }).success).toBe(
      true,
    );
    expect(
      CompanionRequestSchema.safeParse({ id: 'r1', op: 'companion.approve', params: { x: 1 } })
        .success,
    ).toBe(true);
    expect(CompanionResponseSchema.safeParse(okResponse('r1', { any: 'thing' })).success).toBe(
      true,
    );
    expect(
      CompanionResponseSchema.safeParse(errResponse('r1', 'unauthorized', 'No.')).success,
    ).toBe(true);
    expect(
      CompanionEventFrameSchema.safeParse({
        kind: 'event',
        type: 'enterprise.record.updated',
        at: '2026-08-07T12:00:00.000Z',
        data: { id: 'rec_1' },
      }).success,
    ).toBe(true);
  });

  it('refuses drift: unknown fields, unknown error codes, empty ids', () => {
    expect(CompanionRequestSchema.safeParse({ id: 'r1', op: 'x', extra: true }).success).toBe(
      false,
    );
    expect(CompanionRequestSchema.safeParse({ id: '', op: 'x' }).success).toBe(false);
    expect(
      CompanionResponseSchema.safeParse({
        id: 'r1',
        ok: false,
        error: { code: 'made-up', message: 'x' },
      }).success,
    ).toBe(false);
    expect(CompanionResponseSchema.safeParse({ ok: true, result: 1 }).success).toBe(false); // missing id
    expect(
      CompanionResponseSchema.safeParse({ id: 'r1', ok: true, result: 1, extra: 2 }).success,
    ).toBe(false); // strict: no extra keys
  });
});

describe('version assertion', () => {
  it('accepts the current version and refuses others with the typed code', () => {
    expect(() => assertProtocolVersion(COMPANION_PROTOCOL_VERSION)).not.toThrow();
    let code = '';
    try {
      assertProtocolVersion(COMPANION_PROTOCOL_VERSION + 1);
    } catch (err) {
      code = err instanceof CompanionProtocolError ? err.code : '';
    }
    expect(code).toBe('version-mismatch');
  });
});
