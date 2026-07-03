/**
 * Engineering AI — the reasoning service behind the Engineering tab.
 *
 * It does NOT replace the deterministic facts; it layers narrative on top. Flow:
 * gather deterministic engineering facts (from the briefing), assemble context via
 * the Context Builder, run the AI Engine for the synthesis (Root Cause / Risk /
 * Recommended Action / Business Impact), then run a governance gate before the
 * result is shown. When no model is reachable (or a call errors) the engine's
 * fallback yields grounded:false, so the AI fields are null and `aiOffline` is set
 * — the facts still render. Pure: every dependency is injected, so it unit-tests
 * electron-free.
 */
import type {
  AiContextItem,
  AiContextSource,
  AiEngineRequest,
  AiEngineResponse,
  Briefing,
  EngineeringAnalysis,
  EngineeringFact,
  GovernanceView,
} from '@neuropause/shared';
import type { ContextRequest } from './contextBuilder';

export interface EngineeringAnalyzeRequest {
  subject?: string;
  now?: string;
}

export interface GovernanceInput {
  grounded: boolean;
  recommendedAction: string | null;
  contextSources: AiContextSource[];
}

export interface EngineeringAIDeps {
  buildContext: (req: ContextRequest) => AiContextItem[];
  run: (req: AiEngineRequest) => Promise<AiEngineResponse>;
  deterministicFacts: () => EngineeringFact[];
  /** Governance gate run before display; defaults to the read-only gate below. */
  governance?: (input: GovernanceInput) => GovernanceView;
  now?: () => string;
}

/** Verbs whose presence in a recommendation implies an external, side-effecting action. */
const ACTION_VERBS = [
  'merge',
  'deploy',
  'delete',
  'revert',
  'rollback',
  'roll back',
  'push',
  'release',
  'disable',
  'restart',
  'rerun',
  're-run',
  'force',
];

export function classifyRequiresApproval(action: string | null): boolean {
  if (!action) return false;
  const a = action.toLowerCase();
  return ACTION_VERBS.some((v) => a.includes(v));
}

/**
 * Default governance gate. Engineering AI output is read-only analysis — nothing
 * is executed — so display is always allowed; but if the recommendation implies an
 * external action, that is flagged as advisory-only and requiring human approval.
 */
export function defaultGovernance(input: GovernanceInput): GovernanceView {
  const requiresApproval = classifyRequiresApproval(input.recommendedAction);
  const reasoning = !input.grounded
    ? 'No model was reachable; showing deterministic facts only. No external action is performed.'
    : requiresApproval
      ? 'Read-only analysis. The recommendation implies an external action, which is advisory only and requires explicit human approval before anything is performed.'
      : 'Read-only analysis. No external action is performed; recommendations are advisory.';
  return { decision: 'allow', requiresApproval, reasoning, sourceSystems: input.contextSources };
}

const DEFAULT_QUERY = 'engineering health CI failures pull requests releases risk';

export async function analyzeEngineering(
  deps: EngineeringAIDeps,
  req: EngineeringAnalyzeRequest = {},
): Promise<EngineeringAnalysis> {
  const now = (deps.now ?? ((): string => new Date().toISOString()))();
  const facts = deps.deterministicFacts();
  const focus = req.subject?.trim();
  const subject = focus || 'all active repositories';

  const context = deps.buildContext({
    worker: 'engineering',
    query: focus || DEFAULT_QUERY,
    now,
  });

  const response = await deps.run({
    worker: 'engineering',
    promptId: 'engineering.summary',
    context,
    variables: { subject },
    tier: 'balanced',
  });

  const data = response.grounded ? response.data : null;
  const recommendedAction = readStr(data, 'recommendedAction');
  const governanceFn = deps.governance ?? defaultGovernance;

  return {
    rootCause: readStr(data, 'rootCause'),
    engineeringRisk: readStr(data, 'engineeringRisk'),
    recommendedAction,
    businessImpact: readStr(data, 'businessImpact'),
    facts,
    grounded: response.grounded,
    aiOffline: !response.grounded,
    model: response.model,
    confidence: response.confidence,
    evidence: response.evidence,
    contextSources: response.contextSources,
    governance: governanceFn({
      grounded: response.grounded,
      recommendedAction,
      contextSources: response.contextSources,
    }),
    generatedAt: now,
  };
}

function readStr(data: Record<string, unknown> | null, key: string): string | null {
  if (!data) return null;
  const v = data[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** The briefing sections that constitute deterministic engineering facts. */
const ENGINEERING_SECTIONS = new Set(['engineering_risk', 'ci_health', 'pr_health', 'release_health']);

/** Extract deterministic engineering facts from a computed briefing. */
export function engineeringFactsFromBriefing(brief: Briefing): EngineeringFact[] {
  const facts: EngineeringFact[] = [];
  for (const section of brief.sections) {
    if (!ENGINEERING_SECTIONS.has(section.id) || section.empty) continue;
    for (const item of section.items) {
      facts.push({
        label: section.title,
        text: item.detail ? `${item.text} — ${item.detail}` : item.text,
        at: item.at,
        evidence: item.evidence.map((e) => ({ kind: e.kind, id: e.id })),
      });
    }
  }
  return facts;
}
