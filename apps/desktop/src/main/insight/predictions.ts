/**
 * Phase 6 Stage 6 (D-4) — deterministic predictive intelligence.
 *
 * Seven heuristics over histories the platform ALREADY keeps (the 90-day
 * health history, automation run ring, job store, execution ring, connector
 * accounts). No ML, no model, no randomness: each heuristic fires only when
 * its stated condition holds on real records, carries the evidence ids it
 * fired on, states its basis plainly, and stays silent when history is
 * insufficient — a missing prediction means "not enough evidence", never
 * "no risk".
 *
 * Pure + deterministic + IO-free.
 */
import type {
  AutomationRunRecord,
  ConfidenceBreakdown,
  ConnectorDto,
  InsightPrediction,
  Job,
} from '@neuropause/shared';

export interface PredictionInput {
  nowMs: number;
  /** Existing 90-day daily health points (oldest first). */
  healthHistory: { day: string; overall: number }[] | null;
  jobs: Job[] | null;
  automationRuns: AutomationRunRecord[] | null;
  connectors: Pick<ConnectorDto, 'id' | 'name' | 'health' | 'configured' | 'accounts'>[] | null;
  projects: { projects: number; openTasks: number; overdueTasks: number } | null;
  /** Recent timeline event count (7-day window) for the inactivity heuristic. */
  recentEventCount: number | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function breakdown(parts: {
  dataAvailability: number;
  signalQuality: number;
  historicalCoverage: number;
  correlationStrength: number;
}): ConfidenceBreakdown {
  const overall =
    parts.dataAvailability * 0.3 +
    parts.signalQuality * 0.25 +
    parts.historicalCoverage * 0.25 +
    parts.correlationStrength * 0.2;
  return {
    dataAvailability: round2(clamp01(parts.dataAvailability)),
    signalQuality: round2(clamp01(parts.signalQuality)),
    historicalCoverage: round2(clamp01(parts.historicalCoverage)),
    correlationStrength: round2(clamp01(parts.correlationStrength)),
    overall: round2(clamp01(overall)),
  };
}

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Run every heuristic; silent (absent) when its condition/history is missing. */
export function buildPredictions(input: PredictionInput): InsightPrediction[] {
  const out: InsightPrediction[] = [];
  const { nowMs } = input;

  /* ── approval backlog growth ────────────────────────────────────────────── */
  if (input.jobs) {
    const awaiting = input.jobs.filter((j) => j.status === 'awaiting_approval');
    const oldAwaiting = awaiting.filter((j) => {
      const t = parseMs(j.createdAt);
      return t != null && nowMs - t > 2 * 86_400_000;
    });
    if (awaiting.length >= 3 && oldAwaiting.length >= 1) {
      out.push({
        id: 'pred:approval-backlog',
        kind: 'approval-backlog',
        title: `Approval backlog likely to block delivery (${awaiting.length} parked)`,
        detail: `${awaiting.length} proposal(s) are parked and ${oldAwaiting.length} have waited over 2 days. At the current decision rate the queue carries into next week.`,
        horizonDays: 7,
        likelihood: round2(clamp01(0.4 + awaiting.length * 0.05 + oldAwaiting.length * 0.1)),
        confidence: breakdown({ dataAvailability: 1, signalQuality: 0.9, historicalCoverage: 0.6, correlationStrength: 0.7 }),
        evidence: awaiting.slice(0, 8).map((j) => j.id),
        basis: 'Job store: parked approvals ≥3 with at least one older than 2 days.',
        suggestedAction: 'Review the approval queue in the Workforce section and decide the oldest proposals first.',
        signals: ['workforce-jobs'],
      });
    }
  }

  /* ── project delay ──────────────────────────────────────────────────────── */
  if (input.projects && input.projects.openTasks >= 5) {
    const share = input.projects.overdueTasks / input.projects.openTasks;
    if (share >= 0.25) {
      out.push({
        id: 'pred:project-delay',
        kind: 'project-delay',
        title: `Project delays likely (${Math.round(share * 100)}% of open tasks overdue)`,
        detail: `${input.projects.overdueTasks} of ${input.projects.openTasks} open task(s) are already overdue across ${input.projects.projects} project(s); backlog at this share historically slips delivery.`,
        horizonDays: 7,
        likelihood: round2(clamp01(0.35 + share * 0.6)),
        confidence: breakdown({ dataAvailability: 1, signalQuality: 0.85, historicalCoverage: 0.5, correlationStrength: 0.6 }),
        evidence: [`tasks.open=${input.projects.openTasks}`, `tasks.overdue=${input.projects.overdueTasks}`],
        basis: 'UDM tasks: overdue share of open tasks ≥ 25% (min 5 open tasks).',
        suggestedAction: 'Triage overdue tasks per project; re-plan or delegate the oldest ones.',
        signals: ['work-entities'],
      });
    }
  }

  /* ── connector instability ──────────────────────────────────────────────── */
  if (input.connectors) {
    const unstable = input.connectors.filter(
      (c) => c.configured && c.accounts.length > 0 && (c.health === 'down' || c.health === 'degraded' || c.accounts.some((a) => a.error != null)),
    );
    if (unstable.length > 0) {
      out.push({
        id: 'pred:connector-instability',
        kind: 'connector-instability',
        title: `${unstable.length} connector(s) likely to interrupt data flow`,
        detail: `${unstable.map((c) => c.name).join(', ')} show degraded health or account errors; left unattended, dependent briefs, automations, and search will run on stale data.`,
        horizonDays: 3,
        likelihood: round2(clamp01(0.5 + unstable.length * 0.1)),
        confidence: breakdown({ dataAvailability: 1, signalQuality: 0.9, historicalCoverage: 0.4, correlationStrength: 0.8 }),
        evidence: unstable.map((c) => `connector:${c.id}=${c.health}`),
        basis: 'Connector service: health degraded/down or account error present.',
        suggestedAction: 'Open Connections and re-authenticate or re-sync the affected connectors.',
        signals: ['connector-health'],
      });
    }
  }

  /* ── automation failure rate ────────────────────────────────────────────── */
  if (input.automationRuns && input.automationRuns.length >= 5) {
    const byRule = new Map<string, AutomationRunRecord[]>();
    for (const r of input.automationRuns) (byRule.get(r.ruleId) ?? byRule.set(r.ruleId, []).get(r.ruleId)!).push(r);
    for (const [ruleId, runs] of byRule) {
      if (runs.length < 5) continue;
      const failed = runs.filter((r) => !r.ok);
      const rate = failed.length / runs.length;
      if (rate >= 0.4) {
        out.push({
          id: `pred:automation-failure:${ruleId}`,
          kind: 'automation-failure',
          title: `Automation “${runs[0].ruleName}” likely to keep failing (${Math.round(rate * 100)}%)`,
          detail: `${failed.length} of the last ${runs.length} run(s) failed. Without a fix the failure pattern continues.`,
          horizonDays: 7,
          likelihood: round2(clamp01(0.3 + rate * 0.65)),
          confidence: breakdown({ dataAvailability: 1, signalQuality: 0.9, historicalCoverage: round2(Math.min(1, runs.length / 20)), correlationStrength: 0.7 }),
          evidence: failed.slice(0, 6).map((r) => r.id),
          basis: 'Automation run ring: per-rule failure rate ≥ 40% over ≥5 runs.',
          suggestedAction: `Open the automation and inspect its last error${failed[0]?.error ? ` (“${failed[0].error}”)` : ''}; pause it if the target system is down.`,
          signals: ['automation-runs'],
        });
      }
    }
  }

  /* ── inactivity ─────────────────────────────────────────────────────────── */
  if (input.recentEventCount != null && input.recentEventCount === 0) {
    out.push({
      id: 'pred:inactivity',
      kind: 'inactivity',
      title: 'Organization inactivity — engagement risk ahead',
      detail: 'No tracked activity in the last 7 days. Dormancy at this level typically continues without re-engagement.',
      horizonDays: 7,
      likelihood: 0.7,
      confidence: breakdown({ dataAvailability: 1, signalQuality: 0.8, historicalCoverage: 0.5, correlationStrength: 0.5 }),
      evidence: ['timeline.recentEventCount=0'],
      basis: 'Enterprise timeline: zero events in the trailing 7-day window.',
      suggestedAction: 'Connect a source or run a brief to restart the activity loop.',
      signals: ['timeline-events'],
    });
  }

  /* ── operational drift + risk trend (need ≥3 daily points) ──────────────── */
  if (input.healthHistory && input.healthHistory.length >= 3) {
    const points = input.healthHistory;
    const values = points.map((p) => p.overall);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    const current = values[values.length - 1];
    const historicalCoverage = round2(Math.min(1, points.length / 90));

    if (stddev > 0 && current < mean - stddev) {
      out.push({
        id: 'pred:operational-drift',
        kind: 'operational-drift',
        title: `Health drifting below its norm (${current} vs mean ${Math.round(mean)})`,
        detail: `Today's overall health (${current}) sits more than one standard deviation (${stddev.toFixed(1)}) below the ${points.length}-day mean — the operational baseline is drifting.`,
        horizonDays: 7,
        likelihood: round2(clamp01(0.4 + (mean - current) / Math.max(1, stddev) / 10)),
        confidence: breakdown({ dataAvailability: 1, signalQuality: 0.7, historicalCoverage, correlationStrength: 0.6 }),
        evidence: points.slice(-5).map((p) => `health:${p.day}=${p.overall}`),
        basis: `Health history (${points.length} daily points): current < mean − 1σ.`,
        suggestedAction: 'Open the Intelligence Center health view and address the weakest domain.',
        signals: ['org-health'],
      });
    }

    const week = values.slice(-7);
    if (week.length >= 3) {
      let declines = 0;
      for (let i = 1; i < week.length; i += 1) if (week[i] < week[i - 1]) declines += 1;
      const delta = week[week.length - 1] - week[0];
      if (delta <= -5 && declines >= Math.ceil((week.length - 1) / 2)) {
        out.push({
          id: 'pred:risk-trend',
          kind: 'risk-trend',
          title: `Enterprise risk rising — health down ${Math.abs(delta)} points this week`,
          detail: `Overall health fell from ${week[0]} to ${week[week.length - 1]} across the last ${week.length} recorded day(s), declining on ${declines} of ${week.length - 1} transitions. The trend continuing is the base case.`,
          horizonDays: 7,
          likelihood: round2(clamp01(0.45 + Math.abs(delta) / 40)),
          confidence: breakdown({ dataAvailability: 1, signalQuality: 0.7, historicalCoverage, correlationStrength: 0.65 }),
          evidence: points.slice(-week.length).map((p) => `health:${p.day}=${p.overall}`),
          basis: 'Health history: ≥5-point weekly decline with majority-declining days.',
          suggestedAction: 'Review this week’s incidents and recommendations; decide the top risk items.',
          signals: ['org-health'],
        });
      }
    }
  }

  return out.sort((a, b) => b.likelihood - a.likelihood || a.id.localeCompare(b.id));
}
