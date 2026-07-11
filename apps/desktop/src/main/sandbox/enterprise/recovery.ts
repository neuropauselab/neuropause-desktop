/**
 * AI Sandbox — Enterprise Scenario Runner (S3): failure classification + recovery.
 *
 * Classifies a step failure (authorization, not-found, validation, timeout, network,
 * conflict, platform-unavailable, automation, unknown), decides whether it is
 * recoverable (a timeout/network/conflict/transient error can be retried; an
 * authorization / validation / not-found failure is REAL and never retried into a pass),
 * and builds a diagnostics + root-cause summary the executor attaches as an artifact.
 * Integrates with the per-step retry policy; rollback of created records is best-effort.
 * Pure classification.
 */
import { EnterprisePlatformError } from './platform';

export type EnterpriseFailureKind =
  | 'authorization'
  | 'not_found'
  | 'validation'
  | 'timeout'
  | 'network'
  | 'conflict'
  | 'platform_unavailable'
  | 'automation'
  | 'unknown';

export interface EnterpriseFailure {
  kind: EnterpriseFailureKind;
  recoverable: boolean;
  message: string;
}

const RECOVERABLE: ReadonlySet<EnterpriseFailureKind> = new Set(['timeout', 'network', 'conflict', 'unknown']);

export function classifyEnterpriseFailure(err: unknown): EnterpriseFailure {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  const code = err instanceof EnterprisePlatformError ? err.code : '';
  const kind = detect(message, name, code);
  return { kind, recoverable: RECOVERABLE.has(kind), message };
}

function detect(message: string, name: string, code: string): EnterpriseFailureKind {
  const m = message.toLowerCase();
  if (name === 'EnterpriseAuthorizationError' || name === 'AuthorizationError' || m.includes('permission') || m.includes('sign in to continue') || m.includes('unauthor')) return 'authorization';
  if (code === 'desktop_unavailable' || code === 'platform_unavailable' || m.includes('requires playwright') || m.includes('unavailable')) return 'platform_unavailable';
  if (code === 'module_not_found' || code === 'record_not_found' || m.includes('not found') || m.includes('not registered')) return 'not_found';
  if (name === 'ZodError' || m.includes('invalid') || m.includes('required') || m.includes('validation')) return 'validation';
  if (m.includes('timeout') || m.includes('timed out')) return 'timeout';
  if (m.includes('net::') || m.includes('econnrefused') || m.includes('enotfound') || m.includes('network')) return 'network';
  if (m.includes('conflict') || m.includes('concurrent') || m.includes('busy')) return 'conflict';
  if (code === 'desktop_automation' || m.includes('selector')) return 'automation';
  return 'unknown';
}

export interface EnterpriseDiagnostics {
  failure: EnterpriseFailure;
  stepId: string;
  action: string;
  channel: string;
  attempts: number;
  variables: string[];
  rootCause: string;
  recordsToRollback: number;
}

export function rootCauseSummary(failure: EnterpriseFailure, stepId: string, action: string): string {
  switch (failure.kind) {
    case 'authorization':
      return `Step "${stepId}" (${action}) was denied by RBAC — the runner acts as the signed-in actor and cannot exceed their permissions. This is a real permission boundary, not a flake.`;
    case 'not_found':
      return `Step "${stepId}" (${action}) targeted a module or record that does not exist. Check the module key / a prior step's saved id.`;
    case 'validation':
      return `Step "${stepId}" (${action}) sent input the module rejected. Check required fields for this record type.`;
    case 'platform_unavailable':
      return `Step "${stepId}" (${action}) needs a backend that is not available here (e.g. Playwright for desktop, or a connected connector). Not retried.`;
    case 'timeout':
    case 'network':
    case 'conflict':
      return `Step "${stepId}" (${action}) hit a transient ${failure.kind} error; the runner retried per the step's retry policy.`;
    case 'automation':
      return `Step "${stepId}" (${action}) could not locate a UI element. This is a real automation failure.`;
    default:
      return `Step "${stepId}" (${action}) failed: ${failure.message}`;
  }
}

export function buildDiagnostics(
  failure: EnterpriseFailure,
  stepId: string,
  action: string,
  channel: string,
  attempts: number,
  variables: string[],
  recordsToRollback: number,
): EnterpriseDiagnostics {
  return {
    failure,
    stepId,
    action,
    channel,
    attempts,
    variables,
    rootCause: rootCauseSummary(failure, stepId, action),
    recordsToRollback,
  };
}
