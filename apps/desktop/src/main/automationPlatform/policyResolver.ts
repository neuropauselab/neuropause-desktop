/**
 * Phase 6 Stage 8 — policy resolution (D-4). Pure composition:
 *
 *   approval chains (EXISTING governance)  →  requiredApprovals
 *   global-gov autonomous allows (P19's own derivation, reused verbatim)
 *   + registry policy defaults (windows / retry / escalation / connectors)
 *   + the honest rollback plan
 *
 * THE INVARIANT (Principle C, reused not reimplemented): auto-execution is
 * possible ONLY when `computeAutoExecutable` — the P19 function — says so AND
 * the policy defaults do not override it. Governance always wins; the default
 * is always approval-required. This module never executes and never persists.
 */
import type {
  ApprovalChain,
  ApprovalPreview,
  AutomationPolicyResolution,
  OpsApprovalRequirement,
  PlaybookDefinition,
  PolicyDefaults,
  RollbackAvailability,
} from '@neuropause/shared';
// The P19 invariant, reused verbatim (audit D-4): explicit allow AND ungoverned,
// default false — autonomous execution is never assumed.
import { computeAutoExecutable } from '../autonomousOps/autoOpsModel';

/** Chains (enabled, matching the trigger) → the reused approval-requirement shape. */
export function approvalsForTrigger(trigger: string, chains: readonly ApprovalChain[]): OpsApprovalRequirement[] {
  const governing = chains.filter((c) => c.enabled && c.appliesTo === trigger);
  if (governing.length === 0) return [{ trigger, governed: false, chainName: null, steps: 0 }];
  return governing.map((c) => ({ trigger, governed: true, chainName: c.name, steps: c.steps.length }));
}

export interface PolicyInputs {
  playbook: PlaybookDefinition | null;
  trigger: string;
  defaults: PolicyDefaults;
  chains: readonly ApprovalChain[];
  /** From the EXISTING global governance policies via P19's `deriveAutoAllowedTriggers`. */
  autoAllowedTriggers: readonly string[];
  rollback: RollbackAvailability;
  nowMs: number;
}

/** Local wall-clock window check (the delivery-engine minutes convention). */
export function windowOpenAt(defaults: PolicyDefaults, nowMs: number): boolean {
  const w = defaults.executionWindow;
  if (!w) return true;
  const d = new Date(nowMs);
  const minutes = d.getHours() * 60 + d.getMinutes();
  return w.days.includes(d.getDay()) && minutes >= w.startMinutes && minutes < w.endMinutes;
}

export function resolvePolicy(inputs: PolicyInputs): AutomationPolicyResolution {
  const requiredApprovals = approvalsForTrigger(inputs.trigger, inputs.chains);
  const p19Auto = computeAutoExecutable(inputs.trigger, requiredApprovals, [...inputs.autoAllowedTriggers]);
  const autoExecutable = p19Auto && !inputs.defaults.requiresApprovalOverride;

  const basis: string[] = [
    requiredApprovals.some((r) => r.governed)
      ? `governance chains govern '${inputs.trigger}' (${requiredApprovals.filter((r) => r.governed).length})`
      : `no enabled chain governs '${inputs.trigger}'`,
    inputs.autoAllowedTriggers.includes(inputs.trigger)
      ? `global governance explicitly allows autonomous:'${inputs.trigger}'`
      : 'no global-governance autonomous allow (default: approval required)',
    `policy defaults '${inputs.defaults.id}'${inputs.defaults.requiresApprovalOverride ? ' (forces human approval)' : ''}`,
  ];

  return {
    playbookId: inputs.playbook?.id ?? null,
    approvalTrigger: inputs.trigger,
    requiredApprovals,
    autoExecutable,
    allowedConnectors: inputs.defaults.allowedConnectors,
    executionWindow: inputs.defaults.executionWindow,
    windowOpenNow: windowOpenAt(inputs.defaults, inputs.nowMs),
    retry: inputs.defaults.retry,
    escalation: inputs.defaults.escalation,
    rollback: inputs.rollback,
    basis,
  };
}

/* ── approval preview (D-6/D-9: read-only routing preview) ────────────────── */

export function previewApprovals(
  trigger: string,
  chains: readonly ApprovalChain[],
  roles: readonly { id: string; name: string }[] | null,
  autoExecutable: boolean,
): ApprovalPreview {
  const governing = chains.filter((c) => c.enabled && c.appliesTo === trigger);
  const chain = governing.length > 0 ? governing[0] : null;
  const roleName = (roleId: string): string | null => roles?.find((r) => r.id === roleId)?.name ?? null;
  return {
    trigger,
    governed: chain !== null,
    chainName: chain?.name ?? null,
    steps: chain
      ? [...chain.steps]
          .sort((a, b) => a.order - b.order)
          .map((s) => ({ order: s.order, name: s.name, roleId: s.roleId, roleName: roleName(s.roleId) }))
      : [],
    autoExecutable,
    note: chain
      ? `Governed by "${chain.name}" — ${chain.steps.length} approval step(s); governance always wins.`
      : autoExecutable
        ? 'Ungoverned trigger with an explicit global-governance autonomous allow.'
        : 'Ungoverned trigger; the default remains human approval (nothing auto-executes).',
  };
}
