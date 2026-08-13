/**
 * Keychain-backed persistence (Mobile M1-08). The device's X25519 private key
 * and the paired session live in the OS secure enclave via expo-secure-store —
 * never in plain app storage. Only the base64 private key is kept; the public
 * half is recomputed on load (see deviceKeysFromB64).
 */
import * as SecureStore from 'expo-secure-store';
import type { CompanionSession } from './sealedClient';

const PRIV_KEY = 'companion.device.privateKey';
const SESSION_KEY = 'companion.session';

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function loadDevicePrivB64(): Promise<string | null> {
  return SecureStore.getItemAsync(PRIV_KEY, OPTS);
}

export async function saveDevicePrivB64(privB64: string): Promise<void> {
  await SecureStore.setItemAsync(PRIV_KEY, privB64, OPTS);
}

export async function loadSession(): Promise<CompanionSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY, OPTS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CompanionSession;
  } catch {
    return null;
  }
}

export async function saveSession(session: CompanionSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), OPTS);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, OPTS);
}
