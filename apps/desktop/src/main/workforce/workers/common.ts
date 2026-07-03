/**
 * Shared building blocks for the built-in workers. `buildWorker` stamps out a
 * `Worker` template (built-in, idle, neutral trust — the registry fills in
 * timestamps and evolves trust/health from outcomes). The rest are small,
 * deterministic helpers for reading the scoped intelligence-layer data and for
 * constructing the side-effecting **proposals** that the Governance Runtime then
 * gates. A brand-new built-in worker starts below the write-trust floor, so even
 * its low-risk write proposals require human approval until it has earned trust.
 */
import type {
  ActionEvidence,
  EnterpriseTimelineEntry,
  MemoryScope,
  RiskLevel,
  UnifiedEntity,
  UnifiedEntityKind,
  Worker,
  WorkerPermissionScope,
  WorkerRole,
  WorkerSkill,
} from '@neuropause/shared';
import type { ProposedAction } from '../sdk';

/** The default governance policies every built-in worker is bound by. */
const BOUND_POLICIES = ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval', 'pol:write-trust'];

export interface BuildWorkerArgs {
  id: string;
  name: string;
  role: WorkerRole;
  goals: string[];
  skills: WorkerSkill[];
  grants: WorkerPermissionScope[];
  version?: string;
  memoryScope?: MemoryScope;
  trustScore?: number;
}

export function buildWorker(args: BuildWorkerArgs): Worker {
  return {
    identity: {
      id: args.id,
      name: args.name,
      role: args.role,
      version: args.version ?? '1.0.0',
      developer: 'NeuroPause',
    },
    goals: args.goals,
    skills: args.skills,
    permissions: args.grants.map((scope) => ({ scope, granted: true })),
    memoryScope: args.memoryScope ?? 'self',
    policyIds: BOUND_POLICIES,
    trustScore: args.trustScore ?? 0.5,
    lifecycle: 'idle',
    health: { state: 'unknown', lastCheckAt: null, successRate: 1, jobsRun: 0, jobsFailed: 0, message: null },
    createdAt: '',
    updatedAt: '',
    builtIn: true,
    metadata: {},
  };
}

/* ── reading scoped data ─────────────────────────────────────────────────── */

const DONE_STATUS = new Set(['done', 'closed', 'complete', 'completed', 'resolved', 'cancelled', 'merged', 'archived']);

export function byKind(entities: UnifiedEntity[], kinds: UnifiedEntityKind[]): UnifiedEntity[] {
  const set = new Set(kinds);
  return entities.filter((e) => set.has(e.kind));
}

export function openTasks(entities: UnifiedEntity[]): UnifiedEntity[] {
  return entities.filter((e) => e.kind === 'task' && !(e.status && DONE_STATUS.has(e.status.toLowerCase())));
}

export function recentEntities(entities: UnifiedEntity[], n: number): UnifiedEntity[] {
  return [...entities].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, n);
}

export function matching(entities: UnifiedEntity[], re: RegExp): UnifiedEntity[] {
  return entities.filter((e) => re.test(e.title));
}

export function ev(kind: string, id: string): ActionEvidence {
  return { kind, id };
}

export function evFromEntities(entities: UnifiedEntity[], limit = 12): ActionEvidence[] {
  return entities.slice(0, limit).map((e) => ({ kind: e.kind, id: e.id }));
}

export function evFromEvents(events: EnterpriseTimelineEntry[], limit = 12): ActionEvidence[] {
  return events.slice(0, limit).map((e) => ({ kind: 'event', id: e.id }));
}

export function titles(entities: UnifiedEntity[], limit = 5): string {
  return entities.slice(0, limit).map((e) => e.title).join('; ');
}

/* ── proposal builders (side-effecting → governed) ───────────────────────── */

interface ProposalArgs {
  title: string;
  summary: string;
  evidence: ActionEvidence[];
  payload?: Record<string, unknown>;
  risk?: RiskLevel;
}

export function draftProposal(a: ProposalArgs): ProposedAction {
  return {
    title: a.title,
    summary: a.summary,
    sideEffects: true,
    permissions: ['propose:draft'],
    risk: a.risk ?? 'medium',
    evidence: a.evidence,
    payload: a.payload ?? {},
  };
}

export function messageProposal(a: ProposalArgs): ProposedAction {
  return {
    title: a.title,
    summary: a.summary,
    sideEffects: true,
    permissions: ['propose:message'],
    risk: a.risk ?? 'medium',
    evidence: a.evidence,
    payload: a.payload ?? {},
  };
}

export function memoryProposal(a: ProposalArgs): ProposedAction {
  return {
    title: a.title,
    summary: a.summary,
    sideEffects: true,
    permissions: ['write:memory'],
    risk: a.risk ?? 'low',
    evidence: a.evidence,
    payload: a.payload ?? {},
  };
}

export function reminderProposal(a: ProposalArgs): ProposedAction {
  return {
    title: a.title,
    summary: a.summary,
    sideEffects: true,
    permissions: ['write:reminder'],
    risk: a.risk ?? 'low',
    evidence: a.evidence,
    payload: a.payload ?? {},
  };
}
