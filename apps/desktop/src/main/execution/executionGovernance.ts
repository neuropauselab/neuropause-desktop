/**
 * Execution governance gate — puts the existing Governance Runtime on the
 * ExecuteEngine's path.
 *
 * Background: `evaluateAction` (workforce/governance/policyEngine.ts) gates worker
 * proposals — permission, trust, evidence, policy, most-restrictive wins. It is
 * reached from exactly one place, `workforce/runtime/executor.ts`. The
 * ExecuteEngine, which dispatches automation, founder AI and every other
 * subsystem, never calls it: `execute:run` is RBAC-gated at the IPC bridge
 * (`ipc/runtimeAuthz.ts` — MAY THIS USER call the channel) but no policy verdict
 * is taken on the action itself (IS THIS ACTION permitted).
 *
 * This module closes that gap and introduces NO new decision logic. `evaluate` is
 * injected — the caller passes the same `evaluateAction` the workforce path uses,
 * so there is one decision core, not two.
 *
 * Three deliberate choices, all reviewable:
 *
 *  1. `EXECUTION_KIND_PROFILE` is a total `Record<ExecutionKind, …>`, mirroring
 *     `withRuntimeAuthz`'s throw-on-unclassified philosophy at the type level: a
 *     new `ExecutionKind` will not compile until it is classified here.
 *  2. `require_approval` + `req.confirmed === true` resolves to allow. `confirmed`
 *     is the in-process flag the trusted dispatcher sets only after a human
 *     approval (see types/executeEngine.ts) — the renderer cannot supply it. This
 *     reuses the approval path that already exists rather than inventing a second.
 *  3. The principal's `trustScore` is SUPPLIED BY THE COMPOSITION ROOT, not
 *     measured. For a single-user desktop the owner is the operator of their own
 *     machine and 1 is the honest value; it must not be described as a measured
 *     trust signal. Multi-tenant callers pass a real one.
 *
 * Pure: no Electron, no I/O, no clock of its own. Unit-tests from synthetic input.
 */
import type {
  ActionEvidence,
  ActionRequest,
  ExecutionKind,
  ExecutionRequest,
  GovernanceVerdict,
  PolicyRule,
  RiskLevel,
  Worker,
  WorkerPermissionScope,
  WorkerRole,
} from '@neuropause/shared';

/** What executing a kind actually does, in the terms the policy engine speaks. */
export interface ExecutionKindProfile {
  /** Does running it change anything outside the process? */
  sideEffects: boolean;
  risk: RiskLevel;
  /** Scopes the execution exercises — checked against the principal's grants. */
  permissions: WorkerPermissionScope[];
}

/**
 * Every `ExecutionKind` classified. A total Record, so adding a kind to the union
 * without classifying it here is a compile error rather than an ungoverned path.
 *
 * Risk is assigned by what the kind can DO, not by how often it is used:
 * read-shaped kinds are low and side-effect-free; anything that dispatches work,
 * mutates stored state, or drives a runtime is side-effecting and at least medium.
 */
export const EXECUTION_KIND_PROFILE: Record<ExecutionKind, ExecutionKindProfile> = {
  // Free-form task text handed to an executor — it can reach tools, so it acts.
  task: { sideEffects: true, risk: 'medium', permissions: ['execute:action'] },
  // Re-drives the workforce runtime. The IPC classification already calls this
  // the priority finding; it takes the strongest profile.
  worker: { sideEffects: true, risk: 'high', permissions: ['execute:action'] },
  // Runs an automation rule — arbitrary configured side effects.
  automation: { sideEffects: true, risk: 'high', permissions: ['execute:action'] },
  // Acts on a decision record (status change, follow-on action).
  decision: { sideEffects: true, risk: 'medium', permissions: ['execute:action'] },
  // Multi-step orchestration; at least as strong as its strongest step.
  workflow: { sideEffects: true, risk: 'high', permissions: ['execute:action'] },
  // Memory writes/erases — durable state the org later relies on.
  memory: { sideEffects: true, risk: 'medium', permissions: ['write:memory'] },
  // Reaches an external system through a connector. Leaves the machine.
  connector: { sideEffects: true, risk: 'high', permissions: ['execute:action'] },
  // Voice turn — transcript in, dispatch out; treated as the task it becomes.
  voice: { sideEffects: true, risk: 'medium', permissions: ['execute:action'] },
  // Runtime control (launch/stop/restart an app runtime).
  runtime: { sideEffects: true, risk: 'high', permissions: ['execute:action'] },
  // Executive analysis over the org corpus — reads broadly, writes nothing.
  executive: { sideEffects: false, risk: 'low', permissions: ['read:entities'] },
};

