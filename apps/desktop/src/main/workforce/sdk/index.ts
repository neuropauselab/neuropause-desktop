/**
 * Worker SDK — the contract for defining an AI worker on top of the existing
 * worker + governance model (see shared types worker.ts / workforceGovernance.ts).
 *
 * A worker is a `Worker` record (identity, declared skills, permission scopes,
 * goals, memory scope, trust, health) plus a set of runnable **skill
 * implementations**. Each skill runs in a `SkillContext` exposing read access to
 * the intelligence layer **scoped to the worker's granted permissions** (least
 * privilege), and returns a `SkillResult`: a summary + evidence + zero or more
 * **proposed actions**. The runtime turns each proposal into an `ActionRequest`
 * and gates it through the Governance Runtime — skills never act directly.
 *
 * `defineWorker` validates the worker against its skills at construction, so an
 * over-privileged or under-declared worker fails fast.
 */
import type {
  ActionEvidence,
  EnterpriseTimelineEntry,
  ExecutionBinding,
  MemoryItem,
  RiskLevel,
  UnifiedEntity,
  Worker,
  WorkerPermissionScope,
} from '@neuropause/shared';
import { PERMISSION_SCOPES, WORKER_ROLES } from '@neuropause/shared';

/** A knowledge-graph neighbor, flattened for skill use. */
export interface WorkforceNeighbor {
  id: string;
  type: string;
  label: string;
  rel: string;
  direction: 'out' | 'in';
}

/** Read access to the intelligence layer, handed to a skill (already scoped). */
export interface WorkforceData {
  entities: UnifiedEntity[];
  events: EnterpriseTimelineEntry[];
  memories: MemoryItem[];
  neighbors: (nodeId: string) => WorkforceNeighbor[];
  now: string;
}

/** An action a skill wants to take; the runtime stamps it into an ActionRequest. */
export interface ProposedAction {
  title: string;
  summary: string;
  sideEffects: boolean;
  permissions: WorkerPermissionScope[];
  risk: RiskLevel;
  evidence: ActionEvidence[];
  payload: Record<string, unknown>;
  /** P8.3 — optional binding to an existing executor; when approved, the action runs. */
  execution?: ExecutionBinding;
}

export interface SkillResult {
  summary: string;
  evidence: ActionEvidence[];
  grounded: boolean;
  proposals: ProposedAction[];
}

export interface SkillContext {
  worker: Worker;
  now: string;
  data: WorkforceData;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export interface SkillImpl {
  /** Must match a declared WorkerSkill.id in the worker. */
  id: string;
  run: (ctx: SkillContext, input: Record<string, unknown>) => SkillResult;
}

export interface WorkerDefinition {
  worker: Worker;
  skills: Map<string, SkillImpl>;
}

export interface WorkerValidation {
  ok: boolean;
  errors: string[];
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const ID_RE = /^worker:[a-z0-9][a-z0-9-]*$/;

/** Validate a worker against the skill implementations that back it. */
export function validateWorker(worker: Worker, skills: SkillImpl[]): WorkerValidation {
  const errors: string[] = [];
  if (!ID_RE.test(worker.identity.id)) errors.push(`invalid worker id "${worker.identity.id}" (expected worker:slug)`);
  if (!SEMVER.test(worker.identity.version)) errors.push(`invalid version "${worker.identity.version}" (expected x.y.z)`);
  if (!WORKER_ROLES.includes(worker.identity.role)) errors.push(`invalid role "${worker.identity.role}"`);
  if (worker.skills.length === 0) errors.push('worker declares no skills');

  const granted = new Set<WorkerPermissionScope>(worker.permissions.filter((p) => p.granted).map((p) => p.scope));
  for (const p of worker.permissions) {
    if (!PERMISSION_SCOPES.includes(p.scope)) errors.push(`unknown permission scope "${p.scope}"`);
  }

  const provided = new Map(skills.map((s) => [s.id, s]));
  for (const declared of worker.skills) {
    if (!provided.has(declared.id)) {
      errors.push(`skill "${declared.id}" declared but not implemented`);
      continue;
    }
    for (const scope of declared.requires) {
      if (!granted.has(scope)) errors.push(`skill "${declared.id}" requires scope "${scope}" the worker is not granted`);
    }
  }
  for (const s of skills) {
    if (!worker.skills.some((d) => d.id === s.id)) errors.push(`skill "${s.id}" implemented but not declared`);
  }

  return { ok: errors.length === 0, errors };
}

/** Build a validated worker definition; throws on an invalid worker. */
export function defineWorker(worker: Worker, skills: SkillImpl[]): WorkerDefinition {
  const v = validateWorker(worker, skills);
  if (!v.ok) throw new Error(`Invalid worker "${worker.identity.id}": ${v.errors.join('; ')}`);
  return { worker, skills: new Map(skills.map((s) => [s.id, s])) };
}

/** Project full intelligence-layer data down to what the worker may read. */
export function scopeData(full: WorkforceData, worker: Worker): WorkforceData {
  const granted = new Set(worker.permissions.filter((p) => p.granted).map((p) => p.scope));
  return {
    now: full.now,
    entities: granted.has('read:entities') ? full.entities : [],
    events: granted.has('read:timeline') ? full.events : [],
    memories: granted.has('read:memory') ? full.memories : [],
    neighbors: granted.has('read:graph') ? full.neighbors : () => [],
  };
}

/** Convenience for a skill that found nothing to act on. */
export function emptyResult(summary: string): SkillResult {
  return { summary, evidence: [], grounded: false, proposals: [] };
}
