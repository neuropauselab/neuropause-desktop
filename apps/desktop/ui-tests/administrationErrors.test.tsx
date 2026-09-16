/**
 * P13C ROUND 36 — GATE 5. THE ADMIN CENTER HAS AN ERROR STATE.
 *
 * The failure being pinned: all seventeen loads passed through a `settled()`
 * that swallowed every failure into its fallback, `setReady(true)` fired
 * unconditionally, and the 600-line control centre had NO error state and NO
 * retry — a denied `governance:read` rendered as a CLEAN audit trail
 * ("No audit entries yet"). These tests mount the real view over the real
 * harness, fail exactly one load (the audit), and prove: the banner names it,
 * the audit cell renders an explicit error instead of its empty state, Retry
 * re-runs the loads, and a fully healthy load shows no banner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';

vi.mock('@renderer/state/ShellProvider', () => ({
  useShell: () => ({ setSection: vi.fn(), openEnterprise: vi.fn() }),
}));

import { AdministrationView } from '@renderer/administration/AdministrationView';

/** Route every channel the view loads; `auditFails` controls the one failure. */
function routeAll(opts: { auditFails: boolean; auditCalls?: { n: number } }): void {
  route(IpcChannel.OrgList, () => []);
  route(IpcChannel.EnterpriseOrganizationList, () => []);
  route(IpcChannel.EnterpriseOrgGet, () => null);
  route(IpcChannel.EnterpriseGovernanceConfig, () => null);
  route(IpcChannel.EnterpriseGovernanceCompliance, () => []);
  route(IpcChannel.EnterpriseGovernanceAudit, () => {
    if (opts.auditCalls) opts.auditCalls.n += 1;
    if (opts.auditFails) throw new Error('Not authorized: missing permission "governance:read".');
    return [];
  });
  route(IpcChannel.CloudIdentitySummary, () => null);
  route(IpcChannel.CloudMfa, () => null);
  route(IpcChannel.CloudAdminCompliance, () => null);
  route(IpcChannel.CloudRegions, () => []);
  route(IpcChannel.EcosystemKeysList, () => []);
  route(IpcChannel.WorkforceWorkers, () => []);
  route(IpcChannel.ConnectorStats, () => null);
  route(IpcChannel.ConnectorsList, () => []);
  route(IpcChannel.CommercialLicensing, () => null);
  route(IpcChannel.CommercialMetering, () => null);
  route(IpcChannel.ReleaseDiagnosticsGet, () => null);
}

beforeEach(() => {
  cleanup();
  clearRoutes();
});

describe('AdministrationView error state (round 36)', () => {
  it('a failed audit load raises the banner and names the panel', async () => {
    routeAll({ auditFails: true });
    render(<AdministrationView />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not load');
    expect(alert.textContent).toContain('Audit trail');
    expect(alert.textContent).toContain('fallback, not verified state');
  });

  it('the audit cell renders an explicit error, never a clean "No audit entries yet"', async () => {
    routeAll({ auditFails: true });
    render(<AdministrationView />);
    await screen.findByRole('alert');
    await userEvent.setup().click(screen.getByRole('button', { name: /Compliance & Audit/ }));
    expect(await screen.findByText(/could not be loaded — what would appear here is unknown/)).toBeTruthy();
    expect(screen.queryByText('No audit entries yet')).toBeNull();
  });

  it('Retry re-runs the loads', async () => {
    const auditCalls = { n: 0 };
    routeAll({ auditFails: true, auditCalls });
    render(<AdministrationView />);
    await screen.findByRole('alert');
    const before = auditCalls.n;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(auditCalls.n).toBeGreaterThan(before));
  });

  it('a fully healthy load shows no banner, and the genuine empty state remains honest', async () => {
    routeAll({ auditFails: false });
    render(<AdministrationView />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /Compliance & Audit/ }));
    expect(await screen.findByText('No audit entries yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
