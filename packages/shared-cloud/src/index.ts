/**
 * @neuropause/shared-cloud — shared cloud DTOs, contracts, and CONSTITUTIONAL
 * constants used across every delivery surface (desktop, future mobile/web) and
 * the cloud services themselves.
 *
 * STATUS: PREVIEW foundation (NCEA Phase 10.2). Types and constants are real and
 * used by apps/cloud; they are not a claim of a deployed production platform.
 *
 * Constitutional anchors encoded here (NCEA v1.0):
 *   - Principle 5: "Synchronize state, never secrets." The syncable allow-list,
 *     the never-sync deny-list, and the secret-field pattern below are the
 *     SCHEMA-LEVEL teeth for that rule — not a convention.
 *   - Principle 6/10: the cloud coordinates; each surface has a defined role.
 */
import { z } from 'zod';

/* --------------------------------------------------------------------------
 * Identifiers — string aliases (documented) rather than opaque brands, to keep
 * DTOs JSON-friendly across surfaces. Prefixes make provenance obvious in logs.
 * ------------------------------------------------------------------------ */
export type UserId = string; // usr_*
export type OrgId = string; // org_*
export type TeamId = string; // team_*
export type DeviceId = string; // dev_*
export type SessionId = string; // ses_*
export type EventId = string; // evt_*
export type NotificationId = string; // ntf_*
export type AuditId = string; // aud_*

/* --------------------------------------------------------------------------
 * Principle 5 — the syncable/never-sync taxonomy, enforced at the schema layer.
 * ------------------------------------------------------------------------ */

/** State kinds that MAY be synchronized between a user's trusted devices. */
export const SYNCABLE_STATE_KINDS = [
  'timeline',
  'task',
  'workflow_state',
  'notification',
  'approval',
  'org_settings',
  'preferences',
] as const;
export type SyncableStateKind = (typeof SYNCABLE_STATE_KINDS)[number];

/** Kinds that must NEVER leave the device. Present so the deny-list is explicit. */
export const NEVER_SYNC_KINDS = [
  'provider_key',
  'connector_credential',
  'local_secret',
  'runtime_cache',
  'dev_workspace',
] as const;
export type NeverSyncKind = (typeof NEVER_SYNC_KINDS)[number];

/**
 * Field-name pattern that must never appear as a key inside a sync payload.
 * The sync schema (apps/cloud/services/sync) rejects any envelope whose state
 * object contains a matching key — making "state, never secrets" a type error,
 * per the NCEA forward rule, rather than a reviewer's discipline.
 */
export const SECRET_FIELD_PATTERN =
  /(secret|password|passwd|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|credential|authorization|private[_-]?key|client[_-]?secret)/i;

/* --------------------------------------------------------------------------
 * Deployment modes (NCEA Layer 4). Every capability must remain usable in
 * 'standalone' with no cloud reachable — see STATUS.md.
 * ------------------------------------------------------------------------ */
export const DEPLOYMENT_MODES = [
  'standalone',
  'desktop_cloud',
  'private_cloud',
  'single_tenant',
  'multi_tenant',
  'on_premises',
  'air_gapped',
] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

/* --------------------------------------------------------------------------
 * API envelope — every gateway response carries a trace id (Principle 7).
 * ------------------------------------------------------------------------ */
export interface ApiError {
  code: string;
  message: string;
}
export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: ApiError;
  traceId: string;
}

export const apiErrorSchema = z.object({ code: z.string(), message: z.string() });

/* --------------------------------------------------------------------------
 * Shared public DTOs (secret-free by construction).
 *
 * CONSOLIDATION (10.2A): device/session/user/org public shapes are owned by the
 * backend (`apps/backend`). Cross-surface public DTOs for those, if a second
 * surface ever needs them, should be defined ONCE here mapped from the backend's
 * domain types — not duplicated. Only cloud-owned DTOs live here today.
 * ------------------------------------------------------------------------ */
export interface AuditRef {
  auditId: AuditId;
  prevId: AuditId | null;
  hash: string;
}
