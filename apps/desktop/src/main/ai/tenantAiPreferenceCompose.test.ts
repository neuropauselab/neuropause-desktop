/**
 * THE COMPOSITION, TESTED. P13C ROUND 17g.
 *
 * WHY THIS FILE EXISTS, STATED PLAINLY.
 *
 * `round17TenantAiPreference.test.ts` asserts 23 things about the STORE and the
 * pure `resolveEffectiveAiMode` in `packages/shared`. It asserts nothing about
 * the composition — the function that decides what the product actually tells a
 * user — because that function imported the Electron-bound store instance and
 * could not be imported here.
 *
 * That gap is not academic. The single defect this program shipped lived in
 * exactly that function: `restrictedByPlatform` compared modes and ignored
 * `externalConsent`, so a default install told an organization its cloud choice
 * was in force while external routing was impossible. It was found by a human
 * running a fresh install. The tests could not have found it. The first case
 * below is that defect, pinned.
 */
import { describe, expect, it } from 'vitest';
import type { AiMode, TenantAiMode } from '@neuropause/shared';
import { composeAiPreferenceView } from './tenantAiPreferenceCompose';

/** Rank order, NOT the declaration order of `AI_MODES` (which is UI order). */
const MODES: readonly AiMode[] = ['local_only', 'private_first', 'external'];
const RANK: Record<AiMode, number> = { local_only: 0, private_first: 1, external: 2 };
const TENANT_MODES: readonly TenantAiMode[] = ['local_only', 'private_first'];

const row = (mode: TenantAiMode): { mode: TenantAiMode; updatedAt: number } => ({
  mode,
  updatedAt: 1_700_000_000_000,
});

describe('composeAiPreferenceView — the defect that shipped', () => {
  it('a default install that permits cloud AI is RESTRICTED, because consent is off', () => {
    // Platform mode and tenant mode AGREE here. Comparing modes alone says
    // "not restricted" — which is what shipped, and what produced a saved
    // preference, no notice, and no external routing.
    const view = composeAiPreferenceView({
      platformMode: 'private_first',
      platformExternalConsent: false,
      row: row('private_first'),
    });
    expect(view.effectiveMode).toBe('private_first');
    expect(view.restrictedByPlatform).toBe(true);
  });

  it('the same install with consent ON is not restricted', () => {
    const view = composeAiPreferenceView({
      platformMode: 'private_first',
      platformExternalConsent: true,
      row: row('private_first'),
    });
    expect(view.restrictedByPlatform).toBe(false);
  });

  it('platform `external` with consent off still restricts a `private_first` tenant', () => {
    // Recorded because the prediction was wrong: `external` mode routes
    // directly and needs no consent, but the EFFECTIVE mode here is the
    // tenant's `private_first`, which does. Restricted is correct.
    const view = composeAiPreferenceView({
      platformMode: 'external',
      platformExternalConsent: false,
      row: row('private_first'),
    });
    expect(view.effectiveMode).toBe('private_first');
    expect(view.restrictedByPlatform).toBe(true);
  });
});

describe('composeAiPreferenceView — a tenant can only narrow', () => {
  it('rank(effective) <= rank(platform) for every platform x tenant pair', () => {
    for (const platformMode of MODES) {
      for (const tenantMode of TENANT_MODES) {
        for (const platformExternalConsent of [false, true]) {
          const view = composeAiPreferenceView({
            platformMode,
            platformExternalConsent,
            row: row(tenantMode),
          });
          expect(
            RANK[view.effectiveMode],
            `a tenant preference widened platform policy: platform=${platformMode} ` +
              `tenant=${tenantMode} consent=${platformExternalConsent} -> ${view.effectiveMode}`,
          ).toBeLessThanOrEqual(RANK[platformMode]);
        }
      }
    }
  });

  it('never reports a `local_only` tenant as restricted — it asked to be narrower', () => {
    for (const platformMode of MODES) {
      for (const platformExternalConsent of [false, true]) {
        const view = composeAiPreferenceView({
          platformMode,
          platformExternalConsent,
          row: row('local_only'),
        });
        expect(view.effectiveMode).toBe('local_only');
        expect(view.restrictedByPlatform).toBe(false);
      }
    }
  });
});

describe('composeAiPreferenceView — no preference is not a preference', () => {
  it('an organization that has never chosen gets platform policy, unchanged and unflagged', () => {
    for (const platformMode of MODES) {
      const view = composeAiPreferenceView({
        platformMode,
        platformExternalConsent: false,
        row: null,
      });
      expect(view.tenantMode).toBeNull();
      expect(view.effectiveMode).toBe(platformMode);
      expect(view.restrictedByPlatform).toBe(false);
      expect(view.updatedAt).toBeNull();
    }
  });
});

describe('composeAiPreferenceView — the view reports its own inputs', () => {
  it('carries the platform consent flag through, so a caller cannot forget it exists', () => {
    // The UI needs to distinguish "your mode is narrower" from "consent is off";
    // dropping this field is what made the two indistinguishable.
    const view = composeAiPreferenceView({
      platformMode: 'private_first',
      platformExternalConsent: false,
      row: row('private_first'),
    });
    expect(view.platformExternalConsent).toBe(false);
    expect(view.platformMode).toBe('private_first');
    expect(view.tenantMode).toBe('private_first');
    expect(view.updatedAt).toBe(1_700_000_000_000);
  });
});
