/**
 * M1-02 — byte helpers. UTF-8 must round-trip the full code-point range
 * (the envelope carries JSON with arbitrary user text) and refuse malformed
 * sequences instead of silently corrupting; base64url must refuse garbage.
 */
import { describe, expect, it } from 'vitest';
import { bytesToUtf8, constantTimeEqual, concatBytes, fromB64, toB64, utf8ToBytes } from './bytes';
import { CompanionProtocolError } from './errors';

describe('utf8 round-trip', () => {
  it('handles ascii, multibyte, and astral text exactly', () => {
    const samples = [
      'plain',
      'café £ ¥',
      '日本語テキスト',
      'emoji 🚀🔐 and astral 𝔘𝔫𝔦',
      'mixed: a€𝄞b',
    ];
    for (const s of samples) {
      expect(bytesToUtf8(utf8ToBytes(s))).toBe(s);
    }
  });

  it('refuses truncated and malformed sequences', () => {
    expect(() => bytesToUtf8(Uint8Array.from([0xe2, 0x82]))).toThrow(CompanionProtocolError); // truncated €
    expect(() => bytesToUtf8(Uint8Array.from([0xff, 0x20]))).toThrow(CompanionProtocolError); // invalid lead
    expect(() => bytesToUtf8(Uint8Array.from([0xc3, 0x28]))).toThrow(CompanionProtocolError); // bad continuation
  });
});

describe('base64url', () => {
  it('round-trips bytes and refuses malformed text', () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37) % 256);
    expect(fromB64(toB64(bytes))).toEqual(bytes);
    expect(() => fromB64('!!not-base64url!!')).toThrow(CompanionProtocolError);
  });
});

describe('constantTimeEqual + concatBytes', () => {
  it('compares correctly and concatenates in order', () => {
    const a = Uint8Array.from([1, 2, 3]);
    expect(constantTimeEqual(a, Uint8Array.from([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(a, Uint8Array.from([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(a, Uint8Array.from([1, 2]))).toBe(false);
    expect(concatBytes(Uint8Array.from([1]), new Uint8Array(0), Uint8Array.from([2, 3]))).toEqual(
      a,
    );
  });
});
