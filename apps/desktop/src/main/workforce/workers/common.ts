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
  ExecutionBinding,
  ExecutorKind,
  MemoryScope,
  RiskLevel,
  UnifiedEntity,
  UnifiedEntityKind,
  Worker,
  WorkerPermissionScope,
  WorkerRole,
  WorkerSkill,
} from '@neuropause/shared';
import { defineWorker, emptyResult, type ProposedAction, type SkillImpl, type WorkerDefinition } from '../sdk';

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

/* ── executable proposals (P8.4) ─────────────────────────────────────────────
 * An execution proposal carries a P8.3 `ExecutionBinding` to an EXISTING executor
 * action (infra / m365). It exercises the `execute:action` scope and is always
 * high-risk, so the Governance Runtime forces `require_approval` (pol:high-risk-
 * approval) — an approved action then runs through the ExecuteEngine, where the
 * executor's own `mutates + confirmed` gate is the final backstop. Nothing here
 * bypasses approval; nothing new executes — it only points at what already runs.
 */
interface ExecutionProposalArgs {
  title: string;
  summary: string;
  evidence: ActionEvidence[];
  binding: ExecutionBinding;
  payload?: Record<string, unknown>;
  risk?: RiskLevel;
}

export function executionProposal(a: ExecutionProposalArgs): ProposedAction {
  return {
    title: a.title,
    summary: a.summary,
    sideEffects: true,
    permissions: ['execute:action'],
    risk: a.risk ?? 'high',
    evidence: a.evidence,
    payload: a.payload ?? {},
    execution: a.binding,
  };
}

/* ── skill factories ─────────────────────────────────────────────────────────
 * Two shapes cover every enterprise archetype: an advisory read-only reviewer
 * (summarises scoped intelligence, no side effect) and an executable action
 * (emits a governed execution proposal from the job input). Both are pure and
 * reuse the intelligence snapshot the runtime already scopes to the worker.
 */

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A read-only skill: ground a summary in scoped entities + timeline events. */
export function advisorySkill(id: string, noun: string): SkillImpl {
  return {
    id,
    run: (ctx) => {
      const entities = recentEntities(ctx.data.entities, 12);
      const events = ctx.data.events.slice(0, 12);
      if (entities.length === 0 && events.length === 0) {
        return emptyResult(`No connected ${noun} signals to review yet.`);
      }
      const evidence = [...evFromEntities(entities), ...evFromEvents(events)].slice(0, 20);
      return {
        summary: `Reviewed ${entities.length} ${noun} signal(s) and ${events.length} recent event(s).`,
        evidence,
        grounded: true,
        proposals: [],
      };
    },
  };
}

/** A skill that proposes a governed draft brief grounded in scoped intelligence. */
export function draftSkill(id: string, focus: string): SkillImpl {
  return {
    id,
    run: (ctx) => {
      const entities = recentEntities(ctx.data.entities, 10);
      const events = ctx.data.events.slice(0, 10);
      if (entities.length === 0 && events.length === 0) {
        return emptyResult(`No connected signals to brief on for ${focus} yet.`);
      }
      const evidence = [...evFromEntities(entities), ...evFromEvents(events)].slice(0, 16);
      return {
        summary: `Prepared a ${focus} brief from ${entities.length} item(s) and ${events.length} event(s).`,
        evidence,
        grounded: true,
        proposals: [
          draftProposal({
            title: `${cap(focus)} brief`,
            summary: `Draft ${focus} brief for review.`,
            evidence,
            payload: { focus, itemIds: entities.map((e) => e.id).slice(0, 20) },
          }),
        ],
      };
    },
  };
}

/** A skill that proposes a governed memory note capturing an observation. */
export function noteSkill(id: string, focus: string): SkillImpl {
  return {
    id,
    run: (ctx) => {
      const entities = recentEntities(ctx.data.entities, 8);
      if (entities.length === 0) return emptyResult(`Nothing to record for ${focus} yet.`);
      const evidence = evFromEntities(entities, 8);
      return {
        summary: `Prepared a ${focus} note covering ${entities.length} item(s).`,
        evidence,
        grounded: true,
        proposals: [
          memoryProposal({
            title: `${cap(focus)} note`,
            summary: `${entities.length} item(s) noted for ${focus}.`,
            evidence,
            payload: { focus },
          }),
        ],
      };
    },
  };
}

