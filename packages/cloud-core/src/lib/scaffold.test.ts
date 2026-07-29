/**
 * Scaffold test — proves the toolchain (tsc + vitest + cross-package resolution)
 * and exercises the lib primitives, the shared-cloud constants, and the
 * cloud-sdk client in one run.
 */
import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr } from './result';
import { ManualClock, systemClock } from './clock';
import { contentId, randomId, sha256Hex, hmacHex } from './ids';
import { Logger, MemorySink } from './logger';
import {
  SYNCABLE_STATE_KINDS,
  NEVER_SYNC_KINDS,
  SECRET_FIELD_PATTERN,
  DEPLOYMENT_MODES,
} from '@neuropause/shared-cloud';

describe('lib/result', () => {
  it('discriminates ok and err', () => {
    const a = ok(5);
    const b = err('nope');
    expect(isOk(a)).toBe(true);
    expect(isErr(b)).toBe(true);
    if (isOk(a)) expect(a.value).toBe(5);
    if (isErr(b)) expect(b.error).toBe('nope');
  });
});

describe('lib/clock', () => {
  it('ManualClock is deterministic; systemClock advances', () => {
    const c = new ManualClock(1000);
    expect(c.now()).toBe(1000);
    c.advance(500);
    expect(c.now()).toBe(1500);
    expect(typeof systemClock.now()).toBe('number');
  });
});

describe('lib/ids', () => {
  it('contentId is deterministic; randomId is not', () => {
    expect(contentId('aud', 'a', 1)).toBe(contentId('aud', 'a', 1));
    expect(contentId('aud', 'a', 1)).not.toBe(contentId('aud', 'a', 2));
    expect(randomId('dev')).not.toBe(randomId('dev'));
    expect(sha256Hex('x')).toHaveLength(64);
    expect(hmacHex('k', 'x')).toHaveLength(64);
  });
});

describe('lib/logger', () => {
  it('redacts secret-looking keys before they reach the sink', () => {
    const sink = new MemorySink();
    const log = new Logger(sink, new ManualClock(42));
    log.info('login', { userId: 'usr_1', apiKey: 'sk-should-not-appear', token: 'abc' });
    const rec = sink.records[0];
    expect(rec.ts).toBe(42);
    expect(rec.fields.userId).toBe('usr_1');
    expect(rec.fields.apiKey).toBe('[REDACTED]');
    expect(rec.fields.token).toBe('[REDACTED]');
    expect(JSON.stringify(rec)).not.toContain('sk-should-not-appear');
  });
});

describe('shared-cloud constants', () => {
  it('exposes the constitutional taxonomy', () => {
    expect(SYNCABLE_STATE_KINDS).toContain('timeline');
    expect(NEVER_SYNC_KINDS).toContain('provider_key');
    expect(SECRET_FIELD_PATTERN.test('apiKey')).toBe(true);
    expect(SECRET_FIELD_PATTERN.test('title')).toBe(false);
    expect(DEPLOYMENT_MODES).toContain('air_gapped');
  });
});

// (cloud-sdk wiring is covered by apps/cloud/integration.test.ts)
