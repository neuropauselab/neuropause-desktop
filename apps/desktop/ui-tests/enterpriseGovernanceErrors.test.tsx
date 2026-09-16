/**
 * GATE 5 — E-11. SILENT MUTATIONS ON THE GOVERNANCE SURFACES.
 *
 * The failures being pinned: DecisionCenterPanel's approve/reject/delegate and
 * CustomizePanel's unit/role/governance mutations were `try/finally` with no
 * catch or fire-and-forget `void` calls. A reviewer who clicked Approve on a
 * governed action and got a permission denial saw NOTHING — and walked away
 * believing the action was approved. A denied governance toggle was a no-op
 * with no explanation on the surface that decides which approval chains and
 * compliance rules are enforced.
 *
 * Every refusal is now said verbatim (`role=alert`), the decision card stays
 * open for a retry, and success paths still close/clear as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const ctx = vi.hoisted(() => ({
  approve: vi.fn(async () => undefined as unknown),
  reject: vi.fn(async () => undefined as unknown),
  delegate: vi.fn(async () => null),
  createUnit: vi.fn(async () => undefined),
  deleteUnit: vi.fn(async () => undefined),
  createRole: vi.fn(async () => undefined),
  setChain: vi.fn(async () => undefined),
  setRule: vi.fn(async () => undefined),
}));

/** One pending governed proposal awaiting a human decision. */
const JOB = {
  id: 'job-1',
  workerId: 'worker-1',
  skillId: 'send_update',
  createdAt: new Date().toISOString(),
  proposals: [
    {
      id: 'prop-1',
      title: 'Send the weekly update',
      summary: 'Drafted from this week’s records.',
      risk: 'high',
      sideEffects: true,
      evidence: [],
      approval: null,
      verdict: { decision: 'require_approval', checks: [], evaluations: [] },
    },
  ],
};

vi.mock('@renderer/enterprise/EnterpriseProvider', () => ({
  useEnterprise: () => ({
    org: {
      organization: { id: 'org-default', name: 'NeuroPause', slug: 'np' },
      units: [
        { id: 'unit-1', orgId: 'org-default', kind: 'team', name: 'Platform', parentId: null, leadUserId: null },
      ],
      roles: [],
      users: [],
    },
    governance: {
      approvalChains: [
        { id: 'chain-1', name: 'Spending over ₹1L', description: 'CFO sign-off', steps: [{}], enabled: true },
      ],
      complianceRules: [
        { id: 'rule-1', name: 'GST filings on time', category: 'finance', severity: 'high', enabled: true },
      ],
    },
    jobs: [JOB],
    workers: [{ id: 'worker-1', name: 'Ops Worker', role: 'ops' }],
    graph: null,
    compliance: [],
    recommendations: [],
    approve: ctx.approve,
    reject: ctx.reject,
    delegate: ctx.delegate,
    createUnit: ctx.createUnit,
    deleteUnit: ctx.deleteUnit,
    createRole: ctx.createRole,
    setChain: ctx.setChain,
    setRule: ctx.setRule,
    createUser: vi.fn(async () => undefined),
    updateUser: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
  }),
}));

import { DecisionCenterPanel } from '@renderer/enterprise/DecisionCenterPanel';
import { CustomizePanel } from '@renderer/enterprise/CustomizePanel';

beforeEach(() => {
  cleanup();
  localStorage.clear();
  for (const fn of Object.values(ctx)) (fn as ReturnType<typeof vi.fn>).mockClear();
  ctx.approve.mockImplementation(async () => undefined);
  ctx.deleteUnit.mockImplementation(async () => undefined);
  ctx.createRole.mockImplementation(async () => undefined);
  ctx.setChain.mockImplementation(async () => undefined);
  ctx.setRule.mockImplementation(async () => undefined);
});

describe('DecisionCenterPanel — a failed decision is said, never silent (E-11)', () => {
  it('a DENIED approve shows the refusal and keeps the decision open for retry', async () => {
    ctx.approve.mockImplementation(async () => {
      throw new Error('Not authorized: missing permission "workforce:approve".');
    });
    const user = userEvent.setup();
    render(<DecisionCenterPanel onNavigate={() => undefined} />);

    await user.click(screen.getByRole('button', { name: /Review decision/ }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('NOT recorded');
    expect(alert.textContent).toContain('workforce:approve');
    // The card stays open — the reviewer can retry or escalate.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(ctx.approve).toHaveBeenCalledWith('job-1', 'prop-1', undefined);
  });

  it('a successful approve closes the card and shows no alert', async () => {
    const user = userEvent.setup();
    render(<DecisionCenterPanel onNavigate={() => undefined} />);
    await user.click(screen.getByRole('button', { name: /Review decision/ }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed approve followed by a retry that succeeds clears the alert', async () => {
    ctx.approve
      .mockImplementationOnce(async () => {
        throw new Error('backend unavailable');
      })
      .mockImplementation(async () => undefined);
    const user = userEvent.setup();
    render(<DecisionCenterPanel onNavigate={() => undefined} />);
    await user.click(screen.getByRole('button', { name: /Review decision/ }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(ctx.approve).toHaveBeenCalledTimes(2);
  });
});

describe('CustomizePanel — units, roles and governance toggles say their refusals (E-11)', () => {
  it('a DENIED unit delete surfaces an alert, never a silent no-op', async () => {
    ctx.deleteUnit.mockImplementation(async () => {
      throw new Error('Not authorized: missing permission "org:manage".');
    });
    const user = userEvent.setup();
    render(<CustomizePanel />);
    await user.click(screen.getByTitle('Delete unit'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('org:manage');
  });

  it('a DENIED role create surfaces an alert', async () => {
    ctx.createRole.mockImplementation(async () => {
      throw new Error('Not authorized: missing permission "org:manage".');
    });
    const user = userEvent.setup();
    render(<CustomizePanel />);
    await user.type(screen.getByPlaceholderText('New role name…'), 'Auditor');
    await user.click(screen.getByRole('button', { name: /Create role/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('org:manage');
  });

  it('a DENIED approval-chain toggle is said — the enforcement switch never fails silently', async () => {
    ctx.setChain.mockImplementation(async () => {
      throw new Error('Not authorized: missing permission "governance:manage".');
    });
    const user = userEvent.setup();
    render(<CustomizePanel />);
    // The chain row's toggle (aria-pressed reflects enabled state).
    const toggles = screen.getAllByRole('button', { pressed: true });
    await user.click(toggles[0]);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('governance:manage');
    expect(ctx.setChain).toHaveBeenCalledWith('chain-1', false);
  });

  it('a DENIED compliance-rule toggle is said too', async () => {
    ctx.setRule.mockImplementation(async () => {
      throw new Error('Not authorized: missing permission "governance:manage".');
    });
    const user = userEvent.setup();
    render(<CustomizePanel />);
    const toggles = screen.getAllByRole('button', { pressed: true });
    await user.click(toggles[1]);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('governance:manage');
    expect(ctx.setRule).toHaveBeenCalledWith('rule-1', false);
  });

  it('successful mutations still show no alert (the gate is not "always error")', async () => {
    const user = userEvent.setup();
    render(<CustomizePanel />);
    await user.click(screen.getByTitle('Delete unit'));
    await waitFor(() => expect(ctx.deleteUnit).toHaveBeenCalledWith('unit-1'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
