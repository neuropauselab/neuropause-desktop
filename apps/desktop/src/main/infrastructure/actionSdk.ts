/**
 * P6.1 — Infrastructure automation action SDK.
 *
 * An `InfraAction` is a single HIGH-PRIVILEGE, audited, confirmation-gated mutation against a Cloud Platform
 * (Start/Stop/Reboot an EC2 instance, Reboot an RDS database, Rotate a secret, Invalidate a CDN cache). It is
 * the infrastructure analog of the connector `WriteAction`: an action receives the SAME signed, rate-gated
 * discovery transport that discovery uses (`DiscoveryHttp` — no new auth, no new runtime) and returns a
 * structured result; the executor (`executor.ts`) wraps every run with the confirmation gate and the
 * timeline/audit fan-out, so an action itself contains ONLY the live provider request + response mapping.
 *
 * Authorization is least-privilege and enforced provider-side: the discovery credential profile is read-only
 * for discovery, and an action simply issues the signed mutating call — the provider (AWS IAM) denies it if
 * the profile lacks the permission, and the executor surfaces that denial verbatim. No mock calls.
 */
import type { DiscoveryHttp, InfraActionInfo, InfraActionParamSpec, InfraActionRisk, InfrastructureDomain } from '@neuropause/shared';

export interface InfraActionContext {
  platformId: string;
  accountId: string;
  /** The resolved region for a regional action (a global action ignores it). */
  region: string;
  /** The SAME signed transport discovery uses for this platform+account. */
  http: DiscoveryHttp;
  now: string;
}

export interface InfraActionResultRaw {
  ok: boolean;
  /** Short, non-sensitive human summary for the activity feed + timeline. */
  summary: string;
  /** Non-sensitive payload (ids, states, counts). */
  data?: Record<string, string | number | boolean | null>;
}

export type InfraActionParams = Record<string, unknown>;

export interface InfraAction {
  id: string;
  label: string;
  platformId: string;
  domain: InfrastructureDomain;
  description: string;
  /** true = mutates live infrastructure → the executor requires explicit confirmation. */
  mutates: boolean;
  risk: InfraActionRisk;
  targetResourceType: string;
  params: InfraActionParamSpec[];
  run(ctx: InfraActionContext, params: InfraActionParams): Promise<InfraActionResultRaw>;
}

/** Project an action to its catalog DTO (what the renderer renders — no handler). */
export function actionInfo(a: InfraAction): InfraActionInfo {
  return {
    id: a.id,
    label: a.label,
    platformId: a.platformId,
    domain: a.domain,
    description: a.description,
    mutates: a.mutates,
    risk: a.risk,
    targetResourceType: a.targetResourceType,
    params: a.params,
  };
}

/* ── param helpers — throw a clear, non-sensitive error on bad input (also validated at the IPC edge) ── */

export class InfraActionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfraActionInputError';
  }
}

export function reqStr(p: InfraActionParams, k: string): string {
  const v = p[k];
  if (typeof v !== 'string' || v.trim() === '') throw new InfraActionInputError(`Missing required field "${k}"`);
  return v.trim();
}

export function optStr(p: InfraActionParams, k: string): string | undefined {
  const v = p[k];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}
