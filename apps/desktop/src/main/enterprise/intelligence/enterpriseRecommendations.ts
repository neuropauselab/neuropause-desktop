/**
 * Enterprise recommendations (V8.5 inc2). Turns the enterprise insights snapshot
 * into ranked, actionable recommendations using the EXISTING ExecutiveRecommendation
 * type — so they merge into the Executive Center's existing recommendation list and
 * render through the existing UI. No new recommendation model, no parallel engine.
 *
 * Pure: reads only the already-derived enterprise insights (which themselves fold
 * existing signals). Each recommendation is evidence-backed by the insight values;
 * nothing here is fabricated. Recommendations are emitted only when a condition
 * actually holds, so a healthy enterprise produces none.
 */
import type { ExecutiveRecommendation, ExecRecoPriority } from '@neuropause/shared';
import type { EnterpriseInsights } from './enterpriseInsights';

const PRIORITY_RANK: Record<ExecRecoPriority, number> = { critical: 300, high: 200, medium: 100, low: 50 };
function etaForPriority(priority: ExecRecoPriority): string {
  return priority === 'critical' ? 'today' : priority === 'high' ? 'this week' : 'this month';
}
function compositeScore(priority: ExecRecoPriority, confidence: number): number {
  return Math.round(PRIORITY_RANK[priority] + confidence * 100);
}

interface Rule {
  id: string;
  metric: string;
  icon: string;
  when: (e: EnterpriseInsights) => boolean;
  priority: (e: EnterpriseInsights) => ExecRecoPriority;
  confidence: number;
  problem: (e: EnterpriseInsights) => string;
  businessImpact: string;
  rootCause: string;
  expectedOutcome: string;
  recommendedAction: string;
  owner: string;
  sourceSystems: string[];
  evidence: (e: EnterpriseInsights) => string[];
}

const RULES: Rule[] = [
  {
    id: 'enterprise-knowledge-gap',
    metric: 'knowledge',
    icon: 'sparkles',
    when: (e) => e.knowledgeTopics > 0 && e.knowledgeCoveragePercent < 40,
    priority: (e) => (e.knowledgeCoveragePercent < 20 ? 'high' : 'medium'),
    confidence: 0.7,
    problem: (e) => `Only ${e.knowledgeCoveragePercent}% of memories are connected into topics.`,
    businessImpact: 'Disconnected knowledge is hard to recall and reuse, reducing the value of captured work.',
    rootCause: 'Many memories share no entities with others, so they remain orphaned from any topic.',
    expectedOutcome: 'Higher knowledge coverage and more useful cross-memory recall.',
    recommendedAction: 'Review orphaned memories and tag or link them to existing projects and people.',
    owner: 'operations',
    sourceSystems: ['knowledge', 'memory'],
    evidence: (e) => [`${e.knowledgeOrphans} orphaned memories`, `${e.knowledgeTopics} topics`],
  },
  {
    id: 'enterprise-workforce-bottleneck',
    metric: 'workforce',
    icon: 'gauge',
    when: (e) => e.workforceBottlenecks > 0,
    priority: (e) => (e.workforceBottlenecks >= 3 ? 'high' : 'medium'),
    confidence: 0.8,
    problem: (e) => `${e.workforceBottlenecks} workforce bottleneck${e.workforceBottlenecks === 1 ? '' : 's'} detected.`,
    businessImpact: 'Bottlenecks slow goal completion and concentrate risk on a few workers or skills.',
    rootCause: 'High failure rates, backlogs, or ungrounded runs in specific workers or skills.',
    expectedOutcome: 'Balanced workload and restored throughput.',
    recommendedAction: 'Open the Workforce Analytics dashboard and address the flagged workers and skills.',
    owner: 'operations',
    sourceSystems: ['workforce'],
    evidence: (e) => [`${e.workforceJobs} jobs`, `${e.workforceActiveWorkers} active workers`],
  },
  {
    id: 'enterprise-workforce-success',
    metric: 'workforce',
    icon: 'shield',
    when: (e) => e.workforceJobs > 0 && e.workforceSuccessPercent < 50 && e.workforceBottlenecks === 0,
    priority: () => 'high',
    confidence: 0.75,
    problem: (e) => `Workforce success rate is ${e.workforceSuccessPercent}%.`,
    businessImpact: 'Low success rates waste compute and erode trust in automated work.',
    rootCause: 'A large share of decided jobs are failing across the workforce.',
    expectedOutcome: 'Higher success rate and more reliable automated output.',
    recommendedAction: 'Investigate common failure causes in recent jobs and adjust the affected skills.',
    owner: 'engineering',
    sourceSystems: ['workforce'],
    evidence: (e) => [`${e.workforceSuccessPercent}% success`, `${e.workforceJobs} jobs`],
  },
];

export function enterpriseRecommendations(insights: EnterpriseInsights): ExecutiveRecommendation[] {
  const out: ExecutiveRecommendation[] = [];
  for (const r of RULES) {
    if (!r.when(insights)) continue;
    out.push({
      id: r.id,
      metric: r.metric,
      icon: r.icon,
      problem: r.problem(insights),
      businessImpact: r.businessImpact,
      rootCause: r.rootCause,
      priority: r.priority(insights),
      confidence: r.confidence,
      expectedOutcome: r.expectedOutcome,
      evidence: r.evidence(insights),
      sourceSystems: r.sourceSystems,
      recommendedAction: r.recommendedAction,
      owner: r.owner,
      eta: etaForPriority(r.priority(insights)),
      status: 'open',
      score: compositeScore(r.priority(insights), r.confidence),
    });
  }

  // Highest priority first (stable within a priority).
  const rank: Record<ExecRecoPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  out.sort((a, b) => rank[a.priority] - rank[b.priority]);
  return out;
}
