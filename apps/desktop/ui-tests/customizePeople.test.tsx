/**
 * P13C ROUND 36 — GATE 5. PEOPLE CRUD IS FINALLY REACHABLE.
 *
 * The failure being pinned: `enterprise:org.createUser/updateUser/deleteUser`
 * were complete, audited, owner-guarded handlers with ZERO renderer callers —
 * a customer could not add, edit, or remove a person through the product.
 * These tests mount the Customize panel and prove the wired path: add calls
 * createUser, remove calls deleteUser, the seeded owner row offers no remove
 * and no email edit (O-13 — the handler strips it; the UI does not pretend),
 * and a refused mutation surfaces as an alert instead of a silent no-op.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const ctx = vi.hoisted(() => ({
  createUser: vi.fn(async () => undefined),
  updateUser: vi.fn(async () => undefined),
  deleteUser: vi.fn(async () => undefined),
}));

vi.mock('@renderer/enterprise/EnterpriseProvider', () => ({
  useEnterprise: () => ({
    org: {
      organization: { id: 'org-default', name: 'NeuroPause', slug: 'np' },
      units: [],
      roles: [],
      users: [
        {
          id: 'user-owner',
          orgId: 'org-default',
          name: 'Founder',
          email: 'founder@example.test',
          title: 'Owner',
          kind: 'human',
          workerId: null,
          unitId: null,
          roleIds: ['role-owner'],
          status: 'active',
          createdAt: 't',
          updatedAt: 't',
        },
        {
          id: 'user-2',
          orgId: 'org-default',
          name: 'Ada',
          email: 'ada@example.test',
          title: 'Engineer',
          kind: 'human',
          workerId: null,
          unitId: null,
          roleIds: [],
          status: 'active',
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    },
    governance: { approvalChains: [], complianceRules: [] },
    createUnit: vi.fn(async () => undefined),
    deleteUnit: vi.fn(async () => undefined),
    createRole: vi.fn(async () => undefined),
    setChain: vi.fn(async () => undefined),
    setRule: vi.fn(async () => undefined),
    createUser: ctx.createUser,
    updateUser: ctx.updateUser,
    deleteUser: ctx.deleteUser,
  }),
}));

import { CustomizePanel } from '@renderer/enterprise/CustomizePanel';

beforeEach(() => {
  cleanup();
  localStorage.clear();
  ctx.createUser.mockClear().mockImplementation(async () => undefined);
  ctx.deleteUser.mockClear().mockImplementation(async () => undefined);
  ctx.updateUser.mockClear();
});

describe('Customize → People (round 36)', () => {
  it('adds a person through the real provider call', async () => {
    const user = userEvent.setup();
    render(<CustomizePanel />);
    await user.type(screen.getByPlaceholderText('Full name…'), 'Grace');
    await user.type(screen.getByPlaceholderText('Email (sign-in address)…'), 'grace@example.test');
    await user.click(screen.getByRole('button', { name: /Add person/ }));
    await waitFor(() =>
      expect(ctx.createUser).toHaveBeenCalledWith({ name: 'Grace', email: 'grace@example.test', title: undefined }),
    );
  });

  it('removes a non-owner; the owner row offers no remove', async () => {
    const user = userEvent.setup();
    render(<CustomizePanel />);
    const removes = screen.getAllByTitle('Remove person');
    expect(removes).toHaveLength(1); // Ada only — never the protected owner
    expect(screen.getByText(/Owner \(protected\)/)).toBeTruthy();
    await user.click(removes[0]);
    await waitFor(() => expect(ctx.deleteUser).toHaveBeenCalledWith('user-2'));
  });

  it('editing the owner offers no email field (O-13: immutable by design)', async () => {
    const user = userEvent.setup();
    render(<CustomizePanel />);
    const edits = screen.getAllByTitle('Edit person');
    await user.click(edits[0]); // owner row renders first
    expect(screen.getByPlaceholderText('Name')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Email')).toBeNull();
  });

  it('a refused mutation surfaces as an alert, never a silent no-op', async () => {
    ctx.deleteUser.mockImplementation(async () => {
      throw new Error('Not authorized: missing permission "people:manage".');
    });
    const user = userEvent.setup();
    render(<CustomizePanel />);
    await user.click(screen.getAllByTitle('Remove person')[0]);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('people:manage');
  });
});
