/**
 * P8.5 — Worker package validation + composition.
 *
 * Validation is PURE (I/O injected) and layered: shape → compatibility → integrity
 * & signature → id-namespace/collision → permission bounds → skill-kind/config →
 * dependency resolution → least-privilege composition. Composition maps each
 * declarative skill spec onto a fixed, vetted P8.4 factory (advisory/draft/note/
 * mail/infra) and runs it through the existing `composeWorker` (which itself calls
 * `defineWorker`/`validateWorker`) — so an installed worker is built from compiled-in,
 * governed code selected by configuration. The package never contributes code.
 */
import type {
  Worker,
  WorkerPackage,
  WorkerPackageManifest,
  WorkerSkillSpec,
} from '@neuropause/shared';
import { PERMISSION_SCOPES, WORKER_ROLES } from '@neuropause/shared';
import { satisfiesRange } from '../../plugins/manifest';
import type { WorkerDefinition } from '../sdk';
import {
  advisoryPair,
  composeWorker,
  draftPair,
  grantsOf,
  infraPair,
  mailPair,
  notePair,
  type SkillPair,
} from '../workers/common';
import { verifyWorkerPackage } from './packaging';

/** Installed-worker ids are namespaced so they can never collide with a built-in id. */
export const INSTALLED_ID_RE = /^worker:pkg-[a-z0-9][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const SKILL_KINDS = new Set<WorkerSkillSpec['kind']>(['advisory', 'draft', 'note', 'mail', 'infra']);
const MEMORY_SCOPES = new Set(['none', 'self', 'team', 'org']);

/** Injected facts the pure validator needs (no I/O of its own). */
export interface PackageValidationContext {
  /** The running app/engine version (e.g. app.getVersion()). */
  appVersion: string;
  /** Is this id an existing BUILT-IN worker? (collision guard). */
  isBuiltIn: (id: string) => boolean;
  /** Is this id an already-installed package? (dependency resolution). */
  isInstalled: (id: string) => boolean;
}

export interface PackageValidation {
  ok: boolean;
  errors: string[];
}

/** Map one declarative skill spec onto its vetted factory (compiled-in code). */
export function resolveSkillPair(spec: WorkerSkillSpec): SkillPair {
  switch (spec.kind) {
    case 'advisory':
      return advisoryPair(spec.id, spec.label);
    case 'draft':
      return draftPair(spec.id, spec.label);
    case 'note':
      return notePair(spec.id, spec.label);
    case 'mail':
      return mailPair(spec.id, spec.label);
    case 'infra':
      return infraPair({
        id: spec.id,
        verb: spec.label,
        target: spec.target ?? '',
        accountId: spec.accountId,
        actionId: spec.actionId ?? '',
        required: spec.required ?? [],
        optional: spec.optional,
        refKey: spec.refKey ?? '',
      });
    default:
      throw new Error(`unknown skill kind "${(spec as WorkerSkillSpec).kind}"`);
  }
}

/**
 * Compose an installed worker definition from a manifest. Grants are derived
 * least-privilege by `composeWorker`; the result is marked `builtIn:false` and
 * tagged with its provenance in metadata.
 */
export function composeInstalledWorker(manifest: WorkerPackageManifest): WorkerDefinition {
  const pairs = manifest.skills.map(resolveSkillPair);
  const def = composeWorker({
    id: manifest.id,
    name: manifest.name,
    role: manifest.role,
    goals: manifest.goals,
    pairs,
    memoryScope: manifest.memoryScope,
  });
  const worker: Worker = {
    ...def.worker,
    // Reflect the manifest version on the worker identity (composeWorker defaults it).
    identity: { ...def.worker.identity, version: manifest.version },
    builtIn: false,
    metadata: {
      source: 'installed',
      author: manifest.author,
      version: manifest.version,
      capabilities: manifest.capabilities,
    },
  };
  return { worker, skills: def.skills };
}

/** Validate a worker package end to end. Pure; returns all errors found. */
export function validateWorkerPackage(pkg: WorkerPackage, ctx: PackageValidationContext): PackageValidation {
  const errors: string[] = [];
  const m = pkg.manifest;

  // 1. Shape.
  if (!INSTALLED_ID_RE.test(m.id)) errors.push(`id "${m.id}" must match ${INSTALLED_ID_RE} (installed workers are namespaced)`);
  if (!SEMVER.test(m.version)) errors.push(`version "${m.version}" must be x.y.z`);
  if (!m.name?.trim()) errors.push('name is required');
  if (!m.author?.trim()) errors.push('author is required');
  if (!WORKER_ROLES.includes(m.role)) errors.push(`unknown role "${m.role}"`);
  if (m.memoryScope !== undefined && !MEMORY_SCOPES.has(m.memoryScope)) errors.push(`unknown memoryScope "${m.memoryScope}"`);
  if (!Array.isArray(m.skills) || m.skills.length === 0) errors.push('at least one skill is required');

  // 2. Compatibility (engine range vs the running app version).
  if (!m.engine?.neuropause || !satisfiesRange(ctx.appVersion, m.engine.neuropause)) {
    errors.push(`incompatible engine range "${m.engine?.neuropause ?? ''}" (app ${ctx.appVersion})`);
  }

  // 3. Integrity + signature (checksum matches, signature verifies against a trusted key).
  const ver = verifyWorkerPackage(pkg);
  if (!ver.ok) errors.push(`package verification failed: ${ver.reason}`);

  // 4. Id collision with a built-in worker (never overwrite a built-in).
  if (ctx.isBuiltIn(m.id)) errors.push(`id "${m.id}" collides with a built-in worker`);

  // 5. Declared permissions must be known scopes.
  for (const p of m.permissions ?? []) {
    if (!PERMISSION_SCOPES.includes(p)) errors.push(`unknown permission scope "${p}"`);
  }

  // 6. Skill kinds + per-kind required config.
  for (const s of m.skills ?? []) {
    if (!SKILL_KINDS.has(s.kind)) {
      errors.push(`unknown skill kind "${s.kind}"`);
      continue;
    }
    if (s.kind === 'infra') {
      if (!s.target) errors.push(`infra skill "${s.id}" is missing "target"`);
      if (!s.actionId) errors.push(`infra skill "${s.id}" is missing "actionId"`);
      if (!s.refKey) errors.push(`infra skill "${s.id}" is missing "refKey"`);
    }
  }

  // 7. Dependencies must already be installed; self-dependency rejected. (Requiring
  //    deps to pre-exist makes a dependency cycle impossible to create.)
  for (const dep of m.dependencies ?? []) {
    if (dep === m.id) errors.push('a package cannot depend on itself');
    else if (!ctx.isInstalled(dep)) errors.push(`missing dependency "${dep}"`);
  }

  // 8. Least-privilege + composition: the worker's DERIVED grants (exactly what its
  //    skills require) must be a subset of the DECLARED permissions, and the composed
  //    worker must pass validateWorker (via composeWorker).
  if (errors.length === 0) {
    try {
      const pairs = m.skills.map(resolveSkillPair);
      const declared = new Set(m.permissions ?? []);
      for (const scope of grantsOf(pairs)) {
        if (!declared.has(scope)) errors.push(`a skill requires scope "${scope}" not declared in the manifest permissions`);
      }
      composeInstalledWorker(m);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { ok: errors.length === 0, errors };
}
