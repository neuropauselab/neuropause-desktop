/**
 * P13C ROUND 36 — GATE 15. THE ORG.LIST IDIOM AND THE GROUNDED-DASHBOARD LIE.
 *
 * Pinned here:
 *  1. `fetchActiveCloudOrg` — the shared resolver replacing five copies of
 *     `ipc.org.list().catch(() => [])` + `orgs[0]`: a failed list THROWS
 *     (never "you have no organization"), a single org resolves, multi-org
 *     resolves by the FINDING-6 name-match, ambiguity answers null-with-orgs.
 *  2. FeatureFlagsCenter — a failed org/license read renders the error card
 *     with retry, never free-tier entitlements for a paying customer.
 *  3. FamilyDashboard — a failed module read renders a named error with
 *     retry, never "No records yet — this dashboard draws every number from
 *     live records"; a genuinely empty family still gets the honest empty.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { fetchActiveCloudOrg } from '@renderer/lib/activeOrg';

vi.mock('@renderer/state/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { FeatureFlagsCenter } from '@renderer/settings/FeatureFlagsCenter';
import { FamilyDashboard } from '@renderer/business/FamilyDashboard';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const cloudOrg = (orgId: string, name: string): Record<string, unknown> => ({
  orgId,
  name,
  role: 'owner',
  memberCount: 1,
});

describe('fetchActiveCloudOrg (round 36)', () => {
  it('THROWS when the list fails — down is never "no organization"', async () => {
    route(IpcChannel.OrgList, () => {
      throw new Error('org service unreachable');
    });
    await expect(fetchActiveCloudOrg()).rejects.toThrow(/unreachable/);
  });

  it('a single org resolves directly', async () => {
    route(IpcChannel.OrgList, () => [cloudOrg('o1', 'Acme')]);
    const r = await fetchActiveCloudOrg();
    expect(r.active?.orgId).toBe('o1');
  });

  it('multi-org resolves by the active LOCAL organization name (FINDING-6)', async () => {
    route(IpcChannel.OrgList, () => [cloudOrg('o1', 'Acme'), cloudOrg('o2', 'Beta')]);
    route(IpcChannel.EnterpriseOrganizationList, () => [
      { id: 'l1', name: 'Beta', active: true },
      { id: 'l2', name: 'Acme', active: false },
    ]);
    const r = await fetchActiveCloudOrg();
    expect(r.active?.orgId).toBe('o2'); // NOT orgs[0]
  });

  it('ambiguity answers null-with-orgs — never a guess, never "none"', async () => {
    route(IpcChannel.OrgList, () => [cloudOrg('o1', 'Acme'), cloudOrg('o2', 'Beta')]);
    route(IpcChannel.EnterpriseOrganizationList, () => {
      throw new Error('local list down');
    });
    const r = await fetchActiveCloudOrg();
    expect(r.active).toBeNull();
    expect(r.orgs).toHaveLength(2);
  });
});

describe('FeatureFlagsCenter (round 36)', () => {
  it('a failed org read shows the error card with retry — never free-tier flags', async () => {
    let listCalls = 0;
    route(IpcChannel.OrgList, () => {
      listCalls += 1;
      throw new Error('org service unreachable');
    });
    render(<FeatureFlagsCenter />);
    expect(await screen.findByText(/Couldn.t load feature flags/)).toBeTruthy();
    expect(screen.queryByText(/free plan/i)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
  });

  it('a failed LICENSE read is an error too — a paying customer never sees free entitlements', async () => {
    route(IpcChannel.OrgList, () => [cloudOrg('o1', 'Acme')]);
    route(IpcChannel.LicenseRefresh, () => {
      throw new Error('license validator down');
    });
    render(<FeatureFlagsCenter />);
    expect(await screen.findByText(/Couldn.t load feature flags/)).toBeTruthy();
    expect(screen.queryByText(/free plan/i)).toBeNull();
  });
});

describe('FamilyDashboard (round 36)', () => {
  const family = {
    meta: { group: 'Finance', label: 'Finance', icon: 'grid', blurb: '', permission: 'operations:manage' },
    modules: [
      { id: 'finance-invoices', title: 'Invoices' },
      { id: 'finance-payments', title: 'Payments' },
    ],
  } as never;

  it('a denied module read is a named error — never "No records yet, every number is live"', async () => {
    route(IpcChannel.EnterpriseModuleList, (p) => {
      const { moduleId } = p as { moduleId: string };
      if (moduleId === 'finance-invoices') throw new Error('Not authorized: missing permission "finance:read".');
      return [];
    });
    render(<FamilyDashboard family={family} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be read');
    expect(alert.textContent).toContain('Invoices');
    expect(screen.queryByText(/No Finance records yet/)).toBeNull();
  });

  it('a genuinely empty family still renders the honest empty state', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    render(<FamilyDashboard family={family} />);
    expect(await screen.findByText(/No Finance records yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
