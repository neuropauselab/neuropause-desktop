/**
 * P8.5 — First-party worker-package signing key (the local trust root).
 *
 * With no marketplace and no cloud, the realistic trust root for a LOCAL install is a
 * first-party Ed25519 keypair: the app get-or-creates it (persisted 0o600), registers
 * its PUBLIC key in the shared trust store, and signs first-party worker packages with
 * the private key. Install verification then requires a signature from this trusted
 * key. Reuses `nps/signature.ts` (generate/sign) and `registerTrustedKey` — no new
 * crypto, no new PKI. Electron-free (takes a file path) so it is unit-testable.
 */
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import type { WorkerPackage, WorkerPackageManifest } from '@neuropause/shared';
import { generateSigningKeyPair, registerTrustedKey, signData, type KeyPairPem } from '../../nps/signature';
import { packWorker } from './packaging';
import { createLogger } from '../../logger';

const log = createLogger('workforce-signing-key');

interface KeyFile {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export class WorkerSigningKey {
  private key: KeyFile | null = null;

  constructor(private readonly filePath: string) {}

  /** Load or create the keypair, then register the public key as trusted. Idempotent. */
  async ensure(): Promise<void> {
    if (!this.key) {
      try {
        this.key = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as KeyFile;
      } catch {
        const pair: KeyPairPem = generateSigningKeyPair();
        const keyId = `wpkg_${createHash('sha256').update(pair.publicKeyPem).digest('hex').slice(0, 16)}`;
        this.key = { keyId, publicKeyPem: pair.publicKeyPem, privateKeyPem: pair.privateKeyPem };
        await fs
          .writeFile(this.filePath, JSON.stringify(this.key), { mode: 0o600 })
          .catch((e) => log.error('Failed to persist signing key', { error: String(e) }));
      }
    }
    registerTrustedKey(this.key.keyId, this.key.publicKeyPem);
  }

  keyId(): string {
    if (!this.key) throw new Error('Signing key not ready — call ensure() first.');
    return this.key.keyId;
  }

  /** Package + sign a manifest as a first-party worker package. */
  pack(manifest: WorkerPackageManifest): WorkerPackage {
    if (!this.key) throw new Error('Signing key not ready — call ensure() first.');
    return packWorker(manifest, this.key.keyId, this.key.privateKeyPem);
  }

  sign(data: Buffer): string {
    if (!this.key) throw new Error('Signing key not ready — call ensure() first.');
    return signData(data, this.key.privateKeyPem);
  }
}
