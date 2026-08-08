/**
 * Companion gateway identity (Mobile M1-03) — the desktop's static X25519
 * keypair, the pinned trust root a phone learns out of band via the pairing QR.
 *
 * The private key lives ONLY in the OS keychain (safeStorage-backed
 * credentialStore, same refuse-plaintext policy as connector secrets); the
 * public half is recomputed on reload rather than stored twice. If the OS
 * keychain is unavailable, we refuse to run rather than persist key material in
 * the clear — the gateway simply cannot be enabled on that machine.
 */
import {
  generateIdentityKeyPair,
  publicKeyFromPrivateKey,
  fromB64,
  toB64,
  type CompanionKeyPair,
} from '@neuropause/companion-protocol';
import { credentialStore } from '../security/secureStore';
import { createLogger } from '../logger';

const log = createLogger('companion-identity');
const KEY_ID = 'companion-gateway-identity';

/**
 * Load the persisted identity, or mint + persist a new one. Returns null when
 * the OS keychain is unavailable (refuse-plaintext) — the caller keeps the
 * gateway disabled in that case.
 */
export async function loadOrCreateIdentity(): Promise<CompanionKeyPair | null> {
  const existing = await credentialStore.getSecret(KEY_ID);
  if (existing) {
    try {
      const privateKey = fromB64(existing);
      return { privateKey, publicKey: publicKeyFromPrivateKey(privateKey) };
    } catch {
      log.warn('Stored companion identity was unreadable; minting a fresh one');
    }
  }
  const pair = generateIdentityKeyPair();
  await credentialStore.setSecret(KEY_ID, toB64(pair.privateKey));
  // setSecret is a no-op when OS encryption is unavailable; confirm it persisted.
  if (!(await credentialStore.hasSecret(KEY_ID))) {
    log.warn(
      'OS keychain unavailable; companion identity cannot be stored — gateway stays disabled',
    );
    return null;
  }
  return pair;
}
