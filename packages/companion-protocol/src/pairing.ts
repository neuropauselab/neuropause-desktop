/**
 * Pairing (M1-02) — trust-on-first-use via QR, out of band.
 *
 * The desktop shows a QR carrying its LAN endpoint, its static public key,
 * and a one-time token (short TTL). The phone scans it, mints its own static
 * identity, and sends a PairingRequest SEALED to the desktop key with the
 * token inside — proving physical QR possession. The desktop verifies the
 * token (single-use, constant-time, expiry-checked), registers the device,
 * and answers with a sealed PairingResponse. From then on both sides pin each
 * other's static keys; the QR secret never travels again.
 */
import { randomBytes } from '@noble/hashes/utils';
import { z } from 'zod';
import { CompanionProtocolError } from './errors';
import { constantTimeEqual, fromB64, toB64, utf8ToBytes, bytesToUtf8 } from './bytes';
import { COMPANION_PROTOCOL_VERSION } from './version';

const QR_PREFIX = 'npc1.';

export const PairingQrPayloadSchema = z
  .object({
    v: z.literal(COMPANION_PROTOCOL_VERSION),
    /** LAN host (IP or name) the gateway is listening on. */
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    /** Desktop display name shown on the phone during pairing. */
    name: z.string().min(1),
    /** Organization name (display only). */
    org: z.string().min(1),
    /** Desktop static public key (base64url). */
    dpk: z.string().min(1),
    /** One-time pairing token (base64url, 32 bytes, short TTL). */
    token: z.string().min(1),
    /** Token expiry, ISO-8601. */
    exp: z.string().min(1),
  })
  .strict();

export type PairingQrPayload = z.infer<typeof PairingQrPayloadSchema>;

/** QR text form: versioned prefix + base64url(JSON). */
export function encodePairingQr(payload: PairingQrPayload): string {
  const validated = PairingQrPayloadSchema.parse(payload);
  return QR_PREFIX + toB64(utf8ToBytes(JSON.stringify(validated)));
}

export function decodePairingQr(text: string): PairingQrPayload {
  if (!text.startsWith(QR_PREFIX)) {
    throw new CompanionProtocolError('invalid', 'Not a NeuroPause companion pairing code.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytesToUtf8(fromB64(text.slice(QR_PREFIX.length))));
  } catch {
    throw new CompanionProtocolError('invalid', 'Pairing code is corrupted.');
  }
  const parsed = PairingQrPayloadSchema.safeParse(raw);
  if (!parsed.success)
    throw new CompanionProtocolError('invalid', 'Pairing code shape is invalid.');
  return parsed.data;
}

/** Mint a one-time pairing token (32 random bytes). */
export function generatePairingToken(): { token: Uint8Array; tokenB64: string } {
  const token = randomBytes(32);
  return { token, tokenB64: toB64(token) };
}

/** Constant-time token check with expiry; malformed input is simply false. */
export function verifyPairingToken(input: {
  presentedB64: string;
  expected: Uint8Array;
  nowIso: string;
  expIso: string;
}): boolean {
  const expMs = Date.parse(input.expIso);
  const nowMs = Date.parse(input.nowIso);
  if (!Number.isFinite(expMs) || !Number.isFinite(nowMs) || nowMs > expMs) return false;
  let presented: Uint8Array;
  try {
    presented = fromB64(input.presentedB64);
  } catch {
    return false;
  }
  return constantTimeEqual(presented, input.expected);
}

export const PairingDeviceInfoSchema = z
  .object({
    name: z.string().min(1).max(80),
    platform: z.enum(['ios', 'android']),
    model: z.string().max(120).optional(),
    appVersion: z.string().min(1).max(40),
  })
  .strict();

export type PairingDeviceInfo = z.infer<typeof PairingDeviceInfoSchema>;

/** Phone → desktop, sealed to the QR's `dpk` with the phone's new identity as sender. */
export const PairingRequestSchema = z
  .object({
    kind: z.literal('pairing-request'),
    token: z.string().min(1),
    device: PairingDeviceInfoSchema,
  })
  .strict();

export type PairingRequest = z.infer<typeof PairingRequestSchema>;

/** Desktop → phone, sealed back to the device's identity. */
export const PairingResponseSchema = z
  .object({
    kind: z.literal('pairing-response'),
    deviceId: z.string().min(1),
    desktopName: z.string().min(1),
    orgName: z.string().min(1),
    protocolVersion: z.literal(COMPANION_PROTOCOL_VERSION),
  })
  .strict();

export type PairingResponse = z.infer<typeof PairingResponseSchema>;
