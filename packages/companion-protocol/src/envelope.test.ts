/**
 * M1-02 — sealed envelopes. These tests lock the security contract:
 * round-trip fidelity, tamper rejection on every field (ciphertext, nonce,
 * ephemeral key, AAD-bound header), wrong-recipient failure, sender pinning,
 * and per-message uniqueness of nonce + ephemeral key (forward secrecy).
 */
import { describe, expect, it } from 'vitest';
import { generateIdentityKeyPair, seal, unseal, SealedEnvelopeSchema } from './envelope';
import { CompanionProtocolError } from './errors';

const desktop = generateIdentityKeyPair();
const phone = generateIdentityKeyPair();
const stranger = generateIdentityKeyPair();

const BODY = { op: 'snapshot', text: 'unicode 🚀 日本語', nested: { n: 42, ok: true } };

function sealed(seq = 1) {
  return seal({
    body: BODY,
    seq,
    sentAt: '2026-08-07T12:00:00.000Z',
    senderKeys: phone,
    recipientPublicKey: desktop.publicKey,
  });
}

describe('seal → unseal', () => {
  it('round-trips body, seq, sentAt and surfaces the sender key', () => {
    const env = sealed(7);
    expect(SealedEnvelopeSchema.safeParse(env).success).toBe(true);
    const msg = unseal({
      envelope: env,
      recipientKeys: desktop,
      expectedSenderPublicKey: phone.publicKey,
    });
    expect(msg.body).toEqual(BODY);
    expect(msg.seq).toBe(7);
    expect(msg.sentAt).toBe('2026-08-07T12:00:00.000Z');
    expect(msg.senderPublicKey).toEqual(phone.publicKey);
  });

  it('null/omitted body normalizes to null', () => {
    const env = seal({
      body: undefined,
      seq: 1,
      sentAt: '2026-08-07T12:00:00.000Z',
      senderKeys: phone,
      recipientPublicKey: desktop.publicKey,
    });
    expect(unseal({ envelope: env, recipientKeys: desktop }).body).toBeNull();
  });

  it('mints a fresh nonce and a fresh ephemeral key per message', () => {
    const a = sealed();
    const b = sealed();
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.eph).not.toBe(b.eph);
    expect(a.ct).not.toBe(b.ct);
  });
});

describe('tamper + key discipline', () => {
  const flip = (s: string): string => (s.startsWith('A') ? `B${s.slice(1)}` : `A${s.slice(1)}`);

  it('refuses tampered ciphertext, nonce, ephemeral key, and header', () => {
    for (const field of ['ct', 'nonce', 'eph', 'from'] as const) {
      const env = { ...sealed(), [field]: flip(sealed()[field]) };
      expect(() => unseal({ envelope: env, recipientKeys: desktop })).toThrow(
        CompanionProtocolError,
      );
    }
  });

  it('refuses the wrong recipient', () => {
    expect(() => unseal({ envelope: sealed(), recipientKeys: stranger })).toThrow(
      CompanionProtocolError,
    );
  });

  it('refuses an unpinned sender when pinning is requested', () => {
    const env = seal({
      body: BODY,
      seq: 1,
      sentAt: '2026-08-07T12:00:00.000Z',
      senderKeys: stranger,
      recipientPublicKey: desktop.publicKey,
    });
    let code = '';
    try {
      unseal({ envelope: env, recipientKeys: desktop, expectedSenderPublicKey: phone.publicKey });
    } catch (err) {
      code = err instanceof CompanionProtocolError ? err.code : '';
    }
    expect(code).toBe('sender-mismatch');
  });

  it('refuses non-envelope shapes with a typed error', () => {
    for (const junk of [null, 42, 'text', { v: 1 }, { ...sealed(), extra: 'field' }]) {
      expect(() => unseal({ envelope: junk, recipientKeys: desktop })).toThrow(
        CompanionProtocolError,
      );
    }
  });
});
