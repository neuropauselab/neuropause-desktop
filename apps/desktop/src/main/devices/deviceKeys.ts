/**
 * Device proof-of-possession keys (NP-047 / B HIGH-3).
 *
 * Pure crypto half of the device-identity client: generate an Ed25519
 * keypair, expose the raw public key in the base64url form the backend
 * expects, and sign server-issued challenge nonces. No Electron imports —
 * persistence/protection of the private key lives in deviceClient.ts, so this
 * module is unit-testable in plain Node.
 *
 * Protocol (mirrors apps/backend/src/devices/challenge.ts):
 *   POST /devices/challenge { deviceId }        -> { challenge }
 *   sign(challenge) with the device private key
 *   POST /devices { ..., publicKey, challengeNonce, challengeSignature }
 */
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

export interface DeviceKeypair {
  /** Base64url of the RAW 32-byte Ed25519 public key (SPKI prefix stripped). */
  publicKeyB64: string;
  /** PKCS8 PEM of the private key — protect at rest; never send anywhere. */
  privateKeyPem: string;
}

/** Ed25519 SPKI DER = fixed 12-byte prefix + 32-byte raw key. */
const SPKI_PREFIX_LENGTH = 12;

export function generateDeviceKeypair(): DeviceKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(SPKI_PREFIX_LENGTH);
  return {
    publicKeyB64: Buffer.from(rawPub).toString('base64url'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Sign a challenge nonce; returns the base64url Ed25519 signature (64 bytes). */
export function signChallenge(privateKeyPem: string, nonce: string): string {
  const key = createPrivateKey(privateKeyPem);
  return sign(null, Buffer.from(nonce), key).toString('base64url');
}
