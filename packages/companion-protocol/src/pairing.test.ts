/**
 * M1-02 — pairing. Locks the QR format (versioned prefix + validated shape),
 * one-time-token verification (constant-time, expiry-aware, malformed-safe),
 * and the pairing request/response schemas.
 */
import { describe, expect, it } from 'vitest';
import {
  decodePairingQr,
  encodePairingQr,
  generatePairingToken,
  PairingRequestSchema,
  PairingResponseSchema,
  verifyPairingToken,
  type PairingQrPayload,
} from './pairing';
import { CompanionProtocolError } from './errors';

const QR: PairingQrPayload = {
  v: 1,
  host: '192.168.1.20',
  port: 47600,
  name: 'Saurabh’s MacBook Pro',
  org: 'NeuroPause',
  dpk: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  token: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  exp: '2026-08-07T12:05:00.000Z',
};

describe('pairing QR', () => {
  it('encodes with the versioned prefix and round-trips exactly', () => {
    const text = encodePairingQr(QR);
    expect(text.startsWith('npc1.')).toBe(true);
    expect(decodePairingQr(text)).toEqual(QR);
  });

  it('refuses foreign prefixes, corruption, and invalid shapes', () => {
    expect(() => decodePairingQr('https://example.com/x')).toThrow(CompanionProtocolError);
    expect(() => decodePairingQr('npc1.%%%%')).toThrow(CompanionProtocolError);
    expect(() => encodePairingQr({ ...QR, port: 99_999 })).toThrow();
  });
});

describe('one-time token', () => {
  it('accepts the exact token inside its window and nothing else', () => {
    const { token, tokenB64 } = generatePairingToken();
    const base = {
      expected: token,
      nowIso: '2026-08-07T12:00:00.000Z',
      expIso: '2026-08-07T12:05:00.000Z',
    };
    expect(verifyPairingToken({ ...base, presentedB64: tokenB64 })).toBe(true);
    expect(verifyPairingToken({ ...base, presentedB64: generatePairingToken().tokenB64 })).toBe(
      false,
    );
    expect(verifyPairingToken({ ...base, presentedB64: '***' })).toBe(false);
    expect(
      verifyPairingToken({ ...base, presentedB64: tokenB64, nowIso: '2026-08-07T12:06:00.000Z' }),
    ).toBe(false);
    expect(verifyPairingToken({ ...base, presentedB64: tokenB64, expIso: 'not-a-date' })).toBe(
      false,
    );
  });
});

describe('request/response schemas', () => {
  it('accepts well-formed messages and refuses drift', () => {
    expect(
      PairingRequestSchema.safeParse({
        kind: 'pairing-request',
        token: 'abc',
        device: {
          name: 'iPhone 16 Pro',
          platform: 'ios',
          model: 'iPhone17,1',
          appVersion: '0.1.0',
        },
      }).success,
    ).toBe(true);
    expect(
      PairingRequestSchema.safeParse({
        kind: 'pairing-request',
        token: 'abc',
        device: { name: 'Pixel', platform: 'windows', appVersion: '0.1.0' },
      }).success,
    ).toBe(false);
    expect(
      PairingResponseSchema.safeParse({
        kind: 'pairing-response',
        deviceId: 'cd_1',
        desktopName: 'MacBook',
        orgName: 'NeuroPause',
        protocolVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      PairingResponseSchema.safeParse({
        kind: 'pairing-response',
        deviceId: '',
        desktopName: 'MacBook',
        orgName: 'NeuroPause',
        protocolVersion: 1,
      }).success,
    ).toBe(false);
  });
});
