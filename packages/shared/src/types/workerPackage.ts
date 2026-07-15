/**
 * P8.5 — Installable Worker packages.
 *
 * A worker package is a **declarative manifest** (no code): it names a role, goals,
 * and a list of skills, where each skill references one of the fixed, vetted skill
 * KINDS the runtime already ships (advisory / draft / note / mail / infra — the
 * P8.4 factories). Installing therefore composes compiled-in, governed code selected
 * by configuration — it never evaluates code from the package. The manifest is
 * content-hashed (checksum) and Ed25519-signed; the host verifies both against a
 * trusted publisher key before registering the worker into the existing Worker
 * Registry. Governance, RBAC, and trust treat an installed worker identically to a
 * built-in (they never branch on `builtIn`).
 *
 * Types-only.
 */
import type { MemoryScope, WorkerPermissionScope, WorkerRole } from './worker';

/** The fixed catalog of skill kinds a manifest may compose (maps 1:1 to the P8.4 factories). */
export type WorkerSkillKind = 'advisory' | 'draft' | 'note' | 'mail' | 'infra';

/** One skill in a manifest — a kind + its declarative configuration. */
export interface WorkerSkillSpec {
  kind: WorkerSkillKind;
  id: string;
  /** Human phrase: the noun (advisory), the focus (draft/note), or the verb (mail/infra). */
  label: string;
  /** infra only — the executor platform target (e.g. 'aws', 'kubernetes'). */
  target?: string;
  /** infra only — account/subscription scope (defaults applied downstream). */
  accountId?: string;
  /** infra only — the real InfraActionExecutor action id (e.g. 'aws_ec2_stop'). */
  actionId?: string;
  /** infra/mail — required job-input keys → action params. */
  required?: string[];
  /** infra — optional job-input keys carried through when present. */
  optional?: string[];
  /** infra/mail — which resolved param labels the action for the operator. */
  refKey?: string;
}

/** The worker package manifest — the governed, declarative unit of installation. */
export interface WorkerPackageManifest {
  /** Namespaced id: `worker:pkg-<slug>` (kept distinct from built-in ids). */
  id: string;
  name: string;
  /** Semantic version `x.y.z`. */
  version: string;
  author: string;
  description: string;
  role: WorkerRole;
  memoryScope?: MemoryScope;
  goals: string[];
  /** Human-readable capability tags (for display + catalog). */
  capabilities: string[];
  /** Declared permission scopes; the composed worker's derived grants must be a subset. */
  permissions: WorkerPermissionScope[];
  skills: WorkerSkillSpec[];
  /** Ids of other installed worker packages this one requires. */
  dependencies: string[];
  /** Host compatibility range checked against the app version (e.g. '^1.0.0'). */
  engine: { neuropause: string };
}

/** A signed, content-hashed worker package — what the install flow consumes. */
export interface WorkerPackage {
  manifest: WorkerPackageManifest;
  /** SHA-256 hex of the canonical manifest. */
  checksum: string;
  /** Publisher key id the signature claims (must be trusted). */
  signatureKeyId: string | null;
  /** base64 Ed25519 signature over the checksum bytes. */
  signature: string | null;
}

export type WorkerInstallState = 'enabled' | 'disabled';

/** The result of an install-lifecycle operation (crosses IPC to the renderer). */
export interface WorkerInstallResult {
  ok: boolean;
  errors: string[];
  summary: WorkerInstallSummary | null;
}

/** A compact install view for the Operations Center. */
export interface WorkerInstallSummary {
  id: string;
  name: string;
  version: string;
  author: string;
  state: WorkerInstallState;
  role: WorkerRole;
  capabilities: string[];
  permissions: WorkerPermissionScope[];
  /** True when a prior version is retained (rollback is available). */
  canRollback: boolean;
  installedAt: string;
  updatedAt: string;
}
