/**
 * GATE 15 (round 47) — the medium-tier error-hiding sweep, closed.
 *
 * Five surfaces silently converted FAILED reads/writes into empty/success
 * states:
 *   1. KnowledgeWorkspaceView — `settled()` swallowed every dashboard read
 *      into its fallback (empty tiles as an all-clear); SearchTab rendered a
 *      backend outage as "No matches".
 *   2. IntegrationHealthPanel — a failed sync-state read rendered the honest-
 *      looking "No active integration syncs yet".
 *   3. ExecutePanel — failed target reads became "No <mode>s available"; the
 *      sessions/history poll's failures were fully silent.
 *   4. WorkforceProvider — `installs().catch(() => [])` rendered a denied read
 *      as "no installed packages".
 *   5. Settings crash-consent — a failed consent write silently snapped the
 *      toggle back with no explanation.
 *
 * Every failure is now SAID; every genuine empty stays honest.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';

vi.mock('@renderer/state/ShellProvider', () => ({
  useShell: () => ({ setSection: () => undefined }),
}));

import { KnowledgeWorkspaceView } from '@renderer/knowledge2/KnowledgeWorkspaceView';
import { IntegrationHealthPanel } from '@renderer/connectors/IntegrationHealthPanel';
import { ExecutePanel } from '@renderer/enterprise/ExecutePanel';
import { WorkforceProvider, useWorkforce } from '@renderer/workforce/WorkforceProvider';
import { CrashConsentRow } from '@renderer/settings/SettingsShell';

/** Route every knowledge-dashboard channel to success (overridden per test). */
function routeKnowledgeOk(): void {
  route(IpcChannel.MemoryCounts, () => ({ total: 3, byKind: {}, byOrigin: {}, lastBuiltAt: null }));
  route(IpcChannel.KnowledgeTopics, () => ({ topics: [], total: 0 }));
  route(IpcChannel.GraphCounts, () => ({ nodes: 5, edges: 2, byNodeType: {}, byEdgeType: {}, lastBuiltAt: null }));
  route(IpcChannel.EnterpriseGraph, () => null);
  route(IpcChannel.FabricOverview, () => null);
  route(IpcChannel.DecisionList, () => ({ decisions: [] }));
  route(IpcChannel.GovernanceList, () => ({ decisions: [], total: 0 }));
  route(IpcChannel.EnterpriseGovernanceConfig, () => null);
  route(IpcChannel.EnterpriseGovernanceCompliance, () => []);
}

beforeEach(() => {
  clearRoutes();
  cleanup();
});

