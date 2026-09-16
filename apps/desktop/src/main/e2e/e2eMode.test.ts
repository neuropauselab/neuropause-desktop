/**
 * Slice-15 condition 1 — the e2e/real-send mode coupling HARD-FAILS on invalid flag combinations.
 */
import { describe, expect, it } from 'vitest';
import { resolveE2eMode, E2eModeError, looksLikeDefaultProfile } from './e2eMode';

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

describe('resolveE2eMode — mode coupling', () => {
  it('no flags → off', () => {
    expect(resolveE2eMode(env({}))).toBe('off');
  });

  it('NEUROPAUSE_E2E=1 alone → full-e2e (mock)', () => {
    expect(resolveE2eMode(env({ NEUROPAUSE_E2E: '1' }))).toBe('full-e2e');
  });

  it('S15APPPRINCIPAL=1 + FIRST_REAL_SEND=1 → app-principal (real)', () => {
    expect(resolveE2eMode(env({ NEUROPAUSE_S15_APPPRINCIPAL: '1', NEUROPAUSE_FIRST_REAL_SEND: '1' }))).toBe('app-principal');
  });

  it('HARD-FAIL: S15APPPRINCIPAL=1 WITHOUT FIRST_REAL_SEND (principal seed may not run with the send rail inert)', () => {
    expect(() => resolveE2eMode(env({ NEUROPAUSE_S15_APPPRINCIPAL: '1' }))).toThrow(E2eModeError);
    expect(() => resolveE2eMode(env({ NEUROPAUSE_S15_APPPRINCIPAL: '1' }))).toThrow(/requires NEUROPAUSE_FIRST_REAL_SEND/);
  });

  it('HARD-FAIL: NEUROPAUSE_E2E=1 together with S15APPPRINCIPAL=1 (mock and real are mutually exclusive)', () => {
    expect(() => resolveE2eMode(env({ NEUROPAUSE_E2E: '1', NEUROPAUSE_S15_APPPRINCIPAL: '1', NEUROPAUSE_FIRST_REAL_SEND: '1' }))).toThrow(E2eModeError);
  });

  it('HARD-FAIL: NEUROPAUSE_E2E=1 together with FIRST_REAL_SEND=1 (never mock a real send)', () => {
    expect(() => resolveE2eMode(env({ NEUROPAUSE_E2E: '1', NEUROPAUSE_FIRST_REAL_SEND: '1' }))).toThrow(/mutually exclusive/);
  });
});

describe('looksLikeDefaultProfile — isolation safety', () => {
  it('flags the real default @neuropause/desktop userData (any base dir)', () => {
    expect(looksLikeDefaultProfile('/Users/me/Library/Application Support/@neuropause/desktop')).toBe(true);
    expect(looksLikeDefaultProfile('/tmp/@neuropause/desktop/')).toBe(true);
    expect(looksLikeDefaultProfile('C:\\Users\\me\\AppData\\Roaming\\@neuropause\\desktop')).toBe(true);
  });
  it('passes an isolated S15 profile dir', () => {
    expect(looksLikeDefaultProfile('/Users/me/Library/Application Support/NeuroPause-S15')).toBe(false);
    expect(looksLikeDefaultProfile('/tmp/np-s15')).toBe(false);
  });
});
