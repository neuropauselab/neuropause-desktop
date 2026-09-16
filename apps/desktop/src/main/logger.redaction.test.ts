/**
 * NP-013 — the logger redaction BOUNDARY (closes F-MR-7). "Never log tokens or
 * credentials" was a header comment; these pins make it a property of `emit`:
 * every message and meta is scrubbed through main's ONE credential-text rule
 * (`redactCredentialText`) + the shared secret-key classifier
 * (`classifyFieldName`) before reaching EITHER the console or the file sink.
 * Console and file see the SAME redacted payload.
 *
 * The boundary is deliberately CREDENTIAL-only — the divergence from the
 * shared `redactSensitive` (which also strips emails/paths for export) is
 * pinned below: the round-31 W-7 predicate `12@example.com` must SURVIVE, or
 * the boundary would destroy the diagnostic it was built to carry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDACTED_MARKER } from '@neuropause/shared';
import {
  attachLogFileSink,
  createLogger,
  redactCredentialText,
  redactLogPayload,
  serializableMeta,
} from './logger';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ';

describe('redactCredentialText (the one rule)', () => {
  it('catches truncated JWTs and camelCase JSON keys — the V8 parse-error excerpt shape the shared rule cannot see', () => {
    // A decrypt-succeeds/parse-fails excerpt of vault plaintext:
    const excerpt = 'Unexpected token \'x\', ..."{"accessToken":"eyJ0eXAiOiJKV1QiLCJh" is not valid JSON';
    const out = redactCredentialText(excerpt);
    expect(out).not.toContain('eyJ0eXAiOiJKV1QiLCJh');
    expect(out).toContain(REDACTED_MARKER);
  });

  it('catches bare provider-token prefixes (Slack xoxb/xapp, sk-, GitHub PAT, AKIA, ya29)', () => {
    for (const token of [
      'xoxb-1234567890-abcDEF',
      'xapp-1-A0-abcdef123456',
      'sk-live-abcdef12345678',
      'ghp_abcdefghij0123456789',
      'AKIAIOSFODNN7EXAMPLE',
      'ya29.a0AfH6SMBxxxxxxxxxxxxxx',
    ]) {
      const out = redactCredentialText(`provider said: ${token} rejected`);
      expect(out, token).not.toContain(token);
    }
  });

  it('keeps the keyword and redacts the value in key/value pairs (env and JSON forms)', () => {
    const out = redactCredentialText('retry after token=sk_live_9910 and "refresh_token": "abc-def"');
    expect(out).not.toContain('sk_live_9910');
    expect(out).not.toContain('abc-def');
    expect(out).toContain('token=');
  });

  it('W-7 divergence pin: the round-31 redacted email predicate SURVIVES — the boundary owns credentials, not PII', () => {
    const line = 'not_a_member sessionEmailShape=12@example.com ownerEmailShape=8@other.org';
    expect(redactCredentialText(line)).toBe(line);
  });
});

describe('redactLogPayload (pure)', () => {
  it('replaces the ENTIRE value under a secret-classified key — a raw opaque token matches no text pattern, the key is the only signal', () => {
    const out = redactLogPayload({
      accessToken: 'opaque-raw-value-with-no-recognizable-shape',
      refresh_token: 'another-opaque-value',
      clientSecret: { nested: 'object-values-too' },
      connectorId: 'microsoft-entra',
    }) as Record<string, unknown>;
    expect(out.accessToken).toBe(REDACTED_MARKER);
    expect(out.refresh_token).toBe(REDACTED_MARKER);
    expect(out.clientSecret).toBe(REDACTED_MARKER);
    expect(out.connectorId).toBe('microsoft-entra');
  });

  it('scrubs string leaves at any depth (JWT, Bearer)', () => {
    const out = redactLogPayload({
      a: { b: [{ c: `header ${JWT} trailer` }] },
      d: 'Authorization: Bearer abc.def-ghi',
    }) as { a: { b: [{ c: string }] }; d: string };
    expect(out.a.b[0].c).not.toContain(JWT);
    expect(out.d).not.toContain('abc.def-ghi');
  });

  it('scrubs a normalized Error whose message carries a token — message/stack are plain strings after serializableMeta', () => {
    const err = new Error(`decrypt failed near ${JWT}`);
    const out = redactLogPayload(serializableMeta(err)) as { message: string; stack?: string };
    expect(out.message).not.toContain(JWT);
    expect(out.stack ?? '').not.toContain(JWT);
  });

  it('leaves benign values untouched (no over-redaction)', () => {
    const meta = { connectorId: 'm365', count: 3, ok: true, note: 'sync finished in 120ms', nul: null };
    expect(redactLogPayload(meta)).toEqual(meta);
  });
});

describe('emit boundary (console + file sink)', () => {
  const sinkLines: string[] = [];
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sinkLines.length = 0;
    attachLogFileSink((line) => sinkLines.push(line));
    consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    attachLogFileSink(() => undefined);
    consoleSpy.mockRestore();
  });

  it('neither the console nor the file sink ever receives the token — and both receive the SAME redacted payload', () => {
    const log = createLogger('np013-test');
    log.warn(`turn failed with Bearer ${JWT}`, { accessToken: 'raw-opaque-value', detail: `saw ${JWT}` });

    expect(sinkLines).toHaveLength(1);
    expect(sinkLines[0]).not.toContain(JWT);
    expect(sinkLines[0]).not.toContain('raw-opaque-value');
    expect(sinkLines[0]).toContain(REDACTED_MARKER);

    const [, message, meta] = consoleSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(message).not.toContain(JWT);
    expect(meta.accessToken).toBe(REDACTED_MARKER);
    expect(String(meta.detail)).not.toContain(JWT);
    expect(sinkLines[0]).toContain(JSON.stringify(meta));
  });
});
