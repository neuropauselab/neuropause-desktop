/**
 * Solution Pack validation (IP-01). Pure: returns a list of problem strings
 * (empty = valid), mirroring the core's `validateModuleDescriptor` style. Core
 * and other-pack module ids and the core family names are INJECTED so this
 * package never imports the desktop runtime — keeping the certified core lock
 * entirely separate from pack validation.
 */
import {
  SOLUTION_PACK_META_KEYS,
  SolutionPackMetaSchema,
  type SolutionPackManifest,
  type SolutionPackMeta,
} from './types';

export interface ValidatePackOpts {
  /** Ids of the certified core modules (a pack module may not reuse one). */
  coreModuleIds?: string[];
  /** Ids of modules contributed by OTHER installed packs. */
  existingPackModuleIds?: string[];
  /** Core family names a pack module may not claim as its `group`. */
  coreFamilies?: string[];
}

/** Extract only the zod-validated meta keys (drop runtime attachments). */
function metaOf(manifest: SolutionPackManifest): Partial<SolutionPackMeta> {
  const out: Record<string, unknown> = {};
  for (const key of SOLUTION_PACK_META_KEYS) {
    if (manifest[key] !== undefined) out[key] = manifest[key];
  }
  return out as Partial<SolutionPackMeta>;
}

export function validateSolutionPack(
  manifest: SolutionPackManifest,
  opts: ValidatePackOpts = {},
): string[] {
  const problems: string[] = [];

  const parsed = SolutionPackMetaSchema.safeParse(metaOf(manifest));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${issue.path.join('.') || 'manifest'}: ${issue.message}`);
    }
  }

  const core = new Set(opts.coreModuleIds ?? []);
  const otherPacks = new Set(opts.existingPackModuleIds ?? []);
  const coreFamilies = new Set(opts.coreFamilies ?? []);
  const seen = new Set<string>();

  for (const m of manifest.modules ?? []) {
    if (core.has(m.id)) problems.push(`module "${m.id}" collides with a certified core module id`);
    if (otherPacks.has(m.id))
      problems.push(`module "${m.id}" collides with another pack's module id`);
    if (seen.has(m.id)) problems.push(`module "${m.id}" is declared twice in this pack`);
    seen.add(m.id);

    const group = (m.group ?? '').trim();
    if (!group) {
      problems.push(`module "${m.id}" must declare a non-empty group (its industry family)`);
    } else if (coreFamilies.has(group)) {
      problems.push(
        `module "${m.id}" must not reuse the core family "${group}" — packs add new families`,
      );
    }
  }

  return problems;
}