describe('KnowledgeWorkspaceView — failed sources are NAMED, not empty tiles', () => {
  it('a denied memory + graph read raises an alert naming both; Retry recovers', async () => {
    routeKnowledgeOk();
    let failing = true;
    route(IpcChannel.MemoryCounts, () => {
      if (failing) throw new Error('Not authorized: missing permission "memory:read".');
      return { total: 3, byKind: {}, byOrigin: {}, lastBuiltAt: null };
    });
    route(IpcChannel.GraphCounts, () => {
      if (failing) throw new Error('graph store unavailable');
      return { nodes: 5, edges: 2, byNodeType: {}, byEdgeType: {}, lastBuiltAt: null };
    });
    render(<KnowledgeWorkspaceView />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be read');
    expect(alert.textContent).toContain('AI memory');
    expect(alert.textContent).toContain('Knowledge graph');

    failing = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('all sources healthy → no alert (the gate is not "always error")', async () => {
    routeKnowledgeOk();
    render(<KnowledgeWorkspaceView />);
    await screen.findByText(/3 memories/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a FAILED search is its own state — never "No matches"', async () => {
    routeKnowledgeOk();
    route(IpcChannel.EnterpriseSearch, () => {
      throw new Error('search index unavailable');
    });
    render(<KnowledgeWorkspaceView />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Search/ }));
    await user.type(screen.getByLabelText('Search enterprise knowledge'), 'invoices');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Search failed');
    expect(alert.textContent).toContain('search index unavailable');
    expect(screen.queryByText('No matches')).toBeNull();
  });
});

describe('IntegrationHealthPanel — a failed sync-state read is not "no syncs yet"', () => {
  it('a denied read shows the reason with Retry; recovery lands on the honest empty', async () => {
    let failing = true;
    route(IpcChannel.ConnectorSyncState, () => {
      if (failing) throw new Error('Not authorized: missing permission "connectors:read".');
      return [];
    });
    render(<IntegrationHealthPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Sync health could not be read');
    expect(alert.textContent).toContain('connectors:read');
    expect(screen.queryByText(/No active integration syncs yet/)).toBeNull();

    failing = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No active integration syncs yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a genuinely empty sync state stays the honest empty, no alert', async () => {
    route(IpcChannel.ConnectorSyncState, () => []);
    render(<IntegrationHealthPanel />);
    expect(await screen.findByText(/No active integration syncs yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ExecutePanel — failed reads are said, not rendered as absence', () => {
  function routeExecuteOk(): void {
    route(IpcChannel.ExecuteSessions, () => ({ sessions: [], stats: null }));
    route(IpcChannel.ExecuteHistory, () => ({ records: [] }));
  }

  it('a denied automation list is NOT "No automations available"', async () => {
    routeExecuteOk();
    route(IpcChannel.AutomationList, () => {
      throw new Error('Not authorized: missing permission "automation:read".');
    });
    render(<ExecutePanel />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'automation' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be loaded');
    expect(alert.textContent).toContain('automation:read');
  });

  it('a failing sessions/history poll raises the sticky feed banner', async () => {
    route(IpcChannel.ExecuteSessions, () => {
      throw new Error('execution store unavailable');
    });
    route(IpcChannel.ExecuteHistory, () => ({ records: [] }));
    render(<ExecutePanel />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('cannot be refreshed');
    expect(alert.textContent).toContain('execution store unavailable');
  });

  it('healthy reads show neither banner', async () => {
    routeExecuteOk();
    route(IpcChannel.AutomationList, () => ({ rules: [{ id: 'a1', name: 'Nightly report', status: 'active' }] }));
    render(<ExecutePanel />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'automation' }));
    await screen.findByText(/Nightly report/);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('WorkforceProvider — a denied installs read is exposed, never "no packages"', () => {
  function Probe(): JSX.Element {
    const { ready, installs, installsError } = useWorkforce();
    if (!ready) return <div>loading</div>;
    return (
      <div>
        <div data-testid="installs-count">{installs.length}</div>
        <div data-testid="installs-error">{installsError ?? 'none'}</div>
      </div>
    );
  }

  function routeWorkforceOk(): void {
    route(IpcChannel.WorkforceWorkers, () => []);
    route(IpcChannel.WorkforceJobs, () => ({ jobs: [] }));
    route(IpcChannel.WorkforceAudit, () => ({ entries: [], total: 0 }));
    route(IpcChannel.WorkforcePolicies, () => []);
    route(IpcChannel.WorkforceIntelligence, () => null);
    route(IpcChannel.WorkforceInstalls, () => []);
  }

  it('installs failure is recorded in context while the rest of the view stays usable', async () => {
    routeWorkforceOk();
    route(IpcChannel.WorkforceInstalls, () => {
      throw new Error('Not authorized: missing permission "workforce:read".');
    });
    render(
      <WorkforceProvider>
        <Probe />
      </WorkforceProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('installs-error').textContent).toContain('workforce:read'),
    );
    // Partial degradation preserved: the provider still became ready.
    expect(screen.getByTestId('installs-count').textContent).toBe('0');
  });

  it('a successful read clears the error', async () => {
    routeWorkforceOk();
    render(
      <WorkforceProvider>
        <Probe />
      </WorkforceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('installs-error').textContent).toBe('none'));
  });
});

describe('Settings crash-consent — a failed consent write is SAID, not a silent snap-back', () => {
  it('a refused opt-in reverts AND explains; the previous setting is named as still in effect', async () => {
    route(IpcChannel.CrashGetStatus, () => ({ optedIn: false }));
    route(IpcChannel.CrashSetOptIn, () => {
      throw new Error('consent store is read-only');
    });
    render(<CrashConsentRow />);
    const toggle = await screen.findByRole('switch', { name: 'Share crash reports' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await userEvent.setup().click(toggle);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not enable crash reporting');
    expect(alert.textContent).toContain('consent store is read-only');
    expect(alert.textContent).toContain('previous setting is still in effect');
    // The toggle reflects the TRUE state — consent did not change.
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('a successful change shows no note', async () => {
    route(IpcChannel.CrashGetStatus, () => ({ optedIn: false }));
    route(IpcChannel.CrashSetOptIn, (p) => ({ optedIn: (p as { optedIn: boolean }).optedIn }));
    render(<CrashConsentRow />);
    const toggle = await screen.findByRole('switch', { name: 'Share crash reports' });
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
