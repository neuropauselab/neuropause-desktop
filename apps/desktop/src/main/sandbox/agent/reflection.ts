/**
 * AI Sandbox — AI QA Agent (S4): the reflection engine.
 *
 * After every action: compare expected vs actual, detect regressions, classify the
 * failure, estimate confidence, generate root-cause hypotheses, and recommend fixes.
 * Deterministic classification + heuristics run first; the reasoner adds a natural-language
 * narrative on top. A NEW failure (not in the recalled known issues) is flagged as a
 * regression; a previously-known failure is not.
 */
import type { QaFailureClass, QaHypothesis, QaObservation, QaReflection, QaTask } from '@neuropause/shared';
import type { QaReasonerResult, Reasoner } from './ports';

export interface ReflectDeps {
  reasoner: Reasoner;
  knownIssues: string[];
  now: () => number;
}

export interface ReflectOutput {
  reflection: QaReflection;
  narrative: QaReasonerResult;
  reasoningMs: number;
}

export async function reflect(task: QaTask, observation: QaObservation, deps: ReflectDeps): Promise<ReflectOutput> {
  const total = observation.assertions.total || task.expectations.length;
  const matched = observation.outcome === 'pass' ? total : observation.assertions.passed;
  const failureClass = classify(observation);
  const known = matchesKnownIssue(task, deps.knownIssues);
  const regressionDetected = failureClass !== 'none' && !known;
  const confidence = confidenceFor(failureClass, observation);
  const hypotheses = hypothesize(observation, failureClass, known);
  const recommendations = recommend(failureClass);

  const reflection: QaReflection = {
    taskId: task.id,
    matchedExpectations: matched,
    totalExpectations: total,
    regressionDetected,
    failureClass,
    confidence,
    hypotheses,
    recommendations,
  };

  const r0 = deps.now();
  const narrative = await deps.reasoner.explainFailure(observation, reflection);
  const reasoningMs = deps.now() - r0;
  return { reflection, narrative, reasoningMs };
}

export function classify(observation: QaObservation): QaFailureClass {
  if (observation.outcome === 'pass') return 'none';
  const e = (observation.error ?? '').toLowerCase();
  if (e.includes('permission') || e.includes('authoriz') || e.includes('rbac') || e.includes('sign in')) return 'permission';
  if (e.includes('timeout') || e.includes('timed out')) return 'timeout';
  if (e.includes('unavailable') || e.includes('requires playwright') || e.includes('not connected')) return 'environment';
  if (e.includes('crash') || e.includes('renderer')) return 'crash';
  if (observation.outcome === 'error') return e ? 'crash' : 'unknown';
  if (observation.outcome === 'fail') return 'assertion';
  return 'unknown';
}

function confidenceFor(cls: QaFailureClass, observation: QaObservation): number {
  if (cls === 'none') return 1;
  const ratio = observation.assertions.total ? observation.assertions.passed / observation.assertions.total : 0;
  switch (cls) {
    case 'permission': return 0.95;
    case 'assertion': return 0.8;
    case 'timeout':
    case 'environment': return 0.6;
    case 'crash': return 0.7;
    case 'flaky': return 0.4;
    default: return 0.5 + ratio * 0.2;
  }
}

function hypothesize(observation: QaObservation, cls: QaFailureClass, known: boolean): QaHypothesis[] {
  const evidence = [
    `outcome=${observation.outcome ?? observation.status}`,
    `assertions=${observation.assertions.passed}/${observation.assertions.total}`,
    ...(observation.error ? [`error=${observation.error}`] : []),
  ];
  const out: QaHypothesis[] = [];
  if (known) out.push({ cause: 'Matches a previously recorded known issue (not a new regression).', confidence: 0.8, evidence });
  switch (cls) {
    case 'permission':
      out.push({ cause: 'The acting role lacks a required permission, or an RBAC scope changed.', confidence: 0.9, evidence });
      break;
    case 'assertion':
      out.push({ cause: 'A business rule or derived field changed so an expected value no longer holds.', confidence: 0.75, evidence });
      out.push({ cause: 'A module validation/lifecycle hook altered the record shape.', confidence: 0.5, evidence });
      break;
    case 'timeout':
      out.push({ cause: 'A downstream call exceeded its budget (load, slow model, or a hung step).', confidence: 0.6, evidence });
      break;
    case 'environment':
      out.push({ cause: 'A backend the scenario needs is not available here (desktop display, a connected connector).', confidence: 0.7, evidence });
      break;
    case 'crash':
      out.push({ cause: 'An executor or the app instance crashed mid-run.', confidence: 0.65, evidence });
      break;
    case 'none':
      break;
    default:
      out.push({ cause: 'Unclassified failure — inspect the diagnostics artifact.', confidence: 0.4, evidence });
  }
  return out;
}

function recommend(cls: QaFailureClass): string[] {
  switch (cls) {
    case 'permission': return ['Verify the role/scope grants for the targeted module', 'Confirm the RBAC seed for this permission'];
    case 'assertion': return ['Diff the expected vs actual field in the report', 'Check recent changes to the module validate/onChange hooks'];
    case 'timeout': return ['Re-run to confirm flakiness', 'Profile the slowest step from the metrics'];
    case 'environment': return ['Provision the backend (display for desktop, a connected connector) and re-run'];
    case 'crash': return ['Open the diagnostics.json artifact', 'Check the timeline for the last successful phase'];
    case 'none': return [];
    default: return ['Inspect artifacts and the timeline for the failing step'];
  }
}

function matchesKnownIssue(task: QaTask, knownIssues: string[]): boolean {
  const key = `${task.name}`.toLowerCase();
  return knownIssues.some((k) => k.toLowerCase().includes(key) || key.includes(k.toLowerCase().slice(0, 12)));
}
