/**
 * THE COMPOSED ANSWER, WITHOUT ELECTRON. P13C ROUND 17 · D-5.
 *
 * One function, because there must be exactly one place that combines the
 * platform policy with the tenant preference. Two places would eventually
 * disagree, and the direction they disagree in is the direction that grants
 * capability nobody authorized.
 *
 * WHY IT LIVES IN ITS OWN FILE.
 *
 * It used to sit in `tenantAiPreferenceView.ts`, which imports the module-level
 * store instance, which imports `electron` for `app.getPath('userData')`. So the
 * only function implementing this decision could not be imported by anything
 * without an Electron runtime — and it therefore had NO test, in a program whose
 * first rule is that a unit test existing is not evidence. The one defect this
 * program shipped (`restrictedByPlatform` comparing modes while ignoring
 * `externalConsent`) was in this function, and was caught by a human running a
 * fresh install because nothing else could reach it.
 *
 * Splitting the pure composition out is what makes it testable, and is what
 * lets the UI harness route `ai:preference.*` through the REAL rule instead of
 * a second copy of it written for the test.
 */
import type { AiMode, TenantAiMode, TenantAiPreferenceView } from '@neuropause/shared';
import { resolveEffectiveAiMode } from '@neuropause/shared';

export interface AiPreferenceComposeInput {
  /** The platform's resolved routing mode — `ai-config.json`, behind `cloud:operate`. */
  platformMode: AiMode;
  /**
   * The platform's SEPARATE consent flag for external fallback. Not derivable
   * from the mode, and false on a fresh install; passing it explicitly is what
   * stops a caller forgetting it exists, which is exactly how it was forgotten.
   */
  platformExternalConsent: boolean;
  /** The calling organization's stored row, or null when it has never chosen. */
  row: { mode: TenantAiMode; updatedAt: number } | null;
}

export function composeAiPreferenceView(input: AiPreferenceComposeInput): TenantAiPreferenceView {
  const { platformMode, platformExternalConsent, row } = input;
  /**
   * NO PREFERENCE MEANS NO OPINION, NOT A DEFAULT.
   *
   * An organization that has never chosen gets the platform policy unchanged.
   * Defaulting the absent case to `local_only` would look safer and would be a
   * lie — it would silently restrict tenants who never expressed anything, and
   * the product could not tell "chose local" from "has not chosen".
   */
  const effectiveMode = row === null ? platformMode : resolveEffectiveAiMode(platformMode, row.mode);
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
    effectiveMode === 'external' || (effectiveMode === 'private_first' && platformExternalConsent);
  return {
    tenantMode: row?.mode ?? null,
    platformMode,
    platformExternalConsent,
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
