/**
 * D-7b · SITE 4 — A REFUSED MODULE FAVORITE SPEAKS (Business family landing).
 *
 * `BusinessFamilySection`'s `FamilyLanding` had a per-module star button whose
 * `toggleFavorite` called `ipc.enterprise.personalization.favorite(...)`, caught
 * the rejection with `.catch(() => null)`, and then `if (state) setFavorites(...)`
 * — so on failure `state` was null, the guard skipped, and nothing happened:
 * no state change, no message. The channel is `dashboard:read` + requireAuth, so
 * a not-signed-in / non-member / under-permissioned actor was rejected at the
 * secure-bridge boundary and the click was completely silent.
 *
 * The fix raises an ANNOUNCED `error` toast (role="alert", aria-live="assertive")
 * carrying the D-6-cleaned boundary message VERBATIM, keyed per module. The
 * success arm (`setFavorites`, which flips the star) is unchanged.
 *
 * The failure assertions are the negative control against the old code:
 * `.catch(() => null)` swallows the rejection, so no alert appears. The success
 * control asserts the real channel was reached (`calls === 1` + `unroutedChannels()`
 * empty) — excluding the D-7 trap where a mistyped `IpcChannel` constant makes a
 * refusal test pass on an UNROUTED throw.
 *
 * TRAP guarded: `EnterpriseModuleList` is routed to `[]` on mount, else
 * `FamilyDashboard` renders its OWN `role="alert"` ("records could not be read"),
 * which would masquerade as the favorite alert.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';
import { IpcChannel, emptyPersonalizationState, type EnterpriseModuleSummary } from '@neuropause/shared';
import { BUSINESS_FAVORITE_KIND, businessFavoriteId, type BusinessFamilyGroup } from '@renderer/business/businessModel';
import { ToastProvider } from '@renderer/state/ToastProvider';
import { BusinessFamilySection } from '@renderer/business/BusinessFamilySection';

const MODULE: EnterpriseModuleSummary = {
  id: 'invoices',
  title: 'Invoices',
  singular: 'Invoice',
  plural: 'Invoices',
  icon: 'grid',
  description: 'Customer invoices.',
  group: 'Finance',
  fields: [],
  titleField: 'title',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [],
  recordCount: 12,
  activeCount: 5,
  aiSummary: false,
};

const FAMILY: BusinessFamilyGroup = {
  meta: { group: 'Finance', label: 'Finance', icon: 'grid', blurb: 'Invoices, payments and receivables.', permission: 'operations:manage' },
  modules: [MODULE],
  recordCount: 12,
  activeCount: 5,
  hasAi: false,
};

const FAVORITED = {
  ...emptyPersonalizationState(),
  favorites: [{ id: businessFavoriteId('invoices'), kind: BUSINESS_FAVORITE_KIND, label: 'Invoices', tab: 'business', addedAt: '' }],
};

// The verbatim boundary refusal for a `dashboard:read` channel.
const REFUSAL = 'Not authorized: missing permission "dashboard:read".';

function mount(): void {
  render(
    <ToastProvider>
      <BusinessFamilySection family={FAMILY} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  cleanup();
  clearRoutes();
  // Clean mount: route every channel FamilyLanding + FamilyDashboard fire, so the
  // dashboard shows its EmptyState (NOT its role="alert" failure branch) and
  // unroutedChannels() stays []. The only alert a test sees is the favorite's.
  route(IpcChannel.EnterpriseModuleList, () => []);
  route(IpcChannel.EnterpriseTimelineQuery, () => ({ entries: [], nextCursor: null, total: 0 }));
  route(IpcChannel.EnterprisePersonalizationGet, () => emptyPersonalizationState());
});

describe('BusinessFamilySection — a refused module favorite speaks (D-7b Site 4)', () => {
  it('a refused FAVORITE announces the reason', async () => {
    let calls = 0;
    route(IpcChannel.EnterprisePersonalizationFavorite, () => { calls++; throw new Error(REFUSAL); });
    mount();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Favorite Invoices' }));

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive'); // announced, not merely present
    expect(alert.textContent).toContain('dashboard:read');      // boundary message, verbatim
    expect(calls).toBe(1);                                       // the channel really was reached
  });

  it('a bare-string rejection still announces something — never an empty alert', async () => {
    route(IpcChannel.EnterprisePersonalizationFavorite, () => { throw 'a bare string'; });
    mount();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Favorite Invoices' }));

    const alert = await screen.findByRole('alert');
    expect((alert.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
});

describe('BusinessFamilySection — success is preserved and not accidental (D-7b Site 4)', () => {
  it('a successful FAVORITE relabels the star and raises no alert', async () => {
    let calls = 0;
    route(IpcChannel.EnterprisePersonalizationFavorite, () => { calls++; return FAVORITED; });
    mount();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Favorite Invoices' }));

    // Success behaviour preserved: setFavorites runs → the star relabels.
    expect(await screen.findByRole('button', { name: 'Unfavorite Invoices' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(calls).toBe(1);                    // catches a wrong IpcChannel constant
    expect(unroutedChannels()).toEqual([]);   // nothing silently unrouted
  });
});
