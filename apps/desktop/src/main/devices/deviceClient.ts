/**
 * Typed client for the backend /devices API. Main-process only — the renderer
 * reaches it through IPC, never the backend directly. Mirrors orgClient: every
 * call is authenticated with the access token from the auth service. The current
 * device's identity is assembled here (livesync deviceId + OS/arch + app version),
 * so the renderer only supplies the org.
 */
import { hostname } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { app, safeStorage } from 'electron';
import type { Device } from '@neuropause/shared';
import { config } from '../config';
import { authService } from '../auth/authService';
import { getDeviceId } from '../cloud/livesync/liveSyncInstance';
import { generateDeviceKeypair, signChallenge, type DeviceKeypair } from './deviceKeys';
import { createLogger } from '../logger';
import { declareStoreScope } from '../tenancy/storeScope';

const log = createLogger('device-identity');

declareStoreScope({
  name: 'device-identity-key',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  authority: 'SYSTEM',
  classification: 'SECRET',
  retentionScope: 'NONE',
  retentionAuthority: 'NONE',
  retention:
    'One file (`device-identity.json`), written once on first device registration and never ' +
    'removed by any code path. Regenerated only if missing/unreadable — which the SERVER treats ' +
    'as a key mismatch for an enrolled device (403 device_key_mismatch), so silent replacement ' +
    'cannot impersonate the enrolled identity.',
  reason:
    'WHY GLOBAL: one Ed25519 device keypair per installation, the proof-of-possession ' +
    'counterpart of the livesync device id (same INSTALL_GLOBAL precedent). WHY SECRET: the ' +
    'file holds the device PRIVATE key — encrypted with Electron safeStorage where the OS ' +
    'provides a backend, with an explicit logged downgrade where it does not. WHAT IT IS NOT: ' +
    'never customer content, never sent anywhere; only signatures over server-issued one-time ' +
    'challenge nonces leave the machine (NP-047 / Computer-B HIGH-3).',
});

export class DeviceApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DeviceApiError';
    this.status = status;
    this.code = code;
  }
}

interface DeviceRequestInit {
  method?: string;
  body?: unknown;
}

async function deviceRequest<T>(path: string, init: DeviceRequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const token = await authService.getValidAccessToken();
  if (!token) throw new DeviceApiError(401, 'not_authenticated', 'Sign in to manage devices.');
  headers.Authorization = `Bearer ${token}`;

  const url = `${config.backendUrl}/devices${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    throw new DeviceApiError(
      0,
      'network_error',
      (err as Error).message || 'Network request failed',
    );
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) {
    const body = (json ?? {}) as { error?: { code?: string; message?: string } };
    throw new DeviceApiError(
      res.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `Request failed with status ${res.status}`,
    );
  }
  return json as T;
}

/** This device's identity, assembled from the livesync id + native runtime info. */
export function currentDeviceInfo(): {
  deviceId: string;
  name: string;
  platform: string;
  os: string;
  arch: string;
  appVersion: string;
} {
  return {
    deviceId: getDeviceId(),
    name: hostname() || 'This Mac',
    platform: 'desktop',
    os: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
  };
}

/**
 * NP-047 / B HIGH-3 — device keypair persistence.
 *
 * The private key is encrypted at rest with Electron safeStorage (OS keychain
 * backed: DPAPI / Keychain / libsecret) when available. Where the OS provides
 * no encryption backend, the key is stored plaintext in the app's userData
 * directory with an explicit logged downgrade — the PoP still binds the
 * device install; it is never sent anywhere and never committed.
 */
const KEY_FILE = 'device-identity.json';

interface StoredKeyFile {
  v: 1;
  publicKeyB64: string;
  /** base64 of safeStorage ciphertext when `encrypted`, else the PEM itself. */
  privateKey: string;
  encrypted: boolean;
}

let cachedKeypair: DeviceKeypair | null = null;

function keyFilePath(): string {
  return join(app.getPath('userData'), KEY_FILE);
}

function loadOrCreateKeypair(): DeviceKeypair {
  if (cachedKeypair) return cachedKeypair;
  const path = keyFilePath();
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as StoredKeyFile;
    const privateKeyPem = stored.encrypted
      ? safeStorage.decryptString(Buffer.from(stored.privateKey, 'base64'))
      : stored.privateKey;
    cachedKeypair = { publicKeyB64: stored.publicKeyB64, privateKeyPem };
    return cachedKeypair;
  } catch {
    // No key yet (or unreadable): generate + persist. Regeneration after loss
    // is the RE-ENROLLMENT path; the server refuses a key mismatch for an
    // enrolled device, so a lost key requires admin remove + re-enroll.
    const pair = generateDeviceKeypair();
    const canEncrypt = safeStorage.isEncryptionAvailable();
    if (!canEncrypt) {
      log.warn('OS key encryption unavailable — device private key stored without safeStorage');
    }
    const record: StoredKeyFile = {
      v: 1,
      publicKeyB64: pair.publicKeyB64,
      privateKey: canEncrypt
        ? safeStorage.encryptString(pair.privateKeyPem).toString('base64')
        : pair.privateKeyPem,
      encrypted: canEncrypt,
    };
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
    cachedKeypair = pair;
    return pair;
  }
}

export const deviceClient = {
  /**
   * Register (upsert) THIS device against the given org, with Ed25519
   * proof-of-possession: request a one-time server challenge for our
   * deviceId, sign it with the device private key, and send the public key +
   * nonce + signature alongside the identity (NP-047 / B HIGH-3 — the server
   * requires these under a strict schema; previously the client sent none).
   */
  registerCurrent: async (orgId: string): Promise<{ device: Device }> => {
    const info = currentDeviceInfo();
    const keypair = loadOrCreateKeypair();
    const { challenge } = await deviceRequest<{ challenge: string }>('/challenge', {
      method: 'POST',
      body: { deviceId: info.deviceId },
    });
    return deviceRequest<{ device: Device }>('', {
      method: 'POST',
      body: {
        orgId,
        ...info,
        publicKey: keypair.publicKeyB64,
        challengeNonce: challenge,
        challengeSignature: signChallenge(keypair.privateKeyPem, challenge),
      },
    });
  },

  list: (orgId: string): Promise<Device[]> =>
    deviceRequest<{ devices: Device[] }>(`?orgId=${encodeURIComponent(orgId)}`).then(
      (r) => r.devices,
    ),

  revoke: (orgId: string, deviceId: string): Promise<{ device: Device }> =>
    deviceRequest<{ device: Device }>(`/${encodeURIComponent(deviceId)}/revoke`, {
      method: 'POST',
      body: { orgId },
    }),

  remove: (orgId: string, deviceId: string): Promise<void> =>
    deviceRequest<void>(`/${encodeURIComponent(deviceId)}?orgId=${encodeURIComponent(orgId)}`, {
      method: 'DELETE',
    }),
};
