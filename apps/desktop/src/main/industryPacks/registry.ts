/**
 * Industry Pack registry — the composition point a pack plugs into.
 *
 *   NeuroPause Core → Industry Pack → Tenant Configuration
 *
 * The registry's whole job is to keep that arrow one-directional. Core knows
 * about "a pack"; it does not know about medical devices. A pack knows about
 * its industry; it does not know about any tenant. Adding the second pack
 * should require no change to this file — if it does, the seam is in the wrong
 * place.
 *
 * A manifest is validated at registration, not at first use. A pack whose
 * taxonomy repeats a value, or which contributes no module, resolves nothing
 * forever without erroring — the same silent-failure mode `assertRelationships-
 * AreDeclarable` exists to catch on the relationship side.
 */
import type {
  IndustryPackManifest,
  IndustryPackTenantConfig,
  ResolvedTaxonomy,
} from '@neuropause/shared';
import { resolveTaxonomy, validateIndustryPackManifest } from '@neuropause/shared';

export class IndustryPackRegistry {
  private readonly packs = new Map<string, IndustryPackManifest>();
  private readonly tenantConfigs = new Map<string, IndustryPackTenantConfig>();

  /** Register a pack. Ids are unique; an invalid manifest throws at wiring time. */
  register(manifest: IndustryPackManifest): void {
    const problems = validateIndustryPackManifest(manifest);
    if (problems.length > 0) {
      throw new Error(`Invalid industry pack "${manifest.id}": ${problems.join(' ')}`);
    }
    if (this.packs.has(manifest.id)) {
      throw new Error(`Industry pack "${manifest.id}" is already registered.`);
    }
    this.packs.set(manifest.id, manifest);
  }

  get(packId: string): IndustryPackManifest | null {
    return this.packs.get(packId) ?? null;
  }

  list(): IndustryPackManifest[] {
    return [...this.packs.values()];
  }

  /** Attach a tenant's narrowing/extension of a pack. */
  configure(config: IndustryPackTenantConfig): void {
    if (!this.packs.has(config.packId)) {
      throw new Error(`Cannot configure unknown industry pack "${config.packId}".`);
    }
    this.tenantConfigs.set(`${config.tenantId}::${config.packId}`, config);
  }

  configFor(tenantId: string, packId: string): IndustryPackTenantConfig | null {
    return this.tenantConfigs.get(`${tenantId}::${packId}`) ?? null;
  }

  /** Every taxonomy of a pack, resolved for one tenant. */
  taxonomiesFor(tenantId: string, packId: string): ResolvedTaxonomy[] {
    const manifest = this.packs.get(packId);
    if (!manifest) return [];
    const config = this.configFor(tenantId, packId);
    const out: ResolvedTaxonomy[] = [];
    for (const taxonomy of manifest.taxonomies) {
      const resolved = resolveTaxonomy(manifest, taxonomy.key, config);
      if (resolved) out.push(resolved);
    }
    return out;
  }
}

/** The process-wide registry. Packs register into it at boot. */
export const industryPackRegistry = new IndustryPackRegistry();
