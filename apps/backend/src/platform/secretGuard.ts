/**
 * Shared secret guard (NCEA 10.2B, Principle 5 — state, never secrets).
 *
 * Re-exposes the SINGLE cloud-core secret detector so the backend can enforce
 * the exact same rule as the cloud, rather than a second copy.
 *
 * CAUTION — do not wire blindly. Apply to STATE payloads (preferences, workspace
 * settings, timeline). Do NOT apply to the backend's `connector_config` /
 * `connected_account` sync entities, which may legitimately carry credential
 * references by design (see the migration summary). This module provides the
 * check; where to enforce it is a deliberate, per-entity decision.
 */
import { hasSecretKey } from '@neuropause/cloud-core';

/** Offending key path if a secret-like key exists anywhere in `value`, else null. */
export function findSecretKey(value: unknown): string | null {
  return hasSecretKey(value);
}

export function containsSecret(value: unknown): boolean {
  return hasSecretKey(value) !== null;
}
