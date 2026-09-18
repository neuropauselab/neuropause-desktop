/**
 * Request body schemas for the devices API, validated via the shared
 * validateBody middleware (same pattern as organizations/schemas.ts).
 */
import { z } from 'zod';

export const RegisterDeviceBody = z
  .object({
    orgId: z.string().uuid(),
    deviceId: z.string().min(1).max(200),
    name: z.string().min(1).max(120),
    platform: z.string().min(1).max(40),
    os: z.string().min(1).max(40),
    arch: z.string().min(1).max(40),
    appVersion: z.string().min(1).max(40),
    /** Base64url-encoded Ed25519 public key for proof-of-possession. */
    publicKey: z.string().min(32).max(128),
    /** Base64url-encoded Ed25519 signature over the challenge nonce. */
    challengeSignature: z.string().min(64).max(256),
    /** The challenge nonce being signed (issued by POST /devices/challenge). */
    challengeNonce: z.string().min(16).max(128),
  })
  .strict();

// Heartbeat carries no challenge fields: proof-of-possession is enforced at
// registration (where the key is bound), and heartbeat is already gated by
// user auth + non-revoked device state. Accepting unverified signature fields
// here would falsely suggest verification that does not occur.
export const HeartbeatBody = z
  .object({
    orgId: z.string().uuid(),
    appVersion: z.string().min(1).max(40),
  })
  .strict();

export const OrgScopeBody = z.object({ orgId: z.string().uuid() }).strict();

export const ChallengeRequestBody = z
  .object({
    deviceId: z.string().min(1).max(200),
  })
  .strict();
