/**
 * Infrastructure automation + search DTOs (P6.1 — Cloud & Infrastructure Control Plane).
 *
 * These are the pure cross-IPC contracts the renderer renders and the main process fills — they carry NO
 * secrets, NO handlers, and NO transport. Automation actions on a Cloud Platform (e.g. Start/Stop an EC2
 * instance, Reboot an RDS database, Rotate a secret) are HIGH-PRIVILEGE mutations, so an action is described
 * to the UI as `mutates` + a `risk` tier and is executed only through the confirmation-gated executor — the
 * same shape as the connector WriteAction model, reused here for the infrastructure runtime (no new pattern).
 */
import type { InfrastructureDomain } from './cloudPlatform';
import type { ResourceHealth } from './resourceGraph';

/** The risk tier of an infrastructure action (drives the confirmation copy + badge tone in the UI). */
export type InfraActionRisk = 'low' | 'medium' | 'high';

/** A single parameter an action needs (all infra action params are resource ids / regions → strings). */
export interface InfraActionParamSpec {
  key: string;
  label: string;
  required: boolean;
  /** A short hint / example for the field. */
  hint?: string;
}

/** The catalog entry the renderer renders for one automation action (no handler, no secret). */
export interface InfraActionInfo {
  id: string;
  label: string;
  platformId: string;
  domain: InfrastructureDomain;
  /** A one-line description of what the action does. */
  description: string;
  /** true = mutates live infrastructure → the executor REQUIRES an explicit confirmation. */
  mutates: boolean;
  risk: InfraActionRisk;
  /** The resource type this action targets (e.g. `ec2_instance`, `rds_instance`, `secret`). */
  targetResourceType: string;
  params: InfraActionParamSpec[];
}

/** The result of executing an infrastructure action (crosses IPC back to the renderer). */
export interface InfraActionResult {
  ok: boolean;
  /** Set when a mutating action was invoked WITHOUT confirmation — the UI must confirm and retry. */
  requiresConfirmation?: boolean;
  /** A short, non-sensitive human summary for the activity feed. */
  message: string;
  /** Non-sensitive result payload (ids, states, counts). */
  data?: Record<string, string | number | boolean | null>;
}

/** One hit in a global infrastructure search (a lean projection of a `CloudResource`). */
export interface InfraSearchHit {
  resourceId: string;
  platformId: string;
  provider: string;
  accountId: string;
  domain: InfrastructureDomain;
  resourceType: string;
  nativeId: string;
  name: string;
  region: string | null;
  status: string | null;
  health: ResourceHealth;
  /** Which field the query matched (name / nativeId / tag / attribute), for result context. */
  matchedOn: string;
}

/** The result of a global infrastructure search. */
export interface InfraSearchResult {
  query: string;
  /** Total matches before the display cap (so the UI can show "showing N of total"). */
  total: number;
  hits: InfraSearchHit[];
}
