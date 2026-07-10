/**
 * Enterprise Integration — Manifest Profile (Phase P2.1 foundation, Part 3).
 *
 * The existing NCF `ConnectorManifest` already carries id/name/provider/category/authType/capabilities/
 * scopes/oauth/version/docsUrl/brandColor. This module adds the ENTERPRISE metadata a connector must also
 * declare but which the base manifest lacks: sync modes, rate limits, webhook support, health checks, and
 * the concrete provider objects (mapped into the UDM). An `EnterpriseIntegrationProfile` is keyed by the
 * same `connectorId`, so it composes with the base manifest rather than replacing it. Pure types + a
 * deterministic validator + small query helpers — no I/O, no connector-specific logic.
 */
import type {
  IntegrationAuthKind,
  IntegrationObjectDescriptor,
  IntegrationSyncMode,
} from './integrationSdk';
import { INTEGRATION_SYNC_MODES, isIntegrationSyncMode } from './integrationSdk';

/** Provider rate-limit envelope, used by the runtime's token-bucket planner + the dashboard. */
export interface IntegrationRateLimit {
  /** Allowed requests per interval. */
  requestsPerInterval: number;
  /** Interval length in milliseconds. */
  intervalMs: number;
  /** Optional burst capacity above the steady rate. */
  burst?: number;
}

/** Inbound webhook capabilities. NCF has no local receiver yet — this declares intent + event surface. */
export interface IntegrationWebhookSpec {
  supported: boolean;
  /** Event types the connector can deliver. */
  events: string[];
  /** Header carrying the delivery signature, if any. */
  signatureHeader?: string;
}

export type IntegrationHealthCheckKind = 'connectivity' | 'auth' | 'rate_limit' | 'data_freshness';

/** A declarative health check the connector supports (executed by the health engine/provider). */
export interface IntegrationHealthCheckSpec {
  id: string;
  label: string;
  kind: IntegrationHealthCheckKind;
}

/** The enterprise profile for one connector, keyed by the NCF connectorId. */
export interface EnterpriseIntegrationProfile {
  connectorId: string;
  version: string;
  authKinds: IntegrationAuthKind[];
  /** OAuth/consent scopes (mirrors the manifest's scope strings). */
  scopes: string[];
  syncModes: IntegrationSyncMode[];
  rateLimit: IntegrationRateLimit | null;
  webhook: IntegrationWebhookSpec;
  healthChecks: IntegrationHealthCheckSpec[];
  supportedObjects: IntegrationObjectDescriptor[];
  docsUrl: string;
  /** Icon identifier (app icon id or asset URL). */
  iconId: string;
}

export interface ProfileValidation {
  ok: boolean;
  errors: string[];
}

/** Deterministically validate a profile's structural integrity. Pure. */
export function validateIntegrationProfile(profile: EnterpriseIntegrationProfile): ProfileValidation {
  const errors: string[] = [];
  if (!profile.connectorId || !profile.connectorId.trim()) errors.push('connectorId is required');
  if (!profile.version || !profile.version.trim()) errors.push('version is required');
  if (profile.authKinds.length === 0) errors.push('at least one authKind is required');
  if (profile.syncModes.length === 0) errors.push('at least one syncMode is required');
  for (const mode of profile.syncModes) {
    if (!isIntegrationSyncMode(mode)) errors.push(`unknown syncMode: ${mode}`);
  }
  if (profile.rateLimit) {
    if (profile.rateLimit.requestsPerInterval <= 0) errors.push('rateLimit.requestsPerInterval must be > 0');
    if (profile.rateLimit.intervalMs <= 0) errors.push('rateLimit.intervalMs must be > 0');
  }
  if (profile.webhook.supported && profile.webhook.events.length === 0) {
    errors.push('webhook.supported requires at least one event');
  }
  const objectIds = new Set<string>();
  for (const obj of profile.supportedObjects) {
    if (!obj.id || !obj.id.trim()) {
      errors.push('supportedObject id is required');
      continue;
    }
    if (objectIds.has(obj.id)) errors.push(`duplicate supportedObject id: ${obj.id}`);
    objectIds.add(obj.id);
    for (const mode of obj.syncModes) {
      if (!profile.syncModes.includes(mode)) {
        errors.push(`object ${obj.id} declares syncMode ${mode} not offered by the connector`);
      }
    }
  }
  const checkIds = new Set<string>();
  for (const check of profile.healthChecks) {
    if (checkIds.has(check.id)) errors.push(`duplicate healthCheck id: ${check.id}`);
    checkIds.add(check.id);
  }
  return { ok: errors.length === 0, errors };
}

/** Whether the connector supports a given sync mode. */
export function supportsSyncMode(
  profile: EnterpriseIntegrationProfile,
  mode: IntegrationSyncMode,
): boolean {
  return profile.syncModes.includes(mode);
}

/** Preference order used to pick a connector's default sync mode. */
const SYNC_MODE_PREFERENCE: readonly IntegrationSyncMode[] = [
  'incremental',
  'delta',
  'full',
  'scheduled',
  'webhook',
  'manual',
];

/** The connector's default sync mode: the most-preferred mode it offers, else its first declared mode. */
export function defaultSyncMode(profile: EnterpriseIntegrationProfile): IntegrationSyncMode | null {
  for (const mode of SYNC_MODE_PREFERENCE) {
    if (profile.syncModes.includes(mode)) return mode;
  }
  return profile.syncModes[0] ?? null;
}

/** The objects a connector can sync under a given mode. */
export function objectsForSyncMode(
  profile: EnterpriseIntegrationProfile,
  mode: IntegrationSyncMode,
): IntegrationObjectDescriptor[] {
  return profile.supportedObjects.filter((o) => o.syncModes.includes(mode));
}

/** A human, deterministic description of a rate limit. */
export function describeRateLimit(rate: IntegrationRateLimit | null): string {
  if (!rate) return 'No documented rate limit';
  const perSec = rate.intervalMs === 1000;
  const unit = perSec ? 'second' : `${Math.round(rate.intervalMs / 1000)}s`;
  const burst = rate.burst && rate.burst > 0 ? `, burst ${rate.burst}` : '';
  return `${rate.requestsPerInterval} req / ${unit}${burst}`;
}

/** All sync modes not offered by the connector (for capability display). */
export function unsupportedSyncModes(profile: EnterpriseIntegrationProfile): IntegrationSyncMode[] {
  return INTEGRATION_SYNC_MODES.filter((m) => !profile.syncModes.includes(m));
}
