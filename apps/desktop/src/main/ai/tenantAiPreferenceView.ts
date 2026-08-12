/**
 * THE COMPOSED ANSWER. P13C ROUND 17 · D-5.
 *
 * One function, because there must be exactly one place that combines the
 * platform policy with the tenant preference. Two places would eventually
 * disagree, and the direction they disagree in is the direction that grants
 * capability nobody authorized.
 *
 * It returns all three values — tenant, platform, effective — plus
 * `restrictedByPlatform`, so the UI is structurally unable to display "approved
 * cloud AI" as if it were in force while the platform still routes everything
 * locally. Replacing a hard dead end with a silent no-op would be a worse bug
 * than the one D-5 is fixing.
 */
import type { TenantAiPreferenceView } from '@neuropause/shared';
import { resolveEffectiveAiMode } from '@neuropause/shared';
import { tenantAiPreferenceStore } from './tenantAiPreferenceInstance';
import { loadAiConfig, resolveAiMode } from './aiConfigStore';

export function aiPreferenceView(): TenantAiPreferenceView {
  /**
   * `mode` is nullable on disk — an install that predates the mode setting has
   * none — so the platform side goes through `resolveAiMode`, the existing
   * function that answers what an unset config actually behaves as. Reading
   * `cfg.mode` directly would have made "unset" compose as `undefined` and the
   * intersection meaningless.
   */
  const cfg = loadAiConfig();
  /**
   * `provider: null` means "defer to env/default", and `resolveAiMode` reads it
   * to decide what an UNSET mode behaves as: a Claude setup already routes
   * externally, anything else prefers local. A null provider is not Claude, so
   * it takes the local-preferring branch — which is also the fail-safer of the
   * two, and the direction to be wrong in if this ever changes.
   */
  const platformMode = resolveAiMode(cfg, cfg.provider ?? 'ollama');
  const row = tenantAiPreferenceStore.mine();
  /**
   * NO PREFERENCE MEANS NO OPINION, NOT A DEFAULT.
   *
   * An organization that has never chosen gets the platform policy unchanged.
   * Defaulting the absent case to `local_only` would look safer and would be a
   * lie — it would silently restrict tenants who never expressed anything, and
   * the product could not tell "chose local" from "has not chosen".
   */
  const effectiveMode =
    row === null ? platformMode : resolveEffectiveAiMode(platformMode, row.mode);
  /**
   * CAN EXTERNAL AI ACTUALLY RUN? Two conditions, not one.
   *
   * `external` mode routes to the provider directly. `private_first` uses one
   * only as a FALLBACK and only when `externalConsent` is set — a separate
   * platform flag that defaults to false. Comparing modes alone therefore
   * reports "not restricted" on a default install while external routing is
   * impossible, which is the silent no-op this whole view exists to stop.
   */
  const externalPossible =
    effectiveMode === 'external' || (effectiveMode === 'private_first' && cfg.externalConsent);
  return {
    tenantMode: row?.mode ?? null,
    platformMode,
    platformExternalConsent: cfg.externalConsent,
    effectiveMode,
    /**
     * Only an UNFULFILLED intent counts. A tenant that chose `local_only`
     * asked to be narrower and got exactly that; calling it "restricted" would
     * cry wolf on the common, correct case and train the notice to be ignored.
     */
    restrictedByPlatform: row?.mode === 'private_first' && !externalPossible,
    updatedAt: row?.updatedAt ?? null,
  };
}
