/**
 * AI Workforce — worker model.
 *
 * A worker is a governed, long-lived actor with an identity, a role, declared
 * skills, goals, permissions, a memory scope, a trust score, and health. Workers
 * never act freely: every skill run is proposed as an action and gated by the
 * Governance Runtime (see workforceGovernance.ts). Skills are deterministic and
 * evidence-grounded — the reasoning seam is swappable but cannot fabricate by
 * default.
 *
 * Types-only.
 */

export type WorkerRole =
  | 'founder'
  | 'research'
  | 'engineering'
  | 'marketing'
  | 'sales'
  | 'finance'
  | 'legal'
  | 'operations'
  | 'support';

export const WORKER_ROLES: readonly WorkerRole[] = [
  'founder', 'research', 'engineering', 'marketing', 'sales', 'finance', 'legal', 'operations', 'support',
] as const;

/** Lifecycle states a worker moves through in the runtime. */
export type WorkerLifecycle = 'registered' | 'idle' | 'running' | 'paused' | 'stopped' | 'errored';

export type WorkerHealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface WorkerHealth {
  state: WorkerHealthState;
  lastCheckAt: string | null;
  /** Success rate over recent jobs, 0..1. */
  successRate: number;
  jobsRun: number;
  jobsFailed: number;
  message: string | null;
}

/** What a skill is allowed to touch. Read scopes are low-risk; write/propose
 *  scopes have side effects and are approval-gated by default. */
export type WorkerPermissionScope =
  | 'read:entities'
  | 'read:graph'
  | 'read:timeline'
  | 'read:memory'
  | 'read:health'
  | 'read:connectors'
  | 'write:memory'
  | 'write:reminder'
  | 'propose:draft'
  | 'propose:message';

export const PERMISSION_SCOPES: readonly WorkerPermissionScope[] = [
  'read:entities', 'read:graph', 'read:timeline', 'read:memory', 'read:health', 'read:connectors',
  'write:memory', 'write:reminder', 'propose:draft', 'propose:message',
] as const;

export interface WorkerPermission {
  scope: WorkerPermissionScope;
  granted: boolean;
}

/** A declared capability of a worker. */
export interface WorkerSkill {
  id: string;
  title: string;
  description: string;
  /** Whether running it can have side effects (→ approval-gated). */
  sideEffects: boolean;
  /** Permission scopes this skill exercises. */
  requires: WorkerPermissionScope[];
}

export type MemoryScope = 'none' | 'self' | 'team' | 'org';

export interface WorkerIdentity {
  id: string;
  name: string;
  role: WorkerRole;
  version: string;
  developer: string;
}

export interface Worker {
  identity: WorkerIdentity;
  goals: string[];
  skills: WorkerSkill[];
  permissions: WorkerPermission[];
  memoryScope: MemoryScope;
  /** Ids of governance policy rules bound to this worker. */
  policyIds: string[];
  /** Trust score in 0..1; gates higher-risk actions. */
  trustScore: number;
  lifecycle: WorkerLifecycle;
  health: WorkerHealth;
  createdAt: string;
  updatedAt: string;
  builtIn: boolean;
  metadata: Record<string, unknown>;
}

/** A compact worker view for lists/dashboards. */
export interface WorkerSummary {
  id: string;
  name: string;
  role: WorkerRole;
  version: string;
  lifecycle: WorkerLifecycle;
  healthState: WorkerHealthState;
  trustScore: number;
  skillCount: number;
  builtIn: boolean;
}

export function toWorkerSummary(w: Worker): WorkerSummary {
  return {
    id: w.identity.id,
    name: w.identity.name,
    role: w.identity.role,
    version: w.identity.version,
    lifecycle: w.lifecycle,
    healthState: w.health.state,
    trustScore: w.trustScore,
    skillCount: w.skills.length,
    builtIn: w.builtIn,
  };
}
