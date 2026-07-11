/**
 * AI Sandbox — Continuous Validation Platform (S6): notifications.
 *
 * Maps a run + regression into {@link ValidationNotification}s (Step 9) and emits them
 * through the injected {@link NotifierPort}, which REUSES the existing notification path
 * (`notificationScheduler` / the platform event bus) — never a new notification engine.
 * Pure derivation; emission is the port's job.
 */
import type { RegressionAnalysis, ValidationNotification, ValidationRun } from '@neuropause/shared';
import type { NotifierPort } from './ports';

export function notificationsFor(run: ValidationRun, regression: RegressionAnalysis | null): ValidationNotification[] {
  const out: ValidationNotification[] = [];
  const meta: Record<string, string | number | boolean | null> = { pipeline: run.pipeline, status: run.status, regressions: run.regressionCount };

  if (run.status === 'passed' || run.status === 'warning') {
    out.push({ kind: 'validation-complete', title: `Validation ${run.pipeline} ${run.status}`, body: `${run.stages.length} stage(s) completed.`, priority: 'normal', runId: run.id, metadata: meta });
  }
  if (run.status === 'failed' || run.status === 'error') {
    const failed = run.stages.filter((s) => s.status === 'fail' || s.status === 'error').length;
    out.push({ kind: 'validation-failed', title: `Validation ${run.pipeline} FAILED`, body: `${failed} stage(s) failed.`, priority: 'high', runId: run.id, metadata: meta });
  }
  if (run.certificationLevel === 'pass') {
    out.push({ kind: 'certification-ready', title: `Certification READY — ${run.pipeline}`, body: 'Release certification passed.', priority: 'high', runId: run.id, metadata: meta });
  }
  if (run.certificationLevel === 'fail') {
    out.push({ kind: 'critical-failure', title: `Certification FAILED — ${run.pipeline}`, body: 'Release certification failed — do not ship.', priority: 'critical', runId: run.id, metadata: meta });
  }
  if (regression?.regressed) {
    const security = regression.findings.some((f) => f.kind === 'security');
    const performance = regression.findings.some((f) => f.kind === 'performance' || f.kind === 'latency');
    out.push({
      kind: security ? 'security-issue' : performance ? 'performance-issue' : 'regression-detected',
      title: security ? 'SECURITY regression detected' : performance ? 'Performance regression detected' : 'Regression detected',
      body: regression.summary,
      priority: security || regression.worst === 'critical' ? 'critical' : 'high',
      runId: run.id,
      metadata: meta,
    });
  }
  return out;
}

export function emitNotifications(notifications: ValidationNotification[], notifier: NotifierPort | undefined): void {
  if (!notifier) return;
  for (const n of notifications) {
    try {
      notifier.notify(n);
    } catch {
      /* notifications are best-effort */
    }
  }
}
