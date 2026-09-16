/**
 * The production reading of the composed AI preference. P13C ROUND 17 · D-5.
 *
 * The RULE lives in `tenantAiPreferenceCompose.ts`, which is pure and therefore
 * testable. This file is only the wiring: where the two halves are read from on
 * a real install. Keeping the wiring separate from the rule is what let the rule
 * acquire a test at all — see that file's header for why it had none.
 */
import type { TenantAiPreferenceView } from '@neuropause/shared';
import { tenantAiPreferenceStore } from './tenantAiPreferenceInstance';
import { loadAiConfig, resolveAiMode } from './aiConfigStore';
import { resolveProviderId } from './providerManager';
import { composeAiPreferenceView } from './tenantAiPreferenceCompose';

export function aiPreferenceView(): TenantAiPreferenceView {
  /**
   * `mode` is nullable on disk — an install that predates the mode setting has
   * none — so the platform side goes through `resolveAiMode`, the existing
   * function that answers what an unset config actually behaves as. Reading
   * `cfg.mode` directly would have made "unset" compose as `undefined` and the
   * intersection meaningless.
   *
   * `provider: null` means "defer to env/default", and `resolveAiMode` reads it
   * to decide what an UNSET mode behaves as: a Claude setup already routes
   * externally, anything else prefers local. A null provider is not Claude, so
   * it takes the local-preferring branch — which is also the fail-safer of the
   * two, and the direction to be wrong in if this ever changes.
   *
   * This expression is the one part of the composition still outside the tested
   * function, because `resolveAiMode` lives in `aiConfigStore` and that module
   * imports `electron`. Stated rather than glossed.
   */
  const cfg = loadAiConfig();
  /**
   * P13C ROUND 34 — D-2. The display and the router used to compute two
   * DIFFERENT platform modes: this file substituted 'ollama' for a null
   * provider ("the fail-safer of the two") while the router's
   * `resolveProviderId()` substituted 'claude'. On a fresh install the view
   * therefore reported `private_first` — so first-run showed no restriction
   * warning — while the engine routed `external`. Fail-safe in the display
   * with a permissive engine is the inversion of the intent. Both sides now
   * read the SAME resolution, so `restrictedByPlatform` is finally computed
   * against what the engine will actually do.
   */
  return composeAiPreferenceView({
    platformMode: resolveAiMode(cfg, resolveProviderId().provider),
    platformExternalConsent: cfg.externalConsent,
    row: tenantAiPreferenceStore.mine(),
  });
}