/* ── skill pairs + worker composition ────────────────────────────────────────
 * A `SkillPair` keeps a skill's DECLARATION (what the worker advertises + the
 * scopes it needs) in lockstep with its IMPLEMENTATION, so the two can never
 * drift. `composeWorker` derives the worker's granted scopes as the exact union
 * of its skills' requirements — least privilege by construction.
 */
export interface SkillPair {
  decl: WorkerSkill;
  impl: SkillImpl;
}

/** Read-only advisory review. */
export function advisoryPair(id: string, noun: string): SkillPair {
  return {
    decl: {
      id,
      title: `Review ${noun}`,
      description: `Produce an evidence-grounded ${noun} review (read-only).`,
      sideEffects: false,
      requires: ['read:entities', 'read:timeline'],
    },
    impl: advisorySkill(id, noun),
  };
}

/** Governed draft brief (propose:draft → always approval-gated). */
export function draftPair(id: string, focus: string): SkillPair {
  return {
    decl: {
      id,
      title: `${cap(focus)} brief`,
      description: `Draft a ${focus} brief for review (requires approval).`,
      sideEffects: true,
      requires: ['read:entities', 'read:timeline', 'propose:draft'],
    },
    impl: draftSkill(id, focus),
  };
}

/** Governed memory note (write:memory → approval-gated below the trust floor). */
export function notePair(id: string, focus: string): SkillPair {
  return {
    decl: {
      id,
      title: `${cap(focus)} note`,
      description: `Record a ${focus} note in memory (requires approval).`,
      sideEffects: true,
      requires: ['read:entities', 'write:memory'],
    },
    impl: noteSkill(id, focus),
  };
}

/** Executable Microsoft 365 mail action (m365 mail.send → approval + confirmation gated). */
export function mailPair(id: string, verb: string): SkillPair {
  return {
    decl: {
      id,
      title: verb,
      description: `${verb} through Microsoft 365 (approval + confirmation gated).`,
      sideEffects: true,
      requires: ['read:timeline', 'execute:action'],
    },
    impl: execSkill({
      id,
      verb,
      executor: 'm365',
      target: 'microsoft-entra',
      actionId: 'mail.send',
      required: ['to', 'subject', 'body'],
      // `to` is a recipient LIST — the M365 executor reads it via strArr (string[]).
      arrayKeys: ['to'],
      refKey: 'subject',
    }),
  };
}

/** Executable infrastructure action bound to a real InfraActionExecutor action. */
export interface InfraPairSpec {
  id: string;
  verb: string;
  target: string;
  accountId?: string;
  actionId: string;
  required: string[];
  optional?: string[];
  refKey: string;
}

export function infraPair(spec: InfraPairSpec): SkillPair {
  return {
    decl: {
      id: spec.id,
      title: spec.verb,
      description: `${spec.verb} through the governed infrastructure executor (approval + confirmation gated).`,
      sideEffects: true,
      requires: ['read:timeline', 'execute:action'],
    },
    impl: execSkill({
      id: spec.id,
      verb: spec.verb,
      executor: 'infra',
      target: spec.target,
      accountId: spec.accountId,
      actionId: spec.actionId,
      required: spec.required,
      optional: spec.optional,
      refKey: spec.refKey,
    }),
  };
}

/** The exact union of scopes a set of skills requires — the worker's grants. */
export function grantsOf(pairs: SkillPair[]): WorkerPermissionScope[] {
  return [...new Set(pairs.flatMap((p) => p.decl.requires))];
}

