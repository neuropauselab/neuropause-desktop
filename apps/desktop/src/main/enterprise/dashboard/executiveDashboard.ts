/**
 * The Executive Dashboard aggregator. Rolls every layer of the platform — the
 * organization runtime, the AI workforce, business activity, governance, the
 * intelligence layer, and operations — into one live {@link ExecutiveSnapshot}.
 *
 * Pure and electron-free: every number is computed from the inputs. Where a
 * value is a composite (the org health score), the derivation is explicit.
 */
import type {
  BusinessActivitySummary,
  ComplianceFinding,
  ExecutiveSnapshot,
  Job,
  OperationsSummary,
  Organization,
  OrgUnit,
  OrgUser,
  Recommendation,
  RiskItem,
  WorkerSummary,
} from '@neuropause/shared';

export interface ExecutiveInput {
  workspaceId: string;
  org: Organization;
  units: OrgUnit[];
  users: OrgUser[];
  workers: WorkerSummary[];
  jobs: Job[];
  findings: ComplianceFinding[];
  recommendations: Recommendation[];
  briefingHeadline: string;
  briefingGrounded: boolean;
  activity: BusinessActivitySummary;
  operations: OperationsSummary;
  now?: string;
}

export function computeExecutiveSnapshot(input: ExecutiveInput): ExecutiveSnapshot {
  const now = input.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();

  /* organization health */
  const humans = input.users.filter((u) => u.kind === 'human');
  const aiUsers = input.users.filter((u) => u.kind === 'ai_worker');
  const unitsWithLead = input.units.filter((u) => u.leadUserId).length;
  const leadershipCoverage = input.units.length > 0 ? unitsWithLead / input.units.length : 1;

  const ailing = input.workers.filter((w) => w.healthState === 'degraded' || w.healthState === 'unhealthy').length;
  const workerHealthShare = input.workers.length > 0 ? (input.workers.length - ailing) / input.workers.length : 1;

  const evaluated = input.findings.length;
  const passed = input.findings.filter((f) => f.status === 'pass').length;
  const compliancePass = evaluated > 0 ? passed / evaluated : 1;

  const healthScore = 0.4 * workerHealthShare + 0.3 * compliancePass + 0.3 * leadershipCoverage;
  const healthLabel = healthScore >= 0.85 ? 'Healthy' : healthScore >= 0.6 ? 'Watch' : 'At risk';

  /* workforce */
  const succeeded = input.jobs.filter((j) => j.status === 'succeeded').length;
  const failed = input.jobs.filter((j) => j.status === 'failed').length;
  const terminal = succeeded + failed;
  const trust = input.workers.length
    ? input.workers.reduce((a, w) => a + w.trustScore, 0) / input.workers.length
    : 0;

  /* approvals */
  let pending = 0;
  let approvedRecently = 0;
  let rejectedRecently = 0;
  let oldestPendingAt: number | null = null;
  for (const j of input.jobs) {
    for (const p of j.proposals) {
      if (p.verdict.decision === 'require_approval' && !p.approval) {
        pending += 1;
        const t = new Date(j.createdAt).getTime();
        if (oldestPendingAt === null || t < oldestPendingAt) oldestPendingAt = t;
      } else if (p.approval?.decision === 'approved') approvedRecently += 1;
      else if (p.approval?.decision === 'rejected') rejectedRecently += 1;
    }
  }

  /* risk from compliance findings */
  const nonPass = input.findings.filter((f) => f.status !== 'pass');
  const criticalFindings = input.findings.filter((f) => f.status === 'fail').length;
  const items: RiskItem[] = nonPass
    .slice()
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 6)
    .map((f) => ({ id: f.ruleId, severity: f.severity, title: f.ruleName, detail: f.detail, evidence: f.evidence }));
  const riskLevel: 'low' | 'elevated' | 'high' = criticalFindings > 0 ? 'high' : nonPass.length > 0 ? 'elevated' : 'low';

  /* intelligence */
  const topRecommendations = input.recommendations
    .slice()
    .sort((a, b) => b.score - a.score || priorityRank(b.priority) - priorityRank(a.priority))
    .slice(0, 3)
    .map((r) => ({ id: r.id, title: r.title, priority: r.priority }));

  return {
    generatedAt: now,
    workspaceId: input.workspaceId,
    organization: {
      organizationId: input.org.id,
      organizationName: input.org.name,
      userCount: input.users.length,
      humanCount: humans.length,
      workerCount: aiUsers.length,
      unitCount: input.units.length,
      leadershipCoverage,
      healthScore,
      healthLabel,
    },
    workforce: {
      total: input.workers.length,
      idle: input.workers.filter((w) => w.lifecycle === 'idle').length,
      running: input.workers.filter((w) => w.lifecycle === 'running').length,
      healthy: input.workers.filter((w) => w.healthState === 'healthy').length,
      degraded: input.workers.filter((w) => w.healthState === 'degraded').length,
      unhealthy: input.workers.filter((w) => w.healthState === 'unhealthy').length,
      unknown: input.workers.filter((w) => w.healthState === 'unknown').length,
      averageTrust: trust,
      jobsRun: input.jobs.length,
      successRate: terminal > 0 ? succeeded / terminal : 1,
    },
    activity: input.activity,
    risk: {
      level: riskLevel,
      openFindings: nonPass.length,
      criticalFindings,
      items,
    },
    approvals: {
      pending,
      approvedRecently,
      rejectedRecently,
      oldestPendingAgeMs: oldestPendingAt === null ? null : Math.max(0, nowMs - oldestPendingAt),
    },
    intelligence: {
      headline: input.briefingHeadline,
      recommendationCount: input.recommendations.length,
      topRecommendations,
      grounded: input.briefingGrounded,
    },
    operations: input.operations,
  };
}

function severityRank(s: ComplianceFinding['severity']): number {
  return s === 'critical' ? 3 : s === 'warning' ? 2 : 1;
}

function priorityRank(p: Recommendation['priority']): number {
  return p === 'high' ? 3 : p === 'normal' ? 2 : 1;
}
