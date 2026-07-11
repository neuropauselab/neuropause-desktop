/**
 * AI Sandbox — Continuous Validation Platform (S6): dashboard projection.
 *
 * Reuses the S1 dashboard PATTERN (a pure composer over real run data) to build a live
 * {@link ValidationDashboard} — current run, queue, scheduled runs, latest + historical
 * results, certification status, and trends. No new dashboard system; every value comes
 * from the run store and the existing observers.
 */
import { computeTrend, type CertificationLevel, type PipelineKind, type ScheduledValidation, type ValidationDashboard, type ValidationHistoryEntry, type ValidationRunStatus } from '@neuropause/shared';

export interface ValidationDashboardInput {
  history: ValidationHistoryEntry[]; // newest first
  scheduled: ScheduledValidation[];
  current: { runId: string; pipeline: PipelineKind; status: ValidationRunStatus } | null;
  queueDepth: number;
  generatedAt: string;
}

type Band = 'healthy' | 'watch' | 'at-risk' | 'critical';

export function composeValidationDashboard(input: ValidationDashboardInput): ValidationDashboard {
  const latest = input.history[0] ?? null;
  const certificationStatus = input.history.find((h) => h.level !== null)?.level ?? null;

  // Pass rates oldest→newest for the trend.
  const passRates = [...input.history].reverse().map((h) => (h.passed + h.failed ? Math.round((h.passed / (h.passed + h.failed)) * 100) : 100));
  const overall = computeTrend(passRates);
  const trends = {
    regression: overall,
    performance: overall,
    security: overall,
    aiQa: overall,
    benchmark: overall,
  };

  const successPct = latest && latest.passed + latest.failed ? Math.round((latest.passed / (latest.passed + latest.failed)) * 100) : 100;
  const panels: ValidationDashboard['panels'] = [
    { key: 'current', label: 'Current', value: input.current ? `${input.current.pipeline} ${input.current.status}` : 'idle', band: input.current?.status === 'running' ? 'watch' : 'healthy' },
    { key: 'certification', label: 'Certification', value: certificationStatus ?? 'n/a', band: certBand(certificationStatus) },
    { key: 'latest', label: 'Latest', value: latest ? `${latest.pipeline} ${latest.status}` : 'none', band: latest ? statusBand(latest.status) : 'watch' },
    { key: 'success', label: 'Latest success', value: `${successPct}%`, band: successPct >= 95 ? 'healthy' : successPct >= 70 ? 'watch' : 'critical' },
    { key: 'scheduled', label: 'Scheduled', value: String(input.scheduled.filter((s) => s.enabled).length), band: 'healthy' },
    { key: 'queue', label: 'Queue depth', value: String(input.queueDepth), band: input.queueDepth > 5 ? 'watch' : 'healthy' },
    { key: 'trend', label: 'Regression trend', value: trends.regression, band: trends.regression === 'declining' ? 'at-risk' : 'healthy' },
    { key: 'runs', label: 'History', value: String(input.history.length), band: 'healthy' },
  ];

  return {
    generatedAt: input.generatedAt,
    current: input.current,
    queueDepth: input.queueDepth,
    scheduled: input.scheduled,
    latest,
    history: input.history,
    certificationStatus,
    trends,
    panels,
  };
}

function certBand(level: CertificationLevel | null): Band {
  if (level === 'pass') return 'healthy';
  if (level === 'warning') return 'watch';
  if (level === 'fail') return 'critical';
  return 'watch';
}
function statusBand(status: ValidationRunStatus): Band {
  if (status === 'passed') return 'healthy';
  if (status === 'warning') return 'watch';
  if (status === 'running') return 'watch';
  return 'critical';
}
