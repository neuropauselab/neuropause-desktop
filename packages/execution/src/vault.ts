/**
 * Modules 4 & 5 — Secret Rotation Platform + Credential Vault Extensions. Composes the
 * Wave 2 envelope-encrypting `EncryptedSecretVault` (AES-256-GCM) and adds: scheduled
 * rotation (rotate a secret every intervalMs with a generator), on-demand rotation,
 * expiration tracking, and "expiring soon" queries. Values are always encrypted at rest;
 * plaintext exists only transiently in `resolve()`.
 */
import type { Clock } from '@neuropause/cloud-core';
import type { EncryptedSecretVault } from '@neuropause/connectivity';

export interface RotationPolicy {
  id: string;
  scope: string;
  key: string;
  intervalMs: number;
  nextAt: number;
  generator: () => string;
}

export class SecretRotationPlatform {
  private readonly policies: RotationPolicy[] = [];
  private readonly expiries = new Map<string, number>();
  private counter = 0;

  constructor(
    private readonly vault: EncryptedSecretVault,
    private readonly clock: Clock,
  ) {}

  private k(scope: string, key: string): string {
    return `${scope}::${key}`;
  }

  async store(scope: string, key: string, value: string, opts: { ttlMs?: number } = {}): Promise<void> {
    await this.vault.put(scope, key, value);
    if (opts.ttlMs !== undefined) this.expiries.set(this.k(scope, key), this.clock.now() + opts.ttlMs);
  }
  resolve(scope: string, key: string): Promise<string | undefined> {
    return this.vault.reveal({ scope, key });
  }
  version(scope: string, key: string): number {
    return this.vault.meta(scope, key)?.version ?? 0;
  }

  /** Rotate a secret now — new ciphertext version, rotation timestamp recorded. */
  async rotateNow(scope: string, key: string, newValue: string, opts: { ttlMs?: number } = {}): Promise<number> {
    const meta = await this.vault.rotate(scope, key, newValue);
    if (opts.ttlMs !== undefined) this.expiries.set(this.k(scope, key), this.clock.now() + opts.ttlMs);
    return meta.version;
  }

  /** Schedule automatic rotation. */
  schedule(input: { scope: string; key: string; intervalMs: number; generator: () => string }): RotationPolicy {
    const policy: RotationPolicy = { id: `rot_${(this.counter += 1)}`, scope: input.scope, key: input.key, intervalMs: input.intervalMs, nextAt: this.clock.now() + input.intervalMs, generator: input.generator };
    this.policies.push(policy);
    return policy;
  }

  /** Rotate any due scheduled secrets; returns how many rotated. */
  async tick(now = this.clock.now()): Promise<number> {
    let rotated = 0;
    for (const p of this.policies) {
      while (p.nextAt <= now) {
        await this.vault.rotate(p.scope, p.key, p.generator());
        p.nextAt += p.intervalMs;
        rotated += 1;
      }
    }
    return rotated;
  }

  /** Secrets whose TTL expires within `withinMs`. */
  expiring(withinMs: number, now = this.clock.now()): Array<{ scope: string; key: string; expiresAt: number }> {
    return [...this.expiries.entries()]
      .filter(([, exp]) => exp <= now + withinMs)
      .map(([k, exp]) => {
        const [scope, key] = k.split('::');
        return { scope, key, expiresAt: exp };
      });
  }
}
