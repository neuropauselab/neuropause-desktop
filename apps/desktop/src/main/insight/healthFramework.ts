/**
 * Phase 6 Stage 6 (D-3) — the unified Enterprise Health Framework.
 *
 * COMPOSES the eight health signals the platform already computes — it never
 * recomputes one: organization (computeOrgHealth scores), departments (org
 * units + leadership coverage), projects (UDM backlog stats), workflows
 * (timeline workflow.* outcomes), automations (AutomationMonitor), AI
 * (summarizeWorkforceHealth + system health), connectors (per-connector
 * health), approvals (job-store queue). Every domain carries its explanation,
 * its evidence references, and a declared confidence — low confidence is
 * stated explicitly, and an unavailable source produces an unavailable domain,
 * never a silent 100.
 *
 * Pure + deterministic + IO-free (all reads injected).
 */
import type {
  ConfidenceBreakdown,
  ConnectorDto,
  InsightBand,
  InsightHealthDomain,
  InsightHealthFramework,
  OrgHealthScores,
  WorkforceHealthSummary,
} from '@neuropause/shared';

/* ── inputs (null = that source was unavailable) ──────────────────────────── */

export interface HealthFrameworkInput {
  nowMs: number;
  org: OrgHealthScores | null;
  orgUnits: { units: number; leadershipCoverage: number | null } | null;
  projects: { projects: number; openTasks: number; overdueTasks: number } | null;
  workflows: { completed: number; failed: number } | null;
  automation: { completed: number; failed: number; paused: number; running: number } | null;
  workforce: WorkforceHealthSummary | null;
  /** NeuroCore's last snapshot (score 0-100 + level label, display-only here). */
  system: { score: number; level: string } | null;
  connectors: Pick<ConnectorDto, 'id' | 'health' | 'configured' | 'accounts'>[] | null;
  approvals: { pending: number; oldestCreatedAt: string | null } | null;
  /** Days of health history available (0–90), for historicalCoverage. */
  historyDays: number;
  /** Reasons per failed source. */
  failures: Record<string, string>;
}

const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function bandFor(score: number): InsightBand {
  if (score >= 75) return 'healthy';
  if (score >= 50) return 'watch';
  if (score >= 25) return 'at-risk';
  return 'critical';
}

function domain(
  key: InsightHealthDomain['key'],
  label: string,
  signals: string[],
  built: {
    score: number | null;
    explanation: string[];
    evidence: string[];
    confidence: number;
    unavailable?: string | null;
  },
): InsightHealthDomain {
  const unavailable = built.unavailable ?? null;
  const confidence = round2(Math.max(0, Math.min(1, built.confidence)));
  const explanation = [...built.explanation];
  if (unavailable == null && confidence < 0.6) {
    explanation.push(`Declared at low confidence (${confidence}) — see evidence coverage.`);
  }
  return {
    key,
    label,
    score: built.score == null ? null : clamp100(built.score),
    band: built.score == null ? 'unknown' : bandFor(clamp100(built.score)),
    explanation,
    evidence: built.evidence,
    confidence,
    signals,
    unavailable,
  };
}

function unavailableDomain(
  key: InsightHealthDomain['key'],
  label: string,
  signals: string[],
  reason: string,
): InsightHealthDomain {
  return {
    key,
    label,
    score: null,
    band: 'unknown',
    explanation: [`Unavailable: ${reason}`],
    evidence: [],
    confidence: 0,
    signals,
    unavailable: reason,
  };
}

/* ── the framework ────────────────────────────────────────────────────────── */

