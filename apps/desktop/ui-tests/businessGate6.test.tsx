/**
 * P13C ROUND 49 — GATE 6. THE BUSINESS WORKSPACE IS NEVER BLANK AND NEVER LIES.
 *
 * Verification driven by a LIVE report: on a profile whose tenant refused
 * ("not a member"), the user saw the Business workspace "blank". These pin the
 * four states the surface can be in, through the real BusinessView:
 *   1. a DENIED channel read → the denial state (lock, no useless retry);
 *   2. a TRANSIENT fault → the fault state with a working "Try again";
 *   3. the round-49 all-filtered refusal (Gate 5's B-1 filter left nothing
 *      readable) → the denial state, never "No business areas yet";
 *   4. a genuinely empty registry ([]) → the honest empty state.
 * None of them is a blank screen or a permanent skeleton.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';

vi.mock('@renderer/state/ShellProvider', () => ({
  useShell: () => ({ businessTab: null, clearBusinessTab: () => undefined, setSection: () => undefined }),
}));

import { BusinessView } from '@renderer/business/BusinessView';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

describe('BusinessView states (Gate 6, round 49)', () => {
  it('a refused tenant ("not a member") renders the DENIAL state — never a blank screen', async () => {
    route(IpcChannel.EnterpriseModulesList, () => {
      throw new Error('Not authorized: this workspace belongs to an organization you are not a member of.');
    });
    render(<BusinessView />);
    expect(await screen.findByText('You don’t have access to Business')).toBeTruthy();
    // A denial offers no useless retry — the caller lacks access, not luck.
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
  });

  it('a transient fault renders the fault state and "Try again" really retries', async () => {
    let calls = 0;
    route(IpcChannel.EnterpriseModulesList, () => {
      calls += 1;
      if (calls === 1) throw new Error('backend unavailable');
      return [];
    });
    render(<BusinessView />);
    expect(await screen.findByText('Couldn’t load the Business workspace')).toBeTruthy();

    await userEvent.setup().click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('No business areas yet')).toBeTruthy();
    expect(calls).toBe(2);
  });

  it('the ALL-FILTERED refusal (round 49) renders as a denial — never "No business areas yet"', async () => {
    route(IpcChannel.EnterpriseModulesList, () => {
      throw new Error('None of the business modules are readable with your current permissions.');
    });
    render(<BusinessView />);
    expect(await screen.findByText('You don’t have access to Business')).toBeTruthy();
    expect(screen.queryByText('No business areas yet')).toBeNull();
  });

  it('a genuinely empty registry renders the honest empty state', async () => {
    route(IpcChannel.EnterpriseModulesList, () => []);
    render(<BusinessView />);
    expect(await screen.findByText('No business areas yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('with readable modules, the workspace renders the family rail (control)', async () => {
    route(IpcChannel.EnterpriseModulesList, () => [
      {
        id: 'finance',
        title: 'Finance',
        singular: 'Invoice',
        plural: 'Invoices',
        icon: 'database',
        description: 'test',
        titleField: 'number',
        group: 'Finance',
        permissions: { read: 'operations:read', write: 'operations:manage' },
        fields: [{ key: 'number', label: 'Number', type: 'text', required: true }],
        recordCount: 3,
        activeCount: 3,
        aiSummary: false,
        actions: [],
      },
    ]);
    render(<BusinessView />);
    await waitFor(() => expect(screen.queryByText('No business areas yet')).toBeNull());
    expect(screen.getAllByText(/Finance/).length).toBeGreaterThan(0);
  });
});
