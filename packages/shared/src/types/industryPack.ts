/**
 * Industry Pack — the reusable layer between NeuroPause Core and a tenant.
 *
 *   NeuroPause Core  →  Industry Pack  →  Tenant Configuration
 *
 * Core owns the Enterprise Module Framework, the record store, RBAC, audit and
 * the Data Plane. An industry pack owns a VOCABULARY and a set of modules for
 * one industry, and nothing else: it declares taxonomies (configurable value
 * lists), the module ids it contributes, the canonical import entities it adds
 * and the cross-domain relationships it declares.
 *
 * The rule that gives the layer its value: **a pack contains no tenant-specific
 * business logic.** "Relife Ortho only ships sterile implants" is a tenant
 * configuration, not a Medical Device Pack fact. A pack that hard-codes one
 * customer's rules stops being a pack. `IndustryPackManifest.taxonomies` is the
 * seam through which a tenant narrows or extends the vocabulary later; nothing
 * in this file references any specific tenant.
 *
 * This file is DECLARATION ONLY — pure types plus small pure helpers. Registry
 * and wiring live in the main process (`main/industryPacks`).
 */

/** One selectable value inside a pack taxonomy. */
export interface IndustryTaxonomyValue {
  value: string;
  label: string;
  /** Optional badge tone for renderers that show the value as a chip. */
  tone?: string;
  /** Free-text note explaining the value; surfaced as form help, never as a claim. */
  note?: string;
}

/**
 * A configurable value list contributed by a pack (product families, materials,
 * sterility states, …). A taxonomy is DATA: extending one is a data change, not
 * a code change, which is what makes a tenant configuration possible without
 * forking the pack.
 */
export interface IndustryTaxonomy {
  key: string;
  label: string;
  /** What the taxonomy means, in the words a user of the industry would use. */
  description: string;
  values: readonly IndustryTaxonomyValue[];
  /**
   * True when a tenant may add values beyond those declared. False means the
   * list is closed because downstream logic switches on it (e.g. lot status).
   */
  extensible: boolean;
}

/** The declarative identity + contents of an industry pack. */
export interface IndustryPackManifest {
  id: string;
  title: string;
  /** What this pack adds, stated without regulatory or certification claims. */
  description: string;
  version: string;
  /** Enterprise module ids the pack contributes to the module registry. */
  moduleIds: readonly string[];
  /** Configurable value lists the pack owns. */
  taxonomies: readonly IndustryTaxonomy[];
  /** Canonical Data Plane entity ids the pack makes importable. */
  canonicalEntityIds: readonly string[];
  /** Cross-domain relationship keys the pack declares. */
  relationshipKeys: readonly string[];
  /**
   * Capabilities the pack deliberately does NOT provide in this build. Rendered
   * verbatim in the UI so a user is never left inferring that an absent feature
   * is merely undiscovered.
   */
  notProvided: readonly string[];
}

/** A pack taxonomy resolved for a tenant (core values + tenant additions). */
export interface ResolvedTaxonomy extends IndustryTaxonomy {
  /** Values added by tenant configuration on top of the pack's own. */
  tenantValues: readonly IndustryTaxonomyValue[];
}

/**
 * Tenant-level narrowing/extension of a pack. Empty in this stage — the shape
 * exists so the pack layer is already tenant-agnostic and the tenant stage adds
 * data, not architecture.
 */
export interface IndustryPackTenantConfig {
  tenantId: string;
  packId: string;
  /** Extra taxonomy values, keyed by taxonomy key. Only for `extensible` lists. */
  taxonomyExtensions: Record<string, readonly IndustryTaxonomyValue[]>;
}

/** Find a taxonomy by key. Returns null rather than throwing — callers render an honest empty list. */
export function findTaxonomy(
  manifest: IndustryPackManifest,
  key: string,
): IndustryTaxonomy | null {
  return manifest.taxonomies.find((t) => t.key === key) ?? null;
}

/**
 * Resolve a taxonomy for a tenant. A non-extensible taxonomy IGNORES tenant
 * additions — silently accepting them would let a tenant invent a lot status
 * the state machine cannot interpret.
 */
export function resolveTaxonomy(
  manifest: IndustryPackManifest,
  key: string,
  config?: IndustryPackTenantConfig | null,
): ResolvedTaxonomy | null {
  const base = findTaxonomy(manifest, key);
  if (!base) return null;
  const proposed = config?.taxonomyExtensions?.[key] ?? [];
  const additions = base.extensible
    ? proposed.filter((v) => !base.values.some((b) => b.value === v.value))
    : [];
  return { ...base, tenantValues: additions, values: [...base.values, ...additions] };
}

/** Every legal value of a taxonomy for a tenant, as plain strings. */
export function taxonomyValues(
  manifest: IndustryPackManifest,
  key: string,
  config?: IndustryPackTenantConfig | null,
): readonly string[] {
  return (resolveTaxonomy(manifest, key, config)?.values ?? []).map((v) => v.value);
}

/**
 * Structural problems in a manifest. Called at wiring time so a malformed pack
 * fails loudly at boot instead of resolving nothing forever in production —
 * the same discipline `validateModuleDescriptor` applies to modules.
 */
export function validateIndustryPackManifest(manifest: IndustryPackManifest): string[] {
  const problems: string[] = [];
  if (!manifest.id.trim()) problems.push('Pack id is required.');
  if (!manifest.title.trim()) problems.push('Pack title is required.');
  if (!manifest.version.trim()) problems.push('Pack version is required.');
  if (manifest.moduleIds.length === 0) problems.push('A pack must contribute at least one module.');
  const dupModule = firstDuplicate(manifest.moduleIds);
  if (dupModule) problems.push(`Module id "${dupModule}" is declared twice.`);
  const dupTaxonomy = firstDuplicate(manifest.taxonomies.map((t) => t.key));
  if (dupTaxonomy) problems.push(`Taxonomy "${dupTaxonomy}" is declared twice.`);
  for (const taxonomy of manifest.taxonomies) {
    if (taxonomy.values.length === 0) problems.push(`Taxonomy "${taxonomy.key}" has no values.`);
    const dupValue = firstDuplicate(taxonomy.values.map((v) => v.value));
    if (dupValue) problems.push(`Taxonomy "${taxonomy.key}" repeats value "${dupValue}".`);
  }
  return problems;
}

function firstDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) return v;
    seen.add(v);
  }
  return null;
}