/** Compose the eight-domain enterprise health framework. Pure. */
export function composeHealthFramework(input: HealthFrameworkInput): InsightHealthFramework {
  const domains: InsightHealthDomain[] = [];

  // 1 — organization: the EXISTING computeOrgHealth scores, verbatim.
  if (input.org) {
    domains.push(
      domain('organization', 'Organization', ['org-health'], {
        score: input.org.overall,
        explanation: [
          `Composed from the existing organization health model (overall ${input.org.overall}/100).`,
          `Sub-scores — activity ${input.org.activity}, adoption ${input.org.adoption}, engineering ${input.org.engineering}, reliability ${input.org.reliability}.`,
        ],
        evidence: [
          `orgHealth.overall=${input.org.overall}`,
          `orgHealth.activity=${input.org.activity}`,
          `orgHealth.reliability=${input.org.reliability}`,
        ],
        confidence: 0.8,
      }),
    );
  } else {
    domains.push(unavailableDomain('organization', 'Organization', ['org-health'], input.failures['organization'] ?? 'org health read failed'));
  }

  // 2 — departments: org units + leadership coverage (no per-unit metric exists
  // yet — composed from structure + the org score, declared at low confidence).
  if (input.orgUnits && input.org) {
    const coverage = input.orgUnits.leadershipCoverage;
    const score = coverage == null ? input.org.overall : input.org.overall * 0.6 + coverage * 100 * 0.4;
    domains.push(
      domain('departments', 'Departments', ['org-structure', 'org-health'], {
        score,
        explanation: [
          `${input.orgUnits.units} organizational unit(s); leadership coverage ${coverage == null ? 'unknown' : `${Math.round(coverage * 100)}%`}.`,
          'No per-unit operational metric exists yet — composed from org structure + the organization score.',
        ],
        evidence: [`org.units=${input.orgUnits.units}`, `org.leadershipCoverage=${coverage ?? 'null'}`],
        confidence: coverage == null ? 0.4 : 0.55,
      }),
    );
  } else {
    domains.push(unavailableDomain('departments', 'Departments', ['org-structure', 'org-health'], input.failures['departments'] ?? 'org structure read failed'));
  }

  // 3 — projects: UDM backlog composition (overdue share degrades health).
  if (input.projects) {
    if (input.projects.projects === 0) {
      domains.push(
        domain('projects', 'Projects', ['work-entities'], {
          score: null,
          explanation: ['No project entities are synced — connect a project source to score this domain.'],
          evidence: ['projects=0'],
          confidence: 0,
          unavailable: 'no project entities synced',
        }),
      );
    } else {
      const overdueShare = input.projects.openTasks > 0 ? input.projects.overdueTasks / input.projects.openTasks : 0;
      const score = 95 - overdueShare * 70;
      domains.push(
        domain('projects', 'Projects', ['work-entities'], {
          score,
          explanation: [
            `${input.projects.projects} project(s), ${input.projects.openTasks} open task(s), ${input.projects.overdueTasks} overdue.`,
            `Overdue share ${Math.round(overdueShare * 100)}% degrades the score from its 95 baseline.`,
          ],
          evidence: [
            `projects=${input.projects.projects}`,
            `tasks.open=${input.projects.openTasks}`,
            `tasks.overdue=${input.projects.overdueTasks}`,
          ],
          confidence: 0.7,
        }),
      );
    }
  } else {
    domains.push(unavailableDomain('projects', 'Projects', ['work-entities'], input.failures['projects'] ?? 'UDM read failed'));
  }

  // 4 — workflows: outcomes observed on the timeline window.
  if (input.workflows) {
    const total = input.workflows.completed + input.workflows.failed;
    if (total === 0) {
      domains.push(
        domain('workflows', 'Workflows', ['workflow-runs', 'timeline-events'], {
          score: null,
          explanation: ['No workflow runs observed in the timeline window.'],
          evidence: ['workflow.runs=0'],
          confidence: 0,
          unavailable: 'no workflow runs in window',
        }),
      );
    } else {
      const failShare = input.workflows.failed / total;
      domains.push(
        domain('workflows', 'Workflows', ['workflow-runs', 'timeline-events'], {
          score: 95 - failShare * 85,
          explanation: [`${total} workflow run(s) observed: ${input.workflows.completed} completed, ${input.workflows.failed} failed (${Math.round(failShare * 100)}% failure share).`],
          evidence: [`workflow.completed=${input.workflows.completed}`, `workflow.failed=${input.workflows.failed}`],
          confidence: 0.65,
        }),
      );
    }
  } else {
    domains.push(unavailableDomain('workflows', 'Workflows', ['workflow-runs', 'timeline-events'], input.failures['workflows'] ?? 'timeline read failed'));
  }

  // 5 — automations: the EXISTING AutomationMonitor rollup.
  if (input.automation) {
    const total = input.automation.completed + input.automation.failed;
    const failShare = total > 0 ? input.automation.failed / total : 0;
    domains.push(
      domain('automations', 'Automations', ['automation-runs'], {
        score: total === 0 ? 90 : 95 - failShare * 85 - Math.min(10, input.automation.paused * 2),
        explanation: [
          total === 0
            ? 'No recent automation runs — nothing failing, nothing verified either.'
            : `${total} recent run(s): ${input.automation.completed} ok, ${input.automation.failed} failed; ${input.automation.paused} rule(s) paused.`,
        ],
        evidence: [`automation.completed=${input.automation.completed}`, `automation.failed=${input.automation.failed}`, `automation.paused=${input.automation.paused}`],
        confidence: total === 0 ? 0.5 : 0.85,
      }),
    );
  } else {
    domains.push(unavailableDomain('automations', 'Automations', ['automation-runs'], input.failures['automations'] ?? 'automation monitor read failed'));
  }

  // 6 — AI: the EXISTING workforce health summary + system health signal.
  if (input.workforce) {
    const wf = input.workforce;
    const base = wf.totalWorkers === 0 ? null : wf.meanSuccessRate * 100;
    const sys = input.system ? input.system.score : null;
    const score = base == null ? sys : sys == null ? base : base * 0.7 + sys * 0.3;
    domains.push(
      domain('ai', 'AI & Workforce', ['workforce-kpis', 'system-health'], {
        score,
        explanation: [
          wf.totalWorkers === 0
            ? 'No AI workers installed.'
            : `${wf.healthy}/${wf.totalWorkers} workers healthy; mean success rate ${Math.round(wf.meanSuccessRate * 100)}% over ${wf.totalJobsRun} job(s).`,
          input.system ? `System health ${input.system.score}/100 (${input.system.level}).` : 'System health signal unavailable.',
        ],
        evidence: [`workforce.state=${wf.state}`, `workforce.jobsRun=${wf.totalJobsRun}`, `workforce.jobsFailed=${wf.totalJobsFailed}`],
        confidence: wf.totalWorkers === 0 ? 0.4 : 0.8,
        unavailable: score == null ? 'no workers and no system signal' : null,
      }),
    );
  } else {
    domains.push(unavailableDomain('ai', 'AI & Workforce', ['workforce-kpis', 'system-health'], input.failures['ai'] ?? 'workforce health read failed'));
  }

  // 7 — connectors: composed from each connector's EXISTING health field.
  if (input.connectors) {
    const active = input.connectors.filter((c) => c.configured && c.accounts.length > 0);
    if (active.length === 0) {
      domains.push(
        domain('connectors', 'Connectors', ['connector-health'], {
          score: null,
          explanation: ['No connectors are connected.'],
          evidence: ['connectors.active=0'],
          confidence: 0,
          unavailable: 'no connected connectors',
        }),
      );
    } else {
      const healthy = active.filter((c) => c.health === 'healthy').length;
      const degraded = active.filter((c) => c.health === 'degraded').length;
      const down = active.filter((c) => c.health === 'down').length;
      const unknown = active.length - healthy - degraded - down;
      const score = (healthy * 95 + degraded * 50 + down * 10 + unknown * 70) / active.length;
      domains.push(
        domain('connectors', 'Connectors', ['connector-health'], {
          score,
          explanation: [`${active.length} connected: ${healthy} healthy, ${degraded} degraded, ${down} down${unknown ? `, ${unknown} unknown` : ''}.`],
          evidence: active.map((c) => `connector:${c.id}=${c.health}`),
          confidence: unknown === active.length ? 0.4 : 0.9,
        }),
      );
    }
  } else {
    domains.push(unavailableDomain('connectors', 'Connectors', ['connector-health'], input.failures['connectors'] ?? 'connector service read failed'));
  }

  // 8 — approvals: queue depth + age from the EXISTING job store.
  if (input.approvals) {
    const { pending, oldestCreatedAt } = input.approvals;
    const oldestMs = oldestCreatedAt ? Date.parse(oldestCreatedAt) : NaN;
    const ageDays = Number.isFinite(oldestMs) ? Math.max(0, (input.nowMs - oldestMs) / 86_400_000) : 0;
    const score = pending === 0 ? 95 : 90 - Math.min(40, pending * 6) - Math.min(35, ageDays * 8);
    domains.push(
      domain('approvals', 'Approvals', ['workforce-jobs'], {
        score,
        explanation: [
          pending === 0
            ? 'No approvals are waiting.'
            : `${pending} approval(s) parked; oldest waiting ${ageDays.toFixed(1)} day(s).`,
        ],
        evidence: [`approvals.pending=${pending}`, ...(oldestCreatedAt ? [`approvals.oldest=${oldestCreatedAt}`] : [])],
        confidence: 0.9,
      }),
    );
  } else {
    domains.push(unavailableDomain('approvals', 'Approvals', ['workforce-jobs'], input.failures['approvals'] ?? 'job store read failed'));
  }

  /* ── roll-up + confidence breakdown (enhancement #3) ────────────────────── */
  const scored = domains.filter((d) => d.score != null);
  const overall = scored.length ? clamp100(scored.reduce((s, d) => s + (d.score ?? 0), 0) / scored.length) : null;

  const dataAvailability = round2(domains.filter((d) => d.unavailable == null).length / domains.length);
  const signalQuality = scored.length ? round2(scored.reduce((s, d) => s + d.confidence, 0) / scored.length) : 0;
  const historicalCoverage = round2(Math.max(0, Math.min(1, input.historyDays / 90)));
  // Health is a point-in-time composition — correlation strength reflects how
  // many domains could be cross-checked against each other (scored share).
  const correlationStrength = round2(scored.length / domains.length);
  const overallConf = round2(
    dataAvailability * 0.35 + signalQuality * 0.35 + historicalCoverage * 0.1 + correlationStrength * 0.2,
  );

  const confidence: ConfidenceBreakdown = {
    dataAvailability,
    signalQuality,
    historicalCoverage,
    correlationStrength,
    overall: overallConf,
  };

  return {
    domains,
    overall,
    band: overall == null ? 'unknown' : bandFor(overall),
    confidence,
    generatedAt: new Date(input.nowMs).toISOString(),
  };
}