/** Compose a validated worker from skill pairs, with least-privilege grants. */
export function composeWorker(args: {
  id: string;
  name: string;
  role: WorkerRole;
  goals: string[];
  pairs: SkillPair[];
  memoryScope?: MemoryScope;
  trustScore?: number;
}): WorkerDefinition {
  const worker = buildWorker({
    id: args.id,
    name: args.name,
    role: args.role,
    goals: args.goals,
    grants: grantsOf(args.pairs),
    memoryScope: args.memoryScope,
    trustScore: args.trustScore,
    skills: args.pairs.map((p) => p.decl),
  });
  return defineWorker(worker, args.pairs.map((p) => p.impl));
}

/** Declarative spec for an executable skill bound to an existing executor action. */
export interface ExecSpec {
  id: string;
  /** Imperative verb phrase, e.g. "Stop EC2 instance". */
  verb: string;
  executor: ExecutorKind;
  /** infra: platformId · m365: connectorId. */
  target: string;
  /** account/subscription scope; omitted → the composition root defaults it. */
  accountId?: string;
  actionId: string;
  /** Input keys that MUST be supplied (become required action params). */
  required: string[];
  /** Input keys carried through when present. */
  optional?: string[];
  /**
   * Keys whose action param is a string ARRAY (e.g. M365 `mail.send` `to`, which
   * the executor reads via `strArr`). Input may be an array or a delimited string
   * (comma/semicolon); it is normalised to a trimmed, non-empty `string[]`.
   */
  arrayKeys?: string[];
  /** Which resolved param labels the action for the operator. */
  refKey: string;
}

/** Normalise an input value to a non-empty string[] (array or delimited string), or null. */
function resolveArray(v: unknown): string[] | null {
  const arr = Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : typeof v === 'string'
      ? v.split(/[,;]/)
      : [];
  const cleaned = arr.map((s) => s.trim()).filter((s) => s !== '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Build an executable skill. It reads the target resource from the job `input`
 * (the runtime passes `job.input` straight through), grounds on recent timeline
 * events, and returns a single governed execution proposal. If a required field
 * is missing it returns an honest empty result rather than a malformed binding.
 */
export function execSkill(spec: ExecSpec): SkillImpl {
  const arrayKeys = new Set(spec.arrayKeys ?? []);
  return {
    id: spec.id,
    run: (ctx, input) => {
      const params: Record<string, unknown> = {};
      for (const k of spec.required) {
        if (arrayKeys.has(k)) {
          const arr = resolveArray(input[k]);
          if (!arr) return emptyResult(`Specify "${k}" to ${spec.verb.toLowerCase()}.`);
          params[k] = arr;
        } else {
          const v = input[k];
          if (typeof v !== 'string' || v.trim() === '') {
            return emptyResult(`Specify "${k}" to ${spec.verb.toLowerCase()}.`);
          }
          params[k] = v.trim();
        }
      }
      for (const k of spec.optional ?? []) {
        if (arrayKeys.has(k)) {
          const arr = resolveArray(input[k]);
          if (arr) params[k] = arr;
        } else {
          const v = input[k];
          if (typeof v === 'string' && v.trim() !== '') params[k] = v.trim();
        }
      }
      const refVal = params[spec.refKey];
      const ref = Array.isArray(refVal) ? refVal.join(', ') : String(refVal ?? spec.target);
      const events = ctx.data.events.slice(0, 5);
      const evidence: ActionEvidence[] = [ev('resource', ref), ...evFromEvents(events)];
      const binding: ExecutionBinding = {
        executor: spec.executor,
        target: spec.target,
        ...(spec.accountId ? { accountId: spec.accountId } : {}),
        actionId: spec.actionId,
        params,
      };
      return {
        summary: `Prepared to ${spec.verb.toLowerCase()} "${ref}" — requires approval.`,
        evidence,
        grounded: events.length > 0,
        proposals: [
          executionProposal({
            title: `${spec.verb}: ${ref}`,
            summary: `${spec.verb} through the governed ${spec.executor} executor (approval + confirmation gated).`,
            evidence,
            binding,
            payload: { ...params },
          }),
        ],
      };
    },
  };
}