/** Who is executing. Supplied by the composition root; never inferred here. */
export interface ExecutionPrincipal {
  id: string;
  role: WorkerRole;
  /** 0..1. A SUPPLIED value, not a measurement — see the module note. */
  trustScore: number;
  grantedScopes: readonly WorkerPermissionScope[];
}

export interface ExecutionGateDeps {
  /** The existing decision core. Pass `evaluateAction` — do not reimplement it. */
  evaluate: (
    req: ActionRequest,
    input: { worker: Worker; policies: PolicyRule[]; now: string },
  ) => GovernanceVerdict;
  principal: () => ExecutionPrincipal;
  policies: () => PolicyRule[];
  now?: () => string;
  newId?: () => string;
}

export interface ExecutionDecision {
  allowed: boolean;
  verdict: GovernanceVerdict;
  /** One line fit for a user-visible error and for the audit record. */
  reason: string;
}

export type ExecutionGate = (req: ExecutionRequest) => ExecutionDecision;

/**
 * Build the `Worker` shape the decision core expects from a principal. This is an
 * ADAPTER, not a fabricated worker: identity and scopes come from the principal,
 * and the fields the core does not read for this path are left empty rather than
 * filled with plausible-looking values.
 */
function principalAsWorker(p: ExecutionPrincipal, at: string): Worker {
  return {
    identity: {
      id: p.id,
      name: p.id,
      role: p.role,
      version: '1',
      developer: 'neuropause',
    },
    goals: [],
    skills: [],
    permissions: p.grantedScopes.map((scope) => ({ scope, granted: true })),
    memoryScope: 'org',
    policyIds: [],
    trustScore: p.trustScore,
    lifecycle: 'running',
    health: {
      state: 'unknown',
      lastCheckAt: null,
      successRate: 0,
      jobsRun: 0,
      jobsFailed: 0,
      message: null,
    },
    createdAt: at,
    updatedAt: at,
    builtIn: true,
    metadata: { source: 'execution-gate' },
  };
}

/**
 * Evidence for an execution request. An execution grounded in a specific target
 * carries that reference; a free-form one carries none — and the evidence check
 * then does its job for side-effecting kinds rather than being handed a
 * decorative placeholder.
 */
function evidenceFor(req: ExecutionRequest): ActionEvidence[] {
  return req.targetId ? [{ kind: req.kind, id: req.targetId }] : [];
}

export function createExecutionGate(deps: ExecutionGateDeps): ExecutionGate {
  const now = deps.now ?? ((): string => new Date().toISOString());
  let seq = 0;
  const newId = deps.newId ?? ((): string => `exec-req-${Date.now()}-${seq++}`);

  return (req: ExecutionRequest): ExecutionDecision => {
    const profile = EXECUTION_KIND_PROFILE[req.kind];
    const principal = deps.principal();
    const at = now();

    const action: ActionRequest = {
      id: newId(),
      workerId: principal.id,
      workerRole: principal.role,
      skillId: `execute:${req.kind}`,
      title: req.label ?? `Execute ${req.kind}`,
      summary: req.input ?? '',
      sideEffects: profile.sideEffects,
      permissions: profile.permissions,
      risk: profile.risk,
      evidence: evidenceFor(req),
      payload: { kind: req.kind, ...(req.targetId ? { targetId: req.targetId } : {}) },
      requestedAt: at,
    };

    const verdict = deps.evaluate(action, {
      worker: principalAsWorker(principal, at),
      policies: deps.policies(),
      now: at,
    });

    if (verdict.decision === 'allow') {
      return { allowed: true, verdict, reason: 'Permitted by governance.' };
    }
    if (verdict.decision === 'require_approval' && req.confirmed === true) {
      // A human already approved this through the trusted dispatcher.
      return { allowed: true, verdict, reason: 'Approved by a human before execution.' };
    }
    const detail = verdict.reasons[0] ?? 'No reason recorded.';
    return {
      allowed: false,
      verdict,
      reason:
        verdict.decision === 'require_approval'
          ? `Requires human approval before it can run: ${detail}`
          : `Blocked by governance: ${detail}`,
    };
  };
}
