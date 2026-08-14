/**
 * P13C ROUND 36 — GATE 12. FAILURE IS NEVER DRESSED AS EMPTINESS.
 *
 * Three screens used to render a backend failure as a plausible empty state:
 *  - the AI Store said "No matching apps — try a different search or category"
 *    over a dead catalog (blaming the user's query for an outage);
 *  - Getting Started hung on "Loading your checklist…" forever under a
 *    fabricated "0 of 0 done" header;
 *  - enterprise search said "No results for X — try a different term".
 * These tests fail each backend for real (thrown route), assert the failure is
 * SAID with a retry, and — the other half of honesty — that the genuine empty
 * state still renders as empty when the backend answers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';

vi.mock('@renderer/state/ShellProvider', () => ({
  useShell: () => ({ setSection: vi.fn(), openEnterprise: vi.fn(), openApp: vi.fn() }),
}));

// The search panel enriches results from the live enterprise context; the
// failure path under test only needs the context to EXIST.
vi.mock('@renderer/enterprise/EnterpriseProvider', () => ({
  useEnterprise: () => ({
    workers: [],
    governance: { approvalChains: [], complianceRules: [] },
    jobs: [],
    org: { organization: null, units: [], roles: [], users: [] },
    graph: null,
  }),
}));

import { WelcomeView } from '@renderer/views/WelcomeView';
import { EnterpriseSearchPanel } from '@renderer/enterprise/EnterpriseSearchPanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

describe('WelcomeView checklist failure (round 36)', () => {
  it('a failed status read shows an error with retry — never an eternal spinner or "0 of 0"', async () => {
    let calls = 0;
    route(IpcChannel.OnboardingStatus, () => {
      calls += 1;
      throw new Error('onboarding store unavailable');
    });
    route(IpcChannel.PilotStatus, () => null);
    render(<WelcomeView />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be loaded');
    expect(screen.queryByText(/Loading your checklist/)).toBeNull();
    expect(screen.queryByText(/0 of 0 done/)).toBeNull();
    // Retry re-invokes the real channel.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls).toBeGreaterThan(1));
  });
});

describe('EnterpriseSearchPanel failure (round 36)', () => {
  it('a search backend failure is its own state — never "No results, try a different term"', async () => {
    let calls = 0;
    route(IpcChannel.EnterpriseSearch, () => {
      calls += 1;
      throw new Error('search index unavailable');
    });
    render(<EnterpriseSearchPanel initialQuery="revenue" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Search could not run');
    expect(screen.queryByText(/No results for/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls).toBeGreaterThan(1));
  });

  it('a genuinely empty result still renders the honest empty copy', async () => {
    route(IpcChannel.EnterpriseSearch, () => ({ query: 'revenue', hits: [], groups: [], total: 0, backends: ['local'] }));
    render(<EnterpriseSearchPanel initialQuery="revenue" />);
    expect(await screen.findByText(/No results for/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

import { SearchResults } from '@renderer/store/MarketplaceHome';

describe('AI Store search failure (round 36)', () => {
  it('a dead catalog is said with retry — never "No matching apps, try a different search"', async () => {
    let calls = 0;
    route(IpcChannel.CatalogSearch, () => {
      calls += 1;
      if (calls === 1) throw new Error('store backend unreachable');
      return { items: [], total: 0 };
    });
    render(<SearchResults query="crm" category={null} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The Store could not load');
    expect(screen.queryByText('No matching apps')).toBeNull();
    // Retry lands on the now-healthy backend and the HONEST empty state shows.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No matching apps')).toBeTruthy();
    expect(calls).toBeGreaterThan(1);
  });
});
