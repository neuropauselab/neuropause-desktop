/**
 * Plugin manifest schema + engine compatibility. The manifest (neuropause.plugin
 * .json) is the contract between a plugin and the host. Compatibility is checked
 * against the running host version using a small, dependency-free semver-range
 * matcher supporting exact, caret (^), tilde (~), wildcard (*), and space-joined
 * comparator ranges (e.g. ">=0.1.0 <1.0.0").
 */
import { z } from 'zod';
import type { PluginManifest } from '@neuropause/shared';

const PermissionEnum = z.enum([
  'network',
  'filesystem_read',
  'filesystem_write',
  'clipboard',
  'notifications',
  'camera',
  'microphone',
  'local_models',
  'automation',
  'background',
  'shell_execution',
]);

const ContributionSchema = z.object({
  id: z.string().min(1).max(128),
  surface: z.enum(['sidebar', 'toolbar', 'panel', 'widget']),
  title: z.string().min(1).max(120),
  icon: z.string().max(64).nullable().default(null),
  entry: z.string().max(512).nullable().default(null),
});

export const PluginManifestSchema = z.object({
  id: z
    .string()
    .min(3)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'id must be lowercase alphanumeric with . _ -'),
  name: z.string().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+].*)?$/, 'version must be semver'),
  description: z.string().max(2000).nullable().default(null),
  author: z.string().max(200).nullable().default(null),
  engine: z.object({ neuropause: z.string().min(1).max(64) }),
  kind: z.enum(['background', 'automation', 'ai_agent', 'mcp_server', 'ui']),
  main: z.string().max(512).nullable().default(null),
  contributions: z.array(ContributionSchema).max(32).default([]),
  permissions: z.array(PermissionEnum).max(16).default([]),
});

export interface ManifestValidation {
  ok: boolean;
  manifest: PluginManifest | null;
  errors: string[];
}

export function validateManifest(raw: unknown): ManifestValidation {
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, manifest: null, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const m = parsed.data as PluginManifest;
  // Code plugins must declare an entry module.
  if (m.kind !== 'ui' && !m.main) {
    return { ok: false, manifest: null, errors: ['main is required for code plugins'] };
  }
  return { ok: true, manifest: m, errors: [] };
}

/* ── minimal semver range matching ── */

type Ver = [number, number, number];

function parse(v: string): Ver {
  const core = v.split(/[-+]/)[0];
  const [a, b, c] = core.split('.').map((n) => parseInt(n, 10) || 0);
  return [a, b, c];
}

function cmp(a: Ver, b: Ver): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function satisfiesComparator(v: Ver, op: string, target: Ver): boolean {
  const c = cmp(v, target);
  switch (op) {
    case '>=':
      return c >= 0;
    case '>':
      return c > 0;
    case '<=':
      return c <= 0;
    case '<':
      return c < 0;
    case '=':
    case '==':
      return c === 0;
    default:
      return false;
  }
}

export function satisfiesRange(version: string, range: string): boolean {
  const v = parse(version);
  const r = range.trim();
  if (r === '' || r === '*' || r === 'x') return true;

  if (r.startsWith('^')) {
    const t = parse(r.slice(1));
    const upper: Ver = t[0] > 0 ? [t[0] + 1, 0, 0] : t[1] > 0 ? [0, t[1] + 1, 0] : [0, 0, t[2] + 1];
    return cmp(v, t) >= 0 && cmp(v, upper) < 0;
  }
  if (r.startsWith('~')) {
    const t = parse(r.slice(1));
    const upper: Ver = [t[0], t[1] + 1, 0];
    return cmp(v, t) >= 0 && cmp(v, upper) < 0;
  }

  // Space-joined comparators (AND), e.g. ">=0.1.0 <1.0.0".
  const parts = r.split(/\s+/).filter(Boolean);
  if (parts.every((p) => /^(>=|<=|>|<|=|==)?\d/.test(p))) {
    return parts.every((p) => {
      const m = p.match(/^(>=|<=|>|<|==|=)?(.+)$/);
      if (!m) return false;
      const op = m[1] || '=';
      return satisfiesComparator(v, op, parse(m[2]));
    });
  }
  // Bare exact version.
  return cmp(v, parse(r)) === 0;
}
