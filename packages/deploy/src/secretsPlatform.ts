/**
 * EPIC 7 — Secrets Platform. Integrates with the existing vault: environment secrets, API keys,
 * certificates, signing keys, OAuth secrets, encryption keys, and rotation policies. It NEVER
 * exposes a secret value — only policy names, rotation intervals, and reference keys. Rotation
 * REUSES the Wave 14 production security key rotation when connected.
 */
import type { DeployGovernance } from './governance';
import type { DeployContext } from './types';
import type { AssetCatalog } from './assets';

export interface RotationPolicy { name: string; rotationDays: number; type: string }

export class SecretsPlatform {
  constructor(
    private readonly governance: DeployGovernance,
    private readonly ctx: DeployContext,
    private readonly catalog: AssetCatalog,
  ) {}

  backend(): string {
    const cfg = JSON.parse(this.catalog.read('secrets/rotation-policies.json')) as { backend: string };
    return cfg.backend;
  }

  /** Rotation POLICIES only — never any secret value. */
  rotationPolicies(): RotationPolicy[] {
    const cfg = JSON.parse(this.catalog.read('secrets/rotation-policies.json')) as { policies: RotationPolicy[] };
    return cfg.policies;
  }

  /** Reference keys (names only) that must be injected from the vault — values are never stored. */
  references(): string[] {
    return this.catalog.read('secrets/secrets.example.env')
      .split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => l.split('=')[0]!.trim());
  }

  /** Rotate a signing/encryption key by REUSING the production security key manager. */
  async rotate(tenant: string, org?: string): Promise<{ tenant: string; version: number | null; reusedSecurity: boolean }> {
    if (this.ctx.production) {
      const res = await this.ctx.production.security().rotateKeys(tenant);
      await this.governance.record({ operator: 'system', org: org ?? '_platform', environment: '_platform', epic: 'E7', operation: 'secrets.rotate', targetId: tenant, evidence: 'live-verified', decision: `v${res.version}` });
      return { tenant, version: res.version, reusedSecurity: res.reusedSecurity };
    }
    return { tenant, version: null, reusedSecurity: false };
  }
}
