/**
 * Solution Pack registry (IP-01). Pure, deterministic lifecycle:
 * install → enable/disable → upgrade, with dependency, version, and id-collision
 * checks. It holds NO side effects — enabling a pack only flips its state here;
 * the desktop loader (IP-02) is what actually registers pack modules into the
 * live EnterpriseModuleRegistry and applies the config overlays for enabled
 * packs. Core module ids/families are injected so the SDK stays pure.
 */
import { validateSolutionPack, type ValidatePackOpts } from './validate';
import type { InstalledPack, SolutionPackManifest } from './types';

export interface SolutionPackRegistryOpts {
  /** Ids of the certified core modules (a pack module may not reuse one). */
  coreModuleIds?: string[];
  /** Core family names a pack module may not claim as its `group`. */
  coreFamilies?: string[];
}

/** Compare MAJOR.MINOR.PATCH; <0 a<b, 0 equal, >0 a>b. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n));
  const pb = b.split('.').map((n) => Number(n));
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export class SolutionPackRegistry {
  private readonly packs = new Map<string, InstalledPack>();

  constructor(private readonly opts: SolutionPackRegistryOpts = {}) {}

  /** Validation opts for a candidate, excluding its own prior modules on upgrade. */
  private validateOpts(excludePackId?: string): ValidatePackOpts {
    const existingPackModuleIds: string[] = [];
    for (const [id, installed] of this.packs) {
      if (id === excludePackId) continue;
      for (const m of installed.manifest.modules ?? []) existingPackModuleIds.push(m.id);
    }
    return {
      coreModuleIds: this.opts.coreModuleIds,
      coreFamilies: this.opts.coreFamilies,
      existingPackModuleIds,
    };
  }

  /** Validate + install a pack as 'installed' (not yet enabled). */
  install(manifest: SolutionPackManifest): void {
    if (this.packs.has(manifest.id)) {
      throw new Error(`Pack "${manifest.id}" is already installed.`);
    }
    const problems = validateSolutionPack(manifest, this.validateOpts());
    if (problems.length > 0) {
      throw new Error(`Pack "${manifest.id}" is invalid: ${problems.join('; ')}`);
    }
    for (const dep of manifest.dependsOn ?? []) {
      if (!this.packs.has(dep)) {
        throw new Error(`Pack "${manifest.id}" depends on "${dep}", which is not installed.`);
      }
    }
    this.packs.set(manifest.id, { manifest, state: 'installed' });
  }

  /** Enable a pack (all its dependencies must already be enabled). */
  enable(id: string): void {
    const pack = this.require(id);
    for (const dep of pack.manifest.dependsOn ?? []) {
      if (this.require(dep).state !== 'enabled') {
        throw new Error(`Enable dependency "${dep}" before enabling "${id}".`);
      }
    }
    pack.state = 'enabled';
  }

  /** Disable a pack (refused while an enabled pack still depends on it). */
  disable(id: string): void {
    const pack = this.require(id);
    for (const [otherId, other] of this.packs) {
      if (otherId === id) continue;
      if (other.state === 'enabled' && (other.manifest.dependsOn ?? []).includes(id)) {
        throw new Error(`Cannot disable "${id}": "${otherId}" is enabled and depends on it.`);
      }
    }
    pack.state = 'disabled';
  }

  /** Upgrade to a strictly-higher version (state preserved); re-validates. */
  upgrade(manifest: SolutionPackManifest): void {
    const current = this.require(manifest.id);
    if (compareSemver(manifest.version, current.manifest.version) <= 0) {
      throw new Error(
        `Upgrade for "${manifest.id}" must be higher than ${current.manifest.version} (got ${manifest.version}).`,
      );
    }
    const problems = validateSolutionPack(manifest, this.validateOpts(manifest.id));
    if (problems.length > 0) {
      throw new Error(`Upgrade for "${manifest.id}" is invalid: ${problems.join('; ')}`);
    }
    current.manifest = manifest;
  }

  get(id: string): InstalledPack | null {
    return this.packs.get(id) ?? null;
  }

  list(): InstalledPack[] {
    return [...this.packs.values()];
  }

  enabled(): InstalledPack[] {
    return this.list().filter((p) => p.state === 'enabled');
  }

  /** All enterprise-module ids contributed by currently-enabled packs. */
  enabledModuleIds(): string[] {
    return this.enabled().flatMap((p) => (p.manifest.modules ?? []).map((m) => m.id));
  }

  private require(id: string): InstalledPack {
    const pack = this.packs.get(id);
    if (!pack) throw new Error(`Pack "${id}" is not installed.`);
    return pack;
  }
}
