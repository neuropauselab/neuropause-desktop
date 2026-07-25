import { describe, expect, it } from 'vitest';
import { buildCrashRecord } from './crashRecord';

const T = '2026-07-25T00:00:00.000Z';

describe('buildCrashRecord — redaction at write time', () => {
  it('scrubs home paths and secret values from message and stack', () => {
    const rec = buildCrashRecord(
      'main',
      'uncaughtException',
      'Failed for token=sk_live_42 at /Users/alice/app',
      'Error\n  at /Users/alice/app/main.js:1\n  Authorization: Bearer abc.def.ghi',
      T,
    );
    expect(rec.at).toBe(T);
    expect(rec.category).toBe('main');
    expect(rec.kind).toBe('uncaughtException');
    // message: secret + home path gone, path shape preserved
    expect(rec.message).not.toContain('sk_live_42');
    expect(rec.message).not.toContain('/Users/alice');
    expect(rec.message).toContain('/Users/<user>');
    // stack: home path + whole bearer token gone
    expect(rec.stack).not.toContain('/Users/alice');
    expect(rec.stack).not.toContain('abc.def.ghi');
  });

  it('preserves a null stack when none is provided', () => {
    const rec = buildCrashRecord('renderer', 'render-process-gone', 'crashed', undefined, T);
    expect(rec.stack).toBeNull();
    expect(rec.message).toBe('crashed');
  });

  it('redacts email addresses in messages', () => {
    const rec = buildCrashRecord('connector', 'sync-failed', 'user bob@corp.com failed', undefined, T);
    expect(rec.message).not.toContain('bob@corp.com');
    expect(rec.message).toContain('<redacted-email>');
  });

  it('leaves an ordinary message untouched', () => {
    const rec = buildCrashRecord('plugin', 'child-process-gone', 'exited with code 9', undefined, T);
    expect(rec.message).toBe('exited with code 9');
  });
});
