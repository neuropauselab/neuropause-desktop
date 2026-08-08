/**
 * Solution Pack SDK types (IP-01). A Solution Pack is a plugin that layers an
 * industry's configuration (dashboards, workflows, reports, terminology, KPIs,
 * AI prompts, permissions, connectors, seed data) — and optionally NEW
 * enterprise modules — on top of the certified enterprise core, WITHOUT editing
 * the core or its 104-module / 13-family certification lock.
 *
 * The declarative "meta" is zod-validated; the runtime attachments (pack-added
 * module descriptors, dashboards, workflows, …) are typed but not zod-parsed
 * (they can carry richer objects). Pack module descriptors reuse the core's own
 * `EnterpriseModuleDescriptor` type (imported as a TYPE only, so this package
 * stays pure — no dependency on the desktop runtime).
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { z } from 'zod';

/** MAJOR.MINOR.PATCH. */
export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'version must be MAJOR.MINOR.PATCH');

/** The serialisable, declarative half of a pack manifest (zod-validated). */
export const SolutionPackMetaSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must be kebab-case (a-z, 0-9, -)'),
    name: z.string().min(1),
    industry: z.string().min(1),
    version: SemverSchema,
    description: z.string().min(1),
    dependsOn: z.array(z.string()).optional(),
    coreModulesUsed: z.array(z.string()),
    terminology: z.record(z.string()).optional(),
    permissions: z.array(z.string()).optional(),
    kpis: z.array(z.string()).optional(),
  })
  .strict();

export type SolutionPackMeta = z.infer<typeof SolutionPackMetaSchema>;

export interface SolutionPackDashboard {
  id: string;
  title: string;
  widgets: string[];
}
export interface SolutionPackWorkflow {
  id: string;
  title: string;
  trigger: string;
}
export interface SolutionPackReport {
  id: string;
  title: string;
}
export interface SolutionPackSeed {
  moduleId: string;
  records: number;
}

/** A full pack manifest: the zod-validated meta + typed runtime attachments. */
export interface SolutionPackManifest extends SolutionPackMeta {
  /** Enterprise modules this pack ADDS (registered at runtime; never core). */
  modules?: EnterpriseModuleDescriptor[];
  dashboards?: SolutionPackDashboard[];
  workflows?: SolutionPackWorkflow[];
  reportTemplates?: SolutionPackReport[];
  aiPrompts?: Record<string, string>;
  connectors?: string[];
  seed?: SolutionPackSeed[];
}

/** Lifecycle state of an installed pack. */
export type SolutionPackState = 'installed' | 'enabled' | 'disabled';

export interface InstalledPack {
  manifest: SolutionPackManifest;
  state: SolutionPackState;
}

/** The meta keys, used to strip runtime attachments before zod parsing. */
export const SOLUTION_PACK_META_KEYS: readonly (keyof SolutionPackMeta)[] = [
  'id',
  'name',
  'industry',
  'version',
  'description',
  'dependsOn',
  'coreModulesUsed',
  'terminology',
  'permissions',
  'kpis',
];
