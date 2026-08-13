/**
 * Intent Experience Program v2.0 — the intent-native experience composition root.
 *
 * The READ-ONLY reprojection LAYER that turns the EXISTING P14 strategic goals into user outcomes ("intents").
 * It composes a snapshot from ONE real source — `strategyOverview()` — reading its GoalManager (goals +
 * objectives + milestones + dependencies + evidence), its Planning-Engine plan steps (the real next action +
 * governance approval for each not-on-track goal), its category-linked strategic decisions, and its Reasoning
 * confidence. It imports NO mutator; it reads and reprojects only. It creates no new store/runtime and reuses
 * `ecosystem:event` for renderer liveness; every read is defensively wrapped so a failing source degrades
 * rather than crashes the projection. Nothing here executes, approves, or mutates, and nothing is fabricated
 * — a goal with no plan step yields a null next action, not an invented one.
 */
import {
  EmptyRequest,
  IpcChannel,
  type IntentApproval,
  type IntentDecisionLink,
  type StrategyOverview,
  type StrategyPriority,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { connectorService } from '../connectors/connectorService';
import { jobStore } from '../workforce/runtime/jobInstance';
import { IntentService } from './intentService';
import type { IntentBand } from '@neuropause/shared';
import type { IntentGoalInput, IntentState } from './intentModel';
import { withIntentAuthz } from './intentAuthz';
import { activeTenantScope } from '../enterprise/index';

const log = createLogger('intent');

export interface IntentDeps {
  /** The single real source: the P14 strategy overview (goals/planning/decisions/reasoning). */
  strategyOverview: () => StrategyOverview;
}

export interface IntentSubsystem {
  handlers: SecureHandlerDef[];
  service: IntentService;
  dispose: () => void;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Strategy decision priority → display band. */
function priorityBand(p: StrategyPriority): IntentBand {
  return p === 'critical' ? 'critical' : p === 'high' ? 'at-risk' : p === 'medium' ? 'watch' : 'healthy';
}

/** Real StrategyApprovalRequirement → the intent-layer approval shape (or null when absent). */
function toApproval(req: StrategyOverview['planning']['horizons'][number]['steps'][number]['requiredApproval'] | undefined): IntentApproval | null {
  if (!req) return null;
  return { governed: req.governed, chainName: req.chainName, steps: req.steps, note: req.note };
}

/** Compose the intent snapshot from the EXISTING P14 strategy signals (no new store/runtime). */
function buildState(deps: IntentDeps): IntentState {
  const generatedAt = new Date(Date.now()).toISOString();
  const overview = safe(() => deps.strategyOverview());

  const goals = overview?.goals?.goals ?? [];
  const reasoningConfidence = overview?.reasoning?.confidence ?? 0;

  // ── Real next-action per goal: the Planning-Engine plan step (id = `plan-<goalId>`). ──
  const planByGoal = new Map<string, IntentGoalInput['nextAction']>();
  for (const horizon of overview?.planning?.horizons ?? []) {
    for (const step of horizon.steps ?? []) {
      const goalId = step.id.replace(/^plan-/, '');
      planByGoal.set(goalId, { label: step.label, action: step.action, approval: toApproval(step.requiredApproval), evidence: [...(step.evidence ?? [])] });
    }
  }

  // ── Real strategic decisions, linked to intents by shared GoalCategory. ──
  const decisionsByCategory = new Map<string, IntentDecisionLink[]>();
  for (const d of overview?.decisions?.decisions ?? []) {
    const link: IntentDecisionLink = {
      id: d.id,
      title: d.title,
      recommendation: d.recommendation,
      confidence: d.confidence,
      priority: d.priority,
      band: priorityBand(d.priority),
      requiresApproval: (d.requiredApprovals ?? []).length > 0,
    };
    const list = decisionsByCategory.get(d.category) ?? [];
    list.push(link);
    decisionsByCategory.set(d.category, list);
  }

  const intents: IntentGoalInput[] = goals.map((g) => ({
    id: g.id,
    category: g.category,
    name: g.name,
    description: g.description,
    horizon: g.horizon,
    successMetric: g.successMetric,
    target: g.target,
    current: g.current,
    unit: g.unit,
    progress: g.progress,
    status: g.status,
    objectives: (g.objectives ?? []).map((o) => ({ id: o.id, label: o.label, metric: o.metric, current: o.current, target: o.target, unit: o.unit, progress: o.progress, status: o.status })),
    dependencies: [...(g.dependencies ?? [])],
    milestones: (g.milestones ?? []).map((m) => ({ id: m.id, label: m.label, horizon: m.horizon, status: m.status })),
    evidence: [...(g.evidence ?? [])],
    nextAction: planByGoal.get(g.id) ?? null,
    relatedDecisions: decisionsByCategory.get(g.category) ?? [],
  }));

  return { generatedAt, reasoningConfidence, intents };
}

export function initIntent(deps: IntentDeps): IntentSubsystem {
  const service = new IntentService({ scope: activeTenantScope, readState: () => buildState(deps) });

  // Invalidate the memoized snapshot when a backing store changes; the injected strategyOverview accessor
  // refreshes via its own TTL (workforce success + connector health feed the goals). Renderer liveness
  // reuses `ecosystem:event`.
  const invalidate = (): void => service.invalidate();
  jobStore.on('changed', invalidate);
  connectorService.on('event', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.IntentBoard, schema: EmptyRequest, handler: () => service.board() },
    { channel: IpcChannel.IntentWorkspaces, schema: EmptyRequest, handler: () => service.workspaces() },
    { channel: IpcChannel.IntentGovernance, schema: EmptyRequest, handler: () => service.governance() },
  ];
  const handlers = withIntentAuthz(rawHandlers);

  const dispose = (): void => {
    jobStore.off('changed', invalidate);
    connectorService.off('event', invalidate);
  };

  log.info('Intent-native experience ready', { intents: safe(() => service.board().intents.length) ?? 0 });
  return { handlers, service, dispose };
}
