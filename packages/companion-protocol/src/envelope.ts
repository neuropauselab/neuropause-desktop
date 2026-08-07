/**
 * Sealed envelopes (M1-02) — the security core of the companion channel.
 *
 * Every request, response, and realtime frame between phone and desktop is an
 * end-to-end sealed envelope; the HTTP/WS transport underneath carries only
 * ciphertext. Construction per message:
 *
 *   • sender mints an EPHEMERAL X25519 keypair (forward secrecy: discarding it
 *     makes the message undecryptable even if both static keys later leak)
 *   • key = HKDF-SHA256( ECDH(eph, recipientStatic) ‖ ECDH(senderStatic,
 *     recipientStatic), salt = nonce, info = versioned label ) — the second
 *     ECDH authenticates the sender (only the true sender can compute it)
 *   • AEAD = XChaCha20-Poly1305 with a random 24-byte nonce; the envelope
 *     header (version, sender key, ephemeral key) is bound as AAD, so header
 *     tampering fails authentication
 *   • plaintext carries { seq, sentAt, body } — replay material travels INSIDE
 *     the sealed payload (see replay.ts), never as trusted cleartext
 *
 * This is why the design is relay-ready: an M2 relay forwards ciphertext it
 * can neither read nor forge. It is also why there is no TLS/certificate-
 * pinning machinery — the pinned identity is the key itself, exchanged out of
 * band via the pairing QR (TOFU), which is stronger than pinning a cert.
 */
import { x25519 } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import { z } from 'zod';
import { CompanionProtocolError } from './errors';
import { bytesToUtf8, concatBytes, constantTimeEqual, fromB64, toB64, utf8ToBytes } from './bytes';
import { COMPANION_KDF_INFO, COMPANION_PROTOCOL_VERSION } from './version';

export interface CompanionKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** Mint a static X25519 identity keypair (desktop identity, device identity). */
export function generateIdentityKeyPair(): CompanionKeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/** The wire form — every field base64url, safe for JSON/QR/HTTP bodies. */
export const SealedEnvelopeSchema = z
  .object({
    v: z.literal(COMPANION_PROTOCOL_VERSION),
    /** Sender's STATIC public key (identity — verified against the device registry). */
    from: z.string().min(1),
    /** Per-message EPHEMERAL public key (forward secrecy). */
    eph: z.string().min(1),
    /** 24-byte XChaCha20 nonce. */
    nonce: z.string().min(1),
    /** Ciphertext + Poly1305 tag. */
    ct: z.string().min(1),
  })
  .strict();

export type SealedEnvelope = z.infer<typeof SealedEnvelopeSchema>;

const InnerPayloadSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    sentAt: z.string().min(1),
    body: z.unknown(),
  })
  .strict();

export interface SealInput {
  body: unknown;
  seq: number;
  sentAt: string;
  senderKeys: CompanionKeyPair;
  recipientPublicKey: Uint8Array;
}

export interface UnsealedMessage {
  body: unknown;
  seq: number;
  sentAt: string;
  senderPublicKey: Uint8Array;
}

function deriveKey(ephShared: Uint8Array, staticShared: Uint8Array, nonce: Uint8Array): Uint8Array {
  return hkdf(sha256, concatBytes(ephShared, staticShared), nonce, COMPANION_KDF_INFO, 32);
}

function headerAad(from: string, eph: string): Uint8Array {
  return utf8ToBytes(`v${COMPANION_PROTOCOL_VERSION}|${from}|${eph}`);
}

/** Seal a message to the recipient's static key, authenticated as the sender. */
export function seal(input: SealInput): SealedEnvelope {
  const ephPrivate = x25519.utils.randomPrivateKey();
  const ephPublic = x25519.getPublicKey(ephPrivate);
  const nonce = randomBytes(24);
  const ephShared = x25519.getSharedSecret(ephPrivate, input.recipientPublicKey);
  const staticShared = x25519.getSharedSecret(
    input.senderKeys.privateKey,
    input.recipientPublicKey,
  );
  const key = deriveKey(ephShared, staticShared, nonce);
  const from = toB64(input.senderKeys.publicKey);
  const eph = toB64(ephPublic);
  const plaintext = utf8ToBytes(
    JSON.stringify({ seq: input.seq, sentAt: input.sentAt, body: input.body ?? null }),
  );
  const ct = xchacha20poly1305(key, nonce, headerAad(from, eph)).encrypt(plaintext);
  return { v: COMPANION_PROTOCOL_VERSION, from, eph, nonce: toB64(nonce), ct: toB64(ct) };
}

export interface UnsealInput {
  envelope: unknown;
  recipientKeys: CompanionKeyPair;
  /** When set, the envelope's sender key must equal this (constant-time). */
  expectedSenderPublicKey?: Uint8Array;
}

/** Open a sealed envelope; throws typed `bad-envelope`/`sender-mismatch`/`invalid`. */
export function unseal(input: UnsealInput): UnsealedMessage {
  const parsed = SealedEnvelopeSchema.safeParse(input.envelope);
  if (!parsed.success)
    throw new CompanionProtocolError('bad-envelope', 'Envelope shape is invalid.');
  const env = parsed.data;
  const senderPublicKey = fromB64(env.from);
  if (
    input.expectedSenderPublicKey &&
    !constantTimeEqual(senderPublicKey, input.expectedSenderPublicKey)
  ) {
    throw new CompanionProtocolError(
      'sender-mismatch',
      'Envelope sender does not match the paired identity.',
    );
  }
  const ephPublic = fromB64(env.eph);
  const nonce = fromB64(env.nonce);
  const ct = fromB64(env.ct);
  const ephShared = x25519.getSharedSecret(input.recipientKeys.privateKey, ephPublic);
  const staticShared = x25519.getSharedSecret(input.recipientKeys.privateKey, senderPublicKey);
  const key = deriveKey(ephShared, staticShared, nonce);
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(key, nonce, headerAad(env.from, env.eph)).decrypt(ct);
  } catch {
    throw new CompanionProtocolError(
      'bad-envelope',
      'Envelope failed authentication (tampered, replayed header, or wrong keys).',
    );
  }
  let inner: unknown;
  try {
    inner = JSON.parse(bytesToUtf8(plaintext));
  } catch {
    throw new CompanionProtocolError('bad-envelope', 'Envelope payload is not valid JSON.');
  }
  const payload = InnerPayloadSchema.safeParse(inner);
  if (!payload.success)
    throw new CompanionProtocolError('bad-envelope', 'Envelope payload shape is invalid.');
  return {
    body: payload.data.body,
    seq: payload.data.seq,
    sentAt: payload.data.sentAt,
    senderPublicKey,
  };
}
